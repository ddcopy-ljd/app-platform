"""租户门户 API：企业自助注册/登录、我的应用、试用申请、续费申请。

设计要点：
- 会话完全复用平台 security 机制（内存+落库会话表、同一 HttpOnly Cookie），
  租户 user dict 带 role='tenant' 与 tenant_id；租户登录门户后访问 /app/ 网关天然带身份；
- 推广页来源注册免审批：直接生成 30 天试用授权并后台初始化数据副本；
- 门户内申请其他插件试用、发起续费均写入审批台账，由管理员在「租户管理」处理。
"""

import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .config import SESSION_TTL_SECONDS
from .db import audit, get_conn, now_str
from .grants import TRIAL_DAYS, apply_renewal, apply_trial, days_left, grant_state
from .security import (SESSION_COOKIE, create_session, drop_session, hash_password,
                       session_user, verify_password)

router = APIRouter(prefix="/api/portal")

TENANT_ID_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_TTL_SECONDS, httponly=True, samesite="lax")


def _token_of(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth.removeprefix("Bearer ").strip()
    return request.cookies.get(SESSION_COOKIE, "")


def portal_user(request: Request) -> dict:
    """门户接口鉴权：必须是 role='tenant' 的会话，且企业处于启用状态。"""
    user = session_user(_token_of(request))
    if user.get("role") != "tenant":
        raise HTTPException(status_code=403, detail="仅租户门户账号可访问，请重新登录")
    with get_conn() as conn:
        t = conn.execute("SELECT name, level, status FROM tenants WHERE id=?",
                         (user["tenant_id"],)).fetchone()
    if not t or t["status"] != "active":
        raise HTTPException(status_code=403, detail="企业账号已停用，请联系平台管理员")
    return {**user, "tenant_name": t["name"], "level": t["level"] or "vip1"}


# ---------------------------------------------------------------- 注册 / 登录

class RegisterIn(BaseModel):
    tenant_id: str = Field(max_length=32)
    tenant_name: str = Field(max_length=64)
    username: str = Field(max_length=64)
    password: str = Field(min_length=6, max_length=128)
    plugin_id: str = Field(default="", max_length=64)
    contact: str = Field(default="", max_length=120)


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


@router.post("/register")
def register(body: RegisterIn, response: Response):
    """企业自助注册：建租户 + 门户账号；带来源插件时免审批直开 30 天试用并初始化数据。"""
    tid = body.tenant_id.strip()
    tname = body.tenant_name.strip()
    uname = body.username.strip()
    if not TENANT_ID_RE.fullmatch(tid):
        raise HTTPException(status_code=400, detail="企业ID仅允许字母、数字、下划线（1-32位）")
    if not tname:
        raise HTTPException(status_code=400, detail="企业名称不能为空")
    if not uname:
        raise HTTPException(status_code=400, detail="登录账号不能为空")
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM tenants WHERE id=?", (tid,)).fetchone():
            raise HTTPException(status_code=409, detail="该企业ID已注册，请直接登录或更换ID")
        if conn.execute("SELECT 1 FROM tenant_users WHERE username=?", (uname,)).fetchone():
            raise HTTPException(status_code=409, detail="登录账号已存在，请直接登录")
        p = None
        if body.plugin_id:
            p = conn.execute("SELECT name FROM plugins WHERE id=?", (body.plugin_id,)).fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="来源应用不存在")
        ts = now_str()
        conn.execute(
            "INSERT INTO tenants (id, name, level, is_sandbox, status) VALUES (?,?, 'vip1', 0, 'active')",
            (tid, tname))
        conn.execute(
            "INSERT INTO tenant_users (tenant_id, username, password_hash, display_name, created_at) "
            "VALUES (?,?,?,?,?)", (tid, uname, hash_password(body.password), tname, ts))
        message = "注册成功"
        if p:
            trial_end = (date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
            conn.execute(
                "INSERT INTO plugin_grants (plugin_id, tenant_id, pay_status, status, paid_until, note, "
                "granted_at, updated_at) VALUES (?,?,'trial','active',?,?,?,?)",
                (body.plugin_id, tid, trial_end, "推广页自助注册（免审批试用）", ts, ts))
            conn.execute(
                "INSERT INTO plugin_trials (plugin_id, tenant_id, contact, status, requested_at, "
                "reviewed_at, reviewer, trial_end) VALUES (?,?,?,?,?,?,?,?)",
                (body.plugin_id, tid, body.contact.strip()[:120], "approved", ts, ts,
                 "system:self-register", trial_end))
            message = f"注册成功，已开通《{p['name']}》{TRIAL_DAYS} 天免费试用（至 {trial_end}）"
        audit(conn, uname, "租户自助注册", tid,
              f"{tname} · 来源插件 {body.plugin_id or '无'}")
    user = {"username": uname, "display_name": tname, "role": "tenant",
            "tenant_id": tid, "tenant_name": tname}
    token = create_session(user)
    _set_session_cookie(response, token)
    note = ""
    if body.plugin_id:
        try:
            from .plugin_service import provision_tenant_db
            r = provision_tenant_db(body.plugin_id, tid, uname)
            note = r.get("note", "")
        except Exception as e:  # noqa: BLE001 - 无正式版/升级中等场景不阻断注册
            note = f"应用数据初始化需管理员稍后处理：{e}"
    return {"token": token, "user": user, "message": message, "note": note}


@router.post("/login")
def login(body: LoginIn, response: Response):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT tu.tenant_id, tu.username, tu.password_hash, tu.display_name, "
            "t.name AS tenant_name, t.level, t.status AS tenant_status "
            "FROM tenant_users tu JOIN tenants t ON t.id=tu.tenant_id WHERE tu.username=?",
            (body.username.strip(),)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if row["tenant_status"] != "active":
        raise HTTPException(status_code=403, detail="企业账号已停用，请联系平台管理员")
    user = {"username": row["username"], "display_name": row["display_name"] or row["tenant_name"],
            "role": "tenant", "tenant_id": row["tenant_id"], "tenant_name": row["tenant_name"]}
    token = create_session(user)
    _set_session_cookie(response, token)
    return {"token": token, "user": user}


@router.post("/logout")
def logout(request: Request, response: Response):
    drop_session(_token_of(request))
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(portal_user)):
    return user


