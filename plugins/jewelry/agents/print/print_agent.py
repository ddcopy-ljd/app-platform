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
  python print_agent.py run    # 启动桥接（双击 exe 等效；无配置时进入等待态，不退出）
  python print_agent.py run --debug   # 调试模式：输出所有收发消息与任务详情（也可在配置里设 "debug": true）
  python print_agent.py burn <目标exe副本> <门店Token>   # 旧方式：把门店Token烧录进 exe 尾部（仍兼容）

推荐流程（配置运行时推送，通用 exe 不绑定环境）：
  1. 把通用 exe / print_agent.py 拷到店里连标签机的电脑上，双击（或 run）启动；
     无配置时本机 18080 起服务并进入等待态，控制台提示等待推送；
  2. 在电脑端管理页【门店管理 → 门店与打印代理】选门店点「连接本机代理」，
     服务器地址与门店密钥经 http://127.0.0.1:18080/configure 推给代理，
     免人工核对，自动连上云端开始接收任务；
  3. 切换运行模式/服务器地址后，重新点一次「连接本机代理」即可
     （管理页打开期间每 30 秒自动探测并跟随；密钥仅在连接时轮换）。
  也可直接手工编辑 print_agent.json 填 server/token（此时首次连接需人工确认门店名）。
  一个密钥绑定一家门店；多家门店需在各自门店电脑上分别连接各自密钥。
