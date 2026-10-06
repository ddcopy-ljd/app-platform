"""本地打印桥（Print Bridge）——跑在店里连标签机的电脑上。

云端只生成 ZPL 并入队；本程序经 WebSocket 与云端保持长连接，任务即时下发，
通过 Windows 打印池 RAW 直发本机标签机，并把打印结果经同一连接回执云端。

特点：
- 仅 Python 标准库（内置极简 WebSocket 客户端），无需安装第三方包；
- 桥接机主动连云端（出站），无需公网 IP/端口映射，不受浏览器 HTTPS 混合内容限制；
- 任务即时推送，断线自动重连；
- 同一 Wi-Fi 下的手机/电脑点打印，都会经云端路由到这台电脑出纸。

用法：
  python print_agent.py list   # 列出本机打印机（复制名称填入 print_agent.json）
  python print_agent.py run    # 启动桥接（首次运行自动生成 print_agent.json）
  python print_agent.py burn <目标exe副本> <门店Token>
                               # 把门店Token烧录进 exe 尾部（overlay），分发后免填 Token

登录方式（多门店流程，无需账号）：
  1. 首次运行填 云端地址；
  2. 粘贴该门店的桥接密钥（云端【店铺管理 → 门店与打印代理】生成），不填门店码；
     —— 若 exe 已用 burn 烧录门店Token，此步自动跳过；
  3. 云端直接显示密钥所属门店名称，人工核对确认后才进入服务；
  4. 身份名默认「{门店名}打印桥」，连接即上报本机全部打印机，由门店在云端指派。
  一个密钥绑定一家门店；多家门店需在各自门店电脑上用各自密钥分别启动。
"""

import base64
import ctypes
import hashlib
import json
import os
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from ctypes import wintypes

# PyInstaller 单文件运行时 __file__ 指向临时解压目录；冻结态改用 exe 所在目录存配置
if getattr(sys, "frozen", False):
    _BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(_BASE_DIR, "print_agent.json")

# ---- exe 尾部内嵌门店 Token（overlay）----
# 结构：token字节 + 4字节大端长度 + 魔术"PBTKN001"，共 len+12 字节附加在文件末尾。
# Windows 加载器只按 PE 头读取映像，尾部 overlay 被完全忽略，不影响启动与运行。
# 分发流程：build_exe.bat 生成 dist\PrintBridge.exe 后，对每店副本执行 burn 烧录各自 Token。
_TOKEN_MAGIC = b"PBTKN001"
_TOKEN_MAX = 4096

DEFAULT_CONFIG = {
    "server": "http://127.0.0.1:8002",
    "token": "",                     # 门店Token（云端【店铺管理 → 门店与打印代理】生成）
    "name": "",                      # 代理身份名：留空则默认「{门店名}打印桥」
    "printer": "",                   # 标签业务打印机（云端按业务指派，自动写入，也可手填）
    "biz_printers": {},              # 全部打印业务 -> 打印机名（云端 config 推送，自动持久化）
    "cmd_feed": "~JA",               # 进纸指令（ZPL）
    "cmd_backfeed": "~JD",           # 退纸指令（机型相关，可按打印机手册修改）
    "insecure_ssl": False,           # 云端自签名证书时置 true
}


# ---------------------------------------------------------------- 极简 WebSocket 客户端（RFC6455 子集）

