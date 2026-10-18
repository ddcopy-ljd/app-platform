import asyncio
import json
import re
import secrets
import shutil
import threading
from pathlib import Path

from fastapi import (Depends, FastAPI, File, HTTPException, Request, UploadFile,
                     WebSocket)
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               RedirectResponse, Response)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware

from . import gateway as gw
from . import grants as grant_svc
from . import platform_upgrade as pupgrade
from . import plugin_service as svc
from . import portal, runtime, traffic
from .config import (AGENT_API_KEY, FRONTEND_DIR, MAX_PACKAGE_BYTES, PACKAGES_DIR,
                     SESSION_TTL_SECONDS, STORAGE_DIR, TENANT_DB_DIR)
from .db import audit, get_conn, init_db, now_str
from .security import (SESSION_COOKIE, cookie_user, create_session, current_user,
                       drop_session, drop_tenant_sessions, hash_password, verify_password)
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
    if request.url.path == "/" or request.url.path.startswith("/static/") or request.url.path.startswith("/portal"):
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
    # 服务守护：每 15 秒巡检运行中的插件进程，意外退出自动拉起（120 秒内连崩 3 次放弃）。
    runtime.start_watchdog()


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


@app.exception_handler(pupgrade.UpgradeError)
def _upgrade_error(_: Request, exc: pupgrade.UpgradeError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


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
        rows = conn.execute(
            "SELECT t.id, t.name, t.is_sandbox, COALESCE(t.level,'vip1') AS level, t.status, "
            "(SELECT COUNT(*) FROM plugin_grants g WHERE g.tenant_id=t.id AND g.status='active') AS granted_plugins, "
            "(SELECT GROUP_CONCAT(tu.username) FROM tenant_users tu WHERE tu.tenant_id=t.id) AS portal_users "
            "FROM tenants t ORDER BY t.is_sandbox, t.id").fetchall()
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


# ---------------------------------------------------------------- 平台自我升级

@app.get("/api/platform/version")
def platform_version(_: dict = Depends(current_user)):
    return {"version": pupgrade.current_version()}


@app.post("/api/platform/upgrade")
async def platform_upgrade(file: UploadFile = File(...), user: dict = Depends(current_user)):
    content = await file.read(pupgrade.MAX_ZIP_BYTES + 1)
    return pupgrade.apply_upgrade(file.filename or "upgrade.zip", content, user["username"])


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


@app.post("/api/plugins/{plugin_id}/versions/{version_id}/sync-promo")
def sync_promo(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    """把该版本（如试运行版）包内推广页复制到正式版本包，使 /market/{id}/ 立即更新。"""
    return svc.sync_promo(plugin_id, version_id, user["username"])


@app.delete("/api/plugins/{plugin_id}/versions/{version_id}")
def delete_version(plugin_id: str, version_id: int, user: dict = Depends(current_user)):
    return svc.delete_version(plugin_id, version_id, user["username"])


@app.post("/api/plugins/{plugin_id}/gateway/ticket")
def gateway_ticket(plugin_id: str, body: GatewayIn, user: dict = Depends(current_user)):
    runtime.sync_states()
    return gw.issue_ticket(plugin_id, body.mode, body.tenant_id, body.version, user["username"])


# ---------------------------------------------------------------- 租户管理

TENANT_ID_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")


class TenantCreateIn(BaseModel):
    id: str = Field(max_length=32)
    name: str = Field(max_length=64)
    level: str = Field(default="vip1", max_length=20)


class TenantUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    level: str | None = Field(default=None, max_length=20)


class TenantStatusIn(BaseModel):
    status: str = Field(max_length=20)


@app.post("/api/tenants")
def create_tenant(body: TenantCreateIn, user: dict = Depends(current_user)):
    """新建企业租户（ID 仅字母/数字/下划线，用作库文件名片段）。"""
    tid = body.id.strip()
    name = body.name.strip()
    if not TENANT_ID_RE.fullmatch(tid):
        raise HTTPException(status_code=400, detail="租户ID仅允许字母、数字、下划线（1-32位）")
    if not name:
        raise HTTPException(status_code=400, detail="租户名称不能为空")
    if body.level not in grant_svc.TENANT_LEVELS:
        raise HTTPException(status_code=400, detail="未知租户级别")
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM tenants WHERE id=?", (tid,)).fetchone():
            raise HTTPException(status_code=409, detail=f"租户 {tid} 已存在")
        conn.execute("INSERT INTO tenants (id, name, level, is_sandbox, status) VALUES (?,?,?,0,'active')",
                     (tid, name, body.level))
        audit(conn, user["username"], "新建租户", tid, f"{name} · {grant_svc.LEVEL_LABELS[body.level]}")
    return {"ok": True}


@app.put("/api/tenants/{tenant_id}")
def update_tenant(tenant_id: str, body: TenantUpdateIn, user: dict = Depends(current_user)):
    """编辑租户名称 / 级别（standard/premium/enterprise）。"""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tenants WHERE id=?", (tenant_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="租户不存在")
        if row["is_sandbox"]:
            raise HTTPException(status_code=400, detail="沙箱租户不可编辑")
        sets, params, details = [], [], []
        if body.name is not None:
            name = body.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="租户名称不能为空")
            if name != row["name"]:
                sets.append("name=?")
                params.append(name)
                details.append(f"名称「{row['name']}」→「{name}」")
        if body.level is not None:
            if body.level not in grant_svc.TENANT_LEVELS:
                raise HTTPException(status_code=400, detail="未知租户级别")
            if body.level != row["level"]:
                sets.append("level=?")
                params.append(body.level)
                details.append(f"级别 {row['level']}→{body.level}")
        if not sets:
            return {"ok": True}
        params.append(tenant_id)
        conn.execute(f"UPDATE tenants SET {', '.join(sets)} WHERE id=?", params)
        audit(conn, user["username"], "编辑租户", tenant_id, "；".join(details))
    return {"ok": True}


@app.post("/api/tenants/{tenant_id}/status")
def tenant_status(tenant_id: str, body: TenantStatusIn, user: dict = Depends(current_user)):
    """停用/启用租户：停用后该租户对所有插件的访问立即被网关拦截，数据保留。"""
    if body.status not in ("active", "inactive"):
        raise HTTPException(status_code=400, detail="状态仅支持 active / inactive")
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tenants WHERE id=?", (tenant_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="租户不存在")
        if row["is_sandbox"]:
            raise HTTPException(status_code=400, detail="沙箱租户不可停用")
        if row["status"] != body.status:
            conn.execute("UPDATE tenants SET status=? WHERE id=?", (body.status, tenant_id))
            audit(conn, user["username"], "停用租户" if body.status == "inactive" else "启用租户",
                  tenant_id, row["name"])
    return {"ok": True}


@app.delete("/api/tenants/{tenant_id}")
def delete_tenant(tenant_id: str, user: dict = Depends(current_user)):
    """删除无用租户：连带清理授权台账/申请记录/门户账号/数据副本/文件存储，不可恢复。"""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tenants WHERE id=?", (tenant_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="租户不存在")
        if row["is_sandbox"]:
            raise HTTPException(status_code=400, detail="沙箱租户为系统内置，不可删除")
        # 收集数据副本文件路径（删行前查）；插件服务为多租户共享，不因此停服
        db_files = [str(p) for p in TENANT_DB_DIR.glob(f"*/db_*_{tenant_id}_v*.sqlite*")]
        conn.execute("DELETE FROM plugin_grants WHERE tenant_id=?", (tenant_id,))
        conn.execute("DELETE FROM plugin_trials WHERE tenant_id=?", (tenant_id,))
        conn.execute("DELETE FROM plugin_renewals WHERE tenant_id=?", (tenant_id,))
        conn.execute("DELETE FROM tenant_users WHERE tenant_id=?", (tenant_id,))
        conn.execute("DELETE FROM tenant_apps WHERE tenant_id=?", (tenant_id,))
        conn.execute("DELETE FROM tenants WHERE id=?", (tenant_id,))
        audit(conn, user["username"], "删除租户", tenant_id,
              f"{row['name']}；授权/申请/门户账号已清，数据副本文件 {len(db_files)} 个")
    # 库外文件清理：租户数据副本 + storage 目录 + 门户会话
    for f in db_files:
        try:
            Path(f).unlink(missing_ok=True)
        except OSError:
            pass
    for d in STORAGE_DIR.glob(f"*/{tenant_id}"):
        shutil.rmtree(d, ignore_errors=True)
    drop_tenant_sessions(tenant_id)
    return {"ok": True, "db_files_removed": len(db_files)}


@app.get("/api/tenants/applications")
def tenant_applications(_: dict = Depends(current_user)):
    """全平台待办申请：试用申请 + 续费申请（pending 优先，各限 100 条）。"""
    with get_conn() as conn:
        trials = conn.execute(
            "SELECT pt.*, t.name AS tenant_name, p.name AS plugin_name FROM plugin_trials pt "
            "JOIN tenants t ON t.id=pt.tenant_id JOIN plugins p ON p.id=pt.plugin_id "
            "ORDER BY pt.status='pending' DESC, pt.id DESC LIMIT 100").fetchall()
        renewals = conn.execute(
            "SELECT pr.*, t.name AS tenant_name, p.name AS plugin_name FROM plugin_renewals pr "
            "JOIN tenants t ON t.id=pr.tenant_id JOIN plugins p ON p.id=pr.plugin_id "
            "ORDER BY pr.status='pending' DESC, pr.id DESC LIMIT 100").fetchall()
    return {"trials": [dict(r) for r in trials], "renewals": [dict(r) for r in renewals]}


@app.get("/api/tenants/{tenant_id}/grants")
def tenant_grants_detail(tenant_id: str, _: dict = Depends(current_user)):
    """该租户授权明细 + 试用/续费申请记录 + 门户账号（租户管理台账弹窗数据源）。"""
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM tenants WHERE id=?", (tenant_id,)).fetchone():
            raise HTTPException(status_code=404, detail="租户不存在")
        rows = conn.execute(
            "SELECT g.plugin_id, p.name AS plugin_name, p.icon, p.current_version, "
            "g.pay_status, g.status, g.paid_until, g.note, g.granted_at, g.updated_at "
            "FROM plugin_grants g JOIN plugins p ON p.id=g.plugin_id WHERE g.tenant_id=? "
            "ORDER BY g.plugin_id", (tenant_id,)).fetchall()
        trials = conn.execute(
            "SELECT pt.*, p.name AS plugin_name FROM plugin_trials pt JOIN plugins p ON p.id=pt.plugin_id "
            "WHERE pt.tenant_id=? ORDER BY pt.id DESC LIMIT 50", (tenant_id,)).fetchall()
        renewals = conn.execute(
            "SELECT pr.*, p.name AS plugin_name FROM plugin_renewals pr JOIN plugins p ON p.id=pr.plugin_id "
            "WHERE pr.tenant_id=? ORDER BY pr.id DESC LIMIT 50", (tenant_id,)).fetchall()
        users = conn.execute(
            "SELECT username, display_name, created_at FROM tenant_users WHERE tenant_id=? "
            "ORDER BY username", (tenant_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["days_left"] = grant_svc.days_left(r["paid_until"])
            d["db_ready"] = bool(r["current_version"]) and svc.db_path(
                r["plugin_id"], tenant_id, r["current_version"]).exists()
            out.append(d)
    return {"grants": out, "trials": [dict(r) for r in trials],
            "renewals": [dict(r) for r in renewals], "portal_users": [dict(r) for r in users]}


# ---------------------------------------------------------------- 租户授权与试用付费

class GrantIn(BaseModel):
    tenant_id: str = Field(max_length=64)
    pay_status: str = Field(max_length=20)
    paid_until: str | None = Field(default=None, max_length=10)
    note: str = Field(default="", max_length=200)


class GrantStatusIn(BaseModel):
    status: str = Field(max_length=20)


class TrialReviewIn(BaseModel):
    action: str = Field(max_length=10)


@app.get("/api/plugins/{plugin_id}/grants")
def grants_overview(plugin_id: str, _: dict = Depends(current_user)):
    """授权台账 + 试用申请记录（授权管理区块数据源）。"""
    return grant_svc.plugin_grants_overview(plugin_id)


@app.post("/api/plugins/{plugin_id}/grants")
def save_grant(plugin_id: str, body: GrantIn, user: dict = Depends(current_user)):
    """开通/更新授权（trial 缺省到期日=今天起 30 天；free/arrears 忽略到期日）。"""
    grant_svc.upsert_grant(plugin_id, body.tenant_id, body.pay_status,
                           body.paid_until, body.note, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/grants/{tenant_id}/status")
def grant_status_change(plugin_id: str, tenant_id: str, body: GrantStatusIn,
                        user: dict = Depends(current_user)):
    grant_svc.set_grant_status(plugin_id, tenant_id, body.status, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/grants/{tenant_id}/provision")
def grant_provision(plugin_id: str, tenant_id: str, user: dict = Depends(current_user)):
    """为已授权但尚无数据副本的租户后台初始化数据库。"""
    return grant_svc.provision(plugin_id, tenant_id, user["username"])


@app.delete("/api/plugins/{plugin_id}/grants/{tenant_id}")
def grant_delete(plugin_id: str, tenant_id: str, user: dict = Depends(current_user)):
    grant_svc.delete_grant(plugin_id, tenant_id, user["username"])
    return {"ok": True}


@app.post("/api/plugins/{plugin_id}/trials/{trial_id}/review")
def trial_review(plugin_id: str, trial_id: int, body: TrialReviewIn,
                 user: dict = Depends(current_user)):
    """审批试用申请：approve 生成 30 天试用授权；reject 拒绝。"""
    return grant_svc.review_trial(plugin_id, trial_id, body.action, user["username"])


class RenewalConfirmIn(BaseModel):
    action: str = Field(max_length=10)          # confirm | reject
    paid_until: str | None = Field(default=None, max_length=10)


@app.post("/api/plugins/{plugin_id}/renewals/{renewal_id}/confirm")
def renewal_confirm(plugin_id: str, renewal_id: int, body: RenewalConfirmIn,
                    user: dict = Depends(current_user)):
    """确认续费：confirm 需填新到期日并更新授权台账；reject 拒绝。"""
    return grant_svc.confirm_renewal(plugin_id, renewal_id, body.action,
                                     body.paid_until, user["username"])


# ---------------------------------------------------------------- 租户门户账号（管理端）

class PortalAccountIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(min_length=6, max_length=128)


@app.post("/api/tenants/{tenant_id}/portal-account")
def portal_account(tenant_id: str, body: PortalAccountIn, user: dict = Depends(current_user)):
    """为存量租户创建/重置门户账号（密码仅本次回显一次，列表接口永不回显）。"""
    uname = body.username.strip()
    if not uname:
        raise HTTPException(status_code=400, detail="登录账号不能为空")
    with get_conn() as conn:
        t = conn.execute("SELECT name FROM tenants WHERE id=? AND is_sandbox=0", (tenant_id,)).fetchone()
        if not t:
            raise HTTPException(status_code=404, detail="企业租户不存在")
        exist = conn.execute("SELECT tenant_id FROM tenant_users WHERE username=?", (uname,)).fetchone()
        if exist and exist["tenant_id"] != tenant_id:
            raise HTTPException(status_code=409, detail="该账号已归属其他企业")
        if exist:
            conn.execute("UPDATE tenant_users SET password_hash=?, display_name=? WHERE username=?",
                         (hash_password(body.password), t["name"], uname))
            audit(conn, user["username"], "重置门户账号", tenant_id, uname)
            return {"ok": True, "action": "reset", "username": uname}
        conn.execute(
            "INSERT INTO tenant_users (tenant_id, username, password_hash, display_name, created_at) "
            "VALUES (?,?,?,?,?)", (tenant_id, uname, hash_password(body.password), t["name"], now_str()))
        audit(conn, user["username"], "创建门户账号", tenant_id, uname)
    return {"ok": True, "action": "created", "username": uname}


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


def _bugtracker_base(plugin_id: str, mode: str, tenant_id: str | None, operator: str) -> str | None:
    """为珠宝云页面签发 BugTracker 沙箱票证地址（供上报页跨插件内嵌）；非珠宝云返回 None。"""
    if plugin_id != "jewelry":
        return None
    return gw.ensure_ticket("bugtracker", mode, tenant_id, operator)


def _rewrite_app_base(content: bytes, base: str, bt_base: str | None = None) -> bytes:
    """让插件页面在 /app/{插件}/{租户}/ 或 /gw/{票据}/ 前缀下正确加载：
    1) 把 <link src/href/action="/..."> 等标签绝对路径加挂载前缀；
    2) 注入 window.__APP_BASE__ 供前端 JS 拼接 API 地址；
    3) bt_base 非空时追加注入 window.__BUGTRACKER_BASE__（跨插件内嵌 BugTracker 上报页用）。
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
    script = f"<script>window.__APP_BASE__={json.dumps(base)};"
    if bt_base:
        script += f"window.__BUGTRACKER_BASE__={json.dumps(bt_base)};"
    script += "</script>"
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
        bt_base = None
        if tctx:
            bt_base = await run_in_threadpool(
                _bugtracker_base, tctx["plugin_id"], tctx["mode"], tctx["tenant_id"], "gateway"
            )
        content = _rewrite_app_base(content, f"/gw/{ticket}/", bt_base)
        _set_header(headers, "Cache-Control", "no-store")  # 注入页禁止缓存，避免浏览器复用未注入的旧副本
    return Response(content=content, status_code=status, headers=headers)


# 机器客户端（无 Cookie）允许访问的插件接口白名单：由插件自行校验凭证，
# 平台不鉴权。如打印桥凭门店密钥换取门店名称的 bridge-whoami。
_MACHINE_PATHS = {"api/stores/bridge-whoami", "api/print-agent/download",
                  "api/agent/version",
                  "api/scan-app/info", "api/scan-app/download"}


# 插件 SPA 自管理登录：平台网关只做路由转发，不查平台 Cookie 登录态。
# 插件前端自带独立登录页（v-if="!token" 渲染登录表单），插件后端各 API 端点自行校验 Bearer token。
# operator 仅作审计标识，无平台会话时记为 "anonymous"。
def _append_body(content: bytes, snippet: str) -> bytes:
    """把注入片段插入 HTML 的 </body> 前（无 body 标签则追加到末尾）。"""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return content
    idx = text.lower().rfind("</body>")
    if idx >= 0:
        text = text[:idx] + snippet + text[idx:]
    else:
        text += snippet
    return text.encode("utf-8")


@app.api_route("/app/{plugin_id}/{tenant_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def app_entry(plugin_id: str, tenant_id: str, path: str, request: Request):
    if path in _MACHINE_PATHS:
        operator = "print-agent"
    else:
        try:
            user = cookie_user(request)
            operator = user["username"]
        except HTTPException:
            operator = "anonymous"
    body = await request.body()
    try:
        status, headers, content = await run_in_threadpool(
            gw.proxy_app, plugin_id, tenant_id, operator,
            path, request.method, request.url.query, dict(request.headers), body
        )
    except svc.PluginError as e:
        if e.status_code == 403:
            # 未开通/试用到期/欠费/停用：返回内置拦截页（含试用申请表单），而非 JSON 报错
            page = await run_in_threadpool(grant_svc.intercept_page, plugin_id, tenant_id, str(e))
            return HTMLResponse(page, status_code=403)
        raise
    if "text/html" in _content_type(headers).lower():
        content = _rewrite_app_base(content, f"/app/{plugin_id}/{tenant_id}/")
        banner = await run_in_threadpool(grant_svc.tenant_banner, plugin_id, tenant_id)
        if banner:
            content = _append_body(content, banner)   # 试用/付费到期前 10 天顶部提示条
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
    # 注入公网原始 Host / 入口前缀 / 协议，插件据此还原公开服务地址（如打印桥地址自愈）
    hdrs = dict(ctx["headers"])
    orig_host = (websocket.headers.get("host") or "").strip()
    if orig_host:
        hdrs["Host"] = orig_host
    hdrs["X-Forwarded-Proto"] = "https" if websocket.url.scheme == "wss" else "http"
    hdrs["X-App-Base"] = f"/app/{plugin_id}/{tenant_id}/"
    upstream_url = f"ws://127.0.0.1:{ctx['port']}/ws/{path}" + (f"?{query}" if query else "")
    await websocket.accept()
    try:
        upstream = await run_in_threadpool(WSClient, upstream_url, hdrs)
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


@app.websocket("/gw/{ticket}/ws/{path:path}")
async def gw_gateway_ws(websocket: WebSocket, ticket: str, path: str):
    """WebSocket 透传（票据模式）：/gw/{票据}/ws/... → 插件 /ws/...。

    与 /app/ 的 WS 透传对应：沙箱/试运行模式经票证地址下载的本地打印桥也要能
    收到实时任务。票据为确定性派生且重复签发自动续期，适合代理长期连接。
    平台层不鉴权，由插件应用自行校验（如珠宝云的桥接密钥）。
    """
    tctx = gw.ticket_context(ticket)
    if not tctx:
        await websocket.accept()
        await websocket.close(code=4404, reason="调试入口已失效，请在插件版本调试中重新打开")
        return
    try:
        ctx = await run_in_threadpool(
            gw.resolve_gateway, tctx["plugin_id"], tctx["mode"], tctx["tenant_id"], None,
            "gateway", record_audit=False
        )
    except Exception as e:
        await websocket.accept()
        await websocket.close(code=4403, reason=str(e)[:120])
        return
    query = websocket.url.query
    # 注入公网原始 Host / 票据入口前缀 / 协议，插件据此还原公开服务地址（如打印桥地址自愈）
    hdrs = dict(ctx["headers"])
    orig_host = (websocket.headers.get("host") or "").strip()
    if orig_host:
        hdrs["Host"] = orig_host
    hdrs["X-Forwarded-Proto"] = "https" if websocket.url.scheme == "wss" else "http"
    hdrs["X-App-Base"] = f"/gw/{ticket}/"
    upstream_url = f"ws://127.0.0.1:{ctx['port']}/ws/{path}" + (f"?{query}" if query else "")
    await websocket.accept()
    try:
        upstream = await run_in_threadpool(WSClient, upstream_url, hdrs)
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


app.include_router(portal.router)


# ---------------------------------------------------------------- 前端

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/portal")
@app.get("/portal/")
def portal_page():
    """租户门户（企业自助注册/登录、我的应用、申请与续费）。"""
    return FileResponse(FRONTEND_DIR / "portal.html")


@app.get("/logo/logo.svg")
def platform_logo():
    """平台品牌标识。插件前端会以绝对路径引用 /logo/logo.svg，此处兜底提供，避免 404。"""
    return FileResponse(FRONTEND_DIR / "logo.svg", media_type="image/svg+xml",
                        headers={"Cache-Control": "no-store"})
