"""调试入口：签发短期访问票据，经平台网关反向代理到指定插件版本并注入上下文 Header。"""

import secrets
import threading
import time
import urllib.error
import urllib.request

from .plugin_service import PluginError, resolve_gateway

TICKET_TTL_SECONDS = 30 * 60
# 不转发给上游/下游的逐跳头与平台凭证
# 注意：authorization 必须放行，插件应用自己的 Bearer 会话令牌靠它传递
#（平台自身的登录凭证走 HttpOnly Cookie，已被下面的 cookie 规则拦掉，不会泄漏给插件）
_HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
                "proxy-authorization", "proxy-authenticate", "host", "content-length",
                "cookie"}
_CONTEXT_PREFIX = "x-resolved-", "x-system-", "x-operator-"

_tickets: dict[str, dict] = {}
_lock = threading.Lock()


def issue_ticket(plugin_id: str, mode: str, tenant_id: str | None, version: str | None, operator: str) -> dict:
    ctx = resolve_gateway(plugin_id, mode, tenant_id, version, operator)
    ticket = secrets.token_urlsafe(24)
    with _lock:
        now = time.time()
        for k in [k for k, t in _tickets.items() if t["expires"] < now]:
            _tickets.pop(k, None)
        _tickets[ticket] = {
            "plugin_id": plugin_id, "mode": mode, "tenant_id": ctx["tenant_id"],
            "version": ctx["target_version"], "operator": operator, "expires": now + TICKET_TTL_SECONDS,
        }
    return {**ctx, "url": f"/gw/{ticket}/"}


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
    fwd = {k: v for k, v in headers.items()
           if k.lower() not in _HOP_HEADERS and not k.lower().startswith(_CONTEXT_PREFIX)}
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