class MiniWS:
    """零依赖 WebSocket 客户端：文本帧收发、自动回应 Ping、支持 7/16/64 位长度。
    仅配合本系统服务端使用（不处理扩展与客户端分片发送）。"""

    def __init__(self, url, insecure_ssl=False, timeout=40):
        u = urllib.parse.urlparse(url)
        secure = u.scheme in ("wss", "https")
        host, path = u.hostname, (u.path or "/") + (("?" + u.query) if u.query else "")
        if not host:
            raise OSError(f"无效地址：{url}")
        port = u.port or (443 if secure else 80)
        raw = socket.create_connection((host, port), timeout=timeout)
        if secure:
            ctx = ssl._create_unverified_context() if insecure_ssl else ssl.create_default_context()
            raw = ctx.wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET " + path + " HTTP/1.1\r\nHost: " + host + ":" + str(port) +
               "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n")
        raw.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = raw.recv(4096)
            if not chunk:
                raise OSError("握手失败：连接中断")
            resp += chunk
        head, _, rest = resp.partition(b"\r\n\r\n")
        status_line = head.split(b"\r\n")[0]
        if b" 101 " not in status_line:
            raise OSError("握手失败：" + status_line.decode("utf-8", errors="replace"))
        expected = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if expected.encode() not in head:
            raise OSError("握手校验失败")
        self._buf = rest
        self.sock = raw
        self._lock = threading.Lock()

    def _readn(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise OSError("连接已断开")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _read_frame(self):
        b1, b2 = self._readn(2)
        opcode, masked, ln = b1 & 0x0F, b2 & 0x80, b2 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", self._readn(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", self._readn(8))[0]
        mask = self._readn(4) if masked else b""
        payload = self._readn(ln) if ln else b""
        if masked:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        return opcode, payload

    def _send_frame(self, opcode, payload):
        with self._lock:
            head = bytearray([0x80 | opcode])
            n = len(payload)
            if n < 126:
                head.append(0x80 | n)
            elif n < 65536:
                head.append(0x80 | 126)
                head += struct.pack(">H", n)
            else:
                head.append(0x80 | 127)
                head += struct.pack(">Q", n)
            key = os.urandom(4)
            head += key
            masked = bytes(c ^ key[i % 4] for i, c in enumerate(payload))
            self.sock.sendall(bytes(head) + masked)

    def send_text(self, s):
        self._send_frame(0x1, s.encode("utf-8"))

    def recv_text(self):
        """返回一条文本消息；连接关闭返回 None；自动回应服务端 Ping。"""
        while True:
            opcode, payload = self._read_frame()
            if opcode in (0x1, 0x2):
                return payload.decode("utf-8", errors="replace")
            if opcode == 0x9:            # Ping -> Pong
                self._send_frame(0xA, payload)
            elif opcode == 0xA:          # Pong
                continue
            elif opcode == 0x8:          # Close
                return None

    def close(self):
        try:
            self._send_frame(0x8, b"")
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


# ---------------------------------------------------------------- Windows RAW 打印（ctypes winspool）

class _DOC_INFO_1W(ctypes.Structure):
    _fields_ = [("pDocName", wintypes.LPWSTR),
                ("pOutputFile", wintypes.LPWSTR),
                ("pDatatype", wintypes.LPWSTR)]


class _PRINTER_INFO_4W(ctypes.Structure):
    _fields_ = [("pPrinterName", wintypes.LPWSTR),
                ("pServerName", wintypes.LPWSTR),
                ("Attributes", wintypes.DWORD)]


def list_printers():
    """枚举本机打印机（EnumPrintersW，PRINTER_INFO_4 结构体数组）。"""
    winspool = ctypes.WinDLL("winspool.drv")
    winspool.EnumPrintersW.argtypes = [
        wintypes.DWORD, wintypes.LPWSTR, wintypes.DWORD,
        ctypes.c_void_p, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD)]
    need = wintypes.DWORD()
    got = wintypes.DWORD()
    level, flags = 4, 2 | 4  # PRINTER_INFO_4, LOCAL | CONNECTIONS
    winspool.EnumPrintersW(flags, None, level, None, 0, ctypes.byref(need), ctypes.byref(got))
    if need.value == 0:
        return []
    buf = ctypes.create_string_buffer(need.value)
    if not winspool.EnumPrintersW(flags, None, level, buf, need.value, ctypes.byref(need), ctypes.byref(got)):
        return []
    arr = ctypes.cast(buf, ctypes.POINTER(_PRINTER_INFO_4W))
    names = []
    for i in range(got.value):
        nm = arr[i].pPrinterName
        if nm:
            names.append(nm)
    return names


