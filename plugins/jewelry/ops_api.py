"""懿臻珠宝云 · 运维端 API（/api/ops/*）。

唯一准入方式：平台网关 PRODUCTION_SUPPORT 穿透票证注入的两个头同时成立——
  X-System-Bypass-Auth: true          （网关穿透，无业务会话）
  X-Operator-Mode: PRODUCTION_SUPPORT （必须恰为生产运维模式）
普通业务 Bearer 登录、SANDBOX 穿透（同样 bypass 但 mode=SANDBOX）一律 403。

巡检/设备/审计端点只读租户业务库；助手发布与强更开关是本模块仅有的写操作，
每次调用强制写 operate_logs（经 main._log 注入）。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

logger = logging.getLogger("jewelry.ops")

router = APIRouter(prefix="/api/ops", tags=["ops-console"])

ROOT = Path(__file__).resolve().parent

# main.py 在模块加载末期注入的依赖（避免与 main 循环导入）
_deps: dict = {}


def init(*, open_conn, tenant_of, software_version: str, scan_info, log_fn) -> None:
    """由 main.py 调用：注入开库/租户解析/包指纹函数与审计写函数（_log）。"""
    _deps["open_conn"] = open_conn
    _deps["tenant_of"] = tenant_of
    _deps["software_version"] = software_version
    _deps["scan_info"] = scan_info
    _deps["log_fn"] = log_fn


def require_ops(request: Request) -> SimpleNamespace:
    """统一鉴权：仅平台 PRODUCTION_SUPPORT 穿透可进。"""
    if request.headers.get("X-System-Bypass-Auth", "").lower() != "true":
        raise HTTPException(status_code=403,
                            detail="运维端仅允许平台「生产运维穿透」进入（缺少穿透凭证）")
    if (request.headers.get("X-Operator-Mode") or "").upper() != "PRODUCTION_SUPPORT":
        raise HTTPException(status_code=403,
                            detail="运维端仅允许 PRODUCTION_SUPPORT 模式（普通登录/沙箱模式禁止）")
    return SimpleNamespace(
        operator=request.headers.get("X-Operator-ID") or "admin",
        tenant=_deps["tenant_of"](request),
    )


def _conn(request: Request):
    return _deps["open_conn"](request)


def _scalar(conn, sql: str, args=()) -> int | float:
    v = conn.execute(sql, args).fetchone()[0]
    return 0 if v is None else v


@router.get("/context", dependencies=[Depends(require_ops)])
def ops_context(request: Request):
    """进入上下文：租户/操作者/模式/版本——前端顶栏展示与模式自证。"""
    op = require_ops(request)
    return {
        "mode": "PRODUCTION_SUPPORT",
        "tenant": op.tenant,
        "operator": op.operator,
        "software_version": _deps["software_version"],
        "server_time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.get("/overview", dependencies=[Depends(require_ops)])
def ops_overview(request: Request):
    """只读经营总览：组织/商品库存/会员/销售（今日+近7日）/扫描助手设备。"""
    require_ops(request)
    conn = _conn(request)
    try:
        today = time.strftime("%Y-%m-%d")
        week_ago = time.strftime("%Y-%m-%d", time.localtime(time.time() - 6 * 86400))
        online_threshold = time.time() - 60  # 与设备列表 WS 兜底口径一致：60 秒内有上报帧

        status_rows = conn.execute(
            "SELECT status, COUNT(*) n FROM products GROUP BY status"
        ).fetchall()
        product_status = {r["status"] or "未设置": r["n"] for r in status_rows}

        data = {
            "counts": {
                "stores": _scalar(conn, "SELECT COUNT(*) FROM stores"),
                "users": _scalar(conn, "SELECT COUNT(*) FROM users"),
                "customers": _scalar(conn, "SELECT COUNT(*) FROM customers"),
                "products": _scalar(conn, "SELECT COUNT(*) FROM products"),
                "products_in_stock": product_status.get("在库", 0),
                "stock_cost": round(_scalar(
                    conn, "SELECT COALESCE(SUM(cost),0) FROM products WHERE status='在库'"), 2),
                "stock_price": round(_scalar(
                    conn, "SELECT COALESCE(SUM(price),0) FROM products WHERE status='在库'"), 2),
                "devices": _scalar(conn, "SELECT COUNT(*) FROM devices"),
                "devices_online": _scalar(
                    conn, "SELECT COUNT(*) FROM devices WHERE last_seen >= ?",
                    (online_threshold,)),
            },
            "product_status": product_status,
            "sales_today": {
                "bills": _scalar(conn,
                    "SELECT COUNT(*) FROM sales WHERE biz_date=? AND status='已完成'", (today,)),
                "paid": round(_scalar(conn,
                    "SELECT COALESCE(SUM(paid),0) FROM sales WHERE biz_date=? AND status='已完成'",
                    (today,)), 2),
            },
            "sales_7d": {
                "bills": _scalar(conn,
                    "SELECT COUNT(*) FROM sales WHERE biz_date>=? AND status='已完成'",
                    (week_ago,)),
                "paid": round(_scalar(conn,
                    "SELECT COALESCE(SUM(paid),0) FROM sales WHERE biz_date>=? AND status='已完成'",
                    (week_ago,)), 2),
            },
            "scan_app": _deps["scan_info"](),
        }
        return data
    finally:
        conn.close()


@router.get("/devices", dependencies=[Depends(require_ops)])
def ops_devices(request: Request):
    """扫描助手设备清单：在线状态只信 last_seen 上报帧（服务端不自行刷新）。"""
    require_ops(request)
    conn = _conn(request)
    try:
        rows = conn.execute(
            """SELECT d.id, d.code, d.name, d.status, d.bound_store_id, d.last_seen,
                      d.app_version, d.apk_md5, d.current_task_id, s.name AS store_name
               FROM devices d LEFT JOIN stores s ON s.id = d.bound_store_id
               ORDER BY d.id"""
        ).fetchall()
        now = time.time()
        items = []
        for r in rows:
            last_seen = r["last_seen"] or 0
            items.append({
                "id": r["id"],
                "code": r["code"],
                "name": r["name"],
                "status": r["status"],
                "store_name": r["store_name"] or ("未绑定" if not r["bound_store_id"] else f"#{r['bound_store_id']}"),
                "last_seen": last_seen,
                "online": bool(last_seen and now - last_seen <= 60),
                "app_version": r["app_version"] or "",
                "apk_md5": r["apk_md5"] or "",
                "busy": bool(r["current_task_id"]),
            })
        info = _deps["scan_info"]()
        return {"items": items, "server_md5": info.get("md5", ""), "force": info.get("force", False)}
    finally:
        conn.close()


# ---------------------------------------------------------------- 助手发布（扫描助手 APK / 打印助手 EXE）
# 产物直接存插件包内 downloads/：与下载接口同址取件，运维端上传即就地覆盖，发布后对全租户立即生效。
# 注意：本目录随插件版本走，插件升级/重装后需由运维端重新上传（插件包默认不再预置助手产物）。

MAX_AGENT_BYTES = 30 * 1024 * 1024  # 30MB

AGENTS = {
    "scan": {"filename": "scan-assistant-release.apk", "ext": ".apk", "label": "扫描助手 APK"},
    "print": {"filename": "PrintBridge.exe", "ext": ".exe", "label": "打印助手 EXE"},
}

_manifest_lock = threading.Lock()


def pub_dir() -> Path:
    """运维端发布的助手产物目录 = 插件包内 downloads/（下载接口同址取件，main.py 也引用）。"""
    d = ROOT / "downloads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_manifest() -> list:
    try:
        return json.loads((pub_dir() / "manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except Exception:
        logger.exception("发布历史 manifest.json 读取失败，按空处理")
        return []


def _append_manifest(entry: dict) -> None:
    with _manifest_lock:
        items = _read_manifest()
        items.append(entry)
        tmp = pub_dir() / f".manifest.{uuid.uuid4().hex}.tmp"
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, pub_dir() / "manifest.json")


def _file_md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


@router.get("/agents", dependencies=[Depends(require_ops)])
def ops_agents(request: Request):
    """两个助手的当前发布状态 + 发布历史（manifest.json）。"""
    require_ops(request)
    d = pub_dir()
    scan_pub = d / AGENTS["scan"]["filename"]
    print_pub = d / AGENTS["print"]["filename"]

    def _pkg(path: Path, fallback_md5: str = "") -> dict:
        if not path.is_file():
            return {"published": False, "md5": fallback_md5, "size": 0, "time": ""}
        side = Path(str(path) + ".md5")
        md5 = side.read_text(encoding="utf-8", errors="ignore").split()[0].lower() \
            if side.is_file() and side.read_text(encoding="utf-8", errors="ignore").split() \
            else _file_md5(path)
        return {"published": True, "md5": md5, "size": path.stat().st_size,
                "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(path.stat().st_mtime))}

    scan_info = _deps["scan_info"]()  # 兜底指纹（发布目录缺失时为包内 downloads/ 的）
    force = scan_info.get("force", False)
    return {
        "scan": {**_pkg(scan_pub, scan_info.get("md5", "")), "force": force},
        "print": _pkg(print_pub),
        "history": list(reversed(_read_manifest()))[:100],
    }


@router.post("/agents/publish", dependencies=[Depends(require_ops)])
async def ops_agents_publish(request: Request, kind: str = Form(...), note: str = Form(""),
                             file: UploadFile = File(...)):
    """上传发布助手产物：校验类型/大小 → 算 MD5 → 临时文件原子替换 → 写 .md5 sidecar → 记发布历史 → 强制审计。"""
    op = require_ops(request)
    meta = AGENTS.get(kind)
    if not meta:
        raise HTTPException(400, f"未知助手类型 kind={kind}（可选 scan/print）")
    name = file.filename or ""
    if not name.lower().endswith(meta["ext"]):
        raise HTTPException(400, f"{meta['label']} 仅接受 {meta['ext']} 文件，收到：{name or '(空)'}")
    data = await file.read(MAX_AGENT_BYTES + 1)
    if len(data) > MAX_AGENT_BYTES:
        raise HTTPException(400, f"文件超过 30MB 上限（{len(data) / 1048576:.1f}MB）")
    if not data:
        raise HTTPException(400, "文件内容为空")

    md5 = hashlib.md5(data).hexdigest()
    d = pub_dir()
    target = d / meta["filename"]
    tmp = d / f".{meta['filename']}.{uuid.uuid4().hex}.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, target)  # 原子替换：下载链路不会读到半截文件
    (Path(str(target) + ".md5")).write_text(md5, encoding="utf-8")
    entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, "label": meta["label"],
             "filename": meta["filename"], "size": len(data), "md5": md5,
             "operator": op.operator, "note": note.strip()}
    _append_manifest(entry)

    conn = _conn(request)
    try:
        _deps["log_fn"](conn, op.operator, "运维端·发布助手",
                        f"{meta['label']} md5={md5[:8]} {len(data) // 1024}KB"
                        + (f" 备注：{entry['note']}" if entry["note"] else ""), "成功")
    finally:
        conn.close()
    return {"ok": True, **{k: entry[k] for k in ("kind", "md5", "size", "time", "operator")}}


class ForceIn(BaseModel):
    enabled: bool


@router.post("/agents/scan/force", dependencies=[Depends(require_ops)])
def ops_agents_force(request: Request, body: ForceIn):
    """扫描助手强制升级开关：写/删 <apk>.force sidecar（现网 App 已按该标记强更）。"""
    op = require_ops(request)
    fmark = pub_dir() / (AGENTS["scan"]["filename"] + ".force")
    if body.enabled:
        fmark.write_text("1", encoding="utf-8")
    else:
        fmark.unlink(missing_ok=True)
    conn = _conn(request)
    try:
        _deps["log_fn"](conn, op.operator, "运维端·强制升级",
                        f"扫描助手强更开关 → {'开启' if body.enabled else '关闭'}", "成功")
    finally:
        conn.close()
    return {"ok": True, "force": body.enabled}


# ---------------------------------------------------------------- 审计查询（只读）

@router.get("/audit", dependencies=[Depends(require_ops)])
def ops_audit(request: Request, limit: int = Query(100, ge=1, le=500),
              offset: int = Query(0, ge=0)):
    """本租户 operate_logs 查询（含运维端自身写操作的留痕）。"""
    require_ops(request)
    conn = _conn(request)
    try:
        total = _scalar(conn, "SELECT COUNT(*) FROM operate_logs")
        rows = conn.execute(
            "SELECT id,time,operator,store,action,target,result FROM operate_logs "
            "ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset),
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}
    finally:
        conn.close()


# ---------------------------------------------------------------- 人脸确认（高危写操作前的本人在场校验）
#
# 定位：不是身份认证（替代不了平台账号/穿透票据），只在强制终止/重置密码前做一次
# 「本人在场」生物确认。浏览器端 face-api.js 提取 128 维特征 → 服务端纯 Python
# 欧氏距离比对（模板永不下发浏览器）；无摄像头/非 HTTPS 时可用应急口令兜底。
# 模板存 STORAGE_DIR/face/（插件级共享存储，跨版本、跨租户持久），不入任何静态目录。

DESCRIPTOR_LEN = 128
FACE_DISTANCE_MAX = 0.5          # face-api 官方严格档（0.5 严格 / 0.6 宽松），高危操作取严
MAX_FACE_TEMPLATES = 20
_PBKDF2_ITERS = 200_000
_face_lock = threading.Lock()


def face_dir() -> Path:
    base = os.environ.get("STORAGE_DIR")
    d = (Path(base) / "face") if base else (ROOT / "dev_storage" / "face")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_templates() -> list:
    try:
        data = json.loads((face_dir() / "templates.json").read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        logger.exception("人脸模板 templates.json 读取失败，按空处理")
        return []


def _write_templates(items: list) -> None:
    tmp = face_dir() / f".templates.{uuid.uuid4().hex}.tmp"
    tmp.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, face_dir() / "templates.json")


def _valid_descriptor(v) -> list[float] | None:
    if not isinstance(v, list) or len(v) != DESCRIPTOR_LEN:
        return None
    out = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            return None
        xf = float(x)
        if not math.isfinite(xf) or abs(xf) > 100:
            return None
        out.append(xf)
    return out


def _euclid(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def face_enabled() -> bool:
    return len(_read_templates()) > 0


def guard_verify(body) -> dict:
    """高危写操作前置校验。模板为空=功能未启用，返回 {'method':'none'} 放行；
    否则必须人脸比对通过或应急口令正确，返回验证方式供写操作审计；不通过一律 403。"""
    templates = _read_templates()
    if not templates:
        return {"method": "none", "name": ""}
    emergency = (getattr(body, "emergency", None) or "").strip()
    face = _valid_descriptor(getattr(body, "face", None))
    if not emergency and face is None:
        raise HTTPException(403, "该操作需要人脸确认（或应急口令），请在弹窗中完成验证")
    if emergency:
        if not _check_emergency(emergency):
            raise HTTPException(403, "应急口令不正确")
        return {"method": "emergency", "name": ""}
    best = min(templates, key=lambda t: _euclid(face, t["descriptor"]))
    dist = _euclid(face, best["descriptor"])
    if dist > FACE_DISTANCE_MAX:
        raise HTTPException(403, f"人脸不匹配（距离 {dist:.2f} > {FACE_DISTANCE_MAX}），请正对镜头重试或使用应急口令")
    return {"method": "face", "name": best["name"], "distance": round(dist, 3)}


def _check_emergency(password: str) -> bool:
    p = face_dir() / "emergency.key"
    if not p.is_file():
        return False
    try:
        _, iters, salt_hex, hash_hex = p.read_text(encoding="utf-8").strip().split("$")
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(h.hex(), hash_hex)
    except Exception:
        logger.exception("应急口令校验异常")
        return False


class EnrollIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    descriptor: list


class EmergencyIn(BaseModel):
    password: str = Field(min_length=8, max_length=64)


class FaceGuardIn(BaseModel):
    """受控写操作的人脸/应急口令载体（二选一；功能未启用时均可空）。"""
    face: list[float] | None = None
    emergency: str | None = None


@router.get("/face/status", dependencies=[Depends(require_ops)])
def ops_face_status(request: Request):
    """人脸功能开关状态：前端决定写操作走 confirm 还是人脸弹窗。"""
    require_ops(request)
    return {"enabled": face_enabled(), "count": len(_read_templates()),
            "has_emergency": (face_dir() / "emergency.key").is_file(),
            "distance_max": FACE_DISTANCE_MAX}


@router.get("/face/templates", dependencies=[Depends(require_ops)])
def ops_face_templates(request: Request):
    """已录入模板列表（永不返回 descriptor 特征向量）。"""
    require_ops(request)
    return {"items": [{"id": t["id"], "name": t["name"], "enrolled_at": t["enrolled_at"],
                       "enrolled_by": t.get("enrolled_by", "")} for t in _read_templates()]}


@router.post("/face/enroll", dependencies=[Depends(require_ops)])
def ops_face_enroll(request: Request, body: EnrollIn):
    """录入人脸模板：姓名+128 维特征；重名拒绝；模板数 ≤20。"""
    op = require_ops(request)
    desc = _valid_descriptor(body.descriptor)
    if desc is None:
        raise HTTPException(400, f"人脸特征格式错误（须为 {DESCRIPTOR_LEN} 维数值向量）")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "姓名不能为空")
    with _face_lock:
        items = _read_templates()
        if any(t["name"] == name for t in items):
            raise HTTPException(400, f"已存在同名模板「{name}」，请先删除再重新录入")
        if len(items) >= MAX_FACE_TEMPLATES:
            raise HTTPException(400, f"模板数量已达上限 {MAX_FACE_TEMPLATES}")
        tid = uuid.uuid4().hex[:12]
        items.append({"id": tid, "name": name, "descriptor": desc,
                      "enrolled_at": time.strftime("%Y-%m-%d %H:%M:%S"), "enrolled_by": op.operator})
        _write_templates(items)
    conn = _conn(request)
    try:
        _deps["log_fn"](conn, op.operator, "运维端·人脸模板录入", f"模板：{name}", "成功")
    finally:
        conn.close()
    return {"ok": True, "id": tid, "name": name, "count": len(items)}


@router.delete("/face/templates/{tid}", dependencies=[Depends(require_ops)])
def ops_face_delete(request: Request, tid: str):
    """删除人脸模板（最后一个删除后功能自动回到未启用，该降级动作本身有审计）。"""
    op = require_ops(request)
    with _face_lock:
        items = _read_templates()
        target = next((t for t in items if t["id"] == tid), None)
        if not target:
            raise HTTPException(404, "模板不存在")
        items = [t for t in items if t["id"] != tid]
        _write_templates(items)
    conn = _conn(request)
    try:
        _deps["log_fn"](conn, op.operator, "运维端·人脸模板删除",
                        f"模板：{target['name']}" + ("（最后一个模板已删除，人脸确认自动停用）" if not items else ""),
                        "成功")
    finally:
        conn.close()
    return {"ok": True, "count": len(items)}


@router.post("/face/emergency", dependencies=[Depends(require_ops)])
def ops_face_emergency(request: Request, body: EmergencyIn):
    """设置/更新应急口令（摄像头或 HTTPS 不可用时的兜底通道；PBKDF2 存储，不可逆）。"""
    op = require_ops(request)
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", body.password.encode(), salt, _PBKDF2_ITERS)
    p = face_dir() / "emergency.key"
    tmp = face_dir() / f".emergency.{uuid.uuid4().hex}.tmp"
    tmp.write_text(f"pbkdf2_sha256${_PBKDF2_ITERS}${salt.hex()}${h.hex()}", encoding="utf-8")
    os.replace(tmp, p)
    conn = _conn(request)
    try:
        _deps["log_fn"](conn, op.operator, "运维端·应急口令设置", "人脸确认兜底口令已更新", "成功")
    finally:
        conn.close()
    return {"ok": True}
