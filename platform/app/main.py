import asyncio
import json
import re
import secrets
import threading

from fastapi import (Depends, FastAPI, File, HTTPException, Request, UploadFile,
                     WebSocket)
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware

from . import gateway as gw
from . import plugin_service as svc
from . import runtime
from . import traffic
from .config import AGENT_API_KEY, FRONTEND_DIR, MAX_PACKAGE_BYTES, PACKAGES_DIR, SESSION_TTL_SECONDS
from .db import get_conn, init_db
from .security import (SESSION_COOKIE, cookie_user, create_session, current_user, drop_session,
                       verify_password)
from .ws_relay import WSClient

# 标签属性中的绝对路径（排除 // 协议相对与 http: 等 scheme），供应用挂载前缀重写
_APP_BASE_TAG_RE = re.compile(
    r'(?i)(href|src|action)=("|\')(\/(?!\/)(?![a-zA-Z]+:)[^"\']*)("|\')'
)

app = FastAPI(title="综合业务应用服务平台")
# 注意：Starlette 的 add_middleware 是 insert(0)，后添加的在最外层。
# 目标顺序（外→内）：Traffic → GZip → RawOut，故按 RawOut → GZip → Traffic 的顺序添加。
# Traffic 在最外层 => 统计到的 out_bytes 即网络上实际传输的压缩后字节数（真实流量）；
# RawOut 在 GZip 内层记录压缩前字节数，供前端展示"压缩节省了多少"。
app.add_middleware(traffic.RawOutMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
app.add_middleware(traffic.TrafficMiddleware)


@app.middleware("http")
async def _static_no_cache(request: Request, call_next):
    """前端静态资源（html/js/css）禁用缓存，避免浏览器缓存旧页面导致改动不生效。"""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
def _startup() -> None:
    init_db()
    traffic.init_traffic()
    # 平台启动后自动拉起各插件的正式（及试运行）版本服务，便于调试入口开箱即用。
    # 放后台线程执行，避免多个服务逐个启动（含端口探测超时）拖慢平台就绪。
    threading.Thread(target=_auto_start_services, name="auto-start-services", daemon=True).start()


def _auto_start_services() -> None:
    try:
        for msg in runtime.start_serving_versions():
            print(f"[auto-start] {msg}", flush=True)
    except Exception as e:  # noqa: BLE001 - 自动启动异常不应影响平台运行
        print(f"[auto-start] 异常：{e}", flush=True)


@app.on_event("shutdown")
def _shutdown() -> None:
    traffic.shutdown_traffic()
    runtime.stop_all()


@app.exception_handler(svc.PluginError)
def _plugin_error(_: Request, exc: svc.PluginError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


# ---------------------------------------------------------------- 登录

class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_TTL_SECONDS, httponly=True, samesite="lax")


@app.post("/api/auth/login")
def login(body: LoginIn, response: Response):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    user = {"username": row["username"], "display_name": row["display_name"], "role": row["role"]}
    token = create_session(user)
    _set_session_cookie(response, token)
    return {"token": token, "user": user}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, _: dict = Depends(current_user)):
    drop_session(request.headers.get("authorization", "").removeprefix("Bearer ").strip())
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request, response: Response, user: dict = Depends(current_user)):
    _set_session_cookie(response, request.headers.get("authorization", "").removeprefix("Bearer ").strip())
    return user


# ---------------------------------------------------------------- 应用插件管理

class PrepareIn(BaseModel):
    tenants: list[str] = Field(default_factory=list, max_length=50)


class GatewayIn(BaseModel):
    mode: str
    tenant_id: str | None = None
    version: str | None = Field(default=None, max_length=20)


class AppStatusIn(BaseModel):
    status: str


@app.get("/api/plugins")
def plugins(_: dict = Depends(current_user)):
    runtime.sync_states()
    return svc.list_plugins()


@app.get("/api/plugins/maintenance")
def maintenance(_: dict = Depends(current_user)):
    return svc.maintenance_status()


@app.get("/api/tenants")
def tenants(_: dict = Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name, is_sandbox FROM tenants ORDER BY is_sandbox, id").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/traffic/summary")
def traffic_summary(_: dict = Depends(current_user)):
    """流量概览：今日 / 本月 / 近 12 个月总量。"""
    return traffic.stats.summary()


