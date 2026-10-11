"""BugPulse 缺陷跟踪 · 插件后端（可独立运行）。

独立启动：在本目录执行  python main.py
默认 http://127.0.0.1:8003  演示账号 admin / admin123456
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query, Request, UploadFile, File
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bugtracker")

ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8003"))
# 平台启动时注入 TENANT_DB_DIR / STORAGE_DIR；独立运行时进入 STANDALONE 模式
MODE = "STANDALONE" if not os.environ.get("TENANT_DB_DIR") else "PLATFORM"


def _load_plugin_meta() -> dict:
    try:
        return json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


PLUGIN_META = _load_plugin_meta()
SOFT_NAME = PLUGIN_META.get("name", "BugPulse 缺陷跟踪")
SOFT_VERSION = PLUGIN_META.get("softwareVersion", "1.0.0")
FEATURES = PLUGIN_META.get("features", [])

import db  # noqa: E402

app = FastAPI(title=SOFT_NAME, docs_url="/docs", redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=500)

_sessions: dict[str, dict] = {}
_lock = threading.Lock()

STATUS_LABELS = {"open": "待处理", "in_progress": "进行中", "testing": "待验证", "closed": "已关闭"}
SEVERITY_LABELS = {"blocker": "致命", "critical": "严重", "major": "一般", "minor": "轻微"}
PRIORITY_LABELS = {"p0": "P0-紧急", "p1": "P1-高", "p2": "P2-中", "p3": "P3-低"}

_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")


# ---------------------------------------------------------------- 租户与鉴权

def _tenant_of(request: Request) -> str:
    return request.headers.get("X-Resolved-Tenant-ID") or os.environ.get("TENANT_ID") or "tenant_trial"


def _bypass(request: Request) -> bool:
    return request.headers.get("X-System-Bypass-Auth") == "true"


def _operator_mode(request: Request) -> str:
    return (request.headers.get("X-Operator-Mode") or "NORMAL").upper()


def _header_operator(request: Request) -> str:
    return request.headers.get("X-Operator-ID") or "admin"


def _storage_dir(tenant: str) -> Path:
    """截图落盘目录：平台按 STORAGE_DIR/{tenant} 隔离；独立运行用 ROOT/storage/{tenant}。"""
    base = Path(os.environ.get("STORAGE_DIR") or str(ROOT / "storage"))
    if MODE == "PLATFORM":
        base = base / tenant
    else:
        base = ROOT / "storage" / tenant
    base.mkdir(parents=True, exist_ok=True)
    return base


def _open(request: Request) -> sqlite3.Connection:
    tenant = _tenant_of(request)
    if MODE == "STANDALONE":
        os.environ.setdefault("TENANT_DB_DIR", str(ROOT / "dev_data"))
        db.DB_DIR = Path(os.environ["TENANT_DB_DIR"])
    conn = db.connect(tenant)
    # 兜底建表（正常情况由平台 init 脚本建库；独立运行时首次自动建 + 种子）
    conn.executescript(db.SCHEMA)
    db.migrate_schema(conn)
    if conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] == 0:
        db.seed_demo(conn)
    conn.commit()
    return conn


@contextmanager
def _db(request: Request):
    conn = _open(request)
    try:
        yield conn
    finally:
        conn.close()


def _require_auth(request: Request) -> dict:
    if _bypass(request):
        op = _header_operator(request)
        return {"username": op, "display_name": op, "role": "TENANT_ADMIN"}
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        token = request.query_params.get("token", "").strip()
    with _lock:
        sess = _sessions.get(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return sess


def _audit(request: Request, sess: dict, action: str, target: str, detail: str = "") -> None:
    """PRODUCTION_SUPPORT 模式每笔修改强制审计；其余模式也记录写操作（低成本）。"""
    with _db(request) as conn:
        conn.execute(
            "INSERT INTO audit_logs(operator,action,target,detail) VALUES(?,?,?,?)",
            (sess.get("username", "?"), action, target,
             f"[{_operator_mode(request)}] {detail}"),
        )
        conn.commit()


def _now_hm() -> str:
    return datetime.now().strftime("%H:%M")


# ---------------------------------------------------------------- 序列化

def _bug_payload(conn: sqlite3.Connection, bug_id: int) -> dict:
    b = conn.execute("SELECT * FROM bugs WHERE id=?", (bug_id,)).fetchone()
    if not b:
        raise HTTPException(status_code=404, detail="缺陷不存在")
    images = conn.execute(
        "SELECT id, bug_id, width, height, bytes, orig_size, created FROM bug_images WHERE bug_id=? ORDER BY id",
        (bug_id,),
    ).fetchall()
    comments = conn.execute(
        "SELECT id, author, text, type, created FROM bug_comments WHERE bug_id=? ORDER BY id DESC",
        (bug_id,),
    ).fetchall()
    return {
        "id": b["id"], "code": b["code"], "projectId": b["project_id"],
        "title": b["title"], "module": b["module"], "status": b["status"],
        "severity": b["severity"], "priority": b["priority"],
        "assignee": b["assignee"], "reporter": b["reporter"],
        "steps": b["steps"], "actual": b["actual"], "expected": b["expected"],
        "createdAt": b["created"],
        "images": [dict(r) for r in images],
        "comments": [dict(r) for r in comments],
    }


def _activity(conn: sqlite3.Connection, bug_id: int, author: str, text: str) -> None:
    conn.execute(
        "INSERT INTO bug_comments(bug_id,author,text,type) VALUES(?,?,?,'activity')",
        (bug_id, author, text),
    )


# ---------------------------------------------------------------- 登录

class LoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/auth/login")
def api_login(body: LoginReq, request: Request):
    with _db(request) as conn:
        user = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not user or not db.verify_password(body.password, user["password"]):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        if "$" not in user["password"]:
            # 历史明文库命中后静默升级为哈希存储
            conn.execute("UPDATE users SET password=? WHERE id=?",
                         (db.hash_password(body.password), user["id"]))
            conn.commit()
        token = secrets.token_urlsafe(24)
        info = {"username": user["username"], "display_name": user["display_name"], "role": user["role"]}
        with _lock:
            _sessions[token] = info
        mode = _operator_mode(request)
        return {"token": token, "user": info, "features": FEATURES, "mode": mode,
                "tenant": _tenant_of(request), "version": SOFT_VERSION}


@app.get("/api/auth/me")
def api_me(request: Request):
    u = _require_auth(request)
    return {"user": u, "features": FEATURES, "mode": _operator_mode(request),
            "tenant": _tenant_of(request), "version": SOFT_VERSION}


@app.post("/api/auth/logout")
def api_logout(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    with _lock:
        _sessions.pop(token, None)
    return {"ok": True}


class PasswordIn(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


@app.get("/api/users")
def api_users(request: Request):
    """成员列表：仅返回展示字段，密码永不回显。"""
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute(
            "SELECT username, display_name, role, created FROM users ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    display_name: str = Field(min_length=1, max_length=64)
    role: str = "MEMBER"
    password: str = Field(min_length=6, max_length=128)


@app.post("/api/users")
def api_create_user(body: UserIn, request: Request):
    """创建成员：仅系统管理员（TENANT_ADMIN / 平台 bypass）可操作。"""
    sess = _require_auth(request)
    if sess.get("role") != "TENANT_ADMIN":
        raise HTTPException(status_code=403, detail="仅系统管理员可创建成员")
    username = body.username.strip().lower()
    if not re.match(r"^[a-z0-9_]{2,32}$", username):
        raise HTTPException(status_code=400, detail="用户名须为 2-32 位小写字母/数字/下划线")
    if body.role not in ("TENANT_ADMIN", "MEMBER"):
        raise HTTPException(status_code=400, detail="非法角色")
    with _db(request) as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise HTTPException(status_code=400, detail=f"用户名 [{username}] 已存在")
        conn.execute(
            "INSERT INTO users(username,password,display_name,role) VALUES(?,?,?,?)",
            (username, db.hash_password(body.password), body.display_name.strip(), body.role),
        )
        conn.commit()
        _audit(request, sess, "创建成员", username, f"角色 {body.role}")
        return {"ok": True, "username": username}


@app.post("/api/auth/password")
def api_change_password(body: PasswordIn, request: Request):
    """修改自己的密码：需验证旧密码；新密码至少 6 位。"""
    sess = _require_auth(request)
    with _db(request) as conn:
        u = conn.execute("SELECT * FROM users WHERE username=?", (sess["username"],)).fetchone()
        if not u or not db.verify_password(body.old_password, u["password"]):
            raise HTTPException(status_code=400, detail="旧密码不正确")
        conn.execute("UPDATE users SET password=? WHERE id=?",
                     (db.hash_password(body.new_password), u["id"]))
        conn.commit()
        _audit(request, sess, "修改密码", u["username"], "")
        return {"ok": True}


# ---------------------------------------------------------------- 项目

class ProjectIn(BaseModel):
    key: str = Field(min_length=2, max_length=8)
    name: str = Field(min_length=1, max_length=128)
    desc: str = Field(default="", max_length=512)


@app.get("/api/projects")
def api_projects(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY id").fetchall()
        return [{"id": r["id"], "key": r["key"], "name": r["name"], "desc": r["descr"]} for r in rows]


@app.post("/api/projects")
def api_create_project(body: ProjectIn, request: Request):
    sess = _require_auth(request)
    key = body.key.strip().upper()
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="项目 KEY 须为 2-8 位大写字母/数字，且以字母开头")
    with _db(request) as conn:
        if conn.execute("SELECT 1 FROM projects WHERE key=?", (key,)).fetchone():
            raise HTTPException(status_code=400, detail=f"项目 KEY [{key}] 已存在")
        cur = conn.execute("INSERT INTO projects(key,name,descr) VALUES(?,?,?)",
                           (key, body.name.strip(), body.desc.strip()))
        conn.commit()
        pid = cur.lastrowid
        _audit(request, sess, "新建项目", key, body.name)
        return {"id": pid, "key": key, "name": body.name.strip(), "desc": body.desc.strip()}


# ---------------------------------------------------------------- 缺陷

class BugIn(BaseModel):
    projectId: int
    title: str = Field(min_length=1, max_length=256)
    module: str = Field(default="", max_length=64)
    status: str = "open"
    severity: str = "major"
    priority: str = "p2"
    assignee: str = Field(default="未指派", max_length=64)
    steps: str = Field(default="", max_length=4000)
    actual: str = Field(default="", max_length=2000)
    expected: str = Field(default="", max_length=2000)
    images: list[dict] = []  # [{dataUrl, width, height, bytes, origSize}] 创建时一并挂载


class StatusIn(BaseModel):
    status: str


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _save_dataurl_image(conn: sqlite3.Connection, storage: Path, bug_id: int, bug_code: str, img: dict) -> None:
    data_url = img.get("dataUrl", "")
    m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", data_url)
    if not m:
        raise HTTPException(status_code=400, detail="图片 dataUrl 格式不合法")
    ext, b64 = m.group(1), m.group(2)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="图片 base64 解码失败")
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="单张图片不得超过 2MB（请先压缩）")
    fname = f"{bug_code}_{int(time.time()*1000)}_{secrets.token_hex(3)}.{ext}"
    (storage / fname).write_bytes(raw)
    conn.execute(
        "INSERT INTO bug_images(bug_id,filename,width,height,bytes,orig_size) VALUES(?,?,?,?,?,?)",
        (bug_id, fname, int(img.get("width") or 0), int(img.get("height") or 0),
         len(raw), img.get("origSize") or ""),
    )


@app.get("/api/bugs")
def api_list_bugs(request: Request, projectId: int = Query(default=0)):
    _require_auth(request)
    with _db(request) as conn:
        if projectId:
            rows = conn.execute("SELECT id FROM bugs WHERE project_id=? ORDER BY id DESC", (projectId,)).fetchall()
        else:
            rows = conn.execute("SELECT id FROM bugs ORDER BY id DESC").fetchall()
        return [_bug_payload(conn, r["id"]) for r in rows]


@app.post("/api/bugs")
def api_create_bug(body: BugIn, request: Request):
    sess = _require_auth(request)
    if body.status not in STATUS_LABELS:
        raise HTTPException(status_code=400, detail="非法状态")
    if body.severity not in SEVERITY_LABELS:
        raise HTTPException(status_code=400, detail="非法严重度")
    if body.priority not in PRIORITY_LABELS:
        raise HTTPException(status_code=400, detail="非法优先级")
    tenant = _tenant_of(request)
    with _db(request) as conn:
        proj = conn.execute("SELECT * FROM projects WHERE id=?", (body.projectId,)).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="项目不存在")
        seq = proj["seq"]
        code = f"{proj['key']}-{seq}"
        conn.execute("UPDATE projects SET seq=seq+1 WHERE id=?", (proj["id"],))
        cur = conn.execute(
            "INSERT INTO bugs(project_id,code,title,module,status,severity,priority,assignee,reporter,steps,actual,expected) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (proj["id"], code, body.title.strip(), body.module.strip(), body.status,
             body.severity, body.priority, body.assignee.strip() or "未指派",
             sess["display_name"], body.steps.strip() or "未提供步骤",
             body.actual.strip() or "未提供", body.expected.strip() or "未提供"),
        )
        bug_id = cur.lastrowid
        storage = _storage_dir(tenant)
        n_img = 0
        for img in body.images:
            _save_dataurl_image(conn, storage, bug_id, code, img)
            n_img += 1
        _activity(conn, bug_id, sess["display_name"], f"创建了新缺陷，附带 {n_img} 张现场截图。")
        conn.commit()
        _audit(request, sess, "新建缺陷", code, body.title)
        return _bug_payload(conn, bug_id)


@app.get("/api/bugs/{bug_id}")
def api_get_bug(bug_id: int, request: Request):
    _require_auth(request)
    with _db(request) as conn:
        return _bug_payload(conn, bug_id)


@app.post("/api/bugs/{bug_id}/status")
def api_change_status(bug_id: int, body: StatusIn, request: Request):
    sess = _require_auth(request)
    if body.status not in STATUS_LABELS:
        raise HTTPException(status_code=400, detail="非法状态")
    with _db(request) as conn:
        b = conn.execute("SELECT * FROM bugs WHERE id=?", (bug_id,)).fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="缺陷不存在")
        if b["status"] == body.status:
            return _bug_payload(conn, bug_id)
        conn.execute("UPDATE bugs SET status=?, updated=datetime('now','localtime') WHERE id=?",
                     (body.status, bug_id))
        _activity(conn, bug_id, sess["display_name"],
                  f"将状态流转为：{STATUS_LABELS[b['status']]} → {STATUS_LABELS[body.status]}")
        conn.commit()
        _audit(request, sess, "状态流转", b["code"], f"{b['status']}->{body.status}")
        return _bug_payload(conn, bug_id)


@app.post("/api/bugs/{bug_id}/comments")
def api_add_comment(bug_id: int, body: CommentIn, request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        b = conn.execute("SELECT code FROM bugs WHERE id=?", (bug_id,)).fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="缺陷不存在")
        conn.execute("INSERT INTO bug_comments(bug_id,author,text,type) VALUES(?,?,?,'comment')",
                     (bug_id, sess["display_name"], body.text.strip()))
        conn.commit()
        return _bug_payload(conn, bug_id)


@app.post("/api/bugs/{bug_id}/images")
def api_append_image(bug_id: int, request: Request, file: UploadFile = File(...)):
    """multipart 追加截图（服务端校验类型并落盘；前端已做长边800压缩）。"""
    sess = _require_auth(request)
    ctype = (file.content_type or "").lower()
    if ctype not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=400, detail="仅支持 JPEG/PNG/WebP 图片")
    raw = file.file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="单张图片不得超过 2MB（请先压缩）")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[ctype]
    with _db(request) as conn:
        b = conn.execute("SELECT code FROM bugs WHERE id=?", (bug_id,)).fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="缺陷不存在")
        fname = f"{b['code']}_{int(time.time()*1000)}_{secrets.token_hex(3)}.{ext}"
        storage = _storage_dir(_tenant_of(request))
        (storage / fname).write_bytes(raw)
        conn.execute(
            "INSERT INTO bug_images(bug_id,filename,width,height,bytes,orig_size) VALUES(?,?,?,?,?,?)",
            (bug_id, fname, 0, 0, len(raw), ""),
        )
        _activity(conn, bug_id, sess["display_name"], f"上传了新截图凭据 ({len(raw)//1024} KB)")
        conn.commit()
        _audit(request, sess, "追加截图", b["code"], fname)
        return _bug_payload(conn, bug_id)


@app.delete("/api/bugs/{bug_id}/images/{img_id}")
def api_delete_image(bug_id: int, img_id: int, request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM bug_images WHERE id=? AND bug_id=?", (img_id, bug_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="图片不存在")
        b = conn.execute("SELECT code FROM bugs WHERE id=?", (bug_id,)).fetchone()
        fname = row["filename"]
        conn.execute("DELETE FROM bug_images WHERE id=?", (img_id,))
        _activity(conn, bug_id, sess["display_name"], f"删除了截图 {fname}")
        conn.commit()
        p = _storage_dir(_tenant_of(request)) / fname
        p.unlink(missing_ok=True)
        _audit(request, sess, "删除截图", b["code"] if b else "", fname)
        return _bug_payload(conn, bug_id)


@app.delete("/api/bugs/{bug_id}")
def api_delete_bug(bug_id: int, request: Request):
    """删除缺陷：级联删除评论、图片行与 storage 中的图片文件。"""
    sess = _require_auth(request)
    tenant = _tenant_of(request)
    with _db(request) as conn:
        b = conn.execute("SELECT * FROM bugs WHERE id=?", (bug_id,)).fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="缺陷不存在")
        rows = conn.execute("SELECT filename FROM bug_images WHERE bug_id=?", (bug_id,)).fetchall()
        storage = _storage_dir(tenant)
        conn.execute("DELETE FROM bug_comments WHERE bug_id=?", (bug_id,))
        conn.execute("DELETE FROM bug_images WHERE bug_id=?", (bug_id,))
        conn.execute("DELETE FROM bugs WHERE id=?", (bug_id,))
        conn.commit()
        deleted = 0
        for r in rows:
            p = storage / r["filename"]
            if p.is_file():
                p.unlink()
                deleted += 1
        _audit(request, sess, "删除缺陷", b["code"], f"级联删除 {deleted} 张截图")
        return {"ok": True, "code": b["code"], "deletedImages": deleted}


# ---------------------------------------------------------------- 外部上报（免登录）

REPORT_KINDS = ("缺陷", "需求")
_report_rate: dict[str, list[float]] = {}
_report_rate_lock = threading.Lock()


class ReportIn(BaseModel):
    source: str = Field(min_length=2, max_length=32, description="来源插件标识")
    appname: str = Field(default="", max_length=64, description="来源插件应用名称（项目名）")
    reporter: str = Field(min_length=1, max_length=32, description="上报人姓名")
    title: str = Field(min_length=1, max_length=120)
    kind: str = "缺陷"
    detail: str = Field(default="", max_length=2000)
    images: list[dict] = []  # [{dataUrl, width, height, bytes, origSize}] 最多 3 张


def _report_allow(tenant: str) -> bool:
    """同租户每分钟最多 5 条外部上报（防刷）。"""
    now = time.time()
    with _report_rate_lock:
        arr = [t for t in _report_rate.get(tenant, []) if now - t < 60]
        allowed = len(arr) < 5
        arr.append(now) if allowed else None
        _report_rate[tenant] = arr
        return allowed


@app.post("/api/report")
def api_external_report(body: ReportIn, request: Request):
    """免登录外部上报：来源插件与上报人由嵌入方传入，落「外部上报箱」项目待处理。

    平台网关模式依赖注入的 X-Resolved-Tenant-ID 隔离租户；独立运行回落 tenant_trial。
    """
    if body.kind not in REPORT_KINDS:
        raise HTTPException(status_code=400, detail="类型仅支持：缺陷 / 需求")
    if len(body.images) > 3:
        raise HTTPException(status_code=400, detail="截图最多 3 张")
    source = body.source.strip()
    reporter = body.reporter.strip()
    title = body.title.strip()
    if len(source) < 2 or not reporter or not title:
        raise HTTPException(status_code=400, detail="来源插件、上报人、标题不能为空")
    tenant = _tenant_of(request)
    if not _report_allow(tenant):
        raise HTTPException(status_code=429, detail="上报太频繁，请 1 分钟后再试")
    with _db(request) as conn:
        # 归属项目：以来源插件应用名称建/复用项目（key=插件ID大写）；
        # key 不合法（非 2-8 位字母数字）时回落「外部上报箱」
        key = source.upper()[:8]
        if _KEY_RE.match(key):
            name = body.appname.strip() or source
            conn.execute("INSERT OR IGNORE INTO projects(key,name,descr) VALUES(?,?,?)",
                         (key, name, f"来自插件应用 [{name}] 的外部上报"))
            proj = conn.execute("SELECT * FROM projects WHERE key=?", (key,)).fetchone()
        else:
            db.ensure_inbox(conn)
            proj = conn.execute("SELECT * FROM projects WHERE key='INBOX'").fetchone()
        code = f"{proj['key']}-{proj['seq']}"
        conn.execute("UPDATE projects SET seq=seq+1 WHERE id=?", (proj["id"],))
        display = f"{reporter}（来自 {source}）"
        cur = conn.execute(
            "INSERT INTO bugs(project_id,code,title,module,status,severity,priority,assignee,reporter,"
            "steps,actual,expected,source_plugin,source_reporter) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (proj["id"], code, title, "", "open", "major", "p2", "未指派",
             display, body.detail.strip() or "未提供", "未提供", "未提供", source, reporter),
        )
        bug_id = cur.lastrowid
        n_img = 0
        for img in body.images:
            _save_dataurl_image(conn, _storage_dir(tenant), bug_id, code, img)
            n_img += 1
        _activity(conn, bug_id, display,
                  f"外部上报（{body.kind}），来源插件 [{source}]。")
        conn.execute(
            "INSERT INTO audit_logs(operator,action,target,detail) VALUES(?,?,?,?)",
            (display, "外部上报", code, f"[{_operator_mode(request)}] {body.kind}，附带 {n_img} 张截图"))
        conn.commit()
        return {"ok": True, "code": code, "title": title, "images": n_img}


# ---------------------------------------------------------------- 图片伺服

@app.get("/api/images/{bug_id}/{img_id}")
def api_get_image(bug_id: int, img_id: int, request: Request, download: int = Query(default=0)):
    _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM bug_images WHERE id=? AND bug_id=?", (img_id, bug_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    path = _storage_dir(_tenant_of(request)) / row["filename"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="图片文件已丢失")
    media = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
    ext = path.suffix.lstrip(".").lower()
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{row["filename"]}"'
    return FileResponse(str(path), media_type=media.get(ext, "application/octet-stream"), headers=headers)


# ---------------------------------------------------------------- 前端静态

@app.get("/", include_in_schema=False)
def index():
    page = FRONTEND_DIR / "index.html"
    if not page.is_file():
        return HTMLResponse("<h1>frontend/index.html 缺失</h1>", status_code=500)
    return FileResponse(str(page), headers={"Cache-Control": "no-cache"})


@app.get("/app.js", include_in_schema=False)
def app_js():
    f = FRONTEND_DIR / "app.js"
    if not f.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(f), media_type="application/javascript",
                         headers={"Cache-Control": "no-cache"})


@app.get("/report", include_in_schema=False)
def report_page():
    """外部免登录上报页（可被其他插件以 iframe 嵌入）。"""
    page = FRONTEND_DIR / "report.html"
    if not page.is_file():
        return HTMLResponse("<h1>frontend/report.html 缺失</h1>", status_code=500)
    return FileResponse(str(page), headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    return {"ok": True, "name": SOFT_NAME, "version": SOFT_VERSION, "mode": MODE}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
