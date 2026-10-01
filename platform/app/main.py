from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import gateway as gw
from . import plugin_service as svc
from . import runtime
from .config import FRONTEND_DIR, MAX_PACKAGE_BYTES, SESSION_TTL_SECONDS
from .db import get_conn, init_db
from .security import (SESSION_COOKIE, cookie_user, create_session, current_user, drop_session,
                       verify_password)

app = FastAPI(title="综合业务应用服务平台")


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.on_event("shutdown")
def _shutdown() -> None:
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


@app.api_route("/gw/{ticket}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def gateway_proxy(ticket: str, path: str, request: Request):
    body = await request.body()
    status, headers, content = await run_in_threadpool(
        gw.proxy, ticket, path, request.method, request.url.query, dict(request.headers), body
    )
    return Response(content=content, status_code=status, headers=headers)


# 演示：企业登录尚未实现，暂由平台登录会话模拟企业用户访问
@app.api_route("/app/{plugin_id}/{tenant_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def app_entry(plugin_id: str, tenant_id: str, path: str, request: Request):
    user = cookie_user(request)
    body = await request.body()
    status, headers, content = await run_in_threadpool(
        gw.proxy_app, plugin_id, tenant_id, user["username"],
        path, request.method, request.url.query, dict(request.headers), body,
    )
    return Response(content=content, status_code=status, headers=headers)


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