@app.get("/api/traffic/digest")
def traffic_digest(_: dict = Depends(current_user)):
    """首页每日摘要：昨日 / 今日 + 异常告警。"""
    return traffic.stats.digest()


@app.get("/api/traffic/top")
def traffic_top(_: dict = Depends(current_user), start: str | None = None, end: str | None = None,
                limit: int = 20):
    """指定范围内流量最大的请求路径 Top N。"""
    try:
        return traffic.stats.top(start=start, end=end, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/traffic/query")
def traffic_query(dim: str = "tenant", granularity: str = "month", months: int = traffic.KEEP_MONTHS,
                  start: str | None = None, end: str | None = None,
                  plugin_id: str | None = None, tenant_id: str | None = None,
                  _: dict = Depends(current_user)):
    """流量明细：dim=tenant|app，granularity=month|day|hour|hod(一天内 24 个时段)。"""
    try:
        return traffic.stats.query(dim=dim, granularity=granularity, start=start, end=end,
                                   months=months, plugin_id=plugin_id, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/plugins/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(current_user)):
    content = await file.read(MAX_PACKAGE_BYTES + 1)
    return svc.register_package(file.filename or "plugin.zip", content, user["username"])


@app.get("/api/plugins/{plugin_id}")
def plugin_detail(plugin_id: str, _: dict = Depends(current_user)):
    runtime.sync_states()
    return svc.get_plugin_detail(plugin_id)


@app.post("/api/plugins/{plugin_id}/app-status")
def app_status(plugin_id: str, body: AppStatusIn, user: dict = Depends(current_user)):
    svc.set_app_status(plugin_id, body.status, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/service/start")
def service_start(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    runtime.start_service(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/service/stop")
def service_stop(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    runtime.stop_service(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.get("/api/plugins/{plugin_id}/versions/{version_id}/service/log")
def service_log(plugin_id: str, version_id: int, _: dict = Depends(current_user)):
    return runtime.get_service_log(plugin_id, version_id)


@app.get("/api/plugins/{plugin_id}/versions/{version_id}/log")
def version_log(plugin_id: str, version_id: int, _: dict = Depends(current_user)):
    return svc.get_version_log(plugin_id, version_id)


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/init")
def init_version(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    svc.start_init(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/prepare")
def prepare_version(plugin_id: str, version_id: int, body: PrepareIn, user: dict = Depends(current_user)):
    svc.start_prepare(plugin_id, version_id, body.tenants, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/pass-trial")
def pass_trial(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    svc.pass_trial(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/switch")
def switch_version(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    svc.start_switch(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/set-current")
def set_current(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    svc.set_current(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.delete("/api/plugins/{plugin_id}/versions/{version_id}")
def delete_version(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    svc.delete_version(plugin_id, version_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/gateway/ticket")
def gateway_ticket(plugin_id: str, body: GatewayIn, user: dict = Depends(current_user)):
    runtime.sync_states()
    return gw.issue_ticket(plugin_id, body.mode, body.tenant_id, body.version, user["username"])


# ---------------------------------------------------------------- AI Agent 升级流水线
# 职责边界：平台管「版本信息、上传校验、沙箱试运行、服务拉起、结果汇报」；
# 插件方（AI Agent 以插件作者身份）负责「对比版本、编写迁移脚本、按规范打包」。

def _ver_tuple(v: str) -> tuple:
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


def _agent_ok(request: Request) -> None:
    """Agent 接口鉴权：config.AGENT_API_KEY 非空时启用，请求头 X-Agent-Key 必须匹配。"""
    if not AGENT_API_KEY:
        raise HTTPException(status_code=403, detail="Agent 接口未启用：请在平台配置 config.py 中设置 AGENT_API_KEY")
    key = request.headers.get("X-Agent-Key", "")
    if not secrets.compare_digest(key, AGENT_API_KEY):
        raise HTTPException(status_code=401, detail="X-Agent-Key 无效")


PACKAGE_SPEC = {
    "zip_layout": "zip 根目录直接包含 plugin.json（不要多包一层目录）",
    "plugin_json_required": ["id", "name", "softwareVersion", "dataVersion", "entry"],
    "plugin_json_optional": ["icon", "category", "author", "description", "features",
                             "promo", "scripts.init", "scripts.upgrade"],
    "migration_rule": "数据结构未变 → dataVersion 保持不变（平台自动全量复制旧库）；"
                      "结构变更 → dataVersion 必须递增，并实现 scripts/upgrade.py 迁移脚本",
    "upgrade_env": ["OLD_DB_PATH", "NEW_DB_PATH", "OLD_STORAGE", "NEW_STORAGE",
                    "TENANT_ID", "OLD_DATA_VERSION", "NEW_DATA_VERSION"],
    "upgrade_contract": "平台先把旧库完整复制到 NEW_DB_PATH，脚本只需在其上执行增量迁移；"
                        "存储目录同理（OLD_STORAGE → NEW_STORAGE）；脚本执行 120 秒超时",
    "verdict_meaning": {"ok": "可打包上传，上传后平台自动发起沙箱试运行",
                        "exists": "目标版本已存在，请递增 softwareVersion",
                        "older": "目标版本不高于当前正式版本，禁止发布"},
}


@app.get("/api/agent/plugins/{plugin_id}/release-info")
def agent_release_info(plugin_id: str, request: Request, target: str | None = None):
    """Agent 步骤①：取指定插件的正式版版本号/数据版本，并判定目标版本可否发布。"""
    _agent_ok(request)
    try:
        detail = svc.get_plugin_detail(plugin_id)
    except svc.PluginError as e:
        raise HTTPException(status_code=404, detail=str(e))
    versions = detail["versions"]
    current = next((v for v in versions if v["is_current"]), None)
    if not current:
        raise HTTPException(status_code=409, detail="该插件尚无正式版本，无法作为升级基线")
    latest = max(versions, key=lambda v: _ver_tuple(v["software_version"]))["software_version"]
    out = {
        "plugin_id": plugin_id, "name": detail["name"],
        "current_version": current["software_version"],
        "current_data_version": current["data_version"],
        "latest_version": latest,
        "target": target,
        "source_dir": str(PACKAGES_DIR / plugin_id / f"v{current['software_version']}"),
        "package_spec": PACKAGE_SPEC,
    }
    if target:
        if any(v["software_version"] == target for v in versions):
            out["verdict"], out["verdict_detail"] = "exists", f"目标版本 v{target} 已存在，请递增 softwareVersion"
        elif _ver_tuple(target) <= _ver_tuple(current["software_version"]):
            out["verdict"], out["verdict_detail"] = "older", f"目标版本不高于正式版 v{current['software_version']}，禁止发布"
        else:
            out["verdict"], out["verdict_detail"] = "ok", "可打包上传；上传后平台将自动发起沙箱试运行"
    return out


@app.post("/api/agent/plugins/{plugin_id}/release")
async def agent_release(plugin_id: str, request: Request, file: UploadFile = File(...)):
    """Agent 步骤②③：上传新版本包（含迁移脚本），平台自动发起沙箱试运行。"""
    _agent_ok(request)
    content = await file.read(MAX_PACKAGE_BYTES + 1)
    try:
        info = svc.register_package(file.filename or "plugin.zip", content, "ai-agent")
    except svc.PluginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if info["plugin_id"] != plugin_id:
        raise HTTPException(status_code=400,
                            detail=f"包内 plugin.json id={info['plugin_id']} 与接口地址的 {plugin_id} 不一致")
    v = next((v for v in svc.get_plugin_detail(plugin_id)["versions"]
              if v["software_version"] == info["software_version"]), None)
    auto = {"started": False}
    if v:
        try:
            svc.start_prepare(plugin_id, v["id"], [], "ai-agent")  # 默认仅虚拟沙箱租户 tenant_trial
            auto = {"started": True, "note": "已自动发起沙箱试运行（tenant_trial）；数据就绪后平台自动拉起沙箱服务"}
        except svc.PluginError as e:
            auto = {"started": False, "reason": str(e)}
    return {"ok": True, "plugin_id": info["plugin_id"],
            "software_version": info["software_version"], "data_version": info["data_version"],
            "auto_prepare": auto,
            "pipeline_url": f"/api/agent/plugins/{plugin_id}/pipeline/{info['software_version']}"}


@app.get("/api/agent/plugins/{plugin_id}/pipeline/{software_version}")
def agent_pipeline(plugin_id: str, software_version: str, request: Request):
    """Agent 步骤④⑤：轮询升级流水线状态与测试结果。

    上传后自动流转：uploaded → preparing(数据准备/迁移) → trial(沙箱服务就绪，可自测)。
    failed = 迁移脚本执行失败（附日志）。轮询到 trial 即可对 sandbox_url 做功能自测。
    """
    _agent_ok(request)
    try:
        detail = svc.get_plugin_detail(plugin_id)
    except svc.PluginError as e:
        raise HTTPException(status_code=404, detail=str(e))
    v = next((v for v in detail["versions"] if v["software_version"] == software_version), None)
    if not v:
        raise HTTPException(status_code=404, detail=f"插件 {plugin_id} 不存在版本 v{software_version}")

    # 沙箱数据就绪后自动拉起服务，供 agent 做功能自测（幂等：已运行则跳过）
    service_started = None
    if v["status"] == "trial" and v.get("has_entry") and v["service"]["state"] != "running":
        try:
            runtime.start_service(plugin_id, v["id"], "ai-agent")
            service_started = True
        except Exception as e:  # noqa: BLE001 - 启动失败不影响状态汇报
            service_started = False
            v["service"]["error"] = str(e)

    result = {"failed": "failed", "trial": "success", "trial_passed": "success",
              "ready": "success"}.get(v["status"], "running")
    log_tail = ""
    try:
        log_tail = "\n".join(svc.get_version_log(plugin_id, v["id"])["log"].splitlines()[-30:])
    except Exception:  # noqa: BLE001 - 日志缺失不阻塞状态
        pass
    return {
        "plugin_id": plugin_id, "software_version": software_version,
        "stage": v["status"], "progress": v.get("progress"), "error": v.get("error"),
        "data_version": v["data_version"],
        "result": result,
        "service": v["service"], "service_started": service_started,
        "sandbox_url": f"/app/{plugin_id}/tenant_trial/" if v["service"]["state"] == "running" else None,
        "is_current": v["is_current"],
        "log_tail": log_tail,
    }


def _content_type(headers: dict) -> str:
    for k, v in headers.items():
        if k.lower() == "content-type":
            return v
    return ""


def _set_header(headers: dict, name: str, value: str) -> None:
    """覆盖设置响应头（移除同名不同大小写的旧键，避免重复头）。"""
    for k in [k for k in headers if k.lower() == name.lower()]:
        headers.pop(k)
    headers[name] = value


def _rewrite_app_base(content: bytes, base: str) -> bytes:
    """让插件页面在 /app/{插件}/{租户}/ 或 /gw/{票据}/ 前缀下正确加载：
    1) 把 <link src/href/action="/..."> 等标签绝对路径加挂载前缀；
    2) 注入 window.__APP_BASE__ 供前端 JS 拼接 API 地址。
    仅对 text/html 生效，其他内容原样返回。"""
    if not content:
        return content
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return content
    # 标签属性中的绝对路径加前缀（排除 // 协议相对与 http: 等 scheme）
    text = _APP_BASE_TAG_RE.sub(
        lambda m: f"{m.group(1)}={m.group(2)}{base}{m.group(3).lstrip('/')}{m.group(4)}", text
    )
    script = f"<script>window.__APP_BASE__={json.dumps(base)};</script>"
    low = text.lower()
    if "</head>" in low:
        text = text.replace("</head>", script + "</head>", 1)
    elif "<head" in low:
        idx = low.find("<head")
        end = text.find(">", idx)
        text = text[:end + 1] + script + text[end + 1:]
    else:
        text = script + text
    return text.encode("utf-8")


@app.api_route("/gw/{ticket}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def gateway_proxy(ticket: str, path: str, request: Request):
    # 票据解析出插件与租户后回填，使 billing 归属到具体应用与企业
    tctx = gw.ticket_context(ticket)
    if tctx:
        traffic.bind(request, source=traffic.SOURCE_APP,
                     plugin_id=tctx["plugin_id"], tenant_id=tctx["tenant_id"])
    body = await request.body()
    status, headers, content = await run_in_threadpool(
        gw.proxy, ticket, path, request.method, request.url.query, dict(request.headers), body
    )
    if "text/html" in _content_type(headers).lower():
        content = _rewrite_app_base(content, f"/gw/{ticket}/")
        _set_header(headers, "Cache-Control", "no-store")  # 注入页禁止缓存，避免浏览器复用未注入的旧副本
    return Response(content=content, status_code=status, headers=headers)


# 机器客户端（无 Cookie）允许访问的插件接口白名单：由插件自行校验凭证，
# 平台不鉴权。如打印桥凭门店密钥换取门店名称的 bridge-whoami。
_MACHINE_PATHS = {"api/stores/bridge-whoami", "api/print-agent/download"}


# 演示：企业登录尚未实现，暂由平台登录会话模拟企业用户访问
@app.api_route("/app/{plugin_id}/{tenant_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def app_entry(plugin_id: str, tenant_id: str, path: str, request: Request):
    if path in _MACHINE_PATHS:
        operator = "print-agent"
    else:
        try:
            user = cookie_user(request)
        except HTTPException:
            # 未登录/会话过期（重启平台会清空内存会话）：跳转平台登录页，而不是裸 401
            return RedirectResponse("/", status_code=302)
        operator = user["username"]
    body = await request.body()
    status, headers, content = await run_in_threadpool(
        gw.proxy_app, plugin_id, tenant_id, operator,
        path, request.method, request.url.query, dict(request.headers), body,
    )
    if "text/html" in _content_type(headers).lower():
        content = _rewrite_app_base(content, f"/app/{plugin_id}/{tenant_id}/")
        _set_header(headers, "Cache-Control", "no-store")  # 注入页禁止缓存，避免浏览器复用未注入的旧副本
    return Response(content=content, status_code=status, headers=headers)


@app.websocket("/app/{plugin_id}/{tenant_id}/ws/{path:path}")
async def app_gateway_ws(websocket: WebSocket, plugin_id: str, tenant_id: str, path: str):
    """WebSocket 透传：/app/{插件}/{租户}/ws/... → 插件服务 /ws/...。

    供插件的长连接客户端（如珠宝云本地打印桥）经平台网关使用。
    平台层不鉴权（无 Cookie 的机器客户端也要能连），由插件应用自行校验
    （如珠宝云的桥接密钥）。租户上下文经握手头透传给插件。
    """
    try:
        ctx = await run_in_threadpool(
            gw.resolve_gateway, plugin_id, "NORMAL", tenant_id, None, "gateway", record_audit=False
        )
    except Exception as e:
        await websocket.accept()
        await websocket.close(code=4403, reason=str(e)[:120])
        return
    query = websocket.url.query
    upstream_url = f"ws://127.0.0.1:{ctx['port']}/ws/{path}" + (f"?{query}" if query else "")
    await websocket.accept()
    try:
        upstream = await run_in_threadpool(WSClient, upstream_url, ctx["headers"])
    except Exception as e:
        await websocket.close(code=4502, reason=str(e)[:120])
        return

    async def up_to_client():
        while True:
            msg = await run_in_threadpool(upstream.recv_text)
            if msg is None:
                return
            await websocket.send_text(msg)

    async def client_to_up():
        while True:
            msg = await websocket.receive_text()
            await run_in_threadpool(upstream.send_text, msg)

    tasks = [asyncio.create_task(up_to_client()), asyncio.create_task(client_to_up())]
    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in tasks:
        t.cancel()
    upstream.close()
    try:
        await websocket.close()
    except Exception:
        pass


# 插件包提供的推广页与平台同源，用 CSP sandbox 使其成为隔离源，无法读取平台登录凭证
PROMO_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    "X-Content-Type-Options": "nosniff",
}


@app.get("/market/{plugin_id}/{path:path}")
def promo_page(plugin_id: str, path: str):
    return FileResponse(svc.promo_file(plugin_id, None, path), headers=PROMO_HEADERS)


@app.get("/market-preview/{plugin_id}/{version}/{path:path}")
def promo_preview(plugin_id: str, version: str, path: str, request: Request):
    cookie_user(request)
    return FileResponse(svc.promo_file(plugin_id, version, path), headers=PROMO_HEADERS)


# ---------------------------------------------------------------- 前端

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/logo/logo.svg")
def platform_logo():
    """平台品牌标识。插件前端会以绝对路径引用 /logo/logo.svg，此处兜底提供，避免 404。"""
    return FileResponse(FRONTEND_DIR / "logo.svg", media_type="image/svg+xml",
                        headers={"Cache-Control": "no-store"})
