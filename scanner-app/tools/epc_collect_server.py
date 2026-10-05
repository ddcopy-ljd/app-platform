"""手持机 EPC 采集服务（临时工具，仅标准库）。

用法：
    python epc_collect_server.py            # 默认 8790 端口，数据写入 ./epc_collected.json
    python epc_collect_server.py --port 9000 --out D:/tmp/epc.json

启动后会打印本机局域网 IP，把手持机「EPC 采集」页的地址填成 http://<IP>:<端口> 即可上传。

接口：
    POST /upload   手持机上传 {"device","batch","tags":[{"epc","rssi","seq",...}]}
                   返回 {"ok":true,"received":n,"new":n,"total":n}
    GET  /         文本状态页（累计条数 + 最近 10 条）
    GET  /list     纯文本，每行一个 EPC
    POST /reset    清空已采集数据（需带 ?yes=1）
"""

import argparse
import json
import os
import socket
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8790
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "epc_collected.json")


class Store:
    """按 EPC 去重、保持首次采集顺序的落盘存储。"""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.data = {"updated": "", "items": []}
        self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
                self.data.setdefault("items", [])
            except Exception as e:
                print(f"[warn] 读取已有数据失败，将新建：{e}", file=sys.stderr)

    def _dump(self):
        base = os.path.splitext(self.path)[0]
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        with open(base + ".txt", "w", encoding="utf-8") as f:
            for it in self.data["items"]:
                f.write(it["epc"] + "\n")

    def merge(self, payload: dict) -> dict:
        device = str(payload.get("device", "") or "")
        batch = str(payload.get("batch", "") or "")
        tags = payload.get("tags") or []
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.lock:
            index = {it["epc"].upper(): it for it in self.data["items"]}
            new = 0
            for t in tags:
                epc = str(t.get("epc", "")).strip().upper()
                if not epc:
                    continue
                if epc in index:
                    it = index[epc]
                    it["hits"] = int(it.get("hits", 1)) + 1
                    it["rssi"] = t.get("rssi", it.get("rssi", 0))
                    it["last_at"] = now
                else:
                    item = {
                        "epc": epc,
                        "rssi": t.get("rssi", 0),
                        "hits": int(t.get("hits", 1) or 1),
                        "seq": len(self.data["items"]) + 1,
                        "device": device,
                        "batch": batch,
                        "first_at": t.get("ts") or now,
                        "last_at": now,
                    }
                    self.data["items"].append(item)
                    index[epc] = item
                    new += 1
            self.data["updated"] = now
            self._dump()
            return {
                "ok": True,
                "received": len(tags),
                "new": new,
                "total": len(self.data["items"]),
            }

    def reset(self) -> dict:
        with self.lock:
            self.data = {"updated": "", "items": []}
            self._dump()
        return {"ok": True, "total": 0}

    def status_text(self) -> str:
        items = self.data["items"]
        lines = [
            f"累计 {len(items)} 条  更新时间：{self.data.get('updated') or '-'}",
            f"数据文件：{self.path}",
            "",
            "最近 10 条：",
        ]
        for it in items[-10:]:
            lines.append(f"  #{it.get('seq')} {it['epc']}  rssi={it.get('rssi')}  {it.get('device','')}")
        lines += ["", "接口：POST /upload · GET /list · POST /reset?yes=1"]
        return "\n".join(lines)


class Handler(BaseHTTPRequestHandler):
    store: Store = None  # 由 main 注入

    def log_message(self, fmt, *args):
        print(f"[{datetime.now():%H:%M:%S}] {fmt % args}")

    def _send(self, code: int, body: str, ctype: str = "text/plain; charset=utf-8"):
        raw = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        try:
            if path == "/list":
                text = "\n".join(it["epc"] for it in self.store.data["items"])
                self._send(200, text + ("\n" if text else ""))
            elif path in ("/", ""):
                self._send(200, self.store.status_text())
            else:
                self._send(404, "not found")
        except Exception as e:
            self._send(500, f"error: {e}")

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        query = self.path.split("?")[1] if "?" in self.path else ""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            if path == "/upload":
                payload = json.loads(raw.decode("utf-8") or "{}")
                res = self.store.merge(payload)
                print(f"  收到 {res['received']} 条，新增 {res['new']} 条，累计 {res['total']} 条")
                self._send(200, json.dumps(res, ensure_ascii=False), "application/json; charset=utf-8")
            elif path == "/reset":
                if "yes=1" not in query:
                    self._send(400, "确认清空请请求 /reset?yes=1")
                    return
                self._send(200, json.dumps(self.store.reset(), ensure_ascii=False),
                           "application/json; charset=utf-8")
            else:
                self._send(404, "not found")
        except Exception as e:
            self._send(500, f"error: {e}")


def lan_ips():
    """本机局域网 IPv4 列表（优先出网口 IP）。"""
    found = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        found.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except Exception:
        pass
    return found


def main():
    ap = argparse.ArgumentParser(description="手持机 EPC 采集服务")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--out", default=DEFAULT_OUT, help="采集结果 JSON 文件路径")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    Handler.store = Store(args.out)

    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    ips = lan_ips()
    print("=" * 58)
    print("EPC 采集服务已启动")
    print(f"  端口：{args.port}")
    for ip in ips:
        print(f"  手持机填写地址：http://{ip}:{args.port}")
    if not ips:
        print("  未探测到局域网 IP，请在电脑上 ipconfig 查看后手工填写")
    print(f"  数据文件：{args.out}")
    print(f"  已有 {len(Handler.store.data['items'])} 条（清空：curl -X POST http://127.0.0.1:{args.port}/reset?yes=1）")
    print("  Ctrl+C 结束")
    print("=" * 58)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