"""

import base64
import ctypes
import hashlib
import http.server
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

# ---- exe 尾部内嵌配置（overlay）----
# 结构：payload字节 + 4字节大端长度 + 魔术，共 len+12 字节附加在文件末尾。
# Windows 加载器只按 PE 头读取映像，尾部 overlay 被完全忽略，不影响启动与运行。
# 分发流程：云端下载接口在内存中按门店动态烧录 server+token（用户不可见，双击即用）。
# PBCFG002：payload 为 JSON {"server":..., "token":...}——server 随下载来源（独立/正式/沙箱票据）自动变化；
# PBTKN001：旧版仅 Token，读取端仍兼容（手工 burn 的旧 exe）。
_TOKEN_MAGIC = b"PBTKN001"
_CONFIG_MAGIC = b"PBCFG002"
_TOKEN_MAX = 4096
_CFG_MAX = 8192

# 本地直打：浏览器经 http://127.0.0.1:18080 直发打印指令给本程序（不经云端中转）；
# 本地服务不可达时前端自动回退云端 WS 链路。_WS_SEND[0] 为当前云端长连接（回执上报用）。
# 配置推送：云端管理页经 POST /configure 下发 server/token（任意运行模式通用），
# _CFG_EVENT 唤醒等待态主循环 / _CFG_VER 变化触发运行中心跳断开重连。
_LOCAL_PORT = 18080
_WS_SEND = [None]
_CFG_VER = [0]                          # 配置版本号（每次推送更新 +1）
_CFG_EVENT = threading.Event()          # 等待态：配置到达/变化即唤醒
_TRUSTED = [False]                      # 配置来自管理页推送（免人工确认门店）
_STATE = {"store_name": "", "ws": False, "waited": False}   # 本地 / 状态查询数据源

DEFAULT_CONFIG = {
    "server": "http://127.0.0.1:8002",
    "token": "",                     # 门店Token（云端【店铺管理 → 门店与打印代理】生成）
    "name": "",                      # 代理身份名：留空则默认「{门店名}打印桥」
    "printer": "",                   # 标签业务打印机（云端按业务指派，自动写入，也可手填）
    "biz_printers": {},              # 全部打印业务 -> 打印机名（云端 config 推送，自动持久化）
    "cmd_feed": "~JA",               # 进纸指令（ZPL）
    "cmd_backfeed": "~JD",           # 退纸指令（机型相关，可按打印机手册修改）
    "insecure_ssl": False,           # 云端自签名证书时置 true
    "debug": False,                  # 调试模式：输出所有收发消息与任务详情（也可 run --debug 临时开启）
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


def _read_embedded_config(path=None):
    """读取 exe 尾部内嵌配置；兼容两代格式：
    PBCFG002 = JSON {"server":..., "token":...}；PBTKN001 = 旧版仅 Token。返回 dict（无内嵌返回 {}）。"""
    p = path or _self_exe_path()
    try:
        with open(p, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            if size < 12:
                return {}
            f.seek(size - 12)
            tail = f.read(12)
            magic = tail[4:]
            if magic not in (_CONFIG_MAGIC, _TOKEN_MAGIC):
                return {}
            plen = struct.unpack(">I", tail[:4])[0]
            if plen <= 0 or plen > _CFG_MAX or size < 12 + plen:
                return {}
            f.seek(size - 12 - plen)
            raw = f.read(plen)
            if magic == _CONFIG_MAGIC:
                try:
                    cfg = json.loads(raw.decode("utf-8", errors="replace"))
                    return cfg if isinstance(cfg, dict) else {}
                except Exception:
                    return {}
            return {"token": raw.decode("utf-8", errors="replace").strip()}
    except Exception:
        return {}


def _strip_overlay(exe_bytes):
    """剥除尾部旧 overlay（两代魔术均识别），返回纯 exe 字节。"""
    size = len(exe_bytes)
    if size >= 12:
        tail = exe_bytes[-12:]
        if tail[4:] in (_CONFIG_MAGIC, _TOKEN_MAGIC):
            plen = struct.unpack(">I", tail[:4])[0]
            if 0 < plen <= _CFG_MAX and size >= 12 + plen:
                return exe_bytes[:size - 12 - plen]
    return exe_bytes


def embed_config_bytes(exe_bytes, server, token):
    """纯字节版烧录：剥除旧 overlay 后追加 JSON{server,token}+长度+魔术（PBCFG002），返回新 exe 字节。
    供后端下载接口在内存中按门店动态注入服务地址与 Token（不落临时文件）。"""
    token = (token or "").strip()
    server = (server or "").strip()
    if not token:
        raise ValueError("Token 不能为空")
    if len(token.encode("utf-8")) > _TOKEN_MAX:
        raise ValueError("Token 过长")
    payload = json.dumps({"server": server, "token": token}, ensure_ascii=False).encode("utf-8")
    if len(payload) > _CFG_MAX:
        raise ValueError("内嵌配置过长")
    if exe_bytes[:2] != b"MZ":
        raise ValueError("目标不是 Windows 可执行文件（MZ 头校验失败）")
    return _strip_overlay(exe_bytes) + payload + struct.pack(">I", len(payload)) + _CONFIG_MAGIC


def embed_token(target, token, server=""):
    """文件版烧录：读目标 exe → 字节烧录 → 写回。
    注意：Windows 不允许改写正在运行的 exe，请对未运行的副本操作。"""
    token = (token or "").strip()
    with open(target, "rb") as f:
        raw = f.read()
    if _read_embedded_config(target):
        print("[burn] 已剥除旧内嵌配置")
    try:
        out = embed_config_bytes(raw, server, token)
    except ValueError as e:
        raise SystemExit(f"[burn] {e}")
    try:
        with open(target, "wb") as f:
            f.write(out)
    except PermissionError:
        raise SystemExit("[burn] 写入失败：目标 exe 正在运行或被占用，请换未运行的副本")
    chk = _read_embedded_config(target)
    ok = chk.get("token") == token and chk.get("server", "") == (server or "").strip()
    print(f"[burn] {'成功' if ok else '失败'}：server={server or '(空)'} Token（{len(token)} 字符）-> {target}")
    if not ok:
        raise SystemExit(1)


def _ensure_config():
    # exe 尾部内嵌配置（server+token，旧版烧录分发兼容）仍拥有最高优先级；
    # 新流程为空配置启动 → 等待云端管理页 POST /configure 推送（任意运行模式通用）。
    embedded = _read_embedded_config()
    emb_server = str(embedded.get("server") or "").strip()
    emb_token = str(embedded.get("token") or "").strip()
    if not os.path.exists(CONFIG_PATH):
        cfg = dict(DEFAULT_CONFIG)
        if emb_token:
            if emb_server:
                cfg["server"] = emb_server
            cfg["token"] = emb_token
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        if emb_token:
            print(f"[config] 已生成配置并写入 exe 内嵌值（server={cfg['server']}，Token {len(emb_token)} 字符）")
        else:
            print(f"[config] 已生成空配置 {CONFIG_PATH}：双击即可运行，等待云端管理页推送配置（也可手工填写）")
        return cfg
    # utf-8-sig 兼容带 BOM 的配置（记事本/部分编辑器保存时会加 BOM）
    with open(CONFIG_PATH, "r", encoding="utf-8-sig") as f:
        cfg = json.load(f)
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg or {})
    changed = False
    if emb_server and emb_server != str(merged.get("server") or "").strip():
        merged["server"] = emb_server
        changed = True
        print(f"[config] 使用 exe 内嵌云端地址：{emb_server}")
    if emb_token and emb_token != str(merged.get("token") or "").strip():
        merged["token"] = emb_token
        changed = True
        print(f"[config] 使用 exe 内嵌门店 Token（{len(emb_token)} 字符），已覆盖本地配置")
    # 空值不再交互强填：进入等待态，由云端管理页推送配置（run 主循环处理）
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


# ---------------------------------------------------------------- 调试输出

def _dbg(cfg, msg):
    """调试输出：配置 debug 字段为真（或 run --debug）时打印到控制台。"""
    if cfg.get("debug"):
        print(f"[debug {time.strftime('%H:%M:%S')}] {msg}")


# ---------------------------------------------------------------- 本地直打 HTTP 服务

def _start_local_http(cfg):
    """本机回环打印服务：同机浏览器 POST /print 直发 ZPL，本地出纸不经云端。
    打印成功后尽力经云端长连接上报 local_ack（供云端补审计）；连接不可用则静默跳过。"""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            self._json(200, {"ok": True, "name": str(cfg.get("name") or ""),
                             "printers": list_printers(),
                             "server": str(cfg.get("server") or ""),
                             "token_set": bool(str(cfg.get("token") or "").strip()),
                             "store_name": _STATE["store_name"],
                             "ws_connected": _STATE["ws"]})

        def do_POST(self):
            p = self.path.rstrip("/")
            if p == "/configure":
                # 云端管理页推送：server 地址 / 门店 Token（管理页操作即授权，免人工确认）
                try:
                    ln = int(self.headers.get("Content-Length") or 0)
                    d = json.loads(self.rfile.read(ln).decode("utf-8"))
                    server = str(d.get("server") or "").strip().rstrip("/")
                    token = str(d.get("token") or "").strip()
                    if not server and not token:
                        return self._json(400, {"ok": False, "message": "server/token 至少提供一项"})
                    chg = []
                    if server and server != str(cfg.get("server") or "").strip().rstrip("/"):
                        cfg["server"] = server
                        chg.append("server=" + server)
                    if token and token != str(cfg.get("token") or "").strip():
                        cfg["token"] = token
                        chg.append(f"Token（{len(token)} 字符）")
                    _TRUSTED[0] = True
                    if chg:
                        _save_config(cfg)
                        _CFG_VER[0] += 1
                        _CFG_EVENT.set()
                    print("[config] 收到管理页推送：" + ("、".join(chg) if chg else "无变化"))
                    return self._json(200, {"ok": True, "changed": bool(chg),
                                            "store_name": _STATE["store_name"],
                                            "ws_connected": _STATE["ws"],
                                            "server": str(cfg.get("server") or "")})
                except Exception as e:
                    return self._json(400, {"ok": False, "message": str(e)})
            if p != "/print":
                return self._json(404, {"ok": False, "message": "not found"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
                d = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
                zpl = str(d.get("zpl") or "")
                if not zpl.strip():
                    return self._json(400, {"ok": False, "message": "zpl 为空"})
                bname = str(d.get("biz") or "")
                printer = (str((cfg.get("biz_printers") or {}).get(bname) or "")
                           or str(cfg.get("printer") or ""))
                count = zpl.count("^XA") or 1
                _dbg(cfg, f"本地直打请求：biz={bname or '?'} 打印机={printer or '(系统默认)'} {count} 张")
                _dbg(cfg, f"本地直打 ZPL 全文：\n{zpl}")
                raw_print(printer, zpl.encode("latin-1", errors="replace"), "jewelry-local")
                print(f"[local] 本地直打 {count} 张 → {printer or '(系统默认)'}")
                ws = _WS_SEND[0]
                if ws is not None:
                    try:
                        ws.send_text(json.dumps(
                            {"type": "local_ack", "biz": bname, "printer": printer,
                             "count": count}, ensure_ascii=False))
                        _dbg(cfg, f"已上报 local_ack：{count} 张 → {printer or '(系统默认)'}")
                    except Exception:
                        pass
                return self._json(200, {"ok": True, "printer": printer, "count": count})
            except Exception as e:
                return self._json(500, {"ok": False, "message": str(e)})

        def log_message(self, *a):
            pass

    try:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", _LOCAL_PORT), _Handler)
    except OSError as e:
        print(f"[local] 本地直打服务启动失败（端口 {_LOCAL_PORT}）：{e}")
        return
    threading.Thread(target=srv.serve_forever, daemon=True, name="local-http").start()
    print(f"[local] 本地直打服务已启动：http://127.0.0.1:{_LOCAL_PORT}（断网也可用）")


def run(cfg):
    store_name = ""
    if cfg.get("debug"):
        print("[bridge] 调试模式已开启：将输出所有收发消息与任务详情")

    _start_local_http(cfg)

    backoff = 2
    hb_stop = None
    last_token = ""
    while True:
        try:
            token = str(cfg.get("token") or "").strip()
            if not token:
                # 等待态：尚未绑定门店，等待云端管理页推送配置（本地直打服务不受影响）
                if hb_stop:
                    hb_stop.set()
                    hb_stop = None
                _WS_SEND[0] = None
                _STATE["ws"] = False
                if not _STATE["waited"]:
                    _STATE["waited"] = True
                    print("[bridge] 尚未绑定门店：请打开云端【门店与打印代理】页，点【连接本机代理】推送配置")
                    print(f"[bridge] 等待配置中…（本地直打服务已就绪 http://127.0.0.1:{_LOCAL_PORT}，断网也可用）")
                _CFG_EVENT.wait(timeout=3)
                _CFG_EVENT.clear()
                backoff = 2
                continue
            base = str(cfg.get("server") or "").rstrip("/")
            ws_url = (base.replace("https://", "wss://").replace("http://", "ws://")
                      + "/ws/print-agent")
            if token != last_token:
                # 新 Token：校验归属门店；管理页推送的配置免人工确认，手工配置仍需确认
                try:
                    who = _req("GET", f"{base}/api/stores/bridge-whoami?key="
                                      + urllib.parse.quote(token), timeout=15,
                               insecure_ssl=bool(cfg.get("insecure_ssl")))
                except urllib.error.HTTPError as e:
                    print(f"[whoami] 门店 Token 校验失败（{e.code}）："
                          f"{getattr(e, 'read', lambda: b'')().decode('utf-8', errors='replace')}")
                    cfg["token"] = ""          # 清空回等待态，管理页重新推送即可
                    _save_config(cfg)
                    last_token = ""
                    continue
                except Exception as e:
                    raise OSError(f"云端不可达：{e}")
                store_name = str(who.get("store_name") or "?")
                print(f"[whoami] 本代理将绑定门店：{store_name}（ID={who.get('store_id')}）")
                if not _TRUSTED[0]:
                    if input("确认服务该门店？(y/n)：").strip().lower() not in ("y", "yes"):
                        print("[bridge] 已取消（Token 若有误，请到云端门店管理重新生成并粘贴）")
                        cfg["token"] = ""
                        _save_config(cfg)
                        continue
                # 身份名留空时按门店名兜底，并回写配置，下次启动不再询问
                if not str(cfg.get("name") or "").strip():
                    cfg["name"] = f"{store_name}打印桥"
                _STATE["store_name"] = store_name
                _STATE["waited"] = False
                _save_config(cfg)
                last_token = token
                print(f"[bridge] 打印桥目标：{base}")
                print(f"[bridge] 绑定打印机：{str(cfg.get('printer') or '') or '(等待云端指派，暂用系统默认)'}")
            q = ("?key=" + urllib.parse.quote(token)
                 + "&name=" + urllib.parse.quote(str(cfg.get("name") or "")))
            ws = MiniWS(ws_url + q, insecure_ssl=bool(cfg.get("insecure_ssl")))
            _WS_SEND[0] = ws
            _STATE["ws"] = True
            print("[bridge] 已连接云端（WebSocket），身份：" + str(cfg.get("name") or ""))
            backoff = 2
            # 连接即上报本机全部打印机（不过滤，含虚拟打印机，由门店在云端指派时判断）
            ws.send_text(json.dumps({"type": "hello", "name": cfg["name"],
                                     "printers": list_printers()}, ensure_ascii=False))
            _dbg(cfg, "已发送 hello（身份 + 本机打印机列表）")
            # 定时心跳：云端据此判定在线（静默断网也能在 15 秒内被发现）；
            # 同时检测管理页配置推送（_CFG_VER 变化）→ 主动断开由主循环按新配置重连
            hb_stop = threading.Event()

            def _heartbeat():
                ver = _CFG_VER[0]
                while not hb_stop.wait(5):
                    try:
                        ws.send_text(json.dumps({"type": "heartbeat"}))
                    except Exception:
                        return
                    if _CFG_VER[0] != ver:
                        print("[bridge] 检测到配置更新，按新配置重连…")
                        try:
                            ws.close()
                        except Exception:
                            pass
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
                    _dbg(cfg, f"收到非 JSON 消息：{msg[:500]}")
                    continue
                mtype = d.get("type")
                _dbg(cfg, f"收到 {mtype or '?'}：{msg}")

                if mtype == "config":
                    # 云端指派/补推：全量「业务 -> 打印机」映射；printer 字段为标签业务兼容值
                    changed = False
                    # 地址自愈：云端告知权威地址与本地不同时立即跟随（断线重连即用新地址）
                    s_in = str(d.get("server") or "").strip()
                    if s_in:
                        n = (s_in.replace("wss://", "https://")
                                 .replace("ws://", "http://").rstrip("/"))
                        if n and n != base:
                            base = n
                            ws_url = (base.replace("https://", "wss://")
                                          .replace("http://", "ws://") + "/ws/print-agent")
                            cfg["server"] = n
                            changed = True
                            print(f"[config] 云端地址更新：{n}（断线重连即用新地址）")
                    bp_in = d.get("biz_printers")
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
                    _dbg(cfg, f"任务摘要：门店={store_name} 业务={job.get('biz') or '?'} "
                              f"job_id={jid} 张数={job.get('count', '?')} "
                              f"打印机={jprinter or '(系统默认)'} 标题={job.get('title') or ''}")
                    _dbg(cfg, f"任务 ZPL 全文：\n{job.get('zpl') or ''}")
                    try:
                        raw_print(jprinter,
                                  job["zpl"].encode("latin-1", errors="replace"),
                                  job.get("title") or "jewelry-labels")
                        print(f"[print] {jid} 已发送到打印机（{job.get('count', '?')} 张）")
                        _dbg(cfg, f"回执 ack：job_id={jid} ok=True")
                        ws.send_text(json.dumps({"type": "ack", "job_id": jid,
                                                 "ok": True, "message": "ok"}))
                    except Exception as e:
                        print(f"[print] {jid} 打印失败：{e}")
                        _dbg(cfg, f"回执 ack：job_id={jid} ok=False：{e}")
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
            _STATE["ws"] = False
            print("[bridge] 手动停止")
            return
        except Exception as e:
            if hb_stop: hb_stop.set()
            _WS_SEND[0] = None
            _STATE["ws"] = False
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
            print("用法：PrintBridge.exe burn <目标exe副本路径> <门店Token> [云端地址]")
            print("说明：把门店 Token（及可选云端地址）烧录进 exe 尾部（overlay，不影响程序启动与运行）。")
            print("      云端地址不填时 exe 内嵌为空，运行时回落默认/配置文件地址。")
            print("      Windows 不能改写正在运行的 exe，请复制一份副本后再烧录分发。")
            sys.exit(1)
        embed_token(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "")
        return
    if cmd == "run":
        cfg = _ensure_config()
        if any(str(a).lower() in ("--debug", "-d") for a in sys.argv[2:]):
            cfg["debug"] = True
        run(cfg)
        return
    print(__doc__)


if __name__ == "__main__":
    main()