# ---------------------------------------------------------------- 门户概览

@router.get("/overview")
def overview(user: dict = Depends(portal_user)):
    """我的应用（含授权状态）、试用申请记录、续费记录、可申请的插件目录。"""
    tid = user["tenant_id"]
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT g.plugin_id, p.name AS plugin_name, p.icon, p.current_version, "
            "g.pay_status, g.status, g.paid_until, g.note, g.granted_at "
            "FROM plugin_grants g JOIN plugins p ON p.id=g.plugin_id WHERE g.tenant_id=? "
            "ORDER BY g.plugin_id", (tid,)).fetchall()
        apps = []
        for r in rows:
            d = dict(r)
            st = grant_state(conn, r["plugin_id"], tid)
            d["state"] = st["state"]
            d["days_left"] = days_left(r["paid_until"])
            d["pending_trial"] = bool(st["pending_trial"])
            apps.append(d)
        trials = conn.execute(
            "SELECT pt.id, pt.plugin_id, p.name AS plugin_name, p.icon, pt.contact, pt.status, "
            "pt.requested_at, pt.reviewed_at, pt.trial_end FROM plugin_trials pt "
            "JOIN plugins p ON p.id=pt.plugin_id WHERE pt.tenant_id=? "
            "ORDER BY pt.id DESC LIMIT 50", (tid,)).fetchall()
        renewals = conn.execute(
            "SELECT pr.id, pr.plugin_id, p.name AS plugin_name, p.icon, pr.months, pr.note, "
            "pr.status, pr.requested_at, pr.reviewed_at, pr.new_paid_until FROM plugin_renewals pr "
            "JOIN plugins p ON p.id=pr.plugin_id WHERE pr.tenant_id=? "
            "ORDER BY pr.id DESC LIMIT 50", (tid,)).fetchall()
        catalog = conn.execute(
            "SELECT id, name, icon, category, description FROM plugins "
            "WHERE app_status='OPEN' AND id NOT IN "
            "(SELECT plugin_id FROM plugin_grants WHERE tenant_id=?) ORDER BY id", (tid,)).fetchall()
    return {"apps": apps, "trials": [dict(r) for r in trials],
            "renewals": [dict(r) for r in renewals], "catalog": [dict(r) for r in catalog]}


class TrialIn(BaseModel):
    plugin_id: str = Field(max_length=64)
    contact: str = Field(default="", max_length=120)


@router.post("/trials")
def portal_apply_trial(body: TrialIn, user: dict = Depends(portal_user)):
    """门户内申请试用其他插件（待管理员审批）。"""
    return apply_trial(body.plugin_id, user["tenant_id"], body.contact or user["username"])


class RenewalIn(BaseModel):
    plugin_id: str = Field(max_length=64)
    months: int = Field(default=12, ge=1, le=60)
    note: str = Field(default="", max_length=200)


@router.post("/renewals")
def portal_apply_renewal(body: RenewalIn, user: dict = Depends(portal_user)):
    """门户内发起续费申请（管理员确认并填写新到期日）。"""
    return apply_renewal(body.plugin_id, user["tenant_id"], body.months, body.note)
