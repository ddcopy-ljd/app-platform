"""调试入口：签发访问票据，经平台网关反向代理到指定插件版本并注入上下文 Header。

票证为确定性派生（HMAC）：同 插件+模式+租户+版本 永远得到同一地址，
平台重启后依旧有效；票证与上下文持久化于 platform/data/gw_tickets.json。
"""

import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.error
import urllib.request

from .config import DATA_DIR
from .plugin_service import PluginError, resolve_gateway

TICKET_TTL_SECONDS = 30 * 24 * 3600        # 30 天：稳定地址按版本生命周期滚动
_TICKETS_PATH = DATA_DIR / "gw_tickets.json"
_SECRET_PATH = DATA_DIR / "gw_secret.key"
# 不转发给上游/下游的逐跳头与平台凭证
# 注意：authorization 必须放行，插件应用自己的 Bearer 会话令牌靠它传递
#（平台自身的登录凭证走 HttpOnly Cookie，已被下面的 cookie 规则拦掉，不会泄漏给插件）
_HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
                "proxy-authorization", "proxy-authenticate", "host", "content-length",
                "cookie"}
_CONTEXT_PREFIX = "x-resolved-", "x-system-", "x-operator-"

_tickets: dict[str, dict] = {}
_lock = threading.Lock()


def _load_tickets() -> None:
    global _tickets
    try:
        _tickets = {
            k: v for k, v in
            json.loads(_TICKETS_PATH.read_text(encoding="utf-8")).items()
            if isinstance(v, dict) and v.get("expires", 0) > time.time()
        }
    except Exception:
        _tickets = {}


def _save_tickets() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _TICKETS_PATH.write_text(json.dumps(_tickets, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _secret() -> bytes:
    """平台票证签名密钥：首次使用时生成并持久化。"""
    try:
        return _SECRET_PATH.read_bytes().strip()
    except OSError:
        s = secrets.token_hex(32).encode()
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _SECRET_PATH.write_bytes(s)
        except OSError:
            pass
        return s


def _stable_ticket(plugin_id: str, mode: str, tenant_id: str | None) -> str:
    # 版本不参与派生：同 插件+模式+租户 永远同一地址；重新签发时把该地址指向刷新到当前解析版本
    msg = f"{plugin_id}|{mode}|{tenant_id or ''}"
    return hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()[:20]


def issue_ticket(plugin_id: str, mode: str, tenant_id: str | None, version: str | None, operator: str) -> dict:
    ctx = resolve_gateway(plugin_id, mode, tenant_id, version, operator)
    with _lock:
        now = time.time()
        for k in [k for k, t in _tickets.items() if t["expires"] < now]:
            _tickets.pop(k, None)
        ticket = _stable_ticket(plugin_id, mode, ctx["tenant_id"])
        _tickets[ticket] = {
            "plugin_id": plugin_id, "mode": mode, "tenant_id": ctx["tenant_id"],
            "version": ctx["target_version"], "operator": operator, "expires": now + TICKET_TTL_SECONDS,
        }
        _save_tickets()
    return {**ctx, "url": f"/gw/{ticket}/"}


def ensure_ticket(plugin_id: str, mode: str, tenant_id: str | None, operator: str) -> str | None:
    """跨插件内嵌场景（如珠宝云沙箱票证页内嵌 BugTracker 上报页）：
    签发同 模式+租户 的目标插件票证地址；插件不存在/无可用版本时返回 None 由前端回落。
    票证为确定性派生，重复调用只刷新指向版本，不产生新地址。"""
    try:
        ctx = resolve_gateway(plugin_id, mode, tenant_id, None, operator, record_audit=False)
    except PluginError:
        return None
    with _lock:
        now = time.time()
        ticket = _stable_ticket(plugin_id, mode, ctx["tenant_id"])
        old = _tickets.get(ticket)
        if old and old["expires"] > now and old["version"] == ctx["target_version"]:
            return f"/gw/{ticket}/"
        _tickets[ticket] = {
            "plugin_id": plugin_id, "mode": mode, "tenant_id": ctx["tenant_id"],
            "version": ctx["target_version"], "operator": operator, "expires": now + TICKET_TTL_SECONDS,
        }
        _save_tickets()
    return f"/gw/{ticket}/"


def ticket_context(ticket: str) -> dict | None:
    """读取票据对应的插件与租户（供流量归属使用），票据失效时返回 None。"""
    with _lock:
        t = _tickets.get(ticket)
        if not t or t["expires"] < time.time():
            return None
        return {"plugin_id": t["plugin_id"], "tenant_id": t["tenant_id"], "mode": t["mode"]}


def proxy(ticket: str, path: str, method: str, query: str, headers: dict[str, str], body: bytes):
    with _lock:
        t = _tickets.get(ticket)
        if not t or t["expires"] < time.time():
            _tickets.pop(ticket, None)
            raise PluginError("调试入口已失效，请在插件版本调试中重新打开", 401)
    ctx = resolve_gateway(t["plugin_id"], t["mode"], t["tenant_id"], t["version"], t["operator"],
                          record_audit=False)
    ctx["headers"]["X-App-Base"] = f"/gw/{ticket}/"
    return _forward(ctx, path, method, query, headers, body)


def proxy_app(plugin_id: str, tenant_id: str, operator: str,
              path: str, method: str, query: str, headers: dict[str, str], body: bytes):
    """常规业务模式固定入口：/app/{plugin_id}/{tenant_id}/，始终路由到正式版本。"""
    ctx = resolve_gateway(plugin_id, "NORMAL", tenant_id, None, operator)
    ctx["headers"]["X-App-Base"] = f"/app/{plugin_id}/{tenant_id}/"
    return _forward(ctx, path, method, query, headers, body)


def _forward(ctx: dict, path: str, method: str, query: str, headers: dict[str, str], body: bytes):
    # 客户端自带的上下文头一律丢弃，只使用网关注入的值
    # accept-encoding 也不透传：平台需要在 text/html 响应体中注入 window.__APP_BASE__，
    # 若上游返回 gzip 等压缩字节，注入会因无法解码而静默失效（回环转发不压缩无性能问题）。
    fwd = {k: v for k, v in headers.items()
           if k.lower() not in _HOP_HEADERS
           and not k.lower().startswith(_CONTEXT_PREFIX)
           and k.lower() != "accept-encoding"}
    fwd.update(ctx["headers"])
    url = f"http://127.0.0.1:{ctx['port']}/{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, data=body or None, headers=fwd, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        resp = e
    except (urllib.error.URLError, TimeoutError) as e:
        raise PluginError(f"转发至 v{ctx['target_version']} 服务失败：{e}", 502)
    with resp:
        content = resp.read()
        out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in _HOP_HEADERS}
        return resp.status, out_headers, content


_load_tickets()   # 模块加载即恢复持久化票证（平台重启后地址依旧有效）