def raw_print(printer, data, title):
    """通过 Windows 打印池以 RAW 数据类型直发字节流（ZPL 原样透传）。"""
    winspool = ctypes.WinDLL("winspool.drv")
    h = wintypes.HANDLE()
    if not winspool.OpenPrinterW(printer or None, ctypes.byref(h), None):
        raise OSError(f"打开打印机失败：{printer or '(默认)'} 错误码 {ctypes.GetLastError()}")
    doc = _DOC_INFO_1W(pDocName=title, pOutputFile=None, pDatatype="RAW")
    try:
        if not winspool.StartDocPrinterW(h, 1, ctypes.byref(doc)):
            raise OSError(f"StartDocPrinter 失败 错误码 {ctypes.GetLastError()}")
        if not winspool.StartPagePrinter(h):
            raise OSError(f"StartPagePrinter 失败 错误码 {ctypes.GetLastError()}")
        written = wintypes.DWORD()
        buf = ctypes.create_string_buffer(data, len(data))
        if not winspool.WritePrinter(h, buf, len(data), ctypes.byref(written)):
            raise OSError(f"WritePrinter 失败 错误码 {ctypes.GetLastError()}")
        winspool.EndPagePrinter(h)
        winspool.EndDocPrinter(h)
    finally:
        winspool.ClosePrinter(h)


# ---------------------------------------------------------------- 主循环

def _self_exe_path():
    """本程序自身路径：冻结态为 exe，脚本态为 .py（脚本态无 overlay，读不到即视为未烧录）。"""
    return os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__)


def _read_embedded_token(path=None):
    """读取 exe 尾部内嵌的门店 Token；未烧录/文件不可读返回 ''。"""
    p = path or _self_exe_path()
    try:
        with open(p, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            if size < 12:
                return ""
            f.seek(size - 12)
            tail = f.read(12)
            if tail[4:] != _TOKEN_MAGIC:
                return ""
            tlen = struct.unpack(">I", tail[:4])[0]
            if tlen <= 0 or tlen > _TOKEN_MAX or size < 12 + tlen:
                return ""
            f.seek(size - 12 - tlen)
            return f.read(tlen).decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def embed_token_bytes(exe_bytes, token):
    """纯字节版烧录：剥除旧 overlay 后追加 token+长度+魔术，返回新 exe 字节。
    供后端下载接口在内存中按门店动态注入 Token（不落临时文件）。"""
    token = (token or "").strip()
    if not token:
        raise ValueError("Token 不能为空")
    data = token.encode("utf-8")
    if len(data) > _TOKEN_MAX:
        raise ValueError("Token 过长")
    if exe_bytes[:2] != b"MZ":
        raise ValueError("目标不是 Windows 可执行文件（MZ 头校验失败）")
    size = len(exe_bytes)
    if size >= 12:
        tail = exe_bytes[-12:]
        if tail[4:] == _TOKEN_MAGIC:
            tlen = struct.unpack(">I", tail[:4])[0]
            if 0 < tlen <= _TOKEN_MAX and size >= 12 + tlen:
                exe_bytes = exe_bytes[:size - 12 - tlen]
    return exe_bytes + data + struct.pack(">I", len(data)) + _TOKEN_MAGIC


def embed_token(target, token):
    """文件版烧录：读目标 exe → 字节烧录 → 写回。
    注意：Windows 不允许改写正在运行的 exe，请对未运行的副本操作。"""
    token = (token or "").strip()
    with open(target, "rb") as f:
        raw = f.read()
    if _read_embedded_token(target):
        print("[burn] 已剥除旧内嵌 Token")
    try:
        out = embed_token_bytes(raw, token)
    except ValueError as e:
        raise SystemExit(f"[burn] {e}")
    try:
        with open(target, "wb") as f:
            f.write(out)
    except PermissionError:
        raise SystemExit("[burn] 写入失败：目标 exe 正在运行或被占用，请换未运行的副本")
    ok = _read_embedded_token(target) == token
    print(f"[burn] {'成功' if ok else '失败'}：门店 Token（{len(token)} 字符）-> {target}")
    if not ok:
        raise SystemExit(1)


def _ensure_config():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        print(f"[config] 已生成配置 {CONFIG_PATH}，请填写云端地址与桥接密钥后重新运行")
        sys.exit(0)
    # utf-8-sig 兼容带 BOM 的配置（记事本/部分编辑器保存时会加 BOM）
    with open(CONFIG_PATH, "r", encoding="utf-8-sig") as f:
        cfg = json.load(f)
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg or {})
    changed = False
    if not str(merged.get("server") or "").strip():
        merged["server"] = input("云端地址（如 https://xxx.yourdomain.com）：").strip()
        changed = True
    if not str(merged.get("token") or "").strip():
        # 配置文件无 Token 时兜底读 exe 尾部内嵌值（burn 烧录的分发场景）
        embedded = _read_embedded_token()
        if embedded:
            merged["token"] = embedded
            print(f"[config] 使用 exe 内嵌门店 Token（{len(embedded)} 字符），跳过手工粘贴")
    if not str(merged.get("token") or "").strip():
        merged["token"] = input("门店Token（云端【店铺管理 → 门店与打印代理】生成）：").strip()
        changed = True
    if changed:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged


