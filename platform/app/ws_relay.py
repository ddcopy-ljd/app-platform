"""极简 WebSocket 客户端（RFC6455 子集）——供平台网关向插件服务转发 WS 长连接。

仅标准库实现（不依赖 websockets 包）：支持自定义握手头（透传 X-Resolved-Tenant-ID
等租户上下文）、文本帧收发、自动回应服务端 Ping、处理 Close 帧。
线程安全：send 加锁，recv 请单线程使用（网关的转发泵满足）。
"""

import base64
import hashlib
import os
import socket
import ssl
import struct
import threading
from urllib.parse import urlparse

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WSClient:
    def __init__(self, url: str, headers: dict | None = None, timeout: int = 30):
        u = urlparse(url)
        secure = u.scheme in ("wss", "https")
        host = u.hostname
        if not host:
            raise OSError(f"无效地址：{url}")
        port = u.port or (443 if secure else 80)
        path = (u.path or "/") + (("?" + u.query) if u.query else "")
        sock = socket.create_connection((host, port), timeout=timeout)
        if secure:
            ctx = ssl.create_default_context()
            sock = ctx.wrap_socket(sock, server_hostname=host)
        self.sock = sock
        key = base64.b64encode(os.urandom(16)).decode()
        lines = ["GET " + path + " HTTP/1.1",
                 f"Host: {host}:{port}",
                 "Upgrade: websocket",
                 "Connection: Upgrade",
                 "Sec-WebSocket-Key: " + key,
                 "Sec-WebSocket-Version: 13"]
        for k, v in (headers or {}).items():
            lines.append(f"{k}: {v}")
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise OSError("上游握手失败：连接中断")
            resp += chunk
        head, _, rest = resp.partition(b"\r\n\r\n")
        status = head.split(b"\r\n")[0]
        if b" 101 " not in status:
            raise OSError("上游握手失败：" + status.decode("utf-8", errors="replace"))
        expected = base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()
        if expected.encode() not in head:
            raise OSError("上游握手校验失败")
        self._buf = rest
        self._wlock = threading.Lock()

    # ---- 帧收发 ----

    def _readn(self, n: int) -> bytes:
        buf = self._buf
        while len(buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise OSError("上游连接已断开")
            buf += chunk
        out, self._buf = buf[:n], buf[n:]
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

    def _send_frame(self, opcode: int, payload: bytes):
        with self._wlock:
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

    # ---- 对外接口 ----

    def send_text(self, s: str):
        self._send_frame(0x1, s.encode("utf-8"))

    def recv_text(self):
        """返回一条文本消息；对端关闭返回 None；自动回应 Ping。"""
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