def _save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[config] 配置回写失败：{e}")


def _req(method, url, timeout=20, insecure_ssl=False):
    """极简 HTTP 调用，返回解析后的 JSON；自签证书时 insecure_ssl=True。"""
    ctx = ssl._create_unverified_context() if insecure_ssl else None
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def run(cfg):
    base = cfg["server"].rstrip("/")
    ws_url = (base.replace("https://", "wss://").replace("http://", "ws://")
              + "/ws/print-agent")

    # ---- 人工确认：凭门店 Token 直接显示所属门店，确认后才进入服务（不填门店码）----
    try:
        who = _req("GET", f"{base}/api/stores/bridge-whoami?key="
                          + urllib.parse.quote(str(cfg["token"])), timeout=15,
                   insecure_ssl=bool(cfg.get("insecure_ssl")))
    except urllib.error.HTTPError as e:
        print(f"[whoami] 门店 Token 校验失败（{e.code}）：{getattr(e, 'read', lambda: b'')().decode('utf-8', errors='replace')}")
        sys.exit(1)
    except Exception as e:
        print(f"[whoami] 云端不可达：{e}")
        sys.exit(1)
    store_name = who.get("store_name") or "?"
    print(f"[whoami] 本代理将绑定门店：{store_name}（ID={who.get('store_id')}）")
    if input("确认服务该门店？(y/n)：").strip().lower() not in ("y", "yes"):
        print("[bridge] 已取消（Token 若有误，请到云端门店管理重新生成并粘贴）")
        return

    # 身份名留空时按门店名兜底，并回写配置，下次启动不再询问
    if not str(cfg.get("name") or "").strip():
        cfg["name"] = f"{store_name}打印桥"
        _save_config(cfg)

    print(f"[bridge] 打印桥目标：{base}")
    print(f"[bridge] 绑定打印机：{cfg['printer'] or '(等待云端指派，暂用系统默认)'}")
    backoff = 2
    hb_stop = None
    while True:
        try:
            q = ("?key=" + urllib.parse.quote(str(cfg["token"]))
                 + "&name=" + urllib.parse.quote(str(cfg["name"])))
            ws = MiniWS(ws_url + q, insecure_ssl=bool(cfg.get("insecure_ssl")))
            print("[bridge] 已连接云端（WebSocket），身份：" + str(cfg["name"]))
            backoff = 2
            # 连接即上报本机全部打印机（不过滤，含虚拟打印机，由门店在云端指派时判断）
            ws.send_text(json.dumps({"type": "hello", "name": cfg["name"],
                                     "printers": list_printers()}, ensure_ascii=False))
            # 定时心跳：云端据此判定在线（静默断网也能在 15 秒内被发现）
            hb_stop = threading.Event()

            def _heartbeat():
                while not hb_stop.wait(5):
                    try:
                        ws.send_text(json.dumps({"type": "heartbeat"}))
                    except Exception:
                        return

            threading.Thread(target=_heartbeat, name="hb", daemon=True).start()
            cur_printer = str(cfg.get("printer") or "")
            while True:
                msg = ws.recv_text()
                if msg is None:
                    raise OSError("云端关闭连接")
                try:
                    d = json.loads(msg)
                except Exception:
                    continue
                mtype = d.get("type")

                if mtype == "config":
                    # 云端指派/补推：全量「业务 -> 打印机」映射；printer 字段为标签业务兼容值
                    bp_in = d.get("biz_printers")
                    changed = False
                    if isinstance(bp_in, dict):
                        norm = {str(k): str(v or "") for k, v in bp_in.items()}
                        if norm != cfg.get("biz_printers"):
                            cfg["biz_printers"] = norm
                            changed = True
                    p = str(d.get("printer")
                            or (cfg.get("biz_printers") or {}).get("label_product") or "")
                    if p and p != cur_printer:
                        cur_printer = p
                        cfg["printer"] = p
                        changed = True
                    if changed:
                        _save_config(cfg)
                    nbiz = len(cfg.get("biz_printers") or {})
                    print(f"[config] 所属门店：{d.get('store_name') or '?'} · "
                          f"标签打印机：{cur_printer or '(未指派，用系统默认)'}"
                          f" · 已收业务指派 {nbiz} 项")

                elif mtype == "job":
                    job = d.get("job") or {}
                    jid = job.get("job_id") or ""
                    # 打印机优先级：任务自带 > 该业务在映射中的指派 > 标签默认打印机
                    bpmap = cfg.get("biz_printers") or {}
                    jprinter = (str(job.get("printer") or "")
                                or str(bpmap.get(str(job.get("biz") or "")) or "")
                                or cur_printer or "")
                    try:
                        raw_print(jprinter,
                                  job["zpl"].encode("latin-1", errors="replace"),
                                  job.get("title") or "jewelry-labels")
                        print(f"[print] {jid} 已发送到打印机（{job.get('count', '?')} 张）")
                        ws.send_text(json.dumps({"type": "ack", "job_id": jid,
                                                 "ok": True, "message": "ok"}))
                    except Exception as e:
                        print(f"[print] {jid} 打印失败：{e}")
                        ws.send_text(json.dumps({"type": "ack", "job_id": jid,
                                                 "ok": False, "message": str(e)}))

                elif mtype == "control":
                    action = str(d.get("action") or "")
                    cid = str(d.get("control_id") or "")
                    ok, m = True, "ok"
                    try:
                        if action == "feed":
                            raw_print(cur_printer, str(cfg.get("cmd_feed") or "~JA").encode("latin-1"), "feed")
                        elif action == "backfeed":
                            raw_print(cur_printer, str(cfg.get("cmd_backfeed") or "~JD").encode("latin-1"), "backfeed")
                        elif action == "test":
                            raw_print(str(d.get("printer") or cur_printer or ""),
                                      str(d.get("zpl") or "").encode("latin-1", errors="replace"),
                                      "PrintBridge Test")
                        elif action == "refresh":
                            ws.send_text(json.dumps({"type": "printers",
                                                     "printers": list_printers()},
                                                    ensure_ascii=False))
                        else:
                            ok, m = False, f"未知指令 {action}"
                    except Exception as e:
                        ok, m = False, str(e)
                    print(f"[control] {action} -> {'ok' if ok else '失败：' + m}")
                    if cid:
                        ws.send_text(json.dumps({"type": "ack", "control_id": cid,
                                                 "ok": ok, "message": m}))

        except KeyboardInterrupt:
            if hb_stop: hb_stop.set()
            print("[bridge] 手动停止")
            return
        except Exception as e:
            if hb_stop: hb_stop.set()
            print(f"[bridge] 连接断开：{e}，{backoff} 秒后重连")
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "run").lower()
    if cmd == "list":
        names = list_printers()
        if not names:
            print("(未检测到打印机)")
            return
        print("本机打印机：")
        for n in names:
            print(" -", n)
        return
    if cmd == "burn":
        if len(sys.argv) < 4:
            print("用法：PrintBridge.exe burn <目标exe副本路径> <门店Token>")
            print("说明：把门店 Token 烧录进 exe 尾部（overlay，不影响程序启动与运行）。")
            print("      Windows 不能改写正在运行的 exe，请复制一份副本后再烧录分发。")
            sys.exit(1)
        embed_token(sys.argv[2], sys.argv[3])
        return
    if cmd == "run":
        run(_ensure_config())
        return
    print(__doc__)


if __name__ == "__main__":
    main()
