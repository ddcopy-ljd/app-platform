"""懿臻珠宝云 · 插件后端（可独立运行）。

独立启动：在本目录执行  python main.py
默认 http://127.0.0.1:8002  演示账号 admin / admin123456
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import io
import random
import re
import secrets
import socket
import sqlite3
import threading
import time
import urllib.parse
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, Body, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
import uvicorn

import db
import rfid_print
import sensors

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("jewelry")

ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"
LOGO_DIR = ROOT / "logo"

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8002"))
# 平台启动时注入 TENANT_DB_DIR；独立运行时该变量为空 → 进入 STANDALONE 模式
MODE = "STANDALONE" if not os.environ.get("TENANT_DB_DIR") else "PLATFORM"

# ---- 软件名称等元数据：统一从 plugin.json 读取，改名只改这一处 ----
def _load_plugin_meta() -> dict:
    try:
        return json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
    except Exception:
        return {}

PLUGIN_META = _load_plugin_meta()
SOFT_NAME = PLUGIN_META.get("name", "懿臻珠宝云")
SOFT_VERSION = PLUGIN_META.get("softwareVersion", "1.0.0")

FEATURES = [
    "products", "inventory", "sales", "deposits", "loans", "customers",
    "repairs", "purchases", "outsourcings", "rfid", "labels", "site", "logs",
]

app = FastAPI(title=SOFT_NAME, docs_url="/docs", redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=500)

_sessions: dict[str, dict] = {}
_lock = threading.Lock()

# ---------------------------------------------------------------- 高管(EXECUTIVE)只读闸门
# 高管可跨所有门店巡查、可任意切换；业务数据只读（任何门店都不能写）；
# 行政/系统类（账号/门店组织/企业资料/编码规则/品类/库位/安防配置）仅当当前工作门店为总店(HQ)时可写。
# 统一在中间件按路径前缀裁决，避免逐个端点散落判断；设备/公开链路无会话，不受此限。
_EXEC_ADMIN_PREFIXES = (
    "/api/admin/", "/api/shops", "/api/stores", "/api/profile", "/api/biz-config",
    "/api/categories", "/api/product-types", "/api/label-templates",
    "/api/clerk-types", "/api/locations", "/api/sensors",
)
_EXEC_PASS_PREFIXES = ("/api/auth/",)
_EXEC_READONLY_DETAIL = "高管账号为只读账号，仅可查看，不能进行该操作"
_EXEC_NONHQ_DETAIL = "总部/系统设置仅可在总店修改，请先切换到总店"


def _hq_store_id(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT id FROM stores WHERE UPPER(IFNULL(code,''))='HQ' ORDER BY id LIMIT 1").fetchone()
    return int(row["id"]) if row else 0


# ---- 列级权限：成本查看（店长/高管强制可见；店员等按 users.can_view_cost 逐账号授予）----
_COST_FORCE_VISIBLE_ROLES = ("TENANT_ADMIN", "EXECUTIVE")


def _can_view_cost(conn: sqlite3.Connection, sess: dict) -> bool:
    """以库中开关为唯一准绳（会话快照仅兜底），使权限收回在下个请求即生效。"""
    if sess.get("role") in _COST_FORCE_VISIBLE_ROLES:
        return True
    row = conn.execute(
        "SELECT IFNULL(can_view_cost,0) v FROM users WHERE username=?",
        (sess.get("username") or "",),
    ).fetchone()
    return bool(row and row["v"])


def _hide_cost(rows, allow: bool):
    """无成本权限时把 dict 或 dict 列表里的 cost 抹为 None（前端统一渲染 ***）。"""
    if allow:
        return rows
    if isinstance(rows, dict):
        if "cost" in rows:
            rows["cost"] = None
    elif isinstance(rows, list):
        for r in rows:
            if isinstance(r, dict) and "cost" in r:
                r["cost"] = None
    return rows


@app.middleware("http")
async def executive_write_guard(request: Request, call_next):
    method = request.method.upper()
    path = request.url.path
    if method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api/"):
        return await call_next(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    with _lock:
        sess = _sessions.get(token)
    # 无会话（未登录/设备密钥/平台网关注入身份）交给各端点自身鉴权，不在此拦截
    if not sess or sess.get("role") != "EXECUTIVE":
        return await call_next(request)
    if path.startswith(_EXEC_PASS_PREFIXES):
        return await call_next(request)
    if path.startswith(_EXEC_ADMIN_PREFIXES):
        # 行政类：仅当前工作门店为总店时放行
        cur = int(sess.get("store_id") or 0)

        def _is_hq() -> bool:
            with _open(request) as conn:
                return cur == _hq_store_id(conn) and cur != 0

        if await run_in_threadpool(_is_hq):
            return await call_next(request)
        return JSONResponse(status_code=403, content={"detail": _EXEC_NONHQ_DETAIL})
    # 其余业务写一律拒绝
    return JSONResponse(status_code=403, content={"detail": _EXEC_READONLY_DETAIL})


def _safe_relative(f: Path, base: Path) -> bool:
    try:
        return f.is_relative_to(base)
    except AttributeError:
        pass
    try:
        f.relative_to(base)
        return True
    except ValueError:
        return False


def _tenant_of(request: Request) -> str:
    return request.headers.get("X-Resolved-Tenant-ID") or os.environ.get("TENANT_ID") or "tenant_trial"


def _bypass(request: Request) -> bool:
    return request.headers.get("X-System-Bypass-Auth") == "true"


def _operator_mode(request: Request) -> str:
    return (request.headers.get("X-Operator-Mode") or "NORMAL").upper()


def _header_operator(request: Request) -> str:
    return request.headers.get("X-Operator-ID") or "admin"


def _open(request: Request) -> sqlite3.Connection:
    tenant = _tenant_of(request)
    if MODE == "STANDALONE" or not os.environ.get("TENANT_DB_DIR"):
        base = os.environ.get("TENANT_DB_DIR") or str(ROOT / "dev_data")
        os.environ["TENANT_DB_DIR"] = base
        db.DB_DIR = Path(base)
        path = Path(base) / f"db_jewelry_{tenant}_v1.0.0.sqlite"
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=3000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        db.migrate_schema(conn)
        if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            db.seed_demo(conn)
        db.ensure_new_seeds(conn)
        return conn
    conn = db.connect(tenant)
    db.ensure_new_seeds(conn)
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
        return {"username": _header_operator(request), "display_name": _header_operator(request), "role": "TENANT_ADMIN"}
    raw = request.headers.get("Authorization", "")
    token = raw.replace("Bearer ", "").strip()
    with _lock:
        sess = _sessions.get(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    # 手持机扫码会话仅当天有效，隔日自动作废
    valid_day = sess.get("valid_day")
    if valid_day and valid_day != date.today().isoformat():
        with _lock:
            _sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="登录已过期（手持机会话当天有效），请重新扫码登录")
    return sess


# ---------------------------------------------------------------- 门店授权与当前工作门店

def _accessible_store_rows(conn: sqlite3.Connection, sess: dict) -> list[sqlite3.Row]:
    """当前会话可访问的门店：店长/高管=全部门店（高管可跨店巡查）；店员=user_stores 授权门店。"""
    if sess.get("role") in ("TENANT_ADMIN", "EXECUTIVE"):
        return conn.execute("SELECT * FROM stores ORDER BY id").fetchall()
    return conn.execute(
        """SELECT s.* FROM stores s
           JOIN user_stores us ON us.store_id = s.id
           JOIN users u ON u.id = us.user_id
           WHERE u.username=? ORDER BY s.id""",
        (sess.get("username"),),
    ).fetchall()


def _store_payload(rows: list[sqlite3.Row]) -> list[dict]:
    return [{"id": r["id"], "name": r["name"], "code": r["code"], "shop_id": r["shop_id"]} for r in rows]


def _current_store(request: Request, conn: sqlite3.Connection, sess: dict | None = None) -> tuple[int, list[sqlite3.Row]]:
    """解析当前工作门店，返回 (store_id, 授权门店行)。
    - 无任何授权门店 → 403（业务接口统一拦截，前端引导联系店长授权）；
    - 会话记住的门店失效（被收权/删除）→ 自动落到第一家并回写会话；
    - 平台网关注入身份（bypass 无会话态）支持 X-Store-Id 头显式指定。"""
    if sess is None:
        sess = _require_auth(request)
    rows = _accessible_store_rows(conn, sess)
    if not rows:
        raise HTTPException(status_code=403,
                            detail="你尚未被授权访问任何门店，请联系店长在「系统管理 · 用户与门店权限」中分配")
    ids = [r["id"] for r in rows]
    cur = int(sess.get("store_id") or 0)
    if cur not in ids:
        hdr = (request.headers.get("X-Store-Id") or "").strip()
        cur = int(hdr) if hdr.isdigit() and int(hdr) in ids else ids[0]
        sess["store_id"] = cur
    return cur, rows


def _log(conn: sqlite3.Connection, operator: str, action: str, target: str, result: str = "成功") -> None:
    try:
        conn.execute(
            "INSERT INTO operate_logs(operator,store,action,target,result) VALUES(?,?,?,?,?)",
            (operator, "总店", action, target, result),
        )
        conn.commit()
    except Exception:
        logger.exception("写操作日志失败")


def _inv(conn: sqlite3.Connection, product_id: int | None, epc: str, typ: str, operator: str,
         qty: int = 1, store_id: int = 0) -> None:
    conn.execute(
        "INSERT INTO inventory_logs(product_id,epc,type,qty,operator,store_id) VALUES(?,?,?,?,?,?)",
        (product_id, epc or "", typ, qty, operator, store_id),
    )


def _touch_customer(conn: sqlite3.Connection, name: str, phone: str, amount: float, due: float) -> int:
    """销售成交后回写客户：存在则累加累计消费/欠款，不存在则建档（散客）。返回 customer_id（无则 0）。"""
    if not phone and not name:
        return 0
    cust = None
    if phone:
        cust = conn.execute("SELECT * FROM customers WHERE phone=?", (phone,)).fetchone()
    if cust:
        conn.execute(
            "UPDATE customers SET total_amount=total_amount+?, due_amount=due_amount+?, name=COALESCE(NULLIF(?,''),name) WHERE id=?",
            (amount, due, name, cust["id"]),
        )
        return cust["id"]
    cur = conn.execute(
        "INSERT INTO customers(name,phone,level,total_amount,due_amount) VALUES(?,?,?,?,?)",
        (name or "散客", phone or "", "普通", amount, max(due, 0)),
    )
    return cur.lastrowid


def _next_code(conn: sqlite3.Connection, prefix: str = "J") -> str:
    row = conn.execute("SELECT MAX(id) m FROM products").fetchone()
    return f"{prefix}{(row['m'] or 0) + 1:03d}"


def _next_bill_no(conn: sqlite3.Connection) -> str:
    d = date.today().strftime("%Y%m%d")
    row = conn.execute("SELECT MAX(id) m FROM sales").fetchone()
    seq = (row["m"] or 0) + 1
    return f"XS{d}{seq:03d}"


def _gen_epc(code: str) -> str:
    raw = secrets.token_hex(8).upper()
    return f"E280{raw}{code[-4:].upper().ljust(4, '0')}"[:28]


# 业界标准英文简写材质（受控词表，库内直接存简写）：
# Au 金 / Pt 铂 / Ag 银 / DIA 钻石 / JAD 翡翠 / CGS 彩宝 / PRL 珍珠 / OTH 其他
MATERIAL_CODES = ["AU", "PT", "AG", "DIA", "JAD", "CGS", "PRL", "OTH"]
# 早期英文长码 → 简写（兼容历史入库/接口传入）
_MAT_FULL_TO_SHORT = {
    "GOLD": "AU", "PLATINUM": "PT", "SILVER": "AG", "DIAMOND": "DIA",
    "JADEITE": "JAD", "COLORED_GEMSTONE": "CGS", "PEARL": "PRL", "OTHER": "OTH",
}


def _norm_material(v: str) -> str:
    v = (v or "").strip().upper()
    return _MAT_FULL_TO_SHORT.get(v, v)


def _epc_cfg(conn: sqlite3.Connection) -> tuple[str, int]:
    cfg = conn.execute("SELECT epc_prefix,seq_bits FROM biz_config WHERE id=1").fetchone()
    return (cfg[0], cfg[1]) if cfg else ("E280", 6)


def _pinyin_initials(name: str, n: int = 3) -> str:
    """企业名称 → 拼音首字母前 n 位（中文取拼音首字母，英文/数字原样保留，大写）。
    例：懿臻珠宝 → YZZ。"""
    name = (name or "").strip()
    if not name:
        return ""
    try:
        from pypinyin import Style, lazy_pinyin
        pys = lazy_pinyin(name, style=Style.FIRST_LETTER, errors=lambda items: list(items))
    except Exception:
        pys = list(name)
    out: list[str] = []
    for py in pys:
        for ch in str(py).upper():
            if ch.isascii() and ch.isalnum():
                out.append(ch)
    return "".join(out)[:n]


def _store_seg(code: str, store_id: int = 0) -> str:
    """门店码归一化为定长 2 位字符段：本身恰为 2 位字母/数字则大写原样保留
    （如 HQ、A1、06）；否则（空/超长/中文等）回退为门店序号的 2 位 hex。
    注意：含非 hex 字母的段写入 RFID 芯片时由 chip_epc_hex 转 ASCII-hex。"""
    code = (code or "").strip().upper()
    if len(code) == 2 and all(c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in code):
        return code
    return f"{(store_id or 0) % 256:02X}"


def _compute_item_barcode(conn: sqlite3.Connection, product: dict) -> str:
    """印刷条码 = 门店码(2位字母/数字) + 品类码(2) + 序号(4-6)，每件唯一，与 EPC 解耦（EPC 不改）。

    序号为「同门店+同品类」下的全局递增序号（与 EPC 序号同思路、但独立计数）；
    补全时按货号排序赋值，使同货号多件获得连续序号（01/02/03…），既保证条码唯一可扫中单件，
    又体现“序号按货号聚集”。
    """
    sid = product.get("store_id") or 1
    sc = conn.execute("SELECT code FROM stores WHERE id=?", (sid,)).fetchone()
    store_seg = _store_seg(sc[0] if sc else "", sid)
    tc = (product.get("product_type_code") or "99") or "99"
    cat = tc.strip().upper()[:2].ljust(2, "0")
    _, seq_bits = _epc_cfg(conn)
    seq_bits = max(4, min(6, int(seq_bits or 6)))
    head = f"{store_seg}{cat}"
    maxseq = 0
    for (b,) in conn.execute("SELECT barcode FROM products WHERE barcode LIKE ?", (head + "%",)).fetchall():
        tail = (b or "")[len(head):]
        if len(tail) == seq_bits:
            try:
                maxseq = max(maxseq, int(tail, 16))
            except ValueError:
                continue
    seq = maxseq + 1
    if seq > 16 ** seq_bits - 1:  # 极端溢出兜底（几乎不会发生）
        seq = 1
    return f"{head}{seq:0{seq_bits}X}"


def _gen_type_epc(conn: sqlite3.Connection, type_code: str, store_id: int = 1) -> str:
    """EPC = 企业前缀(配置) + 门店码(2位字母/数字) + 品类码(2) + 序号(seq_bits,4-6)；各(门店+品类)独立计数。"""
    prefix, seq_bits = _epc_cfg(conn)
    seq_bits = max(4, min(6, int(seq_bits or 6)))  # 序号固定 4-6 位
    code = (type_code or "99").strip().upper() or "99"
    code = code[:2].ljust(2, "0")  # 品类码固定 2 位
    store_seg = "00"
    try:
        r = conn.execute("SELECT code FROM stores WHERE id=?", (store_id,)).fetchone()
        if r is not None:
            store_seg = _store_seg(r[0], store_id)
    except Exception:
        store_seg = "00"
    head = f"{prefix}{store_seg}{code}"
    maxseq = 0
    row = conn.execute(
        "SELECT rfid_epc FROM products WHERE rfid_epc LIKE ?", (head + "%",)
    ).fetchall()
    for (e,) in row:
        tail = (e or "")[len(head):]
        if len(tail) == seq_bits:
            try:
                maxseq = max(maxseq, int(tail, 16))
            except ValueError:
                continue
    seq = maxseq + 1
    if seq > 16 ** seq_bits - 1:
        raise HTTPException(400, "该品类 EPC 序号已用尽，请调大序号位数")
    return f"{head}{seq:0{seq_bits}X}"


# 列表/详情不回传图片 BLOB（图片走专用接口），用 image_ts 判断是否有图
_PRODUCT_COLS = (
    "products.id,products.code,products.name,products.name_i18n,products.category,products.category_code,"
    "products.material,products.product_type,products.product_type_code,"
    "products.weight,products.size,products.cert,products.cost,products.price,products.status,"
    "products.store_id,products.rfid_epc,products.barcode,"
    "products.showcase_public,products.showcase_order,products.showcase_desc,products.showcase_desc_i18n,"
    "products.origin,products.high_value,"
    "products.location_id,products.cert_location_id,"
    "(SELECT l.code||' '||l.name FROM locations l WHERE l.id=products.location_id) AS location_name,"
    "(SELECT l.code||' '||l.name FROM locations l WHERE l.id=products.cert_location_id) AS cert_location_name,"
    "products.image_ts,products.created,"
    "(SELECT MAX(ts) FROM inventory_logs il WHERE il.product_id=products.id AND il.type='rfid') AS label_printed_at,"
    "(SELECT COUNT(*) FROM inventory_logs il WHERE il.product_id=products.id AND il.type='rfid') AS label_print_count"
)


def _assert_locations_in_store(conn: sqlite3.Connection, store_id: int | None,
                               location_id: int, cert_location_id: int) -> None:
    """商品的存放/证书库位必须属于该商品所属门店（停用库位作为历史值保留，允许保存）。"""
    for lid in (location_id or 0, cert_location_id or 0):
        if not lid:
            continue
        r = conn.execute("SELECT store_id FROM locations WHERE id=?", (lid,)).fetchone()
        if not r:
            raise HTTPException(400, "所选库位不存在")
        if store_id and r["store_id"] != store_id:
            raise HTTPException(400, "存放位置必须属于商品所属门店")


def _resolve_type(conn: sqlite3.Connection, code: str, zh_name: str = "") -> tuple[str, str]:
    """按品类码补全中文名；码无效时归入 99 其他。"""
    code = (code or "").strip()
    r = conn.execute("SELECT names FROM product_types WHERE code=?", (code,)).fetchone() if code else None
    if r:
        try:
            return code, (json.loads(r[0] or "{}").get("zh") or zh_name or code)
        except Exception:
            return code, zh_name or code
    r = conn.execute("SELECT names FROM product_types WHERE code='99'").fetchone()
    zh = "其他"
    if r:
        try:
            zh = json.loads(r[0] or "{}").get("zh") or "其他"
        except Exception:
            pass
    return "99", zh


# ---------------------------------------------------------------- 前端 / 静态

@app.get("/api/health")
def health():
    return {"ok": True, "name": SOFT_NAME, "mode": MODE, "version": SOFT_VERSION}


@app.get("/")
def spa_index():
    f = FRONTEND_DIR / "index.html"
    if f.exists():
        return FileResponse(str(f), headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "前端未构建"}, status_code=503)


@app.get("/site")
def public_site(request: Request):
    with _db(request) as conn:
        prof = conn.execute("SELECT * FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        rows = conn.execute(
            """SELECT id, code, name, product_type, material, weight, size, price, cert, status,
                      origin, showcase_order, showcase_desc, image_ts
                 FROM products
                WHERE showcase_public=1 AND status='在库'
                ORDER BY (showcase_order=0) ASC, showcase_order ASC, id DESC
                LIMIT 10"""
        ).fetchall()
    name = (prof["name"] if prof else "懿臻珠宝") or "懿臻珠宝"
    slogan = (prof["slogan"] if prof else "") or ""
    intro = (prof["intro"] if prof else "") or ""
    addr = (prof["address"] if prof else "") or ""
    phone = (prof["phone"] if prof else "") or ""
    hours = (prof["hours"] if prof else "") or ""
    sh_title = (prof["showcase_title"] if prof else "新品橱窗") or "新品橱窗"
    sh_sub = (prof["showcase_subtitle"] if prof else "本周臻品 · 限量发售") or "本周臻品 · 限量发售"

    items_html: list[str] = []
    for r in rows:
        desc = (r["showcase_desc"] or "").strip()
        if not desc:
            parts = []
            if r["origin"]: parts.append(f"产地：{r['origin']}")
            if r["material"]: parts.append(f"材质：{r['material']}")
            if r["weight"] and float(r["weight"]) > 0: parts.append(f"金重：{float(r['weight']):.2f}g")
            if r["size"]: parts.append(f"尺寸：{r['size']}")
            if r["price"]: parts.append(f"参考价：¥{float(r['price']):,.0f}")
            desc = "｜".join(parts)
        cat = r["product_type"] or "珠宝"
        tags_html = f"<span class='tag-cat'>{cat}</span>"
        if r["cert"]:
            tags_html += f"<span class='tag-cert'>附权威证书</span>"
        price_text = f"¥{float(r['price']):,.0f}" if r["price"] and float(r["price"]) > 0 else "<i>到店咨询</i>"
        # 货号行：便于客户到店时报货号描述商品
        code_html = f"<p class='sc-code'>货号 <b>{r['code']}</b></p>" if r["code"] else ""
        if r["image_ts"]:
            cover_html = f"<img class='sc-img' src='/api/products/{r['id']}/image' alt='{r['name']}' loading='lazy'>"
        else:
            # 首字母占位的视觉 LOGO
            avatar_ch = (r["name"] or "臻")[:1]
            cover_html = f"<div class='sc-avatar'>{avatar_ch}</div>"
        items_html.append(
            f"""<article class='sc-card'>
  <div class='sc-cover'>
    {cover_html}
    <div class='sc-badges'>{tags_html}</div>
  </div>
  <div class='sc-body'>
    <h3>{r['name']}</h3>
    {code_html}
    <p class='sc-desc'>{desc}</p>
    <div class='sc-foot'>
      <span class='sc-price'>{price_text}</span>
      <button class='sc-book' onclick=\"focusBook('{r['name']}','{cat}','{r['code'] or ''}')\">预约看货</button>
    </div>
  </div>
</article>"""
        )
    cards_html = "\n".join(items_html) or (
        "<div class='sc-empty'><div class='sc-empty-ico'>💎</div>"
        "<p>橱窗正在整理中</p><span>敬请期待本季臻品</span></div>"
    )
    # 企业宣传 · 四大安心承诺
    promises = [
        ("🔍", "源头直采", "金料与裸石直选自深圳水贝、云南腾冲，省去中间环节，同品质价格更实在。"),
        ("📜", "一物一证", "每件成品均配 NGTC / GIA 权威证书，支持全国任意机构复检，假一赔十。"),
        ("🔨", "自有工坊", "驻店师傅平均从业 20 年，改圈、刻字、维修立等可取，高级定制最快 7 日交付。"),
        ("♾️", "终身养护", "所购首饰终身享免费清洗、抛光与牢固度检测，以旧换新按当日金价估价。"),
    ]
    promise_cards_html = "\n".join(
        f"<div class='p-card'><div class='p-ico'>{ico}</div><h3>{pt}</h3><p>{pd}</p></div>"
        for ico, pt, pd in promises
    )
    # 小图标
    icon_phone = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'/></svg>"
    icon_loc = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>"
    icon_clock = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>"

    html = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} · 官方臻选</title>
<style>
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif; background:#FBF6EC; color:#3D2B1F; line-height:1.6; }}
.hero {{
  position: relative; overflow: hidden;
  background: linear-gradient(150deg, #3D1522 0%, #5C2233 45%, #6E2A3F 100%);
  color: #F7EFE0; padding: 72px 24px 56px; text-align: center;
}}
.hero::before {{
  content: ''; position: absolute; top: -80px; right: -80px; width: 260px; height: 260px;
  background: radial-gradient(circle, rgba(201,169,97,.35) 0%, transparent 70%); border-radius: 50%;
}}
.hero::after {{
  content: ''; position: absolute; bottom: -120px; left: -60px; width: 220px; height: 220px;
  background: radial-gradient(circle, rgba(201,169,97,.22) 0%, transparent 70%); border-radius: 50%;
}}
.hero > * {{ position: relative; z-index: 1; }}
.brand-logo {{
  width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 50%;
  background: linear-gradient(135deg, #F5E7B8, #E8D5A0 30%, #C9A961 60%, #9C7B3A);
  display: flex; align-items: center; justify-content: center; font-size: 30px; color: #5C2233;
  font-weight: 700; box-shadow: 0 8px 28px rgba(201,169,97,.45), inset 0 1px 1px rgba(255,255,255,.6);
  padding: 10px;
}}
.brand-logo img {{ width: 100%; height: 100%; object-fit: contain; }}
.hero h1 {{ margin: 0 0 8px; font-size: 32px; letter-spacing: 2px; }}
.hero .slogan {{ color: #EED8A1; font-size: 18px; margin: 6px 0 16px; letter-spacing: 1px; }}
.hero .intro {{ max-width: 640px; margin: 0 auto; opacity: .88; font-size: 14px; }}
.hero .meta {{
  display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 22px;
  margin-top: 26px; font-size: 13px; opacity: .92;
}}
.hero .meta span {{ display: inline-flex; align-items: center; gap: 5px; }}
.wrap {{ max-width: 1160px; margin: 0 auto; padding: 48px 20px 64px; }}
.section-title {{
  display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 10px;
}}
.section-title h2 {{
  margin: 0; font-size: 26px; color: #4A1B2A; letter-spacing: 1px; position: relative; padding-left: 14px;
}}
.section-title h2::before {{
  content:''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px; border-radius: 2px;
  background: linear-gradient(180deg, #C9A961, #8C6A1E);
}}
.section-title .sub {{ color: #8A6F58; font-size: 13px; padding-bottom: 4px; }}
.sc-grid {{
  display: grid; gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}}
.sc-card {{
  background: #fff; border-radius: 18px; overflow: hidden;
  box-shadow: 0 2px 10px rgba(92,34,51,.06), 0 8px 26px rgba(92,34,51,.05);
  border: 1px solid rgba(201,169,97,.22);
  transition: transform .25s ease, box-shadow .25s ease;
}}
.sc-card:hover {{ transform: translateY(-4px); box-shadow: 0 8px 20px rgba(92,34,51,.10), 0 18px 46px rgba(201,169,97,.18); }}
.sc-cover {{
  position: relative; height: 190px;
  background:
    linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.02)),
    linear-gradient(155deg, #8C2B46 0%, #5C2233 55%, #3D1522 100%);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}}
.sc-cover::after {{
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(120% 80% at 20% 10%, rgba(245,231,184,.35) 0%, transparent 50%),
              radial-gradient(80% 60% at 100% 100%, rgba(201,169,97,.28) 0%, transparent 55%);
  pointer-events: none;
}}
.sc-avatar {{
  width: 110px; height: 110px; border-radius: 50%;
  background: linear-gradient(135deg, #F5E7B8 0%, #C9A961 55%, #9C7B3A 100%);
  color: #4A1B2A; display: flex; align-items: center; justify-content: center;
  font-size: 46px; font-weight: 700; letter-spacing: 1px;
  box-shadow: 0 6px 20px rgba(0,0,0,.22), inset 0 2px 4px rgba(255,255,255,.6);
  position: relative; z-index: 1;
  font-family: "PingFang SC","Microsoft YaHei",serif;
}}
.sc-img {{
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; z-index: 1;
}}
.sc-badges {{
  position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 6px; flex-wrap: wrap; z-index: 2;
}}
.tag-cat, .tag-cert {{
  font-size: 11px; padding: 3px 9px; border-radius: 20px; backdrop-filter: blur(4px);
  background: rgba(255,255,255,.18); color: #F5E7B8; border: 1px solid rgba(245,231,184,.35);
}}
.tag-cert {{ background: rgba(201,169,97,.85); color: #3D2B1F; border-color: rgba(255,255,255,.3); }}
.sc-body {{ padding: 18px 18px 20px; }}
.sc-body h3 {{ margin: 0 0 8px; font-size: 17px; color: #3D2B1F; }}
.sc-code {{
  margin: 0 0 10px; display: inline-block; font-size: 12px; color: #6E5426;
  background: rgba(201,169,97,.14); border: 1px solid rgba(201,169,97,.4);
  border-radius: 6px; padding: 2px 9px; letter-spacing: .3px;
}}
.sc-code b {{ font-family: Consolas, Menlo, 'Courier New', monospace; font-weight: 700; letter-spacing: 1px; }}
.sc-desc {{
  margin: 0 0 16px; font-size: 12.5px; line-height: 1.7; color: #6A5546; min-height: 44px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}}
.sc-foot {{ display: flex; align-items: center; justify-content: space-between; gap: 10px; }}
.sc-price {{
  font-size: 20px; font-weight: 700; color: #5C2233; font-family: Georgia, 'Times New Roman', serif; letter-spacing: .5px;
}}
.sc-price i {{ color: #8A6F58; font-style: normal; font-weight: 500; font-size: 14px; font-family: inherit; }}
.sc-book {{
  border: none; padding: 8px 14px; border-radius: 20px; cursor: pointer; font-size: 12.5px;
  background: linear-gradient(135deg, #5C2233, #8C2B46); color: #F7EFE0;
  box-shadow: 0 2px 10px rgba(92,34,51,.25); transition: transform .15s ease;
}}
.sc-book:hover {{ transform: scale(1.03); }}
.sc-book:active {{ transform: scale(.98); }}
.sc-empty {{
  grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: #fff; border-radius: 18px;
  border: 1px dashed rgba(201,169,97,.5); color: #8A6F58;
}}
.sc-empty-ico {{ font-size: 42px; margin-bottom: 10px; opacity: .7; }}
.sc-empty p {{ margin: 0 0 4px; color: #4A1B2A; font-weight: 600; }}
.form-section {{ margin-top: 58px; }}
.form {{
  background: #fff; border-radius: 18px; padding: 28px;
  border: 1px solid rgba(201,169,97,.22);
  box-shadow: 0 2px 12px rgba(92,34,51,.04);
}}
.form-grid {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 18px;
}}
label {{ display: block; font-size: 12.5px; color: #6A5546; margin-bottom: 4px; }}
input, textarea {{
  width: 100%; padding: 10px 12px; border: 1px solid #E5D7BE; border-radius: 10px; box-sizing: border-box;
  font-family: inherit; font-size: 14px; background: #FEFBF5; color: #3D2B1F; outline: none; transition: border-color .15s;
}}
input:focus, textarea:focus {{ border-color: #C9A961; background: #fff; }}
textarea {{ resize: vertical; min-height: 72px; }}
.submit-row {{ margin-top: 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }}
.btn-submit {{
  border: none; padding: 12px 26px; border-radius: 28px; cursor: pointer; font-size: 14.5px; font-weight: 600;
  background: linear-gradient(135deg, #C9A961, #9C7B3A); color: #3D2B1F; letter-spacing: 1px;
  box-shadow: 0 4px 16px rgba(201,169,97,.35); transition: transform .15s ease, box-shadow .15s ease;
}}
.btn-submit:hover {{ transform: translateY(-1px); box-shadow: 0 6px 22px rgba(201,169,97,.45); }}
.msg-box {{ min-height: 22px; font-size: 13px; }}
.ok {{ color: #2E7D4F; font-weight: 600; }}
.err {{ color: #B33A3A; font-weight: 600; }}
.footer {{ text-align: center; color: #8A6F58; font-size: 12px; margin-top: 44px; padding-top: 18px; border-top: 1px dashed #E5D7BE; }}
.footer-certs {{ color: #12473D; font-weight: 600; font-size: 12.5px; letter-spacing: 1px; margin-bottom: 8px; }}
section[id] {{ scroll-margin-top: 64px; }}
/* ===== 吸顶锚点导航 ===== */
.site-nav {{
  position: sticky; top: 0; z-index: 50;
  background: rgba(251,246,236,.9); backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(21,72,61,.14);
}}
.site-nav-in {{ max-width: 1160px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }}
.site-nav-brand {{ font-weight: 700; color: #12473D; letter-spacing: 2px; font-size: 15px; }}
.site-nav-links a {{ color: #12473D; text-decoration: none; font-size: 13.5px; margin-left: 24px; opacity: .75; transition: opacity .15s; }}
.site-nav-links a:hover {{ opacity: 1; text-decoration: underline; text-underline-offset: 4px; }}
/* ===== 品牌故事（墨玉绿，与酒红金品牌头区分） ===== */
.about {{
  position: relative; overflow: hidden; color: #EAF4EE;
  background: linear-gradient(155deg, #0B322A 0%, #11473C 48%, #18584A 100%);
}}
.about::before {{
  content: ''; position: absolute; top: -120px; right: -90px; width: 340px; height: 340px; border-radius: 50%;
  background: radial-gradient(circle, rgba(94,196,151,.20) 0%, transparent 70%);
}}
.about::after {{
  content: 'SINCE 2009'; position: absolute; right: 16px; bottom: -20px; font-size: 84px; font-weight: 800;
  color: rgba(255,255,255,.045); letter-spacing: 6px; pointer-events: none; white-space: nowrap;
}}
.about-wrap {{
  position: relative; z-index: 1; max-width: 1160px; margin: 0 auto; padding: 66px 20px 8px;
  display: grid; grid-template-columns: 1.25fr .9fr; gap: 50px; align-items: center;
}}
.about-kicker {{
  display: inline-block; font-size: 12px; letter-spacing: 3px; color: #8FE0BC;
  border: 1px solid rgba(143,224,188,.4); border-radius: 20px; padding: 4px 14px; margin-bottom: 20px;
}}
.about-text h2 {{ margin: 0 0 20px; font-size: 28px; line-height: 1.5; color: #F3F9F6; letter-spacing: 1px; }}
.about-text p {{ margin: 0 0 14px; font-size: 14.5px; line-height: 2; color: rgba(234,244,238,.86); }}
.about-cats {{ margin-top: 22px; font-size: 13px; color: #8FE0BC; letter-spacing: 2px; }}
.about-stats {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
.stat {{
  background: rgba(255,255,255,.06); border: 1px solid rgba(143,224,188,.18);
  border-radius: 16px; padding: 26px 18px; text-align: center;
}}
.stat b {{ display: block; font-size: 30px; color: #8FE0BC; font-family: Georgia, 'Times New Roman', serif; margin-bottom: 6px; }}
.stat span {{ font-size: 12.5px; color: rgba(234,244,238,.78); }}
/* ===== 四大承诺（同墨绿章节，玻璃卡） ===== */
.promise-inner {{ max-width: 1160px; margin: 0 auto; padding: 56px 20px 64px; }}
.promise-head {{ text-align: center; margin-bottom: 34px; }}
.promise-head h2 {{ margin: 0 0 8px; font-size: 25px; color: #F3F9F6; letter-spacing: 2px; }}
.promise-head p {{ margin: 0; font-size: 13.5px; color: rgba(234,244,238,.66); }}
.promise-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }}
.p-card {{
  background: rgba(255,255,255,.05); border: 1px solid rgba(143,224,188,.16); border-radius: 18px;
  padding: 30px 22px; text-align: center;
  transition: transform .2s ease, background .2s ease, border-color .2s ease;
}}
.p-card:hover {{ transform: translateY(-5px); background: rgba(255,255,255,.09); border-color: rgba(143,224,188,.42); }}
.p-ico {{
  width: 58px; height: 58px; margin: 0 auto 16px; border-radius: 50%;
  background: rgba(143,224,188,.14); display: flex; align-items: center; justify-content: center; font-size: 26px;
}}
.p-card h3 {{ margin: 0 0 10px; font-size: 17px; color: #F3F9F6; }}
.p-card p {{ margin: 0; font-size: 12.5px; line-height: 1.85; color: rgba(234,244,238,.75); }}
@media (max-width: 900px) {{
  .about-wrap {{ grid-template-columns: 1fr; gap: 32px; padding: 48px 18px 0; }}
  .promise-grid {{ grid-template-columns: 1fr 1fr; }}
}}
@media (max-width: 640px) {{
  .hero {{ padding: 54px 16px 42px; }}
  .hero h1 {{ font-size: 24px; }}
  .wrap {{ padding: 32px 14px 48px; }}
  .section-title h2 {{ font-size: 20px; }}
  .sc-grid {{ gap: 16px; }}
  .form {{ padding: 20px; }}
  .site-nav-brand {{ display: none; }}
  .site-nav-in {{ justify-content: center; }}
  .site-nav-links a {{ margin: 0 10px; }}
  .about-text h2 {{ font-size: 22px; }}
  .about::after {{ font-size: 52px; bottom: -12px; }}
  .promise-grid {{ grid-template-columns: 1fr; }}
  .stat b {{ font-size: 24px; }}
}}
</style></head><body>
<section class="hero">
  <div class="brand-logo"><img src="/logo/logo.svg" alt="{name} logo" onerror="this.remove(); this.parentElement.innerHTML='臻';"></div>
  <h1>{name}</h1>
  <div class="slogan">{slogan}</div>
  <p class="intro">{intro}</p>
  <div class="meta">
    { (f'<span>{icon_loc}{addr}</span>' if addr else '') }
    { (f'<span>{icon_phone}{phone}</span>' if phone else '') }
    { (f'<span>{icon_clock}{hours}</span>' if hours else '') }
  </div>
</section>
<nav class="site-nav">
  <div class="site-nav-in">
    <span class="site-nav-brand">{name}</span>
    <span class="site-nav-links">
      <a href="#about">品牌故事</a><a href="#showcase">臻品橱窗</a><a href="#booking">预约到店</a>
    </span>
  </div>
</nav>
<section class="about" id="about">
  <div class="about-wrap">
    <div class="about-text">
      <span class="about-kicker">SINCE 2009 · 品牌故事</span>
      <h2>十七年只做一件事<br>让每件珠宝都经得起岁月</h2>
      <p>{name}创立于 2009 年，前身为老街上一间三十平米的打金铺。十七年来，我们坚持从深圳水贝、云南腾冲源头直选金料与裸石，每件成品均经 NGTC / GIA 权威检测，一物一证，支持全国复检。</p>
      <p>如今，懿臻已发展为集黄金、钻石、翡翠、彩宝销售与高级定制于一体的珠宝门店，驻店师傅平均从业 20 年以上。我们相信，好的珠宝从不只是商品——它陪人走过求婚、结婚、弥月、纪念等一生里最重要的时刻。</p>
      <div class="about-cats">黄金首饰 · 钻石婚戒 · 翡翠玉石 · 彩宝定制 · 投资金条</div>
    </div>
    <div class="about-stats">
      <div class="stat"><b>17年</b><span>匠心经营</span></div>
      <div class="stat"><b>10000+</b><span>客户的共同选择</span></div>
      <div class="stat"><b>100%</b><span>一物一证 · 支持复检</span></div>
      <div class="stat"><b>20年</b><span>驻店师傅平均工龄</span></div>
    </div>
  </div>
  <div class="promise-inner">
    <div class="promise-head">
      <h2>四大安心承诺</h2>
      <p>从选料到售后，每个环节都写进我们的店规</p>
    </div>
    <div class="promise-grid">{promise_cards_html}</div>
  </div>
</section>
<div class="wrap">
  <div class="section-title" id="showcase">
    <div><h2>{sh_title}</h2><span class="sub">{sh_sub}</span></div>
    <span class="sub">共 {len(rows)} 件臻品 · 官方直营 · 假一赔十</span>
  </div>
  <div class="sc-grid">{cards_html}</div>

  <section class="form-section" id="booking">
    <div class="section-title">
      <div><h2>预约到店</h2><span class="sub">专属顾问一对一 · VIP 私享鉴赏</span></div>
    </div>
    <div class="form">
      <form id="bookForm" onsubmit="return book(event)">
        <div class="form-grid">
          <div><label>您的称呼 *</label><input name="name" id="f-name" placeholder="请输入姓名" required></div>
          <div><label>联系方式 *</label><input name="contact" id="f-contact" placeholder="手机 / 微信" required></div>
          <div><label>意向品类</label><input name="category" id="f-category" placeholder="如 钻石、黄金、翡翠"></div>
          <div><label>目标商品（可填名称）</label><input name="product" id="f-product" placeholder="点击「预约看货」可自动填入"></div>
          <div><label>期望到店日期</label><input name="want_date" type="date"></div>
          <div><label>期望时段</label><input name="want_slot" placeholder="如 14:00 - 16:00"></div>
        </div>
        <label style="margin-top:14px">备注说明</label>
        <textarea name="remark" placeholder="可填写具体需求，如圈号、预算、送礼场合等"></textarea>
        <div class="submit-row">
          <button class="btn-submit" type="submit">✦ 提交 VIP 预约 ✦</button>
          <div id="msg" class="msg-box"></div>
        </div>
      </form>
    </div>
  </section>
  <div class="footer">
    <div class="footer-certs">NGTC / GIA 权威检测合作 · 假一赔十 · 终身免费养护</div>
    © {name} · 以臻金品质 铸一世珍藏
  </div>
</div>
<script>
function focusBook(name, cat, code) {{
  const fp = document.getElementById('f-product');
  const fc = document.getElementById('f-category');
  if (fp) fp.value = code ? ('货号' + code + ' ' + name) : name;
  if (fc && !fc.value) fc.value = cat;
  fp && fp.scrollIntoView({{ behavior:'smooth', block:'center' }});
  fp && fp.focus();
}}
function book(e) {{
  e.preventDefault();
  var f = e.target;
  var msg = document.getElementById('msg');
  msg.className = ''; msg.textContent = '正在提交…';
  var b = {{
    name: f.name.value.trim(),
    contact: f.contact.value.trim(),
    contact_type: 'phone',
    category: f.category.value.trim(),
    want_date: f.want_date.value,
    want_slot: f.want_slot.value.trim(),
    remark: (f.product.value.trim() ? ('意向商品：' + f.product.value + '\\n') : '') + f.remark.value
  }};
  fetch('/api/public/appointments', {{
    method: 'POST',
    headers: {{ 'Content-Type': 'application/json' }},
    body: JSON.stringify(b)
  }}).then(r=>r.json()).then(d=>{{
    msg.textContent = d.detail || '预约已提交，专属顾问将尽快与您联系';
    msg.className = 'ok';
    f.reset();
  }}).catch(()=>{{
    msg.textContent = '网络繁忙，请稍后重试或直接致电门店';
    msg.className = 'err';
  }});
  return false;
}}
</script>
</body></html>"""
    return HTMLResponse(html)


# ---------------------------------------------------------------- 登录

class LoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/auth/login")
def api_login(body: LoginReq, request: Request):
    with _db(request) as conn:
        user = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not user or user["password"] != body.password:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        token = secrets.token_urlsafe(24)
        info = {"username": user["username"], "display_name": user["display_name"], "role": user["role"],
                "can_view_cost": bool(user["can_view_cost"]) if "can_view_cost" in user.keys()
                else user["role"] in _COST_FORCE_VISIBLE_ROLES}
        store_rows = _accessible_store_rows(conn, info)
        stores = _store_payload(store_rows)
        info["store_id"] = stores[0]["id"] if stores else 0
        with _lock:
            _sessions[token] = info
        _log(conn, user["username"], "登录", user["username"])
        mode = _operator_mode(request)
        return {
            "token": token,
            "user": info,
            "features": FEATURES,
            "mode": mode,
            "tenant": _tenant_of(request),
            # 进程所属插件版本（来自启动包的 plugin.json）：多版本并行试运行时供前端标题栏区分
            "version": SOFT_VERSION,
            "stores": stores,
            "store_id": info["store_id"],
        }


class SwitchStoreIn(BaseModel):
    store_id: int


@app.post("/api/auth/switch-store")
def api_switch_store(body: SwitchStoreIn, request: Request):
    """切换当前工作门店（同租户内免密切换）：仅可切换到本人被授权的门店。"""
    sess = _require_auth(request)
    with _db(request) as conn:
        rows = _accessible_store_rows(conn, sess)
        ids = [r["id"] for r in rows]
        if body.store_id not in ids:
            raise HTTPException(status_code=403, detail="无权访问该门店")
        sess["store_id"] = body.store_id
        row = next(r for r in rows if r["id"] == body.store_id)
        _log(conn, sess["username"], "切换门店", row["name"])
        return {"ok": True, "store_id": body.store_id, "stores": _store_payload(rows)}


@app.post("/api/auth/logout")
def api_logout(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    with _lock:
        _sessions.pop(token, None)
    return {"ok": True}


@app.get("/api/auth/me")
def api_me(request: Request):
    u = _require_auth(request)
    with _db(request) as conn:
        # 列级权限实时读库：店长在用户管理里收回/授予后，店员下次刷新即生效，无需重登
        u["can_view_cost"] = _can_view_cost(conn, u)
        rows = _accessible_store_rows(conn, u)
        stores = _store_payload(rows)
    cur = int(u.get("store_id") or 0)
    if cur not in [s["id"] for s in stores]:
        cur = stores[0]["id"] if stores else 0
        u["store_id"] = cur
    return {"user": u, "features": FEATURES, "mode": _operator_mode(request),
            "tenant": _tenant_of(request), "version": SOFT_VERSION,
            "stores": stores, "store_id": cur}


# ---------------------------------------------------------------- 手持机扫码登录（会话当天有效）

# hkey -> {status: pending|waiting|confirmed|denied, device, name, created, user, token}
_handheld_logins: dict[str, dict] = {}
_HANDHELD_LOGIN_TTL = 600  # 登录二维码有效期（秒）


def _purge_handheld_logins() -> None:
    now = time.time()
    expired = [k for k, v in _handheld_logins.items() if now - v["created"] > _HANDHELD_LOGIN_TTL]
    for k in expired:
        _handheld_logins.pop(k, None)


@app.get("/api/handheld/login-qr")
def handheld_login_qr(request: Request):
    """网页端（已登录用户）生成【手持机登录】二维码，内容为手持机上报地址（含一次性 hkey）。"""
    sess = _require_auth(request)
    with _lock:
        _purge_handheld_logins()
    hkey = secrets.token_urlsafe(16)
    _handheld_logins[hkey] = {
        "status": "pending", "device": "", "name": "",
        "created": time.time(), "user": sess, "token": "",
    }
    url = f"http://{_lan_ip()}:{PORT}/api/handheld/auth?hkey={hkey}"
    return {"hkey": hkey, "url": url, "expires_in": _HANDHELD_LOGIN_TTL}


class HandheldAuthIn(BaseModel):
    hkey: str
    device: str = ""
    name: str = ""


@app.post("/api/handheld/auth")
def handheld_auth(body: HandheldAuthIn):
    """手持机扫登录二维码后上报设备信息，进入待确认状态，等待网页端确认。"""
    with _lock:
        _purge_handheld_logins()
        h = _handheld_logins.get(body.hkey)
        if not h:
            raise HTTPException(status_code=410, detail="二维码已过期，请在网页端重新生成")
        if h["status"] != "pending":
            raise HTTPException(status_code=409, detail="该二维码已被使用，请重新生成")
        h["status"] = "waiting"
        h["device"] = (body.device or "").strip()
        h["name"] = (body.name or "").strip() or "手持机"
    return {"ok": True}


@app.get("/api/handheld/login-status")
def handheld_login_status(hkey: str, request: Request):
    """网页端轮询：pending → waiting（显示设备名，等待确认）→ confirmed / denied。"""
    _require_auth(request)
    with _lock:
        _purge_handheld_logins()
        h = _handheld_logins.get(hkey)
        if not h:
            return {"status": "expired"}
        return {"status": h["status"], "device": h["device"], "name": h["name"]}


class HandheldConfirmIn(BaseModel):
    hkey: str
    approve: bool = True


@app.post("/api/handheld/confirm")
def handheld_confirm(body: HandheldConfirmIn, request: Request):
    """网页端确认/拒绝。确认即为手持机签发与当前网页用户同身份的会话（当天有效）。"""
    sess = _require_auth(request)
    with _lock:
        h = _handheld_logins.get(body.hkey)
        if not h:
            raise HTTPException(status_code=410, detail="二维码已过期，请重新生成")
        if h["status"] != "waiting":
            raise HTTPException(status_code=409, detail="登录状态已变更，请关闭后重试")
        if not body.approve:
            h["status"] = "denied"
            return {"ok": False}
        token = secrets.token_urlsafe(24)
        info = dict(sess)
        info["valid_day"] = date.today().isoformat()
        info["via"] = "handheld"
        _sessions[token] = info
        h["status"] = "confirmed"
        h["token"] = token
    with _db(request) as conn:
        _log(conn, sess["username"], "手持机登录确认", h["name"] or h["device"] or "手持机")
    return {"ok": True}


@app.get("/api/handheld/poll")
def handheld_poll(hkey: str):
    """手持机轮询登录结果；网页确认后返回会话 token（当天有效），一次性领取。"""
    with _lock:
        _purge_handheld_logins()
        h = _handheld_logins.get(hkey)
        if not h:
            return {"status": "expired"}
        if h["status"] == "confirmed":
            _handheld_logins.pop(hkey, None)
            u = h["user"]
            return {
                "status": "confirmed",
                "token": h["token"],
                "user": {"username": u["username"], "display_name": u["display_name"], "role": u["role"]},
                "tenant": None,
            }
        return {"status": h["status"]}


# ---------------------------------------------------------------- 看板 / 店铺

@app.get("/api/dashboard/overview")
def dashboard_overview(request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        today = date.today().isoformat()
        stock = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(cost),0) c FROM products WHERE status='在库' AND store_id=?", (sid,)).fetchone()
        in_transit = conn.execute("SELECT COUNT(*) n FROM products WHERE status='在途' AND store_id=?", (sid,)).fetchone()
        reserved = conn.execute("SELECT COUNT(*) n FROM products WHERE status='已定' AND store_id=?", (sid,)).fetchone()
        loaned = conn.execute("SELECT COUNT(*) n FROM products WHERE status='借出' AND store_id=?", (sid,)).fetchone()
        today_sales = conn.execute(
            "SELECT COALESCE(SUM(amount),0) a, COUNT(*) n FROM sales "
            "WHERE biz_date=? AND status!='已冲红' AND (store_id=? OR store_id=0)", (today, sid)
        ).fetchone()
        month = today[:7]
        month_sales = conn.execute(
            "SELECT COALESCE(SUM(amount),0) a FROM sales "
            "WHERE substr(biz_date,1,7)=? AND status!='已冲红' AND (store_id=? OR store_id=0)", (month, sid)
        ).fetchone()
        # ----- 环比/同比计算：同口径 status!='已冲红' AND (store_id=? OR store_id=0) -----
        scope_filter = " AND status!='已冲红' AND (store_id=? OR store_id=0)"
        scope_args_base = [sid]
        # 昨日环比
        yesterday = (date.today() + __import__('datetime').timedelta(days=-1)).isoformat()
        prev_day = conn.execute(
            f"SELECT COALESCE(SUM(amount),0) a FROM sales WHERE biz_date BETWEEN ? AND ?{scope_filter}",
            [yesterday, yesterday] + scope_args_base).fetchone()["a"]
        today_amount = today_sales["a"]
        day_mom_pct = round((today_amount - prev_day) * 100.0 / prev_day, 1) if prev_day and prev_day > 0 else None
        # 上月环比
        from datetime import timedelta as _td
        first_of_this = date.today().replace(day=1)
        first_of_prev = (first_of_this + _td(days=-1)).replace(day=1)
        prev_month_end = first_of_this + _td(days=-1)
        prev_month = conn.execute(
            f"SELECT COALESCE(SUM(amount),0) a FROM sales WHERE biz_date BETWEEN ? AND ?{scope_filter}",
            [first_of_prev.isoformat(), prev_month_end.isoformat()] + scope_args_base
        ).fetchone()["a"]
        month_amount = month_sales["a"]
        month_mom_pct = round((month_amount - prev_month) * 100.0 / prev_month, 1) if prev_month and prev_month > 0 else None
        # 去年同期同比（同月）
        first_of_prev_year = first_of_this.replace(year=first_of_this.year - 1)
        prev_year_end = first_of_prev_year + _td(days=-1)  # 去年同月最后一天
        last_year_month = conn.execute(
            f"SELECT COALESCE(SUM(amount),0) a FROM sales WHERE biz_date BETWEEN ? AND ?{scope_filter}",
            [first_of_prev_year.isoformat(), prev_year_end.isoformat()] + scope_args_base
        ).fetchone()["a"]
        month_yoy_pct = round((month_amount - last_year_month) * 100.0 / last_year_month, 1) if last_year_month and last_year_month > 0 else None

        deposit = conn.execute(
            "SELECT COALESCE(SUM(balance),0) a FROM deposits WHERE status='已定' AND (store_id=? OR store_id=0)",
            (sid,)).fetchone()
        due = conn.execute("SELECT COALESCE(SUM(due_amount),0) a FROM customers").fetchone()
        loans = conn.execute(
            "SELECT COUNT(*) n FROM loans WHERE status IN ('借出中','借入中') AND (store_id=? OR store_id=0)",
            (sid,)).fetchone()
        repairs = conn.execute(
            "SELECT COUNT(*) n FROM repairs WHERE status NOT IN ('已完成','已取走') AND (store_id=? OR store_id=0)",
            (sid,)).fetchone()
        recent = conn.execute(
            "SELECT bill_no, customer, amount, method, biz_date, status FROM sales "
            "WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT 8", (sid,)
        ).fetchall()
        cost_visible = _can_view_cost(conn, sess)
        return {
            "tenant": _tenant_of(request),
            "date": today,
            # 列级权限：无成本权限时库存成本金额返回 None（前端 *** 渲染）
            "stock": {"count": stock["n"], "cost": round(stock["c"], 2) if cost_visible else None,
                      "reserved": reserved["n"], "loaned": loaned["n"], "inTransit": in_transit["n"]},
            "todaySales": {"amount": round(today_amount, 2), "count": today_sales["n"], "momPct": day_mom_pct},
            "monthSales": {"amount": round(month_amount, 2), "momPct": month_mom_pct, "yoyPct": month_yoy_pct},
            "depositPending": {"amount": round(deposit["a"], 2)},
            "customerDue": {"amount": round(due["a"], 2)},
            "loansActive": loans["n"],
            "repairsActive": repairs["n"],
            "recentSales": [dict(r) for r in recent],
        }


@app.get("/api/dashboard/trend")
def dashboard_trend(request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        rows = conn.execute("""
            SELECT substr(biz_date,1,7) m, COALESCE(SUM(amount),0) a
            FROM sales WHERE status!='已冲红' AND biz_date >= date('now','start of month','-11 months')
              AND (store_id=? OR store_id=0)
            GROUP BY m ORDER BY m
        """, (sid,)).fetchall()
        months = [r["m"] for r in rows]
        amounts = [round(r["a"], 2) for r in rows]
        # 去年同月：YYYY-MM → YYYY-1-MM
        last_year_amounts = []
        for m in months:
            parts = m.split("-")
            y = int(parts[0]) - 1
            ym_last = f"{y}-{parts[1]}"
            r2 = conn.execute(
                "SELECT COALESCE(SUM(amount),0) a FROM sales WHERE status!='已冲红' "
                "AND substr(biz_date,1,7)=? AND (store_id=? OR store_id=0)", (ym_last, sid)
            ).fetchone()
            v = round(r2["a"], 2) if r2 and r2["a"] else None
            last_year_amounts.append(v)
        return {"months": months, "amounts": amounts, "amountsLastYear": last_year_amounts}


@app.get("/api/dashboard/category-sales")
def dashboard_category_sales(request: Request):
    """近6个月各品类销售额占比（与趋势图同口径，未关联档案的销售计入「其他」）。"""
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        rows = conn.execute("""
            SELECT COALESCE(NULLIF(p.product_type,''), '其他') cat, COALESCE(SUM(s.amount),0) a, COUNT(*) n
            FROM sales s LEFT JOIN products p ON p.id = s.product_id
            WHERE s.status!='已冲红' AND s.biz_date >= date('now','start of month','-5 months')
              AND (s.store_id=? OR s.store_id=0)
            GROUP BY cat ORDER BY a DESC
        """, (sid,)).fetchall()
        total = sum(r["a"] for r in rows) or 1
        return {"items": [
            {"category": r["cat"], "amount": round(r["a"], 2), "count": r["n"], "pct": round(r["a"] * 100 / total, 1)}
            for r in rows
        ]}


@app.get("/api/dashboard/reminders")
def dashboard_reminders(request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        deposits_urgent = conn.execute(
            "SELECT * FROM deposits WHERE status='已定' AND promised_date <= date('now','+7 days') "
            "AND (store_id=? OR store_id=0) ORDER BY promised_date LIMIT 8", (sid,)
        ).fetchall()
        loans_overdue = conn.execute(
            "SELECT * FROM loans WHERE status IN ('借出中','借入中') AND due_date < date('now') "
            "AND (store_id=? OR store_id=0) ORDER BY due_date LIMIT 8", (sid,)
        ).fetchall()
        repairs_pending = conn.execute(
            "SELECT * FROM repairs WHERE status IN ('待维修','维修中') "
            "AND (store_id=? OR store_id=0) ORDER BY promised_date LIMIT 8", (sid,)
        ).fetchall()
        return {
            "deposits": [dict(r) for r in deposits_urgent],
            "loansOverdue": [dict(r) for r in loans_overdue],
            "repairsPending": [dict(r) for r in repairs_pending],
        }


@app.get("/api/profile")
def profile_get(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        return dict(row) if row else {}


class ProfileIn(BaseModel):
    name: str = ""
    short_name: str = ""
    slogan: str = ""
    intro: str = ""
    contact: str = ""
    phone: str = ""
    address: str = ""
    hours: str = ""
    categories: str = ""
    published: int = 1
    showcase_title: str = "新品橱窗"
    showcase_subtitle: str = "本周臻品 · 限量发售"


@app.put("/api/profile")
def profile_put(body: ProfileIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT id FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        vals = (body.name, body.short_name, body.slogan, body.intro, body.contact, body.phone, body.address,
                body.hours, body.categories, body.published, body.showcase_title, body.showcase_subtitle)
        if row:
            conn.execute(
                """UPDATE tenant_profiles SET name=?,short_name=?,slogan=?,intro=?,contact=?,phone=?,address=?,
                   hours=?,categories=?,published=?,showcase_title=?,showcase_subtitle=? WHERE id=?""",
                vals + (row["id"],),
            )
        else:
            conn.execute(
                """INSERT INTO tenant_profiles(tenant_id,name,short_name,slogan,intro,contact,phone,address,
                   hours,categories,published,showcase_title,showcase_subtitle)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (_tenant_of(request),) + vals,
            )
        conn.commit()
        _log(conn, op["username"], "更新店铺资料", body.name)
        return {"ok": True}


# ---------------------------------------------------------------- 商品

class ProductIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    category: str = "黄金"
    material: str = ""
    weight: float = 0
    size: str = ""
    cert: str = ""
    cost: float = 0
    price: float = 0
    status: str = "在库"
    store_id: int | None = 1
    rfid_epc: str = ""
    name_i18n: str = "{}"
    category_code: str = ""
    product_type: str = ""
    product_type_code: str = ""
    showcase_public: int = 0
    showcase_order: int = 0
    showcase_desc: str = ""
    origin: str = ""
    high_value: int = 0
    location_id: int = 0
    cert_location_id: int = 0


# ---------------------------------------------------------------- 语言 / 业务配置 / 分类

@app.get("/api/languages")
def language_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT code,name,is_default,sort_order FROM languages ORDER BY sort_order").fetchall()
        return [{"code": r[0], "name": r[1], "is_default": bool(r[2]), "sort_order": r[3]} for r in rows]


@app.get("/api/biz-config")
def biz_config_get(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        r = conn.execute(
            "SELECT epc_prefix,seq_bits,IFNULL(gold_price,0) FROM biz_config WHERE id=1"
        ).fetchone()
        if not r:
            conn.execute("INSERT OR IGNORE INTO biz_config(id,epc_prefix,seq_bits) VALUES(1,'E280',8)")
            conn.commit()
            r = ("E280", 8, 0)
        return {"epc_prefix": r[0], "seq_bits": r[1], "gold_price": r[2] or 0}


class BizConfigUpdate(BaseModel):
    epc_prefix: str | None = None
    seq_bits: int | None = None
    gold_price: float | None = None  # 当日金价（元/克）；None=本次不改


@app.put("/api/biz-config")
def biz_config_update(request: Request, body: BizConfigUpdate):
    _require_auth(request)
    prefix = (body.epc_prefix or "").strip().upper()
    with _db(request) as conn:
        # 当日金价：允许单独更新（开单配置入口只传 gold_price）
        if body.gold_price is not None and body.epc_prefix is None and body.seq_bits is None:
            if body.gold_price < 0:
                raise HTTPException(400, "当日金价不能为负数")
            conn.execute(
                "INSERT INTO biz_config(id,gold_price) VALUES(1,?) "
                "ON CONFLICT(id) DO UPDATE SET gold_price=excluded.gold_price",
                (round(body.gold_price, 2),),
            )
            conn.commit()
            return {"ok": True, "gold_price": round(body.gold_price, 2)}
        if body.epc_prefix is None or body.seq_bits is None:
            raise HTTPException(400, "EPC 前缀与序号位数必填")
        # 前缀留空时，按企业名称拼音首字母前三位自动生成
        if not prefix:
            prow = conn.execute("SELECT name FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
            prefix = _pinyin_initials(prow[0] if prow else "")
        if not prefix:
            raise HTTPException(400, "EPC 前缀为空，且无法从企业名称自动生成（请先在店铺资料填写企业名称）")
        if not re.fullmatch(r"[A-Z0-9]{1,6}", prefix):
            raise HTTPException(400, "EPC 前缀只能用 1~6 位英文字母或数字")
        if not (4 <= body.seq_bits <= 6):
            raise HTTPException(400, "序号位数需在 4~6 之间")
        conn.execute(
            "INSERT INTO biz_config(id,epc_prefix,seq_bits) VALUES(1,?,?) "
            "ON CONFLICT(id) DO UPDATE SET epc_prefix=excluded.epc_prefix, seq_bits=excluded.seq_bits",
            (prefix, body.seq_bits),
        )
        conn.commit()
    return {"ok": True, "epc_prefix": prefix}


@app.get("/api/categories")
def category_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT code,names,sort_order,label_template_id FROM categories ORDER BY sort_order,code").fetchall()
        return [{"code": r[0], "names": json.loads(r[1] or "{}"), "sort_order": r[2], "label_template_id": r[3]} for r in rows]


class CategoryUpdate(BaseModel):
    code: str = ""
    names: dict = Field(default_factory=dict)
    sort_order: int = 0


@app.post("/api/categories")
def category_create(request: Request, body: CategoryUpdate):
    _require_auth(request)
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(400, "分类编码不能为空")
    if not (body.names.get("zh") or body.names.get("en")):
        raise HTTPException(400, "至少填写中文或英文名称")
    with _db(request) as conn:
        if conn.execute("SELECT 1 FROM categories WHERE code=?", (code,)).fetchone():
            raise HTTPException(400, "分类编码已存在")
        conn.execute(
            "INSERT INTO categories(code,names,sort_order) VALUES(?,?,?)",
            (code, json.dumps(body.names, ensure_ascii=False), body.sort_order),
        )
        conn.commit()
    return {"ok": True, "code": code}


@app.put("/api/categories/{code}")
def category_update(request: Request, code: str, body: CategoryUpdate):
    _require_auth(request)
    if not (body.names.get("zh") or body.names.get("en")):
        raise HTTPException(400, "至少填写中文或英文名称")
    with _db(request) as conn:
        if not conn.execute("SELECT 1 FROM categories WHERE code=?", (code,)).fetchone():
            raise HTTPException(404, "分类不存在")
        conn.execute(
            "UPDATE categories SET names=?, sort_order=? WHERE code=?",
            (json.dumps(body.names, ensure_ascii=False), body.sort_order, code),
        )
        conn.commit()
    return {"ok": True}


@app.delete("/api/categories/{code}")
def category_delete(request: Request, code: str):
    _require_auth(request)
    with _db(request) as conn:
        used = conn.execute("SELECT COUNT(*) FROM products WHERE category_code=?", (code,)).fetchone()[0]
        if used:
            raise HTTPException(400, f"该分类下仍有 {used} 件商品，不能删除")
        conn.execute("DELETE FROM categories WHERE code=?", (code,))
        conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 商品品类（戒指/项链…）

class ProductTypeIn(BaseModel):
    code: str = ""
    names: dict = Field(default_factory=dict)
    sort_order: int = 0
    pricing_mode: str = "piece"  # piece=计件（一口价）；weight=计重（克重×金价+工费）


@app.get("/api/product-types")
def product_type_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute(
            "SELECT code,names,sort_order,label_template_id,IFNULL(pricing_mode,'piece') "
            "FROM product_types ORDER BY sort_order,code"
        ).fetchall()
        return [{"code": r[0], "names": json.loads(r[1] or "{}"),
                 "sort_order": r[2], "label_template_id": r[3],
                 "pricing_mode": r[4] if r[4] in ("piece", "weight") else "piece"} for r in rows]


@app.post("/api/product-types")
def product_type_create(request: Request, body: ProductTypeIn):
    _require_auth(request)
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(400, "品类编码不能为空")
    if not (body.names.get("zh") or body.names.get("en")):
        raise HTTPException(400, "至少填写中文或英文名称")
    with _db(request) as conn:
        if conn.execute("SELECT 1 FROM product_types WHERE code=?", (code,)).fetchone():
            raise HTTPException(400, "品类编码已存在")
        mode = body.pricing_mode if body.pricing_mode in ("piece", "weight") else "piece"
        conn.execute(
            "INSERT INTO product_types(code,names,sort_order,pricing_mode) VALUES(?,?,?,?)",
            (code, json.dumps(body.names, ensure_ascii=False), body.sort_order, mode),
        )
        conn.commit()
    return {"ok": True, "code": code}


@app.put("/api/product-types/{code}")
def product_type_update(request: Request, code: str, body: ProductTypeIn):
    _require_auth(request)
    if not (body.names.get("zh") or body.names.get("en")):
        raise HTTPException(400, "至少填写中文或英文名称")
    with _db(request) as conn:
        if not conn.execute("SELECT 1 FROM product_types WHERE code=?", (code,)).fetchone():
            raise HTTPException(404, "品类不存在")
        mode = body.pricing_mode if body.pricing_mode in ("piece", "weight") else "piece"
        conn.execute(
            "UPDATE product_types SET names=?, sort_order=?, pricing_mode=? WHERE code=?",
            (json.dumps(body.names, ensure_ascii=False), body.sort_order, mode, code),
        )
        # 同步历史商品冗余的品类中文名
        zh = body.names.get("zh") or body.names.get("en") or code
        conn.execute("UPDATE products SET product_type=? WHERE product_type_code=?", (zh, code))
        conn.commit()
    return {"ok": True}


@app.delete("/api/product-types/{code}")
def product_type_delete(request: Request, code: str):
    _require_auth(request)
    if code == "99":
        raise HTTPException(400, "「其他」为兜底品类，不能删除")
    with _db(request) as conn:
        used = conn.execute("SELECT COUNT(*) FROM products WHERE product_type_code=?", (code,)).fetchone()[0]
        if used:
            raise HTTPException(400, f"该品类下仍有 {used} 件商品，不能删除")
        conn.execute("DELETE FROM product_types WHERE code=?", (code,))
        conn.commit()
    return {"ok": True}


class ProductTypeTemplateIn(BaseModel):
    label_template_id: int | None = None


@app.put("/api/product-types/{code}/template")
def product_type_bind_template(code: str, body: ProductTypeTemplateIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        if not conn.execute("SELECT code FROM product_types WHERE code=?", (code,)).fetchone():
            raise HTTPException(404, "品类不存在")
        if body.label_template_id is not None and not conn.execute(
            "SELECT id FROM label_templates WHERE id=?", (body.label_template_id,)
        ).fetchone():
            raise HTTPException(404, "模板不存在")
        conn.execute("UPDATE product_types SET label_template_id=? WHERE code=?", (body.label_template_id, code))
        conn.commit()
        _log(conn, op["username"], "品类绑定模板", f"{code} -> {body.label_template_id}")
        return {"ok": True}


# ---------------------------------------------------------------- 标签模板 CRUD

class LabelTemplateIn(BaseModel):
    name: str = ""
    size_width: float = 70
    size_height: float = 35
    definition: dict | str = "{}"
    cols: int = 1
    gap: float = 0
    copies: int = 1
    default_printer: str = ""
    is_rfid: int = 0


def _tpl_row(r) -> dict:
    d = dict(r)
    if isinstance(d.get("definition"), str):
        try:
            d["definition"] = json.loads(d["definition"])
        except (json.JSONDecodeError, TypeError):
            d["definition"] = {}
    return d


@app.get("/api/label-templates")
def label_templates_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT * FROM label_templates ORDER BY id").fetchall()
        return {"list": [_tpl_row(r) for r in rows]}


@app.post("/api/label-templates")
def label_template_create(body: LabelTemplateIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        definition = body.definition if isinstance(body.definition, str) else json.dumps(body.definition, ensure_ascii=False)
        cur = conn.execute(
            "INSERT INTO label_templates(name,size_width,size_height,definition,cols,gap,copies,default_printer,is_rfid) VALUES(?,?,?,?,?,?,?,?,?)",
            (body.name, body.size_width, body.size_height, definition, body.cols, body.gap, body.copies, body.default_printer, body.is_rfid),
        )
        conn.commit()
        _log(conn, op["username"], "新建标签模板", body.name)
        return {"ok": True, "id": cur.lastrowid}


@app.put("/api/label-templates/{tid}")
def label_template_update(tid: int, body: LabelTemplateIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        definition = body.definition if isinstance(body.definition, str) else json.dumps(body.definition, ensure_ascii=False)
        conn.execute(
            "UPDATE label_templates SET name=?,size_width=?,size_height=?,definition=?,cols=?,gap=?,copies=?,default_printer=?,is_rfid=? WHERE id=?",
            (body.name, body.size_width, body.size_height, definition, body.cols, body.gap, body.copies, body.default_printer, body.is_rfid, tid),
        )
        conn.commit()
        _log(conn, op["username"], "更新标签模板", f"#{tid} {body.name}")
        return {"ok": True}


@app.delete("/api/label-templates/{tid}")
def label_template_delete(tid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        used = conn.execute("SELECT COUNT(*) FROM categories WHERE label_template_id=?", (tid,)).fetchone()[0]
        used += conn.execute("SELECT COUNT(*) FROM product_types WHERE label_template_id=?", (tid,)).fetchone()[0]
        if used:
            raise HTTPException(400, f"该模板已被 {used} 个分类/品类绑定，请先解绑")
        conn.execute("DELETE FROM label_templates WHERE id=?", (tid,))
        conn.commit()
        _log(conn, op["username"], "删除标签模板", f"#{tid}")
        return {"ok": True}


@app.post("/api/label-templates/{tid}/preview")
def label_template_preview(tid: int, request: Request, product_id: int = 1):
    _require_auth(request)
    with _db(request) as conn:
        tpl = conn.execute("SELECT * FROM label_templates WHERE id=?", (tid,)).fetchone()
        if not tpl:
            raise HTTPException(404, "模板不存在")
        p = conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        if not p:
            raise HTTPException(404, "商品不存在")
        cur_sid, _ = _current_store(request, conn)
        if p["store_id"] not in (0, cur_sid):
            raise HTTPException(403, "该商品不属于当前工作门店")
        prof = conn.execute("SELECT name FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        store_name = prof["name"] if prof and prof["name"] else ""
        product = dict(p)
        product.pop("image", None)
        product["rfid_epc"] = product.get("rfid_epc") or _gen_type_epc(conn, product.get("product_type_code") or "99", product.get("store_id") or 1)
        bc = _compute_item_barcode(conn, product)
        if product.get("barcode") != bc:
            conn.execute("UPDATE products SET barcode=? WHERE id=?", (bc, product["id"]))
            conn.commit()
        product["barcode"] = bc
        prefix_cfg, _ = _epc_cfg(conn)
        zpl = rfid_print.build_label_zpl(product, store_name=store_name, template=dict(tpl), rfid_prefix=prefix_cfg)
        return {"ok": True, "zpl": zpl, "product": product}


# ---------------------------------------------------------------- 分类绑定模板

class CategoryTemplateIn(BaseModel):
    label_template_id: int | None = None


@app.put("/api/categories/{code}/template")
def category_bind_template(code: str, body: CategoryTemplateIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        cat = conn.execute("SELECT code FROM categories WHERE code=?", (code,)).fetchone()
        if not cat:
            raise HTTPException(404, "分类不存在")
        if body.label_template_id is not None:
            tpl = conn.execute("SELECT id FROM label_templates WHERE id=?", (body.label_template_id,)).fetchone()
            if not tpl:
                raise HTTPException(404, "模板不存在")
        conn.execute("UPDATE categories SET label_template_id=? WHERE code=?", (body.label_template_id, code))
        conn.commit()
        _log(conn, op["username"], "分类绑定模板", f"{code} -> {body.label_template_id}")
        return {"ok": True}


@app.post("/api/products/{pid}/generate-epc")
def product_generate_epc(pid: int, request: Request):
    """按 EPC = 前缀+门店码+品类码+递增序号 生成并回写 RFID EPC（已有则直接复用）。"""
    _require_auth(request)
    with _db(request) as conn:
        p = conn.execute("SELECT product_type_code, rfid_epc, store_id FROM products WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "商品不存在")
        if p["rfid_epc"]:
            return {"ok": True, "epc": p["rfid_epc"], "reused": True}
        _assert_stock_unfrozen(conn)
        epc = _gen_type_epc(conn, p["product_type_code"] or "99", p["store_id"] or 1)
        conn.execute("UPDATE products SET rfid_epc=? WHERE id=?", (epc, pid))
        conn.commit()
        return {"ok": True, "epc": epc}


class RebuildBarcodeIn(BaseModel):
    make_groups: bool = False


@app.post("/api/admin/rebuild-barcodes")
def admin_rebuild_barcodes(body: RebuildBarcodeIn, request: Request):
    """补全印刷条码：可选先把同品类商品随机编成同货号分组，再按(门店+品类+货号)计算并写回条码。EPC 不受影响。"""
    _require_auth(request)
    with _db(request) as conn:
        if body.make_groups:
            from collections import defaultdict
            rows = conn.execute("SELECT id, product_type_code, code FROM products").fetchall()
            by_cat: dict = defaultdict(list)
            for r in rows:
                by_cat[r["product_type_code"] or "99"].append(r)
            for items in by_cat.values():
                if len(items) < 2:
                    continue
                random.shuffle(items)
                k = max(1, len(items) // 2)
                base = items[0]["code"]
                for it in items[1:k + 1]:
                    conn.execute("UPDATE products SET code=? WHERE id=?", (base, it["id"]))
            conn.commit()
        n = 0
        for (pid,) in conn.execute("SELECT id FROM products ORDER BY code, id").fetchall():
            p = dict(conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone())
            bc = _compute_item_barcode(conn, p)
            conn.execute("UPDATE products SET barcode=? WHERE id=?", (bc, pid))
            n += 1
        conn.commit()
        return {"ok": True, "updated": n}


@app.get("/api/products")
def product_list(request: Request, q: str = "", status: str = "", page: int = 1, size: int = 80,
                 store_id: int = 0, location_id: int = 0, cert_location_id: int = 0,
                 has_cert: int = -1):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        where, args = [], []
        join = (" LEFT JOIN locations l1 ON l1.id=products.location_id"
                " LEFT JOIN locations l2 ON l2.id=products.cert_location_id")
        # 严格门店隔离：一律以会话当前工作门店为准，忽略前端传入的 store_id
        where.append("products.store_id=?")
        args.append(sid)
        if q:
            where.append("(products.name LIKE ? OR products.code LIKE ? OR products.rfid_epc LIKE ?"
                         " OR l1.name LIKE ? OR l1.code LIKE ? OR l2.name LIKE ? OR l2.code LIKE ?)")
            args += [f"%{q}%"] * 7
        if status:
            where.append("products.status=?")
            args.append(status)
        if location_id:
            where.append("products.location_id=?")
            args.append(location_id)
        if cert_location_id:
            where.append("products.cert_location_id=?")
            args.append(cert_location_id)
        if has_cert == 0:
            where.append("TRIM(IFNULL(products.cert,''))=''")
        elif has_cert == 1:
            where.append("TRIM(IFNULL(products.cert,''))<>''")
        cond = ("WHERE " + " AND ".join(where)) if where else ""
        total = conn.execute(
            f"SELECT COUNT(*) n FROM products {join} {cond}", args).fetchone()["n"]
        rows = conn.execute(
            f"SELECT {_PRODUCT_COLS} FROM products {join} {cond} ORDER BY products.id DESC LIMIT ? OFFSET ?",
            args + [size, (page - 1) * size],
        ).fetchall()
        # 列级权限：无成本权限时逐行抹掉 cost（前端 *** 渲染），防止从接口直取
        items = _hide_cost([dict(r) for r in rows], _can_view_cost(conn, sess))
        return {"total": total, "page": page, "size": size, "items": items}


@app.get("/api/products/options")
def product_options(request: Request, status: str = "在库"):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        sql = (
            "SELECT p.id,p.code,p.name,p.price,p.status,p.rfid_epc,p.barcode,p.store_id,"
            "p.product_type_code,p.weight,"
            "CASE WHEN pt.pricing_mode='weight' THEN 'weight' ELSE 'piece' END pricing_mode "
            "FROM products p LEFT JOIN product_types pt ON pt.code=p.product_type_code "
            "WHERE {cond} ORDER BY p.id"
        )
        if status:
            rows = conn.execute(sql.format(cond="p.status=? AND p.store_id=?"), (status, sid)).fetchall()
        else:
            rows = conn.execute(sql.format(cond="p.store_id=?"), (sid,)).fetchall()
        return {"items": [dict(r) for r in rows]}


# -------------------------------------------- 商品批量导入（Excel .xlsx，按行建档一物一码）
_IMPORT_HEADERS = ["货号", "名称", "品类码", "品类", "材质", "重量(g)", "规格", "证书号", "成本", "售价"]
_IMPORT_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_IMPORT_MAX_BYTES = 5 * 1024 * 1024


def _build_import_template_xlsx(type_rows) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    ws = wb.active
    ws.title = "商品导入"
    ws.append(_IMPORT_HEADERS)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="FFF3D6")
    ws.append(["A001-01", "示例 足金戒指", "01", "黄金", "足金999", 3.52, "12#", "CERT00001", 1800, 2280])
    ws.freeze_panes = "A2"
    widths = [14, 24, 8, 10, 12, 9, 10, 16, 10, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws2 = wb.create_sheet("品类码对照")
    ws2.append(["品类码", "品类名称"])
    for r in type_rows:
        zh = r["names"]
        try:
            zh = (json.loads(r["names"] or "{}").get("zh") or "").strip()
        except Exception:
            zh = ""
        ws2.append([r["code"], zh or r["code"]])
    ws2.column_dimensions["A"].width = 10
    ws2.column_dimensions["B"].width = 18
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@app.get("/api/products/import-template")
def products_import_template(request: Request):
    """下载商品批量导入 Excel 模板（含当前品类码对照页）。静态路由，须在 /api/products/{pid} 前注册。"""
    _require_auth(request)
    with _db(request) as conn:
        type_rows = conn.execute("SELECT code,names FROM product_types ORDER BY code").fetchall()
    data = _build_import_template_xlsx(type_rows)
    fn = urllib.parse.quote("商品批量导入模板.xlsx")
    return Response(
        content=data, media_type=_IMPORT_XLSX_MEDIA,
        headers={"Content-Disposition":
                 "attachment; filename=products_import.xlsx; filename*=UTF-8''" + fn})


@app.post("/api/products/import-xlsx")
async def products_import_xlsx(request: Request, file: UploadFile):
    """按 Excel 行批量建档：每行一件商品（一物一码，EPC 自动生成）；部分行失败不影响其他行。"""
    sess = _require_auth(request)
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "文件为空")
    if len(raw) > _IMPORT_MAX_BYTES:
        raise HTTPException(400, "文件不能超过 5MB")

    def _work():
        from openpyxl import load_workbook
        with _db(request) as conn:
            sid, _ = _current_store(request, conn, sess)
            _assert_stock_unfrozen(conn)
            try:
                wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            except Exception:
                raise HTTPException(400, "无法解析文件，请使用模板另存为 .xlsx 后上传")
            ws = wb.worksheets[0]
            rows = ws.iter_rows(values_only=True)
            try:
                header = [str(c).strip() if c is not None else "" for c in next(rows)]
            except StopIteration:
                raise HTTPException(400, "Excel 内容为空")
            # 按表头名定位列（允许列序与模板不同/有多余列）
            col = {h: i for i, h in enumerate(header)}
            missing = [h for h in ("货号", "名称") if h not in col]
            if missing:
                raise HTTPException(400, "缺少必需列：" + "、".join(missing) + "（请使用最新模板）")

            def cell(r, name):
                i = col.get(name)
                v = r[i] if i is not None and i < len(r) else None
                return "" if v is None else str(v).strip()

            def num(r, name):
                v = cell(r, name)
                if not v:
                    return 0.0
                try:
                    return float(v)
                except ValueError:
                    raise ValueError(name + "需为数字")

            created, failed = 0, []
            seen = set()  # 文件内货号去重
            for idx, r in enumerate(rows, start=2):
                code = cell(r, "货号")
                name = cell(r, "名称")
                if not code and not name:
                    continue  # 整行空白跳过
                try:
                    if not code:
                        raise ValueError("货号不能为空")
                    if not name:
                        raise ValueError("名称不能为空")
                    if code in seen:
                        raise ValueError("文件内货号重复")
                    if conn.execute("SELECT 1 FROM products WHERE code=? AND store_id=?", (code, sid)).fetchone():
                        raise ValueError("本店已存在该货号")
                    weight = num(r, "重量(g)")
                    cost = num(r, "成本")
                    price = num(r, "售价")
                    type_code = cell(r, "品类码")
                    type_name_in = cell(r, "品类")
                    type_code, type_name = _resolve_type(conn, type_code, type_name_in)
                    epc = _gen_type_epc(conn, type_code, sid)
                    conn.execute(
                        """INSERT INTO products(code,name,category,category_code,material,product_type,product_type_code,
                                               weight,size,cert,cost,price,status,store_id,rfid_epc)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'在库',?,?)""",
                        (code, name, type_name, type_code, cell(r, "材质"), type_name, type_code,
                         weight, cell(r, "规格"), cell(r, "证书号"), cost, price, sid, epc))
                    seen.add(code)
                    created += 1
                except ValueError as e:
                    failed.append({"row": idx, "code": code, "name": name, "reason": str(e)})
                except HTTPException:
                    raise
                except Exception as e:  # 单行意外异常记录后继续
                    failed.append({"row": idx, "code": code, "name": name, "reason": "行数据异常：" + str(e)[:60]})
            conn.commit()
            _log(conn, sess["username"], "批量导入商品", f"成功 {created} 条，失败 {len(failed)} 条")
            return {"ok": True, "created": created, "failed": failed, "total": created + len(failed)}

    return await run_in_threadpool(_work)


@app.get("/api/products/{pid}")
def product_detail(pid: int, request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        row = conn.execute(f"SELECT {_PRODUCT_COLS} FROM products WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "商品不存在")
        if row["store_id"] != sid:
            raise HTTPException(403, "该商品不属于当前工作门店")
        return _hide_cost(dict(row), _can_view_cost(conn, sess))


@app.post("/api/products")
def product_create(body: ProductIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        body.store_id = sid  # 商品建档强制落入当前工作门店（跨店请走调拨）
        type_code, type_name = _resolve_type(conn, body.product_type_code, body.product_type)
        _assert_locations_in_store(conn, body.store_id, body.location_id, body.cert_location_id)
        epc = (body.rfid_epc or "").strip()
        if not epc:
            epc = _gen_type_epc(conn, type_code, body.store_id)  # 新商品保存即自动生成 EPC
        cur = conn.execute(
            """INSERT INTO products(code,name,name_i18n,category,category_code,material,product_type,product_type_code,
                                     weight,size,cert,cost,price,status,store_id,rfid_epc,
                                     showcase_public,showcase_order,showcase_desc,origin,high_value,
                                     location_id,cert_location_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (body.code, body.name, body.name_i18n, body.category, body.category_code,
             _norm_material(body.material), type_name, type_code,
             body.weight, body.size, body.cert, body.cost, body.price, body.status, body.store_id, epc,
             body.showcase_public, body.showcase_order, body.showcase_desc, body.origin, body.high_value,
             body.location_id or 0, body.cert_location_id or 0),
        )
        _inv(conn, cur.lastrowid, epc, "in", op["username"], store_id=sid)
        conn.commit()
        _log(conn, op["username"], "新增商品", body.code)
        return {"id": cur.lastrowid, "rfid_epc": epc}


def _assert_product_in_store(conn: sqlite3.Connection, pid: int, sid: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        raise HTTPException(404, "商品不存在")
    if row["store_id"] != sid:
        raise HTTPException(403, "该商品不属于当前工作门店，请到所属门店操作")
    return row


@app.put("/api/products/{pid}")
def product_update(pid: int, body: ProductIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = _assert_product_in_store(conn, pid, sid)
        if row["status"] == "在途":
            raise HTTPException(400, "商品调拨在途中，验收完成后不可编辑")
        # 列级权限：无成本查看权的账号改商品时，忽略其提交的 cost，保留原值（前端字段 *** 禁用，此处兜底）
        if not _can_view_cost(conn, op):
            body.cost = row["cost"]
        body.store_id = sid  # 不允许借编辑跨店改归属
        type_code, type_name = _resolve_type(conn, body.product_type_code, body.product_type)
        _assert_locations_in_store(conn, body.store_id, body.location_id, body.cert_location_id)
        epc = (body.rfid_epc or "").strip() or row["rfid_epc"]
        conn.execute(
            """UPDATE products SET code=?,name=?,name_i18n=?,category=?,category_code=?,material=?,
               product_type=?,product_type_code=?,weight=?,size=?,cert=?,
               cost=?,price=?,status=?,store_id=?,rfid_epc=?,showcase_public=?,
               showcase_order=?,showcase_desc=?,origin=?,high_value=?,
               location_id=?,cert_location_id=? WHERE id=?""",
            (body.code, body.name, body.name_i18n, body.category, body.category_code,
             _norm_material(body.material), type_name, type_code,
             body.weight, body.size, body.cert, body.cost, body.price, body.status, body.store_id, epc,
             body.showcase_public, body.showcase_order, body.showcase_desc, body.origin, body.high_value,
             body.location_id or 0, body.cert_location_id or 0, pid),
        )
        conn.commit()
        _log(conn, op["username"], "修改商品", f"#{pid} {body.code}")
        return {"ok": True, "rfid_epc": epc}


@app.delete("/api/products/{pid}")
def product_delete(pid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = _assert_product_in_store(conn, pid, sid)
        if row["status"] not in ("在库",):
            raise HTTPException(400, "仅允许删除在库商品")
        conn.execute("DELETE FROM products WHERE id=?", (pid,))
        conn.commit()
        _log(conn, op["username"], "删除商品", f"#{pid}")
        return {"ok": True}


# ---------------------------------------------------------------- 商品图片（前端 Canvas 裁切后传 base64 JPEG）

class ProductImageIn(BaseModel):
    data: str  # data:image/jpeg;base64,....


def _decode_image_data(data: str) -> bytes:
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception:
        raise HTTPException(400, "图片数据无效")
    if len(raw) < 64 or len(raw) > 3 * 1024 * 1024:
        raise HTTPException(400, "图片大小需在 3MB 以内")
    if raw[:2] != b"\xff\xd8":
        raise HTTPException(400, "仅支持 JPEG 图片")
    return raw


@app.put("/api/products/{pid}/image")
def product_image_update(pid: int, body: ProductImageIn, request: Request):
    op = _require_auth(request)
    raw = _decode_image_data(body.data)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_product_in_store(conn, pid, sid)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("UPDATE products SET image=?, image_ts=? WHERE id=?", (raw, ts, pid))
        conn.commit()
        _log(conn, op["username"], "上传商品图片", f"#{pid}")
        return {"ok": True, "image_ts": ts}


@app.delete("/api/products/{pid}/image")
def product_image_delete(pid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_product_in_store(conn, pid, sid)
        conn.execute("UPDATE products SET image=NULL, image_ts='' WHERE id=?", (pid,))
        conn.commit()
        _log(conn, op["username"], "删除商品图片", f"#{pid}")
        return {"ok": True}


@app.get("/api/products/{pid}/image")
def product_image_get(pid: int, request: Request):
    """公开读取（橱窗/外部分享页 <img> 无鉴权头），用 image_ts 做缓存标识。"""
    with _db(request) as conn:
        row = conn.execute("SELECT image,image_ts FROM products WHERE id=?", (pid,)).fetchone()
        if not row or not row["image"]:
            raise HTTPException(404, "暂无图片")
        return Response(
            content=bytes(row["image"]),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache", "ETag": f'"{row["image_ts"]}"'},
        )


class PrintLabelIn(BaseModel):
    template: str = "fold"
    copies: int = 1


@app.post("/api/products/{pid}/print-label")
def product_print_label(pid: int, body: PrintLabelIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "商品不存在")
        if not row["rfid_epc"]:
            _assert_stock_unfrozen(conn)
        epc = row["rfid_epc"] or _gen_epc(row["code"])
        conn.execute("UPDATE products SET rfid_epc=? WHERE id=?", (epc, pid))
        _inv(conn, pid, epc, "rfid", op["username"], body.copies)
        conn.commit()
        _log(conn, op["username"], "RFID标签打印", f"{row['code']} {epc}")
        return {"ok": True, "rfid_epc": epc,
                "product": _hide_cost(dict(row) | {"rfid_epc": epc}, _can_view_cost(conn, op)),
                "copies": body.copies, "template": body.template}


# ---------------------------------------------------------------- 库存 / RFID

@app.get("/api/inventory/summary")
def inventory_summary(request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        cost_visible = _can_view_cost(conn, sess)
        def cnt(st):
            r = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(cost),0) c FROM products WHERE status=? AND store_id=?",
                             (st, sid)).fetchone()
            return {"count": r["n"], "cost": round(r["c"], 2) if cost_visible else None}
        logs = conn.execute(
            "SELECT * FROM inventory_logs WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT 30",
            (sid,)).fetchall()
        return {
            "inStock": cnt("在库"),
            "inTransit": cnt("在途"),  # 已发出待验收，资产仍归调出店
            "reserved": cnt("已定"),
            "loaned": cnt("借出"),
            "sold": cnt("已售"),
            "logs": [dict(r) for r in logs],
        }


class InboundIn(BaseModel):
    code: str = ""
    name: str
    store_id: int = 0
    category: str = ""
    category_code: str = ""
    product_type: str = ""
    product_type_code: str = "99"
    material: str = ""
    weight: float = 0
    size: str = ""
    cert: str = ""
    cost: float = 0
    price: float = 0
    rfid_epc: str = ""
    biz_date: str = ""
    location_id: int = 0
    cert_location_id: int = 0


@app.post("/api/inventory/inbound")
def inventory_inbound(body: InboundIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        store_id = sid  # 入库门店强制为当前工作门店
        store = conn.execute("SELECT id,name FROM stores WHERE id=?", (store_id,)).fetchone()
        if not store:
            raise HTTPException(400, "入库门店不存在")
        code = body.code.strip() or _next_code(conn)
        if conn.execute("SELECT 1 FROM products WHERE code=?", (code,)).fetchone():
            raise HTTPException(400, "商品编码已存在")
        type_code, type_name = _resolve_type(conn, body.product_type_code, body.product_type)
        _assert_locations_in_store(conn, store_id, body.location_id, body.cert_location_id)
        epc = (body.rfid_epc or "").strip() or _gen_type_epc(conn, type_code, store_id)
        cur = conn.execute(
            """INSERT INTO products(code,name,category,category_code,material,product_type,product_type_code,
                                    weight,size,cert,cost,price,status,store_id,rfid_epc,showcase_public,
                                    location_id,cert_location_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'在库',?, ?,0,?,?)""",
            (code, body.name, body.category, body.category_code, _norm_material(body.material),
             type_name, type_code, body.weight, body.size, body.cert, body.cost, body.price,
             store_id, epc, body.location_id or 0, body.cert_location_id or 0),
        )
        _inv(conn, cur.lastrowid, epc, "in", op["username"], store_id=store_id)
        conn.commit()
        _log(conn, op["username"], "入库登记", f"{store['name']} {code}")
        return {"id": cur.lastrowid, "code": code, "rfid_epc": epc}


@app.post("/api/inventory/copy/{pid}")
def inventory_copy(pid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        src = _assert_product_in_store(conn, pid, sid)
        code = _next_code(conn)
        type_code = src["product_type_code"] or "99"
        epc = _gen_type_epc(conn, type_code, sid)
        cur = conn.execute(
            """INSERT INTO products(code,name,name_i18n,category,category_code,material,product_type,product_type_code,
                                    weight,size,cert,cost,price,status,store_id,rfid_epc,showcase_public,origin,high_value)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'在库',?, ?,0,?,?)""",
            (code, src["name"], src["name_i18n"], src["category"], src["category_code"],
             _norm_material(src["material"]),
             src["product_type"], type_code, src["weight"], src["size"], src["cert"], src["cost"], src["price"],
             sid, epc, src["origin"], src["high_value"]),
        )
        _inv(conn, cur.lastrowid, epc, "in", op["username"], store_id=sid)
        conn.commit()
        _log(conn, op["username"], "复制入库", f"{src['code']}→{code}")
        return {"id": cur.lastrowid, "code": code, "rfid_epc": epc}


# ---------------------------------------------------------------- 门店调拨
# 两步制：发出（商品转「在途」冻结，store_id 不动）→ 调入方逐件验收（相符入库/不符退回）。
# EPC 终身码：全程只改 products.store_id，绝不重写 rfid_epc。

def _next_transfer_no(conn: sqlite3.Connection) -> str:
    d = date.today().strftime("%Y%m%d")
    row = conn.execute("SELECT MAX(transfer_no) m FROM transfers WHERE transfer_no LIKE ?",
                       (f"DB{d}%",)).fetchone()
    seq = int(row["m"][-3:]) + 1 if row["m"] else 1
    return f"DB{d}{seq:03d}"


class TransferIn(BaseModel):
    to_store_id: int
    product_ids: list[int] = Field(default_factory=list)
    scan_codes: list[str] = Field(default_factory=list)  # 批量扫码（EPC/条码/货号混合）
    remark: str = ""


class ReceiveItem(BaseModel):
    product_id: int
    ok: bool
    reason: str = ""


class TransferReceiveIn(BaseModel):
    items: list[ReceiveItem] = Field(default_factory=list)
    scan_codes: list[str] = Field(default_factory=list)  # 验收端扫到的 EPC/条码/货号 → 自动 ok


@app.post("/api/transfers")
def transfer_create(body: TransferIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        # 扫码入参先 resolve 成 product_ids（与原 product_ids 合并）
        # 注意：EPC / 货号 / 条码 三种码可能 resolve 到同一件商品 → pid 维度去重
        scan_pids: list[int] = []
        seen_pid = set()
        seen_raw = set()
        pid_set = set(body.product_ids or [])
        for s in (body.scan_codes or []):
            s2 = (s or "").strip()
            if not s2 or s2 in seen_raw:
                continue
            seen_raw.add(s2)
            p = _resolve_product(conn, s2, sid)
            if not p:
                raise HTTPException(400, f"扫描的码 {s2} 未登记、不存在或不属于当前门店，无法调拨")
            # 已在 product_ids 里的跳过，避免前端勾选+扫码双路径提交同一商品导致重复
            if p["id"] in seen_pid or p["id"] in pid_set:
                continue
            seen_pid.add(p["id"])
            scan_pids.append(p["id"])
        raw_ids = (list(body.product_ids or []) + scan_pids)
        if not raw_ids:
            raise HTTPException(400, "请选择或扫码调拨商品")
        if len(raw_ids) > 50:
            raise HTTPException(400, "单次调拨最多 50 件")
        ids = list(dict.fromkeys(raw_ids))  # 去重保序
        if len(ids) != len(raw_ids):
            raise HTTPException(400, "调拨商品存在重复选择")
        qmarks = ",".join("?" * len(ids))
        prods = conn.execute(
            f"SELECT * FROM products WHERE id IN ({qmarks})", ids).fetchall()
        if len(prods) != len(ids):
            raise HTTPException(400, "部分商品不存在")
        from_ids = {p["store_id"] for p in prods}
        if len(from_ids) != 1:
            raise HTTPException(400, "一次调拨只能选择同一门店的商品")
        from_sid = from_ids.pop()
        if from_sid != sid:
            raise HTTPException(403, "所选商品不属于当前工作门店，不能跨店发起调拨")
        if from_sid == body.to_store_id:
            raise HTTPException(400, "调入门店必须与调出门店不同")
        # 调入门店须真实存在（允许调给本人未被授权的门店，业务上本就是发给别的店）
        if not conn.execute("SELECT 1 FROM stores WHERE id=?", (body.to_store_id,)).fetchone():
            raise HTTPException(400, "调入门店不存在")
        bad = next((p for p in prods if p["status"] != "在库"), None)
        if bad:
            raise HTTPException(400, f"商品 {bad['code']} 当前状态为{bad['status']}，无法调拨")
        no = _next_transfer_no(conn)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cur = conn.execute(
            """INSERT INTO transfers(transfer_no,from_store_id,to_store_id,status,total_count,
                                     matched_count,diff_count,remark,created_by,sent_at,created)
               VALUES(?,?,?, '在途', ?,0,0,?,?,?,?)""",
            (no, from_sid, body.to_store_id, len(ids), (body.remark or "").strip()[:200],
             op["username"], now, now))
        tid = cur.lastrowid
        conn.executemany(
            "INSERT INTO transfer_items(transfer_id,product_id,epc,product_name,result) VALUES(?,?,?,?,'')",
            [(tid, p["id"], p["rfid_epc"] or "", p["name"] or "") for p in prods])
        conn.execute(f"UPDATE products SET status='在途' WHERE id IN ({qmarks})", ids)
        for p in prods:
            _inv(conn, p["id"], p["rfid_epc"], "transfer_out", op["username"], store_id=sid)
        conn.commit()
        _log(conn, op["username"], "调拨发出", f"{no}（{len(ids)}件）")
        return {"id": tid, "transfer_no": no}


def _transfer_list_rows(conn, where: str, args: list, limit: int, offset: int):
    sql = f"""
        SELECT t.*, fs.name from_store_name, ts.name to_store_name
        FROM transfers t
        JOIN stores fs ON fs.id=t.from_store_id
        JOIN stores ts ON ts.id=t.to_store_id
        {where}
        ORDER BY t.id DESC LIMIT ? OFFSET ?"""
    return conn.execute(sql, args + [limit, offset]).fetchall()


@app.get("/api/transfers")
def transfer_list(request: Request, scope: str = "out", status: str = "",
                  store_id: int = 0, page: int = 1, size: int = 50):
    """调拨单列表。scope=out 当前店调出视角 / in 当前店调入视角；严格按当前工作门店收敛。"""
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        where, args = [], []
        dir_col = "t.to_store_id" if scope == "in" else "t.from_store_id"
        where.append(f"{dir_col}=?")
        args.append(sid)
        if status:
            where.append("t.status=?")
            args.append(status)
        cond = ("WHERE " + " AND ".join(where)) if where else ""
        total = conn.execute(
            f"SELECT COUNT(*) n FROM transfers t {cond}", args).fetchone()["n"]
        rows = _transfer_list_rows(conn, cond, args, size, (page - 1) * size)
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.get("/api/transfers/{tid}")
def transfer_detail(tid: int, request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        t = conn.execute(
            """SELECT t.*, fs.name from_store_name, ts.name to_store_name
               FROM transfers t
               JOIN stores fs ON fs.id=t.from_store_id
               JOIN stores ts ON ts.id=t.to_store_id
               WHERE t.id=?""", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "调拨单不存在")
        if t["from_store_id"] != sid and t["to_store_id"] != sid:
            raise HTTPException(403, "该调拨单与当前工作门店无关")
        items = conn.execute(
            """SELECT i.*, p.code product_code, p.status product_status, p.store_id product_store_id
               FROM transfer_items i JOIN products p ON p.id=i.product_id
               WHERE i.transfer_id=? ORDER BY i.id""", (tid,)).fetchall()
        d = dict(t)
        d["items"] = [dict(r) for r in items]
        return d


@app.post("/api/transfers/{tid}/receive")
def transfer_receive(tid: int, body: TransferReceiveIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        t = conn.execute("SELECT * FROM transfers WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "调拨单不存在")
        if t["to_store_id"] != sid:
            raise HTTPException(403, "该调拨单不是发往当前工作门店的，无权验收")
        if t["status"] != "在途":
            raise HTTPException(400, f"该调拨单状态为{t['status']}，不可重复验收")
        db_items = conn.execute(
            "SELECT * FROM transfer_items WHERE transfer_id=? ORDER BY id", (tid,)).fetchall()
        # 扫码入参 resolve 成 ReceiveItem（默认 ok=True）
        merged_items = list(body.items or [])
        seen_pid = {it.product_id for it in merged_items}
        for s in (body.scan_codes or []):
            s2 = (s or "").strip()
            if not s2:
                continue
            p = _resolve_product(conn, s2)
            if not p:
                raise HTTPException(400, f"验收扫码 {s2} 未登记或不存在")
            if p["id"] in seen_pid:
                continue
            seen_pid.add(p["id"])
            merged_items.append(ReceiveItem(product_id=p["id"], ok=True, reason=""))
        # 必须与调拨明细完全一致（前端若扫漏，会把"未扫到的"当不符处理）
        scan_pids_ok = {it.product_id: it.ok for it in merged_items}
        if set(scan_pids_ok) != {i["product_id"] for i in db_items}:
            # 把调拨明细里未被扫到的自动补为不符，要求前端填写原因
            missing = [i for i in db_items if i["product_id"] not in scan_pids_ok]
            raise HTTPException(400,
                f"验收明细必须与调拨明细完全一致：未扫到 {len(missing)} 件，请继续扫码或标记不符（{', '.join(str(i['product_id']) for i in missing[:3])}{'...' if len(missing) > 3 else ''}）")
        decisions = {it.product_id: it for it in merged_items}
        # 先全量校验（不符必填原因），通过后再写库，保证事务原子
        for i in db_items:
            d = decisions[i["product_id"]]
            if not d.ok and not (d.reason or "").strip():
                raise HTTPException(400, f"商品 {i['product_name']} 标记不符时必须填写原因")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        matched = diff = 0
        for i in db_items:
            d = decisions[i["product_id"]]
            if d.ok:
                cur = conn.execute(
                    "UPDATE products SET store_id=?, status='在库' WHERE id=? AND status='在途'",
                    (t["to_store_id"], i["product_id"]))
                if cur.rowcount != 1:
                    raise HTTPException(400, f"商品 {i['product_name']} 已不在在途状态，验收中止")
                conn.execute(
                    "UPDATE transfer_items SET result='相符', received_at=? WHERE id=?",
                    (now, i["id"]))
                _inv(conn, i["product_id"], i["epc"], "transfer_in", op["username"])
                matched += 1
            else:
                cur = conn.execute(
                    "UPDATE products SET status='在库' WHERE id=? AND status='在途'",
                    (i["product_id"],))
                if cur.rowcount != 1:
                    raise HTTPException(400, f"商品 {i['product_name']} 已不在在途状态，验收中止")
                conn.execute(
                    "UPDATE transfer_items SET result='不符', diff_reason=?, received_at=? WHERE id=?",
                    ((d.reason or "").strip()[:100], now, i["id"]))
                _inv(conn, i["product_id"], i["epc"], "transfer_back", op["username"])
                diff += 1
        new_status = "已完成" if diff == 0 else "部分完成"
        conn.execute(
            "UPDATE transfers SET status=?, matched_count=?, diff_count=?, received_by=?, received_at=? WHERE id=?",
            (new_status, matched, diff, op["username"], now, tid))
        conn.commit()
        _log(conn, op["username"], "调拨验收",
             f"{t['transfer_no']} 相符{matched}件" + (f" 不符{diff}件" if diff else ""))
        return {"id": tid, "status": new_status, "matched": matched, "diff": diff}


class RfidScanIn(BaseModel):
    epcs: list[str] = Field(default_factory=list)
    simulate: bool = False


@app.post("/api/inventory/rfid-scan")
def rfid_scan(body: RfidScanIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        book = conn.execute(
            "SELECT * FROM products WHERE status IN ('在库','已定','借出') AND rfid_epc!='' AND store_id=?",
            (sid,)).fetchall()
        book_map = {r["rfid_epc"]: dict(r) for r in book}
        epcs = [e.strip() for e in body.epcs if e and e.strip()]
        if body.simulate and not epcs:
            epcs = list(book_map.keys())
        scanned = []
        seen = set()
        for epc in epcs:
            if epc in seen:
                continue
            seen.add(epc)
            _inv(conn, book_map.get(epc, {}).get("id"), epc, "scan", op["username"], store_id=sid)
            if epc in book_map:
                p = book_map[epc]
                scanned.append({"epc": epc, "product": p["name"], "code": p["code"], "status": p["status"], "result": "账实相符"})
            # 未登记标签（盘盈）：不再记录入库，直接忽略
        shortage = []
        for epc, p in book_map.items():
            if epc not in seen:
                shortage.append({"epc": epc, "product": p["name"], "code": p["code"], "status": p["status"], "result": "盘亏"})
        conn.commit()
        _log(conn, op["username"], "RFID隔空盘点", f"感应{len(seen)} 盘亏{len(shortage)}")
        return {
            "scannedCount": len(seen),
            "bookCount": len(book_map),
            "matched": scanned,
            "surplus": [],
            "shortage": shortage,
            "items": scanned + shortage,
        }


# ---------------------------------------------------------------- 标签排版打印

@app.get("/api/print/printers")
def print_printers(request: Request):
    _require_auth(request)
    names = rfid_print.list_printers()
    return {"supported": bool(names), "printers": names}


class LabelPrintIn(BaseModel):
    product_ids: list[int] = Field(default_factory=list)
    printer: str = ""
    copies: int = 1
    fields: list[str] = Field(default_factory=lambda: sorted(rfid_print.DEFAULT_FIELDS))
    write_epc: bool = True
    font: str = rfid_print.DEFAULT_FONT
    simulate: bool = False  # True 时只生成 ZPL 不实际发送
    template_id: int | None = None  # 指定模板后按模板 slots 排版，忽略 fields
    route: str = ""  # 'agent'=经本地打印桥下发（店里电脑 print_agent.py 取任务打印）


@app.post("/api/print/labels")
def print_labels(body: LabelPrintIn, request: Request):
    op = _require_auth(request)
    if not body.product_ids:
        raise HTTPException(400, "请至少选择一件商品")
    with _db(request) as conn:
        prof = conn.execute("SELECT name FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        store_name = prof["name"] if prof and prof["name"] else ""
        rows = conn.execute(
            f"SELECT * FROM products WHERE id IN ({','.join('?' * len(body.product_ids))})",
            body.product_ids,
        ).fetchall()
        if len(rows) != len(set(body.product_ids)):
            raise HTTPException(404, "部分商品不存在")
        products = [dict(r) for r in rows]
        for p in products:
            p.pop("image", None)

        # 模板解析：显式 template_id 对全部商品生效；否则每件商品按自身品类绑定的模板逐件解析
        explicit_tpl = None
        if body.template_id:
            tpl = conn.execute("SELECT * FROM label_templates WHERE id=?", (body.template_id,)).fetchone()
            if tpl:
                explicit_tpl = dict(tpl)

        def _bound_tpl(type_code: str):
            if not type_code:
                return None
            row = conn.execute(
                "SELECT lt.* FROM product_types pt JOIN label_templates lt ON lt.id = pt.label_template_id WHERE pt.code=?",
                (type_code,),
            ).fetchone()
            return dict(row) if row else None

        jobs = []
        if any(not p.get("rfid_epc") for p in products):
            _assert_stock_unfrozen(conn)
        for p in products:
            epc = p.get("rfid_epc") or _gen_type_epc(conn, p.get("product_type_code") or "99", p.get("store_id") or 1)
            if not p.get("rfid_epc"):
                conn.execute("UPDATE products SET rfid_epc=? WHERE id=?", (epc, p["id"]))
            p["rfid_epc"] = epc
            bc = _compute_item_barcode(conn, p)
            conn.execute("UPDATE products SET barcode=? WHERE id=?", (bc, p["id"]))
            p["barcode"] = bc
            _inv(conn, p["id"], epc, "rfid", op["username"], body.copies)
            jobs.append({"id": p["id"], "code": p["code"], "name": p["name"], "rfid_epc": epc, "barcode": bc})

        # 逐件生成：显式模板优先，否则按各商品品类绑定模板，无模板回退默认字段布局
        fields = {f for f in body.fields if f in rfid_print.FIELD_OPTIONS}
        copies = max(1, body.copies)
        epc_prefix_cfg, _ = _epc_cfg(conn)
        zpl_parts = []
        per_store: dict[int, list[str]] = {}   # store_id -> 该门店商品的 ZPL 列表
        used_template_ids = set()
        for p in products:
            tpl_i = explicit_tpl or _bound_tpl(p.get("product_type_code") or "")
            if tpl_i:
                used_template_ids.add(tpl_i["id"])
                one = rfid_print.build_label_zpl(
                    p, store_name=store_name, write_epc=body.write_epc, template=tpl_i,
                    rfid_prefix=epc_prefix_cfg,
                )
            else:
                one = rfid_print.build_label_zpl(
                    p, fields=fields, store_name=store_name,
                    font=(body.font or ""), write_epc=body.write_epc,
                    rfid_prefix=epc_prefix_cfg,
                )
            z0 = one.replace("^PQ1", f"^PQ{copies}")
            zpl_parts.append(z0)
            per_store.setdefault(p.get("store_id") or 1, []).append(z0)
        zpl = "".join(zpl_parts)
        tpl_desc = f" 模板#{explicit_tpl['id']}" if explicit_tpl else (" 各自品类模板" if used_template_ids else "")

        sent = False
        printer_desc = body.printer or ""
        if not body.simulate:
            if body.route == "agent":
                # 按商品所属门店分组，路由到各自门店的打印桥；
                # 任务带「标签业务(label_product)」在该门店指派的打印机名
                stores_cfg: dict[int, dict] = {}
                for sid0 in per_store:
                    srow = conn.execute(
                        "SELECT name FROM stores WHERE id=?", (sid0,)).fetchone()
                    bmap = _biz_printer_map(conn, sid0)
                    stores_cfg[sid0] = {
                        "name": srow["name"] if srow else f"门店{sid0}",
                        "printer": bmap.get("label_product", "") or "",
                    }
                with _bridges_lock:
                    missing = [c["name"] for sid0, c in stores_cfg.items()
                               if sid0 not in _bridges
                               or time.time() - _bridges[sid0].last_seen >= 15]
                if missing:
                    raise HTTPException(400, "打印代理不在线：" + "、".join(missing))
                for sid0, parts in per_store.items():
                    _bridge_enqueue(sid0, "".join(parts), len(parts),
                                    biz="label_product", printer=stores_cfg[sid0]["printer"])
                sent = True
                printer_desc = "打印桥（" + "、".join(stores_cfg[s]["name"] for s in per_store) + "）"
            else:
                if not body.printer:
                    raise HTTPException(400, "未选择打印机（无打印机时可勾选“仅生成指令”）")
                try:
                    rfid_print.send_raw(body.printer, zpl, job_title=f"jewelry-labels-{len(jobs)}")
                    sent = True
                except Exception as e:
                    raise HTTPException(500, f"发送打印机失败：{e}")
        conn.commit()
        _log(conn, op["username"], "RFID标签打印",
             f"{len(jobs)}件×{body.copies}张 {printer_desc or '仅生成指令'}" + tpl_desc)
        return {
            "ok": True, "sent": sent, "count": len(jobs) * body.copies,
            "printer": printer_desc, "jobs": jobs, "zpl": zpl,
            "template_id": explicit_tpl["id"] if explicit_tpl else None,
        }


# ---------------------------------------------------------------- 本地打印桥（门店级，多代理）
# 每个门店一把桥接密钥（stores.bridge_key）；代理以密钥连接 /ws/print-agent，
# 连接即上报本机全部打印机；门店在云端「按打印业务」指派打印机（store_printers，
# 多个业务可指向同一台）；打印任务按商品 store_id 路由，任务内带业务码与指派打印机名。


def _biz_printer_map(conn, sid: int) -> dict:
    """门店各打印业务 -> 打印机名（db.PRINT_BIZ 全量，未指派为空串）。"""
    rows = conn.execute(
        "SELECT biz_code,printer_name FROM store_printers WHERE store_id=?", (sid,)).fetchall()
    have = {r["biz_code"]: (r["printer_name"] or "") for r in rows}
    return {code: have.get(code, "") or "" for code in db.PRINT_BIZ_CODES}


class _Bridge:
    __slots__ = ("ws", "loop", "name", "printers", "last_seen", "last_job")

    def __init__(self, ws, loop, name: str):
        self.ws = ws
        self.loop = loop
        self.name = name
        self.printers: list[str] = []
        self.last_seen = time.time()
        self.last_job: dict | None = None


_bridges: dict[int, _Bridge] = {}              # store_id -> 代理连接
_bridges_lock = threading.Lock()
_bridge_results: dict[str, dict] = {}          # control_id -> 回执
_bridge_waiters: dict[str, threading.Event] = {}
_bridge_seq = [0]


def _bridge_send(sid: int, payload: dict) -> None:
    """同步上下文向门店代理推送消息（跨线程投递到其事件循环）。"""
    with _bridges_lock:
        b = _bridges.get(sid)
    if b is None:
        raise RuntimeError("打印桥不在线")
    fut = asyncio.run_coroutine_threadsafe(
        b.ws.send_text(json.dumps(payload, ensure_ascii=False)), b.loop)
    fut.result(timeout=10)


def _bridge_enqueue(sid: int, zpl: str, count: int,
                    biz: str = "label_product", printer: str = "") -> str:
    with _bridges_lock:
        _bridge_seq[0] += 1
        jid = f"PJ{_bridge_seq[0]:06d}"
    _bridge_send(sid, {"type": "job", "job": {"job_id": jid, "zpl": zpl,
                                              "title": "jewelry-labels", "count": count,
                                              "biz": biz, "printer": printer}})
    return jid


def _build_test_zpl(store_name: str, printer: str) -> str:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sn = str(store_name or "").replace("^", " ").replace("~", " ")
    pn = str(printer or "").replace("^", " ").replace("~", " ")
    code = ts.replace("-", "").replace(":", "").replace(" ", "")
    return ("^XA^CI28^LH30,30"
            "^A0N,42,42^FDPrintBridge Test^FS"
            f"^A0N,32,32^FO30,60^FD{sn}^FS"
            f"^A0N,26,26^FO30,100^FD{pn or '-'}  {ts}^FS"
            f"^FO30,140^BY2^BCN,70,Y,N,N^FD{code}^FS"
            "^XZ")


@app.get("/api/print-agent/status")
def print_agent_status(request: Request):
    """各门店打印桥状态（供店铺管理与打印对话框轮询）。"""
    _require_auth(request)
    now = time.time()
    out = []
    with _db(request) as conn:
        rows = conn.execute(
            "SELECT id,name,code,printer_name,bridge_key FROM stores ORDER BY id").fetchall()
        # 连接关闭前预取每店的业务指派
        biz_maps = {r["id"]: _biz_printer_map(conn, r["id"]) for r in rows}
    with _bridges_lock:
        for r in rows:
            b = _bridges.get(r["id"])
            online = bool(b and now - b.last_seen < 15)
            biz_map = biz_maps[r["id"]]
            out.append({
                "store_id": r["id"], "store_name": r["name"], "code": r["code"],
                "online": online, "agent_name": (b.name if online else ""),
                "printers": list(b.printers) if online else [],
                "printer_name": biz_map.get("label_product", "") or r["printer_name"] or "",
                "biz": [{"code": c0, "printer": biz_map.get(c0, "")}
                        for c0 in db.PRINT_BIZ_CODES],
                "has_key": bool((r["bridge_key"] or "").strip()),
                "last_job": (dict(b.last_job) if online and b.last_job else None),
            })
    return {"bridges": out}


@app.get("/api/print-agent/download")
def print_agent_download():
    """下载打印代理：优先返回已构建的单文件 exe，未构建时返回 py 源码（需门店电脑有 Python）。"""
    exe = ROOT / "scripts" / "dist" / "PrintBridge.exe"
    if exe.is_file():
        return FileResponse(exe, filename="PrintBridge.exe",
                            media_type="application/vnd.microsoft.portable-executable")
    src = ROOT / "scripts" / "print_agent.py"
    return FileResponse(src, filename="print_agent.py", media_type="text/x-python")


_PA_BURN = None


def _pa_burn():
    """惰性加载 scripts/print_agent.py 取 embed_token_bytes（exe 尾部 overlay 烧录）。"""
    global _PA_BURN
    if _PA_BURN is None:
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "print_agent", str(ROOT / "scripts" / "print_agent.py"))
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            _PA_BURN = m.embed_token_bytes
        except Exception:
            _PA_BURN = False
    return _PA_BURN or None


@app.get("/api/stores/{sid}/agent-download")
def store_agent_download(sid: int, request: Request):
    """按门店下载已内嵌该店 Token 的打印代理 exe（管理员操作，Token 服务端注入，用户不可见）。"""
    _require_auth(request)
    with _db(request) as conn:
        r = conn.execute(
            "SELECT id,name,bridge_key FROM stores WHERE id=?", (sid,)).fetchone()
    if not r:
        raise HTTPException(404, "门店不存在")
    key = (r["bridge_key"] or "").strip()
    if not key:
        raise HTTPException(400, "该门店尚未生成密钥，请先点【生成/重置】")
    exe = ROOT / "scripts" / "dist" / "PrintBridge.exe"
    if not exe.is_file():
        raise HTTPException(404, "代理尚未打包：请先运行 scripts/build_exe.bat 生成 PrintBridge.exe")
    burn = _pa_burn()
    if not burn:
        raise HTTPException(500, "烧录模块加载失败")
    data = burn(exe.read_bytes(), key)
    fname = ("PrintBridge-"
             + re.sub(r'[\\/:*?"<>|\s]+', "_", (r["name"] or "").strip() or f"store{sid}")
             + ".exe")
    return Response(
        content=data,
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition":
                 "attachment; filename*=UTF-8''" + urllib.parse.quote(fname)})


@app.get("/api/stores/bridge-whoami")
def store_bridge_whoami(request: Request, key: str = ""):
    """代理人工确认用：凭门店 Token 换门店名称（免账号登录）。"""
    key = (key or "").strip()
    with _db(request) as conn:
        r = conn.execute("SELECT id,name FROM stores WHERE bridge_key=?", (key,)).fetchone()
    if not r:
        raise HTTPException(401, "门店 Token 无效")
    return {"store_id": r["id"], "store_name": r["name"]}


@app.get("/api/health/summary")
def health_summary(request: Request):
    """系统自检聚合接口（顶栏铃铛数据源）：
    防盗待处理事件数、盘点任务停滞、在库商品缺EPC、距上次盘点天数、客户欠款总额。"""
    _require_auth(request)
    with _db(request) as conn:
        pending = conn.execute(
            "SELECT COUNT(*) n FROM sensor_events WHERE event_type='alarm' AND handle_status='未处理'"
        ).fetchone()["n"]
        # 盘点任务停滞：进行中 且 30 分钟内无任何扫描上报与设备心跳
        stall = 0
        s = _active_session(conn)
        if s:
            r = conn.execute(
                "SELECT MAX(x) m FROM ("
                " SELECT MAX(scanned_at) x FROM task_scans WHERE task_id=?"
                " UNION ALL SELECT MAX(last_seen) FROM task_devices WHERE task_id=?"
                " UNION ALL SELECT ?)", (s["id"], s["id"], s["created"])).fetchone()
            idle = conn.execute(
                "SELECT (julianday('now','localtime')-julianday(?))*86400 d",
                (r["m"] or s["created"],)).fetchone()["d"]
            stall = 1 if (idle or 0) > 1800 else 0
        ep = conn.execute(
            "SELECT COUNT(*) t, IFNULL(SUM(CASE WHEN IFNULL(rfid_epc,'')='' THEN 1 ELSE 0 END),0) m"
            " FROM products WHERE status='在库'").fetchone()
        last_st = conn.execute("SELECT MAX(created) c FROM stocktakes").fetchone()["c"]
        st_days = (conn.execute(
            "SELECT CAST(julianday('now','localtime')-julianday(?) AS INTEGER) d",
            (last_st,)).fetchone()["d"] if last_st else None)
        due = conn.execute(
            "SELECT IFNULL(SUM(due_amount),0) d FROM customers").fetchone()["d"]
    return {"pending_events": pending, "task_stall": stall,
            "in_stock": ep["t"] or 0, "missing_epc": ep["m"] or 0,
            "last_stocktake_days": st_days, "credit_due": round(due or 0, 2)}


@app.post("/api/stores")
def store_create(body: dict, request: Request):
    _require_admin(request)
    name = str(body.get("name") or "").strip()
    code = str(body.get("code") or "").strip()
    if not name:
        raise HTTPException(400, "门店名称必填")
    if code:
        code_u = code.upper()
        if len(code_u) != 2 or not all(c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in code_u):
            raise HTTPException(400, "门店编码需为 2 位字母或数字（如 HQ、A1、06）；留空则自动生成")
        code = code_u
    with _db(request) as conn:
        shop_id = int(body.get("shop_id") or 0)
        if shop_id:
            if not conn.execute("SELECT 1 FROM shops WHERE id=?", (shop_id,)).fetchone():
                raise HTTPException(400, "所属店铺不存在")
        else:
            shop_id = conn.execute("SELECT id FROM shops ORDER BY id LIMIT 1").fetchone()["id"]
        try:
            cur = conn.execute(
                "INSERT INTO stores(name,code,owner,shop_id) VALUES(?,?,?,?)",
                (name, code or None, str(body.get("owner") or ""), shop_id))
            sid = cur.lastrowid
            if not code:
                code = f"{sid:02X}"
            # 新门店补齐每个打印业务的指派行（空指派）
            conn.executemany(
                "INSERT INTO store_printers(store_id,biz_code,printer_name) VALUES(?,?, '')",
                [(sid, c0) for c0 in db.PRINT_BIZ_CODES])
            conn.commit()
        except sqlite3.IntegrityError as e:
            msg = str(e)
            if "code" in msg.lower() or "UNIQUE constraint failed: stores.code" in msg:
                raise HTTPException(400, "门店编码已存在")
            raise HTTPException(400, "门店创建失败：数据约束冲突")
    return {"ok": True, "id": sid, "code": code}


@app.post("/api/stores/{sid}/bridge-key")
def store_bridge_key_rotate(sid: int, request: Request):
    """生成/重置门店 Token（旧 Token 立即失效）。"""
    _require_auth(request)
    key = secrets.token_urlsafe(18)
    with _db(request) as conn:
        if not conn.execute("SELECT id FROM stores WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "门店不存在")
        conn.execute("UPDATE stores SET bridge_key=? WHERE id=?", (key, sid))
        conn.commit()
    return {"key": key, "store_id": sid}


@app.post("/api/stores/{sid}/bind-printer")
def store_bind_printer(sid: int, body: dict, request: Request):
    """门店按打印业务指派打印机：upsert store_printers 并即时把全量指派推给在线代理。

    必须是同步端点：FastAPI 在线程池执行本函数，_bridge_send 才能跨线程
    投递到代理所在事件循环；若用 async 会在事件循环线程上自锁。
    body: {"biz": 业务码(默认label_product), "printer": 打印机名(空串=取消指派)}
    """
    _require_auth(request)
    biz = str(body.get("biz") or "label_product").strip()
    if biz not in db.PRINT_BIZ_CODES:
        raise HTTPException(400, "未知打印业务")
    printer = str(body.get("printer") or "").strip()
    with _db(request) as conn:
        if not conn.execute("SELECT id FROM stores WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "门店不存在")
        conn.execute(
            "INSERT INTO store_printers(store_id,biz_code,printer_name) VALUES(?,?,?)"
            " ON CONFLICT(store_id,biz_code) DO UPDATE SET printer_name=excluded.printer_name",
            (sid, biz, printer))
        if biz == "label_product":
            # 同步旧列：其他直接读 stores.printer_name 的链路保持一致
            conn.execute("UPDATE stores SET printer_name=? WHERE id=?", (printer, sid))
        conn.commit()
        bmap = _biz_printer_map(conn, sid)
    try:
        _bridge_send(sid, {"type": "config",
                           "printer": bmap.get("label_product", ""),
                           "biz_printers": bmap})
    except Exception:
        pass  # 代理离线时静默：重连后会收到 config 补推
    return {"ok": True, "biz": biz, "printer": printer}


@app.post("/api/stores/{sid}/print-control")
async def store_print_control(sid: int, body: dict, request: Request):
    """向门店代理下发控制指令：feed 进纸 / backfeed 退纸 / test 测试页 / refresh 重新搜索打印机。

    feed/backfeed 走标签业务(label_product)指派机；test 可带 biz 指向任意业务的指派打印机，
    用于逐台验证指派的打印机是否真的出纸。
    """
    _require_auth(request)
    action = str(body.get("action") or "")
    if action not in ("feed", "backfeed", "test", "refresh"):
        raise HTTPException(400, "未知控制指令")
    biz = str(body.get("biz") or "label_product").strip()
    if biz not in db.PRINT_BIZ_CODES:
        raise HTTPException(400, "未知打印业务")
    with _db(request) as conn:
        s = conn.execute("SELECT name FROM stores WHERE id=?", (sid,)).fetchone()
        bmap = _biz_printer_map(conn, sid)
    if not s:
        raise HTTPException(404, "门店不存在")
    with _bridges_lock:
        b = _bridges.get(sid)
        online = bool(b and time.time() - b.last_seen < 15)
    if not online:
        raise HTTPException(400, f"门店「{s['name']}」打印代理不在线")
    target_printer = bmap.get(biz, "") if action == "test" else bmap.get("label_product", "")
    payload: dict = {"type": "control", "action": action,
                     "biz": biz, "printer": target_printer}
    if action == "test":
        payload["zpl"] = _build_test_zpl(s["name"], target_printer)
    if action != "refresh":
        with _bridges_lock:
            _bridge_seq[0] += 1
            payload["control_id"] = f"C{_bridge_seq[0]:06d}"
        ev = threading.Event()
        with _bridges_lock:
            _bridge_waiters[payload["control_id"]] = ev
    try:
        await b.ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception as e:
        with _bridges_lock:
            _bridge_waiters.pop(payload.get("control_id"), None)
        raise HTTPException(400, f"发送失败：{e}")
    if action == "refresh":
        return {"ok": True, "action": action}
    ok = await asyncio.to_thread(_bridge_waiters[payload["control_id"]].wait, 12)
    with _bridges_lock:
        res = _bridge_results.pop(payload["control_id"], None)
        _bridge_waiters.pop(payload["control_id"], None)
    if not ok or not res:
        raise HTTPException(400, "打印桥未响应（超时 12 秒）")
    if not res.get("ok"):
        raise HTTPException(400, f"执行失败：{res.get('message') or '未知错误'}")
    return {"ok": True, "action": action}


@app.websocket("/ws/print-agent")
async def print_agent_ws(websocket: WebSocket, key: str = "", name: str = ""):
    """门店打印桥连接：key=门店Token（stores.bridge_key），一个门店一个代理连接。

    连接即上报本机打印机（hello）；云端回推绑定打印机（config）；
    任务/控制指令实时推送，回执经同一连接返回。
    """
    key = (key or "").strip()
    store = None
    biz_map: dict = {}
    if key:
        with _db(websocket) as conn:
            store = conn.execute(
                "SELECT id,name,printer_name FROM stores WHERE bridge_key=?", (key,)).fetchone()
            if store:
                biz_map = _biz_printer_map(conn, store["id"])
    await websocket.accept()
    if not store:
        await websocket.close(code=4401)
        return
    sid = store["id"]
    b = _Bridge(websocket, asyncio.get_running_loop(),
                (name or "").strip() or f"{store['name']}打印桥")
    with _bridges_lock:
        old = _bridges.get(sid)
        _bridges[sid] = b
    if old is not None:
        try:
            await old.ws.close()
        except Exception:
            pass

    stop = asyncio.Event()

    async def _push_config():
        await websocket.send_text(json.dumps(
            {"type": "config", "store_name": store["name"],
             "printer": biz_map.get("label_product", "") or store["printer_name"] or "",
             "biz_printers": dict(biz_map)}, ensure_ascii=False))

    async def _receiver():
        try:
            while True:
                msg = await websocket.receive_text()
                b.last_seen = time.time()
                try:
                    d = json.loads(msg)
                except Exception:
                    continue
                mtype = d.get("type")
                if mtype in ("hello", "printers"):
                    b.printers = [str(x) for x in (d.get("printers") or []) if str(x).strip()]
                    await _push_config()
                elif mtype == "heartbeat":
                    pass  # 每收到一帧已刷新 last_seen，心跳本身无需处理
                elif mtype == "ack":
                    # 打印任务回执：记录该桥最近一次任务结果（只代表已写入打印队列，
                    # 物理出纸仍需人眼确认——RAW 通道读不到硬件状态）
                    jid = str(d.get("job_id") or "")
                    if jid:
                        b.last_job = {"job_id": jid, "ok": bool(d.get("ok")),
                                      "message": str(d.get("message") or ""),
                                      "ts": datetime.now().strftime("%m-%d %H:%M:%S")}
                        continue
                    cid = str(d.get("control_id") or "")
                    if not cid:
                        continue
                    with _bridges_lock:
                        _bridge_results[cid] = {
                            "ok": bool(d.get("ok")), "message": str(d.get("message") or ""),
                        }
                        if len(_bridge_results) > 200:
                            for k in list(_bridge_results)[:100]:
                                _bridge_results.pop(k, None)
                        ev = _bridge_waiters.get(cid)
                    if ev:
                        ev.set()
        except Exception:
            stop.set()

    recv_task = asyncio.create_task(_receiver())
    try:
        await _push_config()
        # 在线状态完全以代理上报为准：hello + 每 5 秒心跳都会经 _receiver 刷新 last_seen；
        # 服务端不能自己刷新，否则代理静默掉线会被误判为在线。
        while not stop.is_set():
            await asyncio.sleep(5)
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        pass
    finally:
        stop.set()
        recv_task.cancel()
        with _bridges_lock:
            if _bridges.get(sid) is b:
                _bridges.pop(sid, None)


# ---------------------------------------------------------------- RFID 手持机盘点

# 盘点令牌：token -> (租户, 过期时间戳, 上传接口URL)
_stocktake_tokens: dict[str, tuple[str, float, str]] = {}
STOCKTAKE_TOKEN_TTL = 12 * 3600


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _db_for_tenant(tenant: str):
    return _db(SimpleNamespace(headers={"X-Resolved-Tenant-ID": tenant}))


def _next_batch_no(conn: sqlite3.Connection) -> str:
    return "PD" + datetime.now().strftime("%Y%m%d%H%M%S") + secrets.token_hex(1).upper()


def _run_stocktake(conn: sqlite3.Connection, epcs: list[str], device: str, operator: str,
                  commit: bool = True, store_id: int = 0) -> dict:
    """核心盘点：扫到的 EPC 集合对比账面，落库批次与明细，返回结果。

    store_id>0 时只盘点该门店的商品（协同盘点任务按发起门店隔离）；0 为旧版全租户盘点。
    commit=False 时不提交（供任务 submit/terminate 在同一事务内完成「终态抢占+报告+回填」，
    避免报告已落库但终态 CAS 失败而产生重复批次/脏流水），由调用方负责 commit 与操作日志。"""
    if store_id:
        book_rows = conn.execute(
            "SELECT * FROM products WHERE status IN ('在库','已定','借出') AND rfid_epc!='' AND store_id=?",
            (store_id,)).fetchall()
        all_rows = conn.execute(
            "SELECT * FROM products WHERE rfid_epc!='' AND store_id=?", (store_id,)).fetchall()
    else:
        book_rows = conn.execute(
            "SELECT * FROM products WHERE status IN ('在库','已定','借出') AND rfid_epc!=''"
        ).fetchall()
        all_rows = conn.execute("SELECT * FROM products WHERE rfid_epc!=''").fetchall()
    book_map = {r["rfid_epc"]: dict(r) for r in book_rows}
    all_map = {r["rfid_epc"]: dict(r) for r in all_rows}

    # 重复读取计数
    read_count: dict[str, int] = {}
    for e in epcs:
        read_count[e] = read_count.get(e, 0) + 1
    seen = list(dict.fromkeys(epcs))

    matched, shortage, abnormal = [], [], []
    for epc in seen:
        dup = read_count[epc] - 1
        if epc in book_map:
            p = book_map[epc]
            matched.append({"epc": epc, "code": p["code"], "product": p["name"],
                            "book_status": p["status"], "result": "相符", "dup_count": dup})
        elif epc in all_map:
            p = all_map[epc]
            abnormal.append({"epc": epc, "code": p["code"], "product": p["name"],
                             "book_status": p["status"], "result": f"异常（{p['status']}仍出现）", "dup_count": dup})
        # 未登记标签（盘盈）：不再记录入库/批次，直接忽略
    for epc, p in book_map.items():
        if epc not in seen:
            shortage.append({"epc": epc, "code": p["code"], "product": p["name"],
                             "book_status": p["status"], "result": "盘亏（未扫到）", "dup_count": 0})

    batch_no = _next_batch_no(conn)
    cur = conn.execute(
        """INSERT INTO stocktakes(batch_no,device,scanned_count,book_count,matched_count,
                                  surplus_count,shortage_count,abnormal_count,dup_count,operator,store_id)
           VALUES(?,?,?,?,?,0,?,?,?,?,?)""",
        (batch_no, device, len(seen), len(book_map), len(matched),
         len(shortage), len(abnormal),
         sum(v - 1 for v in read_count.values() if v > 1), operator, store_id or 0),
    )
    sid = cur.lastrowid
    for it in matched + shortage + abnormal:
        conn.execute(
            """INSERT INTO stocktake_items(stocktake_id,result,epc,product_id,code,product,book_status,dup_count)
               VALUES(?,?,?,?,?,?,?,?)""",
            (sid, it["result"], it["epc"],
             (book_map.get(it["epc"]) or all_map.get(it["epc"]) or {}).get("id"),
             it["code"], it["product"], it["book_status"], it["dup_count"]),
        )
        if it["epc"] in book_map:
            _inv(conn, book_map[it["epc"]]["id"], it["epc"], "scan", operator, store_id=store_id or 0)
    if commit:
        conn.commit()
        _log(conn, operator, "RFID批量盘点",
             f"{batch_no} 扫描{len(seen)} 盘亏{len(shortage)} 异常{len(abnormal)}")
    items = matched + abnormal + shortage
    return {
        "id": sid, "batch_no": batch_no, "device": device,
        "scannedCount": len(seen), "bookCount": len(book_map),
        "matchedCount": len(matched), "surplusCount": 0,
        "shortageCount": len(shortage), "abnormalCount": len(abnormal),
        "matched": matched, "surplus": [], "shortage": shortage, "abnormal": abnormal,
        "items": items,
    }


class StocktakeSetupIn(BaseModel):
    host: str = ""  # 可手工指定手持机能访问的主机（如 192.168.1.20:8002）


@app.post("/api/stocktake/setup")
def stocktake_setup(body: StocktakeSetupIn, request: Request):
    op = _require_auth(request)
    tenant = _tenant_of(request)
    token = secrets.token_urlsafe(18)
    _stocktake_tokens[token] = (tenant, time.time() + STOCKTAKE_TOKEN_TTL)
    # 清理过期令牌
    now = time.time()
    for k in [k for k, v in _stocktake_tokens.items() if v[1] < now]:
        _stocktake_tokens.pop(k, None)
    host = (body.host or "").strip().rstrip("/")
    if not host:
        host = f"{_lan_ip()}:{PORT}"
    if not host.startswith("http"):
        host = "http://" + host
    url = f"{host}/api/stocktake/upload?key={token}"
    _stocktake_tokens[token] = (tenant, time.time() + STOCKTAKE_TOKEN_TTL, url)
    return {"url": url, "token": token, "expires_in": STOCKTAKE_TOKEN_TTL,
            "page_url": f"{host}/stocktake/upload?key={token}", "operator": op["username"]}


@app.get("/api/stocktake/qr")
def stocktake_qr(token: str):
    """二维码内容即手持机上传接口地址（<img src> 直接加载，凭 token 访问）。"""
    rec = _stocktake_tokens.get(token)
    if not rec or rec[1] < time.time():
        raise HTTPException(403, "盘点二维码已过期，请重新生成")
    try:
        import io

        import qrcode
        from qrcode.image.svg import SvgImage
    except Exception:
        raise HTTPException(503, "服务端缺少 qrcode 依赖")
    img = qrcode.make(rec[2], image_factory=SvgImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


class StocktakeUploadIn(BaseModel):
    epcs: list[str] = Field(default_factory=list)
    device: str = ""


@app.post("/api/stocktake/upload")
def stocktake_upload(key: str, body: StocktakeUploadIn):
    """手持机调用：免登录，凭盘点 key 上传 EPC 列表。"""
    rec = _stocktake_tokens.get(key)
    if not rec:
        raise HTTPException(403, "盘点密钥无效，请在盘点页面重新获取二维码")
    if rec[1] < time.time():
        _stocktake_tokens.pop(key, None)
        raise HTTPException(403, "盘点密钥已过期，请重新获取二维码")
    tenant = rec[0]
    epcs = [e.strip().upper() for e in body.epcs if e and e.strip()]
    if not epcs:
        raise HTTPException(400, "未收到任何 EPC 数据")
    with _db_for_tenant(tenant) as conn:
        _assert_stock_unfrozen(conn)
        result = _run_stocktake(conn, epcs, body.device or "RFID手持机", "手持机")
    return {"ok": True, **result}


@app.get("/api/stocktake/list")
def stocktake_list(request: Request, limit: int = 10):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        rows = conn.execute(
            "SELECT * FROM stocktakes WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ?",
            (sid, max(1, min(limit, 50)))
        ).fetchall()
        return {"list": [dict(r) for r in rows]}


@app.get("/api/stocktake/{sid}")
def stocktake_detail(sid: int, request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        cur_sid, _ = _current_store(request, conn, sess)
        head = conn.execute("SELECT * FROM stocktakes WHERE id=?", (sid,)).fetchone()
        if not head:
            raise HTTPException(404, "盘点批次不存在")
        if head["store_id"] not in (0, cur_sid):
            raise HTTPException(403, "该盘点批次不属于当前工作门店")
        items = conn.execute(
            "SELECT * FROM stocktake_items WHERE stocktake_id=? ORDER BY id", (sid,)
        ).fetchall()
        return {"head": dict(head), "items": [dict(r) for r in items]}


_UPLOAD_PAGE = """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RFID 盘点上传</title>
<style>
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#0F3D33;color:#eaf4ee;padding:18px}
h2{font-size:19px;margin:4px 0 2px} .sub{color:#8fe0bc;font-size:12.5px;margin-bottom:16px}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(143,224,188,.25);border-radius:14px;padding:16px;margin-bottom:14px}
label{font-size:13px;display:block;margin:10px 0 6px}
input,textarea{width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(143,224,188,.35);
 background:rgba(0,0,0,.25);color:#fff;padding:10px;font-size:14px}
textarea{min-height:170px;line-height:1.7;letter-spacing:.5px}
button{width:100%;margin-top:14px;border:0;border-radius:11px;padding:13px;font-size:16px;font-weight:700;
 background:linear-gradient(135deg,#2fae82,#8fe0bc);color:#083025}
.r{margin-top:12px;font-size:13px;line-height:1.9} .ok{color:#8fe0bc}.err{color:#ffb4b4}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}td,th{border-bottom:1px solid rgba(255,255,255,.12);padding:6px 4px;text-align:left}
</style></head><body>
<h2>📡 RFID 批量盘点上传</h2><div class="sub">密钥已通过扫码自动带入 · 懿臻珠宝云</div>
<div class="card">
 <label>手持机 / 设备编号（选填）</label><input id="dev" placeholder="如 PDA-01">
 <label>扫描到的 EPC（每行一个，或用空格/逗号分隔）</label>
 <textarea id="epcs" placeholder="E28011606000020999A1C14501&#10;E280116060000205B85A1234"></textarea>
 <button onclick="up()">上传并生成盘点结果</button>
 <div id="r" class="r"></div>
</div>
<script>
var KEY = new URLSearchParams(location.search).get('key') || '';
function up(){
  var raw = document.getElementById('epcs').value;
  var epcs = raw.split(/[\\s,;]+/).map(function(s){return s.trim();}).filter(Boolean);
  var box = document.getElementById('r');
  if(!epcs.length){ box.innerHTML='<span class="err">请先录入 EPC</span>'; return; }
  box.innerHTML='正在上传盘点…';
  fetch('/api/stocktake/upload?key=' + encodeURIComponent(KEY), {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({epcs:epcs, device:document.getElementById('dev').value})
  }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
  .then(function(x){
    if(!x.ok){ box.innerHTML='<span class="err">'+(x.j.detail||'上传失败')+'</span>'; return; }
    var d=x.j, rows=d.items.map(function(it){
      return '<tr><td>'+it.result+'</td><td>'+(it.code||'')+'</td><td>'+(it.product||'')+'</td><td style="font-family:monospace;font-size:11px">'+it.epc+'</td></tr>';
    }).join('');
    box.innerHTML='<div class="ok">批次 '+d.batch_no+' 完成 ✔</div>'+
      '<div>扫描 <b>'+d.scannedCount+'</b> / 账面 <b>'+d.bookCount+'</b> · '+
      '相符 <b>'+d.matchedCount+'</b> · 盘盈 <b>'+d.surplusCount+'</b> · '+
      '盘亏 <b>'+d.shortageCount+'</b> · 异常 <b>'+d.abnormalCount+'</b></div>'+
      '<table><tr><th>结果</th><th>货号</th><th>商品</th><th>EPC</th></tr>'+rows+'</table>';
  }).catch(function(e){ box.innerHTML='<span class="err">网络错误：'+e+'</span>'; });
}
</script></body></html>"""


@app.get("/stocktake/upload", response_class=HTMLResponse)
def stocktake_upload_page(key: str):
    return HTMLResponse(_UPLOAD_PAGE)


# ------------------------------------------------- 统一工作任务（发起端，需登录）

def _next_task_no(conn: sqlite3.Connection) -> str:
    # 秒级时间戳 + 2 字节随机后缀，防止同秒发起多个任务撞 task_no 唯一约束
    return "RW" + time.strftime("%Y%m%d%H%M%S") + secrets.token_hex(2).upper()


def _next_type_seq(conn: sqlite3.Connection, store_id: int, ttype: str) -> int:
    """同店同功能的人类可读序号：取当前最大值 +1（永久递增、不复用、不补洞）。
    并发依赖 idx_tasks_type_seq 唯一索引兜底，插入撞号由调用方重试。"""
    row = conn.execute(
        "SELECT COALESCE(MAX(type_seq),0)+1 AS n FROM tasks WHERE store_id=? AND type=?",
        (store_id or 0, ttype)).fetchone()
    return int(row["n"])


def _active_session(conn: sqlite3.Connection):
    """统一任务引擎：进行中的盘点任务（冻结判定唯一数据源）。"""
    return conn.execute(
        "SELECT * FROM tasks WHERE type='stocktake' AND status='进行中' ORDER BY id DESC LIMIT 1"
    ).fetchone()


def _assert_stock_unfrozen(conn: sqlite3.Connection):
    """盘点任务进行中期间冻结一切改变库存的操作（销售、出入库、借还、状态变更）。
    任务一经关闭（提交完结/撤销/终止）立即解冻，无「待核对」中间态。"""
    s = _active_session(conn)
    if s:
        raise HTTPException(409, f"盘点任务 {s['task_no']} 进行中，库存操作已暂停，任务结束后恢复")


def _task_event(conn: sqlite3.Connection, task_id: int, event: str, actor: str, detail: str = ""):
    conn.execute(
        "INSERT INTO task_events(task_id,event,actor,detail) VALUES(?,?,?,?)",
        (task_id, event, actor, detail))


def _free_task_devices(conn: sqlite3.Connection, task_id: int):
    """任务关闭后释放所有设备的任务占用。"""
    conn.execute("UPDATE devices SET current_task_id=0 WHERE current_task_id=?", (task_id,))


def _task_device_online(last_seen: str, now: float) -> bool:
    """设备在线判定：任务内 last_seen 60 秒内（只信设备上报帧刷新）。"""
    try:
        ts = time.mktime(time.strptime(last_seen, "%Y-%m-%d %H:%M:%S"))
    except Exception:
        return False
    return (now - ts) <= 60


def _task_progress(conn: sqlite3.Connection, t) -> dict:
    """任务完整对象（含设备在线/进度/结果摘要），发起端渲染与轮询共用。"""
    devices = conn.execute(
        "SELECT device_no,name,source,last_seen,submitted FROM task_devices WHERE task_id=? ORDER BY device_no",
        (t["id"],)).fetchall()
    scanned = conn.execute(
        "SELECT COUNT(*) n FROM task_scans WHERE task_id=?", (t["id"],)).fetchone()["n"]
    now = time.time()
    dev_list = [{**dict(d), "online": _task_device_online(d["last_seen"], now)} for d in devices]
    result = None
    if t["result_id"]:
        r = conn.execute("SELECT * FROM stocktakes WHERE id=?", (t["result_id"],)).fetchone()
        if r:
            result = {"id": r["id"], "scannedCount": r["scanned_count"], "bookCount": r["book_count"],
                      "matchedCount": r["matched_count"], "surplusCount": r["surplus_count"],
                      "shortageCount": r["shortage_count"], "abnormalCount": r["abnormal_count"]}
    return {
        "id": t["id"], "task_no": t["task_no"], "type": t["type"],
        "type_seq": t["type_seq"] if "type_seq" in t.keys() else 0,
        "status": t["status"],
        "operator": t["initiator"], "started": t["created"], "ended": t["ended"],
        "closed_by": t["closed_by"], "scanned_count": scanned,
        "stats": _scan_stats(conn, t["id"]),
        "co_url": f"http://{_lan_ip()}:{PORT}/api/device/claim?key={t['task_key']}",
        "h5_url": f"http://{_lan_ip()}:{PORT}/stock.html?key={t['task_key']}",
        "devices": dev_list, "result": result,
    }


def _task_by_id(conn: sqlite3.Connection, tid: int):
    t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "任务不存在")
    return t


class TaskStartIn(BaseModel):
    type: str = "stocktake"
    host: str = ""
    title: str = ""


# 任务类型：stocktake=盘点（冻结库存，全局唯一进行中）；
# 其余为业务轻量扫码任务（不冻结库存，同店可多个并行，手持机从任务列表自由选择）
SCAN_TASK_TYPES = {"stocktake", "sale", "transfer_out", "transfer_in", "loan", "generic",
                  "epc_product", "epc_inbound"}


@app.post("/api/tasks/start")
def task_start(body: TaskStartIn, request: Request):
    """发起扫描任务。创建成功即同店广播 task_offer 给在线手持机与业务页面。"""
    op = _require_auth(request)
    ttype = (body.type or "stocktake").strip()
    if ttype not in SCAN_TASK_TYPES:
        raise HTTPException(400, "不支持的任务类型")
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        if ttype == "stocktake" and _active_session(conn):
            raise HTTPException(409, "已有盘点任务进行中，请先结束当前任务")
        task_no = _next_task_no(conn)
        key = secrets.token_urlsafe(18)
        title = (body.title or "").strip()
        # 同店同功能序号：Max+1 后插入，撞唯一索引则重取重试（不补洞、不复用）
        cur = None
        for _attempt in range(6):
            type_seq = _next_type_seq(conn, sid, ttype)
            try:
                cur = conn.execute(
                    "INSERT INTO tasks(task_no,task_key,type,type_seq,status,initiator,title,store_id) "
                    "VALUES(?,?,?,?,'进行中',?,?,?)",
                    (task_no, key, ttype, type_seq, op["username"], title, sid))
                break
            except sqlite3.IntegrityError:
                # 盘点全局唯一进行中的友好提示；其余视为序号撞号并重试
                if ttype == "stocktake" and _active_session(conn):
                    raise HTTPException(409, "已有盘点任务进行中，请先结束当前任务")
                cur = None
        if cur is None:
            raise HTTPException(409, "任务创建繁忙，请稍后重试")
        tid = cur.lastrowid
        _task_event(conn, tid, "create", op["username"])
        conn.commit()
        _log(conn, op["username"],
             "开启盘点任务" if ttype == "stocktake" else "发起扫码任务", task_no)
        host = (body.host or "").strip().rstrip("/")
        if not host:
            host = f"{_lan_ip()}:{PORT}"
        if not host.startswith("http"):
            host = "http://" + host
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        _broadcast_task_offer(conn, row)
        # 返回完整任务对象（含 devices/status/result 等），前端可直接渲染；co_url 供二维码使用
        return {**_task_progress(conn, row),
                "key": key,
                "co_url": f"{host}/api/device/claim?key={key}",
                "h5_url": f"{host}/stock.html?key={key}"}


@app.get("/api/tasks")
def tasks_list(request: Request, scope: str = "active", limit: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        if scope == "history":
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status!='进行中' AND (store_id=? OR store_id=0) "
                "ORDER BY id DESC LIMIT ?", (sid, limit)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status='进行中' AND (store_id=? OR store_id=0) "
                "ORDER BY id DESC LIMIT ?", (sid, limit)).fetchall()
        out = []
        for r in rows:
            n = conn.execute(
                "SELECT COUNT(*) n FROM task_scans WHERE task_id=?", (r["id"],)).fetchone()["n"]
            out.append({"id": r["id"], "task_no": r["task_no"], "type": r["type"],
                        "type_seq": r["type_seq"] if "type_seq" in r.keys() else 0,
                        "status": r["status"],
                        "operator": r["initiator"], "created": r["created"], "ended": r["ended"],
                        "closed_by": r["closed_by"], "result_id": r["result_id"], "scanned_count": n})
        return out


@app.get("/api/tasks/{tid}")
def task_detail(tid: int, request: Request):
    _require_auth(request)
    with _db(request) as conn:
        return _task_progress(conn, _task_by_id(conn, tid))


@app.post("/api/tasks/{tid}/cancel")
def task_cancel(tid: int, request: Request):
    """发起端撤销任务：作废不生成报告，立即解冻并释放设备占用。"""
    op = _require_auth(request)
    with _db(request) as conn:
        t = _task_by_id(conn, tid)
        cur = conn.execute(
            "UPDATE tasks SET status='已撤销', ended=datetime('now','localtime'), closed_by='initiator' "
            "WHERE id=? AND status='进行中'", (tid,))
        if cur.rowcount == 0:
            raise HTTPException(409, f"任务已{t['status']}，无法撤销")
        _free_task_devices(conn, tid)
        _task_event(conn, tid, "cancel", op["username"])
        conn.commit()
        _log(conn, op["username"], "撤销盘点任务", t["task_no"])
        _push_task_closed(t, "已撤销")
        return {"ok": True}


@app.post("/api/tasks/{tid}/terminate")
def task_terminate(tid: int, request: Request):
    """发起端终止任务：提前关闭；已有扫描数据时生成部分盘点报告。"""
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        t = _task_by_id(conn, tid)
        if t["store_id"] not in (0, sid):
            raise HTTPException(403, "该盘点任务不属于当前工作门店")
        # 先抢占终态（此时不写报告，避免双击/并发产生重复批次与库存流水）
        cur = conn.execute(
            "UPDATE tasks SET status='已终止', ended=datetime('now','localtime'), closed_by='initiator' "
            "WHERE id=? AND status='进行中'", (tid,))
        if cur.rowcount == 0:
            now_status = conn.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone()
            raise HTTPException(409, f"任务已{now_status['status'] if now_status else t['status']}，无法终止")
        # 抢占成功后再生成部分报告（延迟提交，与终态/回填同一事务落库）
        epcs = [r["epc"] for r in conn.execute(
            "SELECT epc FROM task_scans WHERE task_id=? ORDER BY id", (tid,)).fetchall()]
        result = _run_stocktake(
            conn, epcs, f"任务{t['task_no']}", op["username"], commit=False,
            store_id=t["store_id"] or 0) if epcs else None
        if result:
            conn.execute("UPDATE tasks SET result_id=? WHERE id=?", (result["id"], tid))
        _free_task_devices(conn, tid)
        _task_event(conn, tid, "terminate", op["username"],
                    f"扫描{len(epcs)}条" + ("，已生成部分报告" if result else ""))
        conn.commit()
        _log(conn, op["username"], "终止盘点任务", t["task_no"] + (f" 扫描{len(epcs)}" if epcs else ""))
        _push_task_closed(t, "已终止")
        return {"ok": True, "result": {"id": result["id"], "scannedCount": result["scannedCount"],
                                       "matchedCount": result["matchedCount"],
                                       "shortageCount": result["shortageCount"],
                                       "abnormalCount": result["abnormalCount"]} if result else None}


@app.get("/api/tasks/{tid}/report")
def task_report(tid: int, request: Request):
    """事后复盘：已完成/已终止任务的盘点差异报告（只读）。"""
    _require_auth(request)
    with _db(request) as conn:
        t = _task_by_id(conn, tid)
        if not t["result_id"]:
            raise HTTPException(404, "该任务没有盘点报告")
        r = conn.execute("SELECT * FROM stocktakes WHERE id=?", (t["result_id"],)).fetchone()
        items = [dict(x) for x in conn.execute(
            "SELECT result,epc,code,product,book_status,dup_count FROM stocktake_items "
            "WHERE stocktake_id=? ORDER BY id", (t["result_id"],)).fetchall()]
        return {"task_no": t["task_no"], "status": t["status"], "ended": t["ended"],
                "batch_no": r["batch_no"], "scannedCount": r["scanned_count"], "bookCount": r["book_count"],
                "matchedCount": r["matched_count"], "shortageCount": r["shortage_count"],
                "abnormalCount": r["abnormal_count"], "operator": r["operator"], "items": items}


# ------------------------------------------------- 任务观察流（H5 协同模式 + PC 复用，凭 key）

def _bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "设备未激活，请先扫描门店激活码")
    return auth[7:].strip()


def _task_device_touch(conn: sqlite3.Connection, task_id: int, code: str, name: str,
                       source: str, device_id: int = 0):
    """登记/续期任务内设备并分配临时编号，返回 (device_no, submitted)。"""
    row = conn.execute(
        "SELECT * FROM task_devices WHERE task_id=? AND device_code=?", (task_id, code)).fetchone()
    if row:
        if name:
            conn.execute("UPDATE task_devices SET last_seen=datetime('now','localtime'), name=? WHERE id=?",
                         (name, row["id"]))
        else:
            conn.execute("UPDATE task_devices SET last_seen=datetime('now','localtime') WHERE id=?",
                         (row["id"],))
        return row["device_no"], row["submitted"]
    no = conn.execute(
        "SELECT COALESCE(MAX(device_no),0)+1 n FROM task_devices WHERE task_id=?", (task_id,)
    ).fetchone()["n"]
    # ON CONFLICT 原子兜底：并发首触时即便 SELECT 漏看也不会产生重复行
    conn.execute(
        "INSERT INTO task_devices(task_id,device_id,device_code,device_no,name,source) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(task_id,device_code) DO NOTHING",
        (task_id, device_id, code, no, name or f"设备{no}号", source))
    cur = conn.execute(
        "SELECT device_no, submitted FROM task_devices WHERE task_id=? AND device_code=?",
        (task_id, code)).fetchone()
    return cur["device_no"], cur["submitted"]


def _classify_scan(conn: sqlite3.Connection, epc: str, store_id: int = 0) -> str:
    """盲采服务端分类：本店在库态商品→in_store；他店商品或非在库态→other_store；未登记→unknown。
    盘点任务按发起门店隔离：扫到他店 EPC 不计为本店账实相符。"""
    row = conn.execute(
        "SELECT status,store_id FROM products WHERE rfid_epc=?", (epc,)).fetchone()
    if row is None:
        return "unknown"
    if row["status"] in ("在库", "已定", "借出") and (not store_id or row["store_id"] == store_id):
        return "in_store"
    return "other_store"


def _scan_stats(conn: sqlite3.Connection, task_id: int) -> dict:
    stats = {"in_store": 0, "other_store": 0, "unknown": 0, "total": 0}
    for r in conn.execute(
            "SELECT verdict,COUNT(*) n FROM task_scans WHERE task_id=? GROUP BY verdict",
            (task_id,)).fetchall():
        stats[r["verdict"] or "unknown"] = r["n"]
    stats["total"] = stats["in_store"] + stats["other_store"] + stats["unknown"]
    return stats


def _do_scan(conn: sqlite3.Connection, t, code: str, name: str, source: str, device_id: int,
             body: "ScanIn", now: int) -> dict:
    """扫描原始数据全量入库：服务端排重 + 分类，设备端零业务判定（盲采）。"""
    if t["status"] != "进行中":
        raise HTTPException(409, "任务已结束，停止扫描")
    no, _ = _task_device_touch(conn, t["id"], code, name, source, device_id)
    src = body.source if body.source in ("rfid", "camera", "manual") else "rfid"
    accepted, seen = [], set()
    for tag in body.tags:
        epc = (tag.epc or "").strip().upper()
        if not epc or epc in seen:
            continue
        seen.add(epc)
        cur = conn.execute(
            "INSERT OR IGNORE INTO task_scans(task_id,epc,device_code,device_no,rssi,source,verdict) "
            "VALUES(?,?,?,?,?,?,?)",
            (t["id"], epc, code, no, tag.rssi, src,
             _classify_scan(conn, epc, t["store_id"] or 0)))
        if cur.rowcount > 0:
            accepted.append(epc)
    if device_id:
        conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (now, device_id))
    conn.commit()
    mine = conn.execute(
        "SELECT COUNT(*) n FROM task_scans WHERE task_id=? AND device_code=?",
        (t["id"], code)).fetchone()["n"]
    return {"accepted": accepted, "device_no": no, "mine": mine,
            "stats": _scan_stats(conn, t["id"]), "status": t["status"], "server_time": now}


# ------------------------------------------------- 任务观察流（H5 协同模式，凭 key 增量轮询）

@app.get("/api/task/observe")
def task_observe(key: str, since_id: int = 0):
    now = int(time.time())
    with _db_for_task_key(key) as conn:
        t = conn.execute("SELECT * FROM tasks WHERE task_key=?", (key,)).fetchone()
        if not t:
            raise HTTPException(403, "任务密钥无效，请重新扫描任务二维码")
        devices = conn.execute(
            "SELECT device_code,device_no,name,source,last_seen,submitted FROM task_devices "
            "WHERE task_id=? ORDER BY device_no", (t["id"],)).fetchall()
        rows = conn.execute(
            "SELECT id,epc,device_code,device_no,source,verdict FROM task_scans "
            "WHERE task_id=? AND id>? ORDER BY id", (t["id"], since_id)).fetchall()
        return {
            "task_id": t["id"], "task_no": t["task_no"], "status": t["status"],
            "devices": [{**dict(d), "online": _task_device_online(d["last_seen"], now)} for d in devices],
            "stats": _scan_stats(conn, t["id"]),
            "items": [dict(r) for r in rows],
            "max_id": rows[-1]["id"] if rows else since_id,
            "server_time": now,
        }


# ------------------------------------------------- 扫描助手设备端（激活/摘取/作业/提交）

class ActivateIn(BaseModel):
    akey: str = ""
    code: str
    name: str = ""
    app_version: str = ""


@app.post("/api/device/activate")
def device_activate(body: ActivateIn, key: str = ""):
    """新设备凭门店一次性激活码建档绑定，下发长期设备凭证；重复激活=换绑（重发 token）。"""
    akey = (key or body.akey).strip()
    code = (body.code or "").strip()
    if not akey or not code:
        raise HTTPException(400, "激活码与设备码不能为空")
    now = int(time.time())
    with _db_for_activation_key(akey) as (conn, act):
        if act["used"]:
            raise HTTPException(403, "激活码已被使用，请重新生成")
        if now > act["expires"]:
            raise HTTPException(403, "激活码已过期，请重新生成")
        store = conn.execute("SELECT id,name FROM stores WHERE id=?", (act["store_id"],)).fetchone()
        if not store:
            raise HTTPException(400, "激活码绑定的门店不存在")
        # 原子消费：仅当未使用且未过期时抢占成功，杜绝并发双激活一码绑两台
        claim = conn.execute(
            "UPDATE device_activations SET used=1, used_by=? WHERE id=? AND used=0 AND expires>=?",
            (code, act["id"], now))
        if claim.rowcount == 0:
            raise HTTPException(403, "激活码已被使用或已过期，请重新生成")
        name = (body.name or act["name"] or "").strip()
        token = secrets.token_urlsafe(24)
        if conn.execute("SELECT id FROM devices WHERE code=?", (code,)).fetchone():
            conn.execute(
                "UPDATE devices SET name=?,bound_store_id=?,device_token=?,status='active',"
                "app_version=?,activated_at=datetime('now','localtime'),last_seen=?,current_task_id=0 "
                "WHERE code=?",
                (name, store["id"], token, body.app_version, now, code))
        else:
            conn.execute(
                "INSERT INTO devices(code,name,bound_store_id,device_token,status,last_seen,app_version,activated_at) "
                "VALUES(?,?,?,?,'active',?,?,datetime('now','localtime'))",
                (code, name, store["id"], token, now, body.app_version))
        conn.commit()
        return {"device_token": token, "code": code, "name": name,
                "store": {"id": store["id"], "name": store["name"]}, "server_time": now}


class ClaimIn(BaseModel):
    task_key: str = ""


@app.post("/api/device/claim")
def device_claim(request: Request, body: ClaimIn, key: str = ""):
    """扫描助手摘取任务：必须联网；任务独占校验（未完结不可领新任务）；盲采不下发任何库存数据。"""
    token = _bearer(request)
    tkey = (key or body.task_key).strip()
    with _db_for_device_token(token) as (conn, dev):
        if dev["status"] != "active":
            raise HTTPException(403, "设备已停用，请联系管理员")
        t = conn.execute("SELECT * FROM tasks WHERE task_key=?", (tkey,)).fetchone()
        if not t:
            raise HTTPException(403, "任务密钥无效，请重新扫描任务二维码")
        if t["status"] != "进行中":
            raise HTTPException(403, "任务已结束，请重新扫描任务二维码")
        if dev["current_task_id"] not in (0, t["id"]):
            old = conn.execute("SELECT task_no FROM tasks WHERE id=?", (dev["current_task_id"],)).fetchone()
            raise HTTPException(
                409, f"设备正在任务 {old['task_no'] if old else ''} 中，请先提交完结后再领取新任务")
        no, submitted = _task_device_touch(conn, t["id"], dev["code"], dev["name"], "app", dev["id"])
        conn.execute("UPDATE devices SET current_task_id=?, last_seen=? WHERE id=?",
                     (t["id"], int(time.time()), dev["id"]))
        conn.commit()
        return {"task_id": t["id"], "task_no": t["task_no"], "type": t["type"],
                "title": t["title"], "device_no": no, "status": t["status"],
                "submitted": bool(submitted), "server_time": int(time.time())}


@app.get("/api/device/current")
def device_current(request: Request):
    """断电恢复：设备重启后凭凭证拉取当前归属与未完结任务（指向已关闭任务时自动清占用）。"""
    token = _bearer(request)
    with _db_for_device_token(token) as (conn, dev):
        task = None
        tid = dev["current_task_id"]
        if tid:
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
            if t and t["status"] == "进行中":
                td = conn.execute(
                    "SELECT device_no,submitted FROM task_devices WHERE task_id=? AND device_code=?",
                    (tid, dev["code"])).fetchone()
                task = {"id": t["id"], "task_no": t["task_no"], "type": t["type"],
                        "title": t["title"], "status": t["status"],
                        "device_no": td["device_no"] if td else 0,
                        "submitted": bool(td["submitted"]) if td else False}
            else:
                conn.execute("UPDATE devices SET current_task_id=0 WHERE id=?", (dev["id"],))
                conn.commit()
        store = conn.execute("SELECT id,name FROM stores WHERE id=?", (dev["bound_store_id"],)).fetchone()
        return {"code": dev["code"], "name": dev["name"], "app_version": dev["app_version"],
                "store": dict(store) if store else None, "task": task, "server_time": int(time.time())}


class ScanTagIn(BaseModel):
    epc: str
    rssi: int = 0


class ScanIn(BaseModel):
    device: str = ""
    name: str = ""
    source: str = "rfid"            # rfid | camera | manual
    tags: list[ScanTagIn] = Field(default_factory=list)


@app.post("/api/device/scan")
def device_scan(request: Request, body: ScanIn, key: str = ""):
    """扫描上报（分段批量、可重试）：扫描助手走 Bearer 凭证；H5 自主模式凭任务 key 参与。"""
    now = int(time.time())
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        with _db_for_device_token(auth[7:].strip()) as (conn, dev):
            if dev["status"] != "active":
                raise HTTPException(403, "设备已停用，请联系管理员")
            if not dev["current_task_id"]:
                raise HTTPException(409, "设备尚未领取任务")
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (dev["current_task_id"],)).fetchone()
            return _do_scan(conn, t, dev["code"], dev["name"], "app", dev["id"], body, now)
    if key:
        code = (body.device or "h5-anon").strip()
        with _db_for_task_key(key) as conn:
            t = conn.execute("SELECT * FROM tasks WHERE task_key=?", (key,)).fetchone()
            return _do_scan(conn, t, code, body.name, "h5", 0, body, now)
    raise HTTPException(401, "缺少设备凭证或任务密钥")


@app.post("/api/device/heartbeat")
def device_heartbeat(request: Request, key: str = "", device: str = ""):
    """秒级断线感知：last_seen 只信设备上报帧刷新，服务端不自刷。"""
    now = int(time.time())
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        with _db_for_device_token(auth[7:].strip()) as (conn, dev):
            if dev["status"] != "active":
                raise HTTPException(403, "设备已停用，请联系管理员")
            conn.execute("UPDATE devices SET last_seen=? WHERE id=?", (now, dev["id"]))
            tid = dev["current_task_id"]
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone() if tid else None
            if not t:
                conn.commit()
                return {"status": "idle", "submitted": False, "mine": 0, "server_time": now}
            conn.execute(
                "UPDATE task_devices SET last_seen=datetime('now','localtime') "
                "WHERE task_id=? AND device_code=?", (t["id"], dev["code"]))
            conn.commit()
            mine = conn.execute(
                "SELECT COUNT(*) n FROM task_scans WHERE task_id=? AND device_code=?",
                (t["id"], dev["code"])).fetchone()["n"]
            td = conn.execute(
                "SELECT submitted FROM task_devices WHERE task_id=? AND device_code=?",
                (t["id"], dev["code"])).fetchone()
            return {"task_id": t["id"], "task_no": t["task_no"], "status": t["status"],
                    "submitted": bool(td and td["submitted"]), "mine": mine, "server_time": now}
    if key:
        code = (device or "h5-anon").strip()
        with _db_for_task_key(key) as conn:
            t = conn.execute("SELECT * FROM tasks WHERE task_key=?", (key,)).fetchone()
            conn.execute(
                "UPDATE task_devices SET last_seen=datetime('now','localtime') "
                "WHERE task_id=? AND device_code=?", (t["id"], code))
            conn.commit()
            return {"task_no": t["task_no"], "status": t["status"], "server_time": now}
    raise HTTPException(401, "缺少设备凭证或任务密钥")


def _do_submit(conn: sqlite3.Connection, dev) -> dict:
    """首发抢占提交完结（HTTP/WS 共用）：条件 UPDATE 抢占成功才关闭；败者 409 冲突阻断。
    盘点任务生成差异报告；轻量扫码任务（开单/调拨/借货等）仅关闭任务，结果由发起端页面处理。"""
    if dev["status"] != "active":
        raise HTTPException(403, "设备已停用，请联系管理员")
    tid = dev["current_task_id"]
    if not tid:
        raise HTTPException(409, "设备当前没有进行中的任务")
    t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not t or t["status"] != "进行中":
        raise HTTPException(409, "任务已结束，请重新领取新任务")
    epcs = [r["epc"] for r in conn.execute(
        "SELECT epc FROM task_scans WHERE task_id=? ORDER BY id", (tid,)).fetchall()]
    if not epcs and t["type"] == "stocktake":
        raise HTTPException(400, "没有任何扫描数据，无法提交完结。如误领任务，请由发起端撤销任务")
    actor = f"扫描助手·{dev['code']}"
    # 先抢占（防并发生成双报告），再生成差异报告
    cur = conn.execute(
        "UPDATE tasks SET status='已完成', ended=datetime('now','localtime'), closed_by=? "
        "WHERE id=? AND status='进行中'", (f"device:{dev['code']}", tid))
    if cur.rowcount == 0:
        raise HTTPException(409, "任务已被其他设备抢先提交或已被发起端关闭，本机后续数据无效")
    result = None
    if t["type"] == "stocktake" and epcs:
        result = _run_stocktake(conn, epcs, actor, actor, commit=False,
                                store_id=t["store_id"] or 0)
        conn.execute("UPDATE tasks SET result_id=? WHERE id=?", (result["id"], tid))
    conn.execute(
        "UPDATE task_devices SET submitted=1, submit_at=datetime('now','localtime') "
        "WHERE task_id=? AND device_code=?", (tid, dev["code"]))
    _free_task_devices(conn, tid)
    _task_event(conn, tid, "submit", f"device:{dev['code']}", f"扫描{len(epcs)}条")
    conn.commit()
    _log(conn, actor, "提交完结任务", t["task_no"])
    _push_task_closed(t, "已完成")
    out = {"ok": True, "task_no": t["task_no"], "scanned_count": len(epcs),
           "server_time": int(time.time())}
    if result:
        out["result"] = {"id": result["id"], "scannedCount": result["scannedCount"],
                         "matchedCount": result["matchedCount"],
                         "shortageCount": result["shortageCount"],
                         "abnormalCount": result["abnormalCount"]}
    return out


@app.post("/api/device/submit")
def device_submit(request: Request):
    """首发抢占提交完结：条件 UPDATE 抢占成功才生成报告并解冻；败者收 409 冲突阻断。"""
    token = _bearer(request)
    with _db_for_device_token(token) as (conn, dev):
        return _do_submit(conn, dev)


# ------------------------------------------------- 扫描设备管理（发起端，需登录）

@app.get("/api/devices")
def devices_list(request: Request, store_id: int = 0):
    """设备列表；可按门店筛选（门店管理内嵌设备用）。"""
    _require_auth(request)
    now = time.time()
    with _db(request) as conn:
        sql = ("SELECT d.*, s.name store_name FROM devices d "
               "LEFT JOIN stores s ON s.id=d.bound_store_id")
        args = ()
        if store_id:
            sql += " WHERE d.bound_store_id=?"
            args = (store_id,)
        sql += " ORDER BY d.id DESC"
        rows = conn.execute(sql, args).fetchall()
        out = []
        for r in rows:
            task_no, task_type, task_seq = "", "", 0
            if r["current_task_id"]:
                tr = conn.execute(
                    "SELECT task_no,type,type_seq FROM tasks WHERE id=?",
                    (r["current_task_id"],)).fetchone()
                if tr:
                    task_no, task_type, task_seq = tr["task_no"], tr["type"], tr["type_seq"] or 0
            # WS 常驻连接即在线；离线后回退到 last_seen 60 秒判定（心跳帧兜底）
            with _dev_ws_lock:
                ws_online = r["code"] in _dev_ws.get(r["bound_store_id"], {})
            out.append({**dict(r), "store_name": r["store_name"], "current_task_no": task_no,
                        "current_task_type": task_type, "current_task_seq": task_seq,
                        "online": ws_online or (now - (r["last_seen"] or 0)) <= 60})
        return out


class ActivationIn(BaseModel):
    store_id: int
    name: str = ""


@app.post("/api/devices/activation")
def create_activation(body: ActivationIn, request: Request):
    """管理端生成设备激活码：15 分钟有效、一次性。"""
    op = _require_auth(request)
    with _db(request) as conn:
        if not conn.execute("SELECT id FROM stores WHERE id=?", (body.store_id,)).fetchone():
            raise HTTPException(400, "门店不存在")
        akey = secrets.token_urlsafe(16)
        conn.execute(
            "INSERT INTO device_activations(akey,store_id,name,created_by,expires) VALUES(?,?,?,?,?)",
            (akey, body.store_id, (body.name or "").strip(), op["username"], int(time.time()) + 900))
        conn.commit()
        return {"akey": akey, "expires_in": 900,
                "url": f"http://{_lan_ip()}:{PORT}/api/device/activate?key={akey}"}


@app.get("/api/devices/activations")
def activations_list(request: Request, limit: int = 20):
    _require_auth(request)
    now = time.time()
    with _db(request) as conn:
        rows = conn.execute(
            "SELECT a.*, s.name store_name FROM device_activations a "
            "LEFT JOIN stores s ON s.id=a.store_id ORDER BY a.id DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(r), "expired": (not r["used"]) and now > r["expires"]} for r in rows]


@app.post("/api/devices/{did}/unbind")
def device_unbind(did: int, request: Request):
    """管理端解绑：旧凭证立即失效，设备需重新扫激活码（跨店借调配合入口）。"""
    _require_auth(request)
    with _db(request) as conn:
        if not conn.execute("SELECT id FROM devices WHERE id=?", (did,)).fetchone():
            raise HTTPException(404, "设备不存在")
        conn.execute("UPDATE devices SET bound_store_id=0, device_token='', current_task_id=0 WHERE id=?", (did,))
        conn.commit()
        return {"ok": True}


@app.post("/api/devices/{did}/disable")
def device_disable(did: int, request: Request):
    _require_auth(request)
    with _db(request) as conn:
        cur = conn.execute("UPDATE devices SET status='disabled' WHERE id=?", (did,))
        if cur.rowcount == 0:
            raise HTTPException(404, "设备不存在")
        conn.commit()
        return {"ok": True}


@app.post("/api/devices/{did}/enable")
def device_enable(did: int, request: Request):
    _require_auth(request)
    with _db(request) as conn:
        cur = conn.execute("UPDATE devices SET status='active' WHERE id=?", (did,))
        if cur.rowcount == 0:
            raise HTTPException(404, "设备不存在")
        conn.commit()
        return {"ok": True}


def _find_tenant_db(table: str, column: str, value: str) -> Path | None:
    """扫描全部租户库按内部常量字段定位命中库文件，返回路径（未命中返回 None）。

    只读探测、不跑迁移；表名/列名均为内部常量，value 走参数化绑定。"""
    base = os.environ.get("TENANT_DB_DIR") or str(ROOT / "dev_data")
    for path in sorted(Path(base).glob("db_jewelry_*_v*.sqlite")):
        probe = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, check_same_thread=False)
        probe.row_factory = sqlite3.Row
        probe.execute("PRAGMA busy_timeout=3000")
        try:
            found = probe.execute(
                f"SELECT 1 FROM {table} WHERE {column}=?", (value,)).fetchone()
        except sqlite3.OperationalError:
            found = None  # 旧版本库可能缺表/缺列
        finally:
            probe.close()
        if found:
            return path
    return None


def _open_tenant_db(path: Path) -> sqlite3.Connection:
    """以读写方式打开已定位的租户库（busy_timeout + WAL + 幂等迁移一次）。"""
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA journal_mode=WAL")
    db.migrate_schema(conn)
    return conn


@contextmanager
def _scan_tenant_db(table: str, column: str, value: str, err: str):
    """扫描全部租户库按内部常量字段定位命中行，yield (conn, row)。
    表名/列名均为内部常量，value 走参数化绑定。

    探测阶段用只读连接、不跑迁移，避免每次设备请求对所有租户库做迁移写放大；
    命中后再以读写连接（busy_timeout + WAL + 迁移一次）重连同库供调用方写。"""
    hit = _find_tenant_db(table, column, value)
    if hit is None:
        raise HTTPException(403, err)
    conn = _open_tenant_db(hit)
    row = conn.execute(f"SELECT * FROM {table} WHERE {column}=?", (value,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(403, err)
    try:
        yield conn, row
    finally:
        conn.close()


@contextmanager
def _db_for_task_key(key: str):
    """凭任务 key 反查租户库（H5 协同/观察流免登录入口）。"""
    with _scan_tenant_db("tasks", "task_key", key,
                         "任务密钥无效，请重新扫描任务二维码") as (conn, _row):
        yield conn


# 兼容旧名（模块内其他位置可能引用）
_db_for_tenant_key = _db_for_task_key


@contextmanager
def _db_for_device_token(token: str):
    """凭扫描助手长期凭证反查租户库，yield (conn, devices 行)。"""
    if not token:
        raise HTTPException(401, "设备未激活，请先扫描门店激活码")
    with _scan_tenant_db("devices", "device_token", token,
                         "设备凭证无效，请重新扫描激活码") as (conn, row):
        yield conn, row


@contextmanager
def _db_for_activation_key(akey: str):
    """凭一次性激活码反查租户库，yield (conn, device_activations 行)。"""
    with _scan_tenant_db("device_activations", "akey", akey,
                         "激活码无效，请重新生成") as (conn, row):
        yield conn, row


# ------------------------------------------------- 扫描协同 WS 中枢（三端全 WS，无轮询）
# 架构定稿：
# - 手持机启动即建立 /ws/scan-device 常驻连接（device_token 认证，按绑定门店分组管理）；
# - 业务端页面（电脑/手机浏览器）经 /ws/scan-page 接入（登录会话 token 认证）；
# - 业务端需扫码时创建扫描任务（POST /api/tasks/start）→ 服务端同店广播 task_offer；
# - 手持机从推送的任务列表自由选择（任务间不互斥），扫描结果一律 WS 上报；
# - 服务端实时回推 scan_progress 给发起端页面；首发抢占提交后 task_closed 广播，
#   其余设备后续提交被 409 忽略。

class _DevWS:
    __slots__ = ("ws", "loop", "code", "name", "device_id", "store_id")

    def __init__(self, ws, loop, dev):
        self.ws = ws
        self.loop = loop
        self.code = dev["code"]
        self.name = dev["name"]
        self.device_id = dev["id"]
        self.store_id = dev["bound_store_id"]


class _PageWS:
    __slots__ = ("ws", "loop", "store_id", "username")

    def __init__(self, ws, loop, store_id: int, username: str):
        self.ws = ws
        self.loop = loop
        self.store_id = store_id
        self.username = username


_dev_ws: dict[int, dict[str, _DevWS]] = {}   # store_id -> {设备码: 连接}
_dev_ws_lock = threading.Lock()
_page_ws: dict[int, list[_PageWS]] = {}      # store_id -> [页面连接]
_page_ws_lock = threading.Lock()


def _ws_post(ws, loop, payload: dict) -> None:
    """同步上下文向 WS 连接跨线程投递消息；发送失败静默（由连接侧清理注册表）。"""
    try:
        asyncio.run_coroutine_threadsafe(
            ws.send_text(json.dumps(payload, ensure_ascii=False)), loop)
    except Exception:
        pass


def _broadcast_devices(store_id: int, payload: dict) -> None:
    """同店广播：推送给该门店全部在线手持机。"""
    with _dev_ws_lock:
        conns = list(_dev_ws.get(store_id, {}).values())
    for c in conns:
        _ws_post(c.ws, c.loop, payload)


def _broadcast_pages(store_id: int, payload: dict) -> None:
    """同店广播：推送给该门店全部业务端页面连接。"""
    with _page_ws_lock:
        conns = list(_page_ws.get(store_id, []))
    for c in conns:
        _ws_post(c.ws, c.loop, payload)


def _task_brief(conn: sqlite3.Connection, t) -> dict:
    """任务简报（任务列表/推送共用载荷）。"""
    return {"task_id": t["id"], "task_no": t["task_no"], "type": t["type"],
            "type_seq": t["type_seq"] if "type_seq" in t.keys() else 0,
            "title": t["title"], "status": t["status"], "store_id": t["store_id"],
            "initiator": t["initiator"], "created": t["created"],
            "stats": _scan_stats(conn, t["id"])}


def _broadcast_task_offer(conn: sqlite3.Connection, t) -> None:
    """新任务同店广播：手持机任务列表与业务页面同步可见。"""
    payload = {"type": "task_offer", "task": _task_brief(conn, t)}
    sid = t["store_id"] or 0
    _broadcast_devices(sid, payload)
    _broadcast_pages(sid, payload)


def _push_task_closed(t, status: str) -> None:
    """任务关闭广播：手持机清空本地任务态、停止扫描；业务页面刷新。"""
    payload = {"type": "task_closed", "task_id": t["id"], "task_no": t["task_no"],
               "status": status}
    sid = t["store_id"] or 0
    _broadcast_devices(sid, payload)
    _broadcast_pages(sid, payload)


def _push_scan_progress(store_id: int, task_id: int, task_no: str,
                        device_code: str, result: dict) -> None:
    """扫描进度实时回推发起端业务页面。"""
    _broadcast_pages(store_id, {
        "type": "scan_progress", "task_id": task_id, "task_no": task_no,
        "device": device_code, "accepted": result["accepted"],
        "mine": result["mine"], "stats": result["stats"]})


@app.websocket("/ws/scan-device")
async def scan_device_ws(websocket: WebSocket, token: str = ""):
    """扫描助手常驻连接：凭 device_token 认证（跨租户反查一次，记住库路径）。
    上行：hello/heartbeat/list/claim/scan/submit；下行：ack/task_list/task_offer/task_closed。"""
    token = (token or "").strip()
    db_path = _find_tenant_db("devices", "device_token", token) if token else None
    dev = None
    if db_path:
        conn = _open_tenant_db(db_path)
        try:
            dev = conn.execute(
                "SELECT * FROM devices WHERE device_token=? AND status='active'",
                (token,)).fetchone()
        finally:
            conn.close()
    await websocket.accept()
    if dev is None:
        await websocket.close(code=4401)
        return
    loop = asyncio.get_running_loop()
    link = _DevWS(websocket, loop, dev)
    sid = dev["bound_store_id"]

    def _with_db(fn):
        """每帧独立开库处理（busy_timeout+WAL），避免常驻连接长期持有库句柄。"""
        conn2 = _open_tenant_db(db_path)
        try:
            return fn(conn2)
        finally:
            conn2.close()

    def _touch(conn: sqlite3.Connection, app_version: str = "") -> None:
        # last_seen 只信设备上报帧刷新，服务端不自刷
        if app_version:
            conn.execute("UPDATE devices SET last_seen=?, app_version=? WHERE id=?",
                         (int(time.time()), app_version[:40], link.device_id))
        else:
            conn.execute("UPDATE devices SET last_seen=? WHERE id=?",
                         (int(time.time()), link.device_id))
        conn.commit()

    def _handle(conn: sqlite3.Connection, d: dict):
        mtype = str(d.get("type") or "")
        if mtype == "hello":
            _touch(conn, str(d.get("app_version") or ""))
            return {"type": "ack", "ref": "hello", "ok": True, "code": link.code,
                    "store_id": sid, "server_time": int(time.time())}
        if mtype == "heartbeat":
            _touch(conn)
            return None  # 心跳免应答，帧本身即在线证明
        if mtype == "list":
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status='进行中' AND store_id=? ORDER BY id DESC",
                (sid,)).fetchall()
            return {"type": "task_list", "tasks": [_task_brief(conn, r) for r in rows]}
        if mtype == "claim":
            tid = int(d.get("task_id") or 0)
            dev2 = conn.execute("SELECT * FROM devices WHERE id=?",
                                (link.device_id,)).fetchone()
            if not dev2 or dev2["status"] != "active":
                raise HTTPException(403, "设备已停用，请联系管理员")
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
            if not t or t["status"] != "进行中":
                return {"type": "ack", "ref": "claim", "ok": False, "message": "任务已结束"}
            if t["store_id"] != sid:
                return {"type": "ack", "ref": "claim", "ok": False, "message": "任务不属于本店"}
            if dev2["current_task_id"] not in (0, tid):
                old = conn.execute("SELECT task_no FROM tasks WHERE id=?",
                                   (dev2["current_task_id"],)).fetchone()
                return {"type": "ack", "ref": "claim", "ok": False,
                        "message": f"当前任务 {old['task_no'] if old else ''} 未完结，不可领取新任务"}
            no, submitted = _task_device_touch(conn, tid, link.code, link.name,
                                               "app", link.device_id)
            conn.execute("UPDATE devices SET current_task_id=?, last_seen=? WHERE id=?",
                         (tid, int(time.time()), link.device_id))
            conn.commit()
            return {"type": "ack", "ref": "claim", "ok": True,
                    "task": _task_brief(conn, t), "device_no": no,
                    "submitted": bool(submitted)}
        if mtype == "scan":
            dev2 = conn.execute("SELECT * FROM devices WHERE id=?",
                                (link.device_id,)).fetchone()
            if not dev2 or dev2["status"] != "active":
                raise HTTPException(403, "设备已停用，请联系管理员")
            tid = dev2["current_task_id"]
            if not tid:
                return {"type": "ack", "ref": "scan", "ok": False, "message": "尚未领取任务"}
            t = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
            if not t or t["status"] != "进行中":
                return {"type": "ack", "ref": "scan", "ok": False,
                        "message": "任务已结束，停止扫描", "task_closed": True}
            body = ScanIn(
                source=str(d.get("source") or "rfid"),
                tags=[ScanTagIn(epc=str(x.get("epc") or ""), rssi=int(x.get("rssi") or 0))
                      for x in (d.get("tags") or []) if isinstance(x, dict)])
            r = _do_scan(conn, t, link.code, link.name, "app", link.device_id,
                         body, int(time.time()))
            _push_scan_progress(sid, tid, t["task_no"], link.code, r)
            return {"type": "ack", "ref": "scan", "ok": True,
                    "accepted": r["accepted"], "mine": r["mine"], "stats": r["stats"]}
        if mtype == "submit":
            dev2 = conn.execute("SELECT * FROM devices WHERE id=?",
                                (link.device_id,)).fetchone()
            if not dev2:
                raise HTTPException(403, "设备已停用，请联系管理员")
            r = _do_submit(conn, dev2)
            return {"type": "ack", "ref": "submit", **r}
        return {"type": "ack", "ref": mtype, "ok": False, "message": "未知消息类型"}

    with _dev_ws_lock:
        old = _dev_ws.get(sid, {}).get(link.code)
        _dev_ws.setdefault(sid, {})[link.code] = link
    if old is not None:
        try:
            await old.ws.close()
        except Exception:
            pass
    try:
        # 连接建立即推送该店进行中任务列表（免设备主动轮询）
        first = await asyncio.to_thread(_with_db, lambda c: _handle(c, {"type": "list"}))
        await websocket.send_text(json.dumps(first, ensure_ascii=False))
        while True:
            msg = await websocket.receive_text()
            try:
                d = json.loads(msg)
            except Exception:
                continue
            try:
                resp = await asyncio.to_thread(_with_db, lambda c: _handle(c, d))
            except HTTPException as e:
                resp = {"type": "ack", "ref": str(d.get("type") or ""),
                        "ok": False, "message": e.detail}
            except Exception:
                logger.exception("扫描助手 WS 消息处理失败")
                resp = {"type": "ack", "ref": str(d.get("type") or ""),
                        "ok": False, "message": "服务端处理失败"}
            if resp is not None:
                await websocket.send_text(json.dumps(resp, ensure_ascii=False))
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        pass
    finally:
        with _dev_ws_lock:
            conns = _dev_ws.get(sid, {})
            if conns.get(link.code) is link:
                conns.pop(link.code, None)


@app.websocket("/ws/scan-page")
async def scan_page_ws(websocket: WebSocket, token: str = ""):
    """业务端页面连接：登录会话 token 认证；接收本店扫描进度与任务状态推送（上行仅保活）。"""
    sess = _sessions.get((token or "").strip())
    await websocket.accept()
    if not sess:
        await websocket.close(code=4401)
        return
    with _db(websocket) as conn:
        try:
            sid, _ = _current_store(websocket, conn, sess)
        except HTTPException:
            await websocket.close(code=4403)
            return
    link = _PageWS(websocket, asyncio.get_running_loop(), sid,
                   str(sess.get("username") or ""))
    with _page_ws_lock:
        _page_ws.setdefault(sid, []).append(link)
    try:
        while True:
            await websocket.receive_text()  # 上行仅保活，内容忽略
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        pass
    finally:
        with _page_ws_lock:
            conns = _page_ws.get(sid, [])
            if link in conns:
                conns.remove(link)


# ---------------------------------------------------------------- 销售

class SaleItemIn(BaseModel):
    product_id: int | None = None
    epc: str = ""          # 扫码加件：RFID EPC
    code: str = ""         # 扫码加件：条码/货号
    price: float | None = None    # 计件类成交价（可空，默认取商品售价）
    gold_price: float | None = None  # 计重类成交金价（元/克，已含会员折扣）；空取当日金价
    labor_fee: float | None = None    # 计重类工费（元/件）


class SalePaymentIn(BaseModel):
    method: str = "现金"
    amount: float = Field(default=0, ge=0)


class SaleReq(BaseModel):
    customer: str = ""
    phone: str = ""
    product: str = ""
    product_id: int | None = None
    amount: float = Field(default=0, ge=0)  # 旧字段，由后端汇总忽略
    paid: float = Field(default=0, ge=0)    # 无组合支付时的实收
    method: str = "现金"
    discount: float = Field(default=0, ge=0)  # 整单优惠：应付 = 应收 - 优惠
    payments: list[SalePaymentIn] = []        # 组合支付（可多笔）；为空时回退 paid/method
    biz_date: str = ""
    clerk_type: str = ""   # 经办人类别（存名称快照，缺省取默认类别）
    clerk_name: str = ""   # 经办人具体人名（可空）
    items: list[SaleItemIn] = []  # 一单多件；为空时回退旧单件字段（兼容）


def _resolve_product(conn: sqlite3.Connection, raw_scan, store_id: int | None = None) -> sqlite3.Row | None:
    """通用商品定位：支持 product_id / EPC / 条码 / 货号 四种入参。

    匹配顺序：纯数字 → product_id；否则去空白大写化 → rfid_epc；
    否则 rfid_epc OR barcode OR code LIMIT 1。store_id 传入时做同店校验，
    返回 None（没找着）但不抛错——由调用方决定错误文案。
    """
    if raw_scan is None:
        return None
    val = raw_scan if isinstance(raw_scan, str) else str(raw_scan)
    val = val.strip()
    if not val:
        return None
    row: sqlite3.Row | None = None
    # 1) 纯数字优先当 product_id
    if val.isdigit():
        row = conn.execute("SELECT * FROM products WHERE id=?", (int(val),)).fetchone()
    # 2) RFID EPC（大写去空白）
    if not row:
        row = conn.execute("SELECT * FROM products WHERE rfid_epc=?", (val.upper(),)).fetchone()
    # 3) 条码 / 货号（EPC 作为回退，防止"看起来像条码其实是 EPC"的情况）
    if not row:
        row = conn.execute(
            "SELECT * FROM products WHERE rfid_epc=? OR barcode=? OR code=? LIMIT 1",
            (val.upper(), val, val)).fetchone()
    # 同店约束（调用方显式传 store_id 才校验；None 跳过）
    if row is not None and store_id is not None and store_id:
        if (row["store_id"] or 0) != store_id:
            return None
    return row


def _resolve_sale_product(conn: sqlite3.Connection, it: SaleItemIn):
    """薄封装（向后兼容）：按 product_id → epc → code 顺序 resolve。"""
    return _resolve_product(conn, it.product_id or it.epc or it.code or "")


def _sale_item_dicts(conn: sqlite3.Connection, sale_ids: list[int]) -> dict[int, list]:
    if not sale_ids:
        return {}
    q = ",".join("?" * len(sale_ids))
    out: dict[int, list] = {sid: [] for sid in sale_ids}
    for r in conn.execute(
            f"SELECT * FROM sale_items WHERE sale_id IN ({q}) ORDER BY sale_id, seq, id",
            sale_ids).fetchall():
        out[r["sale_id"]].append(dict(r))
    return out


@app.post("/api/sales")
def sale_create(body: SaleReq, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        # 组装明细：多件优先 body.items；为空回退旧单件字段
        req_items = body.items
        if not req_items and body.product_id:
            req_items = [SaleItemIn(product_id=body.product_id, price=body.amount or None)]
        if not req_items:
            raise HTTPException(400, "请至少添加一件商品")

        # 当日金价 + 品类计价方式（计重/计件）
        cfg = conn.execute("SELECT IFNULL(gold_price,0) gp FROM biz_config WHERE id=1").fetchone()
        daily_gold = float(cfg["gp"] if cfg else 0) or 0.0
        type_modes = {
            r["code"]: (r["pricing_mode"] if r["pricing_mode"] in ("piece", "weight") else "piece")
            for r in conn.execute("SELECT code,pricing_mode FROM product_types").fetchall()
        }

        resolved = []   # [(product, item_snapshot_dict)]
        seen = set()
        shop_id = 0
        store_id = sid  # 开单门店固定为当前工作门店
        for it in req_items:
            p = _resolve_sale_product(conn, it)
            if not p:
                raise HTTPException(400, "扫描的商品未登记或不存在")
            if p["id"] in seen:
                raise HTTPException(400, f"商品 {p['code']} 在本单重复，请只保留一件")
            if p["status"] != "在库":
                raise HTTPException(400, f"商品 {p['code']} 当前状态为{p['status']}，无法开单")
            pstore = p["store_id"] or 0
            if pstore != sid:
                raise HTTPException(403, f"商品 {p['code']} 不属于当前工作门店，不能跨店开单")
            mode = type_modes.get(p["product_type_code"] or "", "piece")
            if mode == "weight":
                weight = float(p["weight"] or 0)
                gold = float(it.gold_price) if it.gold_price is not None and it.gold_price > 0 else daily_gold
                labor = max(0.0, float(it.labor_fee or 0))
                if gold <= 0:
                    raise HTTPException(400, f"商品 {p['code']} 为计重品类，请先在业务配置设置当日金价或录入金价")
                subtotal = round(weight * gold + labor, 2)
                snap = {"pricing_mode": "weight", "weight": weight, "gold_price": gold,
                        "labor_fee": round(labor, 2), "subtotal": subtotal}
            else:
                subtotal = round(float(it.price if it.price is not None else (p["price"] or 0)), 2)
                snap = {"pricing_mode": "piece", "weight": 0.0, "gold_price": 0.0,
                        "labor_fee": 0.0, "subtotal": subtotal}
            seen.add(p["id"])
            resolved.append((p, snap))

        # 店铺件数上限（经商品门店→店铺）
        if store_id:
            srow = conn.execute("SELECT shop_id FROM stores WHERE id=?", (store_id,)).fetchone()
            shop_id = srow["shop_id"] if srow else 0
        limit = 0
        if shop_id:
            lp = conn.execute("SELECT sale_item_limit FROM shops WHERE id=?", (shop_id,)).fetchone()
            if lp:
                limit = lp["sale_item_limit"] or 0
        if limit and len(resolved) > limit:
            raise HTTPException(400, f"本店铺单张开单最多 {limit} 件，当前 {len(resolved)} 件")

        # 应收（各件小计汇总）→ 优惠 → 应付
        receivable = round(sum(s["subtotal"] for _p, s in resolved), 2)
        discount = round(max(0.0, float(body.discount or 0)), 2)
        if discount > receivable:
            raise HTTPException(400, f"优惠金额 ￥{discount} 不能大于应收 ￥{receivable}")
        payable = round(receivable - discount, 2)

        # 组合支付：优先 payments；为空回退旧的单支付 paid/method
        pay_list = [(pm.method.strip() or "现金", round(float(pm.amount or 0), 2))
                    for pm in body.payments if float(pm.amount or 0) > 0]
        if pay_list:
            for m, _amt in pay_list:
                if m not in ("现金", "微信", "刷卡", "转账"):
                    raise HTTPException(400, f"不支持的支付方式：{m}")
        else:
            pay_list = [(body.method or "现金", round(float(body.paid or 0), 2))] if float(body.paid or 0) > 0 else []
        paid = round(sum(a for _m, a in pay_list), 2)
        if paid > payable + 0.01:
            raise HTTPException(400, f"实收 ￥{paid} 超过应付 ￥{payable}，请核对")
        main_method = pay_list[0][0] if len(pay_list) == 1 else ("组合" if pay_list else (body.method or "现金"))

        bill = _next_bill_no(conn)
        biz = body.biz_date or date.today().isoformat()
        status = "已完成" if paid + 0.01 >= payable and payable > 0 else "欠款"
        if payable == 0:
            status = "已完成"
        names = "、".join(p["name"] for p, _s in resolved)
        first = resolved[0][0]
        # 经办人类别：缺省取默认类别；传值按名称原样落库（历史快照），人名可空
        clerk_type = (body.clerk_type or "").strip()
        if not clerk_type:
            drow = conn.execute("SELECT name FROM clerk_types WHERE is_default=1 AND active=1 ORDER BY id LIMIT 1").fetchone()
            clerk_type = drow["name"] if drow else "店员"
        clerk_name = (body.clerk_name or "").strip()[:40]
        cur = conn.execute(
            """INSERT INTO sales(bill_no,customer,phone,product,product_id,amount,paid,method,biz_date,type,status,
                                 clerk_type,clerk_name,store_id,discount,receivable)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (bill, body.customer, body.phone, names, first["id"], payable, paid,
             main_method, biz, "普通", status, clerk_type, clerk_name, sid,
             discount, receivable),
        )
        sale_id = cur.lastrowid
        for seq, (p, s) in enumerate(resolved):
            conn.execute(
                "INSERT INTO sale_items(sale_id,product_id,epc,code,name,price,seq,"
                "pricing_mode,weight,gold_price,labor_fee,subtotal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (sale_id, p["id"], p["rfid_epc"] or "", p["code"] or "", p["name"],
                 s["subtotal"], seq, s["pricing_mode"], s["weight"], s["gold_price"],
                 s["labor_fee"], s["subtotal"]))
            conn.execute("UPDATE products SET status='已售' WHERE id=?", (p["id"],))
            _inv(conn, p["id"], p["rfid_epc"], "out", op["username"], store_id=sid)
        for pseq, (m, amt) in enumerate(pay_list):
            conn.execute(
                "INSERT INTO sale_payments(sale_id,method,amount,seq) VALUES(?,?,?,?)",
                (sale_id, m, amt, pseq))
        # 客户回写 + 关联会员；积分按实付 1 元 = 1 分累计
        customer_id = _touch_customer(conn, body.customer, body.phone, payable, max(0.0, payable - paid))
        if customer_id:
            conn.execute("UPDATE sales SET customer_id=? WHERE id=?", (customer_id, sale_id))
            conn.execute("UPDATE customers SET points=IFNULL(points,0)+? WHERE id=?", (paid, customer_id))
        conn.commit()
        _log(conn, op["username"], "销售开单", f"{bill} {len(resolved)}件")
        return {"bill_no": bill, "id": sale_id, "amount": payable, "receivable": receivable,
                "discount": discount, "paid": paid, "points": paid, "count": len(resolved)}


@app.get("/api/sales")
def sale_list(request: Request, q: str = "", clerk_type: str = "", clerk_name: str = "",
              page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        where, args = [], []
        where.append("(s.store_id=? OR s.store_id=0)")
        args.append(sid)
        if q:
            where.append(
                "(s.bill_no LIKE ? OR s.customer LIKE ? OR s.phone LIKE ? OR s.product LIKE ? "
                "OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=s.id AND "
                "(si.name LIKE ? OR si.code LIKE ? OR si.epc LIKE ?)))")
            args += [f"%{q}%"] * 4 + [f"%{q}%"] * 3
        if clerk_type:
            where.append("s.clerk_type=?")
            args.append(clerk_type)
        if clerk_name:
            where.append("s.clerk_name LIKE ?")
            args.append(f"%{clerk_name}%")
        cond = ("WHERE " + " AND ".join(where)) if where else ""
        total = conn.execute(f"SELECT COUNT(*) n FROM sales s {cond}", args).fetchone()["n"]
        rows = conn.execute(
            f"SELECT s.* FROM sales s {cond} ORDER BY s.id DESC LIMIT ? OFFSET ?",
            args + [size, (page - 1) * size],
        ).fetchall()
        sale_ids = [r["id"] for r in rows]
        items_map = _sale_item_dicts(conn, sale_ids)
        pays_map: dict[int, list] = {sid2: [] for sid2 in sale_ids}
        if sale_ids:
            for pr in conn.execute(
                    f"SELECT sale_id,method,amount,seq FROM sale_payments WHERE sale_id IN "
                    f"({','.join('?' * len(sale_ids))}) ORDER BY sale_id,seq", sale_ids).fetchall():
                pays_map[pr["sale_id"]].append({"method": pr["method"], "amount": pr["amount"]})
        out = []
        for r in rows:
            d = dict(r)
            d["items"] = items_map.get(r["id"], [])
            d["item_count"] = len(d["items"])
            d["payments"] = pays_map.get(r["id"], [])
            out.append(d)
        return {"total": total, "page": page, "size": size, "items": out}


@app.post("/api/sales/{sid}/void")
def sale_void(sid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        cur_sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = conn.execute("SELECT * FROM sales WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "单据不存在")
        if row["store_id"] not in (0, cur_sid):
            raise HTTPException(403, "该单据不属于当前工作门店")
        if row["status"] == "已冲红":
            raise HTTPException(400, "单据已冲红")
        conn.execute("UPDATE sales SET status='已冲红' WHERE id=?", (sid,))
        # 逐件恢复在库（多件明细）；兼容无明细的历史单件单
        item_pids = [r["product_id"] for r in conn.execute(
            "SELECT DISTINCT product_id FROM sale_items WHERE sale_id=? AND product_id IS NOT NULL",
            (sid,)).fetchall()]
        if not item_pids and row["product_id"]:
            item_pids = [row["product_id"]]
        for pid in item_pids:
            conn.execute("UPDATE products SET status='在库' WHERE id=? AND status='已售'", (pid,))
            _inv(conn, pid, "", "in", op["username"], store_id=row["store_id"] or cur_sid)
        if row["phone"]:
            # 冲红回滚：累计消费、欠款、已累计积分（实付部分）
            conn.execute(
                "UPDATE customers SET total_amount=MAX(total_amount-?,0), due_amount=MAX(due_amount-?,0), "
                "points=MAX(IFNULL(points,0)-?,0) WHERE phone=?",
                (row["amount"], max(0.0, row["amount"] - row["paid"]), row["paid"], row["phone"]),
            )
        conn.commit()
        _log(conn, op["username"], "销售冲红", row["bill_no"])
        return {"ok": True}


# ---------------------------------------------------------------- 门店精简列表 / 库位主数据

@app.get("/api/stores")
def store_list(request: Request, all: int = 0):
    """门店精简列表（含所属店铺；库位、调拨、商品表单等共用）。
    默认只返回当前账号被授权的门店；all=1 且为店长时返回全部门店（门店/总部管理页使用）。"""
    sess = _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute(
            """SELECT s.id,s.name,s.code,s.owner,s.shop_id,
                      COALESCE(sp.name,'') AS shop_name,
                      IFNULL(s.bridge_key,'') AS bridge_key,
                      IFNULL(s.printer_name,'') AS printer_name
               FROM stores s LEFT JOIN shops sp ON sp.id=s.shop_id
               ORDER BY s.shop_id, s.id""").fetchall()
        if all and sess.get("role") != "TENANT_ADMIN":
            all = 0
        if not all:
            allow = {r["id"] for r in _accessible_store_rows(conn, sess)}
            rows = [r for r in rows if r["id"] in allow]
        return [dict(r) for r in rows]


@app.put("/api/stores/{sid}")
def store_update(sid: int, body: dict, request: Request):
    """更新门店基础信息/归属店铺。"""
    _require_admin(request)
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "门店名称必填")
    with _db(request) as conn:
        row = conn.execute("SELECT id FROM stores WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "门店不存在")
        shop_id = int(body.get("shop_id") or 0)
        if shop_id:
            if not conn.execute("SELECT 1 FROM shops WHERE id=?", (shop_id,)).fetchone():
                raise HTTPException(400, "所属店铺不存在")
        else:
            shop_id = conn.execute("SELECT id FROM shops ORDER BY id LIMIT 1").fetchone()["id"]
        try:
            conn.execute(
                "UPDATE stores SET name=?, owner=?, shop_id=? WHERE id=?",
                (name, str(body.get("owner") or ""), shop_id, sid))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "门店信息保存失败")
    return {"ok": True}


# ------------------------------------------------- 用户与门店授权（仅店长）

def _require_admin(request: Request) -> dict:
    """行政/系统类操作要求店长或高管。
    高管仅在当前工作门店为总店(HQ)时可行政——该约束由 executive_write_guard 中间件统一拦截，
    店长在任意门店均可行政（既有行为不变）。"""
    sess = _require_auth(request)
    if sess.get("role") not in ("TENANT_ADMIN", "EXECUTIVE"):
        raise HTTPException(403, "仅店长可操作")
    return sess


@app.get("/api/admin/users")
def admin_user_list(request: Request):
    """账号列表 + 各账号被授权的门店（店长/高管自动拥有全部门店，store_ids 返回 -1 标记全店）。"""
    _require_admin(request)
    with _db(request) as conn:
        users = conn.execute("SELECT id,username,display_name,role,IFNULL(can_view_cost,0) can_view_cost FROM users ORDER BY id").fetchall()
        out = []
        for u in users:
            d = dict(u)
            if d["role"] in ("TENANT_ADMIN", "EXECUTIVE"):
                d["store_ids"] = [-1]
            else:
                d["store_ids"] = [r["store_id"] for r in conn.execute(
                    "SELECT store_id FROM user_stores WHERE user_id=? ORDER BY store_id", (u["id"],))]
            out.append(d)
        return {"items": out}


class AdminUserIn(BaseModel):
    username: str = ""
    display_name: str = ""
    password: str = ""
    role: str = "EMPLOYEE"
    can_view_cost: bool | None = None  # 列级权限：不传时按角色默认（店长/高管开，店员关）


@app.post("/api/admin/users")
def admin_user_create(body: AdminUserIn, request: Request):
    op = _require_admin(request)
    uname = body.username.strip()
    if not (2 <= len(uname) <= 32) or not all(c.isalnum() or c in "_-" for c in uname):
        raise HTTPException(400, "登录名需 2-32 位字母、数字或 _-")
    if not body.password:
        raise HTTPException(400, "请设置初始密码")
    role = body.role if body.role in ("TENANT_ADMIN", "EXECUTIVE", "EMPLOYEE") else "EMPLOYEE"
    # 成本权限：店长/高管强制开；店员默认关，可由店长显式授予
    cost_perm = 1 if role in _COST_FORCE_VISIBLE_ROLES or body.can_view_cost is True else 0
    with _db(request) as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (uname,)).fetchone():
            raise HTTPException(409, "登录名已存在")
        cur = conn.execute(
            "INSERT INTO users(username,password,display_name,role,can_view_cost) VALUES(?,?,?,?,?)",
            (uname, body.password, body.display_name.strip() or uname, role, cost_perm))
        conn.commit()
        _log(conn, op["username"], "新增账号", uname)
        return {"ok": True, "id": cur.lastrowid}


@app.put("/api/admin/users/{uid}")
def admin_user_update(uid: int, body: AdminUserIn, request: Request):
    op = _require_admin(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise HTTPException(404, "账号不存在")
        if body.display_name.strip():
            conn.execute("UPDATE users SET display_name=? WHERE id=?", (body.display_name.strip(), uid))
        if body.password:
            conn.execute("UPDATE users SET password=? WHERE id=?", (body.password, uid))
        if body.role in ("TENANT_ADMIN", "EXECUTIVE", "EMPLOYEE"):
            conn.execute("UPDATE users SET role=? WHERE id=?", (body.role, uid))
            # 店长/高管自动拥有全部门店，转任这两类角色时清掉残留的逐店授权
            if body.role in ("TENANT_ADMIN", "EXECUTIVE"):
                conn.execute("DELETE FROM user_stores WHERE user_id=?", (uid,))
        # 成本查看权：店长/高管强制 1（忽略传入的 false）；店员且显式传值时按勾选更新
        new_role = body.role if body.role in ("TENANT_ADMIN", "EXECUTIVE", "EMPLOYEE") else row["role"]
        if new_role in _COST_FORCE_VISIBLE_ROLES:
            conn.execute("UPDATE users SET can_view_cost=1 WHERE id=? AND IFNULL(can_view_cost,0)=0", (uid,))
        elif body.can_view_cost is not None:
            conn.execute("UPDATE users SET can_view_cost=? WHERE id=?", (1 if body.can_view_cost else 0, uid))
        conn.commit()
        _log(conn, op["username"], "修改账号", row["username"])
        return {"ok": True}


@app.delete("/api/admin/users/{uid}")
def admin_user_delete(uid: int, request: Request):
    op = _require_admin(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise HTTPException(404, "账号不存在")
        if row["username"] == op["username"]:
            raise HTTPException(400, "不能删除当前登录账号")
        if row["role"] == "TENANT_ADMIN" and conn.execute(
                "SELECT COUNT(*) n FROM users WHERE role='TENANT_ADMIN'").fetchone()["n"] <= 1:
            raise HTTPException(400, "至少保留一个店长账号")
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.execute("DELETE FROM user_stores WHERE user_id=?", (uid,))
        conn.commit()
        _log(conn, op["username"], "删除账号", row["username"])
        return {"ok": True}


class GrantStoresIn(BaseModel):
    store_ids: list[int] = Field(default_factory=list)


@app.put("/api/admin/users/{uid}/stores")
def admin_grant_stores(uid: int, body: GrantStoresIn, request: Request):
    """设置店员可访问的门店集合（全量覆盖）。店长/高管不使用此关系（自动全店）。"""
    op = _require_admin(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise HTTPException(404, "账号不存在")
        if row["role"] in ("TENANT_ADMIN", "EXECUTIVE"):
            raise HTTPException(400, "店长/高管自动拥有全部门店，无需单独授权")
        valid = {r["id"] for r in conn.execute("SELECT id FROM stores").fetchall()}
        ids = [i for i in dict.fromkeys(body.store_ids) if i in valid]
        conn.execute("DELETE FROM user_stores WHERE user_id=?", (uid,))
        conn.executemany(
            "INSERT INTO user_stores(user_id,store_id,granted_by) VALUES(?,?,?)",
            [(uid, i, op["username"]) for i in ids])
        conn.commit()
        _log(conn, op["username"], "门店授权", f"{row['username']}：{len(ids)} 家门店")
        return {"ok": True, "store_ids": ids}


# ------------------------------------------------- 店铺（上层组织）
@app.get("/api/shops")
def shop_list(request: Request):
    """店铺列表，含各店铺门店数。"""
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute(
            """SELECT sp.*, (SELECT COUNT(*) FROM stores s WHERE s.shop_id=sp.id) AS store_count
               FROM shops sp ORDER BY sp.sort_order, sp.id""").fetchall()
        return [dict(r) for r in rows]


class ShopIn(BaseModel):
    name: str
    code: str = ""
    sale_item_limit: int = 20


@app.post("/api/shops")
def shop_create(body: ShopIn, request: Request):
    _require_auth(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "店铺名称必填")
    limit = body.sale_item_limit if body.sale_item_limit >= 1 else 20
    with _db(request) as conn:
        code = body.code.strip()
        if not code:
            nid = conn.execute("SELECT COALESCE(MAX(id),0)+1 FROM shops").fetchone()[0]
            code = f"S{nid:02X}"
        try:
            cur = conn.execute(
                "INSERT INTO shops(name,code,sale_item_limit) VALUES(?,?,?)",
                (name, code, limit))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "店铺编码已存在")
        return {"ok": True, "id": cur.lastrowid, "code": code}


@app.put("/api/shops/{sid}")
def shop_update(sid: int, body: ShopIn, request: Request):
    _require_auth(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "店铺名称必填")
    limit = body.sale_item_limit if body.sale_item_limit >= 1 else 20
    with _db(request) as conn:
        if not conn.execute("SELECT 1 FROM shops WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "店铺不存在")
        try:
            conn.execute("UPDATE shops SET name=?, code=?, sale_item_limit=? WHERE id=?",
                         (name, body.code.strip(), limit, sid))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "店铺编码已存在")
    return {"ok": True}


@app.delete("/api/shops/{sid}")
def shop_delete(sid: int, request: Request):
    """仅允许删除其下无门店的店铺。"""
    _require_auth(request)
    with _db(request) as conn:
        if not conn.execute("SELECT 1 FROM shops WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "店铺不存在")
        n = conn.execute("SELECT COUNT(*) n FROM stores WHERE shop_id=?", (sid,)).fetchone()["n"]
        if n:
            raise HTTPException(400, f"该店铺下仍有 {n} 家门店，请先调整门店归属后再删除")
        conn.execute("DELETE FROM shops WHERE id=?", (sid,))
        conn.commit()
    return {"ok": True}


class LocationIn(BaseModel):
    store_id: int = 0
    code: str = ""
    name: str = ""
    sort_order: int = 0
    active: int = 1


def _location_row(conn: sqlite3.Connection, lid: int):
    return conn.execute(
        "SELECT l.*, s.name AS store_name FROM locations l "
        "LEFT JOIN stores s ON s.id=l.store_id WHERE l.id=?", (lid,)).fetchone()


@app.get("/api/locations")
def location_list(request: Request, store_id: int = 0, active: int = -1):
    """库位列表：可按门店/启用状态过滤；active=-1 全部、0 已停用、1 启用中。"""
    _require_auth(request)
    sql = ("SELECT l.*, s.name AS store_name FROM locations l "
           "LEFT JOIN stores s ON s.id=l.store_id WHERE 1=1")
    args: list = []
    if store_id:
        sql += " AND l.store_id=?"
        args.append(store_id)
    if active in (0, 1):
        sql += " AND l.active=?"
        args.append(active)
    sql += " ORDER BY l.store_id, l.sort_order, l.id"
    with _db(request) as conn:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]


@app.post("/api/locations")
def location_create(body: LocationIn, request: Request):
    op = _require_auth(request)
    code, name = body.code.strip(), body.name.strip()
    if not body.store_id:
        raise HTTPException(400, "请选择门店")
    if not code or not name:
        raise HTTPException(400, "库位编号和名称必填")
    with _db(request) as conn:
        if not conn.execute("SELECT 1 FROM stores WHERE id=?", (body.store_id,)).fetchone():
            raise HTTPException(400, "门店不存在")
        try:
            cur = conn.execute(
                "INSERT INTO locations(store_id,code,name,sort_order,active) VALUES(?,?,?,?,?)",
                (body.store_id, code, name, body.sort_order, 1 if body.active else 0))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "该门店下库位编号已存在")
        _log(conn, op["username"], "库位新增", f"{code} {name}")
        return dict(_location_row(conn, cur.lastrowid))


@app.put("/api/locations/{lid}")
def location_update(lid: int, body: LocationIn, request: Request):
    op = _require_auth(request)
    code, name = body.code.strip(), body.name.strip()
    if not code or not name:
        raise HTTPException(400, "库位编号和名称必填")
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM locations WHERE id=?", (lid,)).fetchone()
        if not row:
            raise HTTPException(404, "库位不存在")
        try:
            conn.execute(
                "UPDATE locations SET code=?,name=?,sort_order=?,active=? WHERE id=?",
                (code, name, body.sort_order, 1 if body.active else 0, lid))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "该门店下库位编号已存在")
        _log(conn, op["username"], "库位编辑", code)
        return dict(_location_row(conn, lid))


@app.delete("/api/locations/{lid}")
def location_delete(lid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM locations WHERE id=?", (lid,)).fetchone()
        if not row:
            raise HTTPException(404, "库位不存在")
        used = conn.execute(
            "SELECT COUNT(*) n FROM products WHERE location_id=? OR cert_location_id=?",
            (lid, lid)).fetchone()["n"]
        if used:
            raise HTTPException(400, f"该库位已被 {used} 件商品引用，请改用停用")
        conn.execute("DELETE FROM locations WHERE id=?", (lid,))
        conn.commit()
        _log(conn, op["username"], "库位删除", row["code"])
        return {"ok": True}


# ---------------------------------------------------------------- 经办人类别

class ClerkTypeIn(BaseModel):
    name: str = ""
    sort_order: int = 0
    active: int = -1  # -1 不变；POST 时默认启用


@app.get("/api/clerk-types")
def clerk_type_list(request: Request, active: int = -1):
    """经办人类别：默认返回全部（管理页含停用项）；active=1 仅启用（开单下拉用）。"""
    _require_auth(request)
    with _db(request) as conn:
        sql = "SELECT id,name,sort_order,is_default,active FROM clerk_types"
        args: list = []
        if active in (0, 1):
            sql += " WHERE active=?"
            args.append(active)
        sql += " ORDER BY sort_order,id"
        return [dict(r) for r in conn.execute(sql, args).fetchall()]


@app.post("/api/clerk-types")
def clerk_type_create(body: ClerkTypeIn, request: Request):
    op = _require_auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "类别名称必填")
    with _db(request) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO clerk_types(name,sort_order,is_default,active) VALUES(?,?,0,1)",
                (name, body.sort_order))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "经办人类别名称已存在")
        _log(conn, op["username"], "经办人类别新增", name)
        r = conn.execute("SELECT id,name,sort_order,is_default,active FROM clerk_types WHERE id=?",
                         (cur.lastrowid,)).fetchone()
        return dict(r)


@app.put("/api/clerk-types/{cid}")
def clerk_type_update(cid: int, body: ClerkTypeIn, request: Request):
    op = _require_auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "类别名称必填")
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM clerk_types WHERE id=?", (cid,)).fetchone()
        if not row:
            raise HTTPException(404, "经办人类别不存在")
        new_active = row["active"] if body.active < 0 else (1 if body.active else 0)
        # 默认类别（店员）不可停用
        if row["is_default"] and new_active == 0:
            raise HTTPException(400, "默认经办人类别不可停用")
        try:
            conn.execute("UPDATE clerk_types SET name=?,sort_order=?,active=? WHERE id=?",
                         (name, body.sort_order, new_active, cid))
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(400, "经办人类别名称已存在")
        _log(conn, op["username"], "经办人类别编辑", name)
        r = conn.execute("SELECT id,name,sort_order,is_default,active FROM clerk_types WHERE id=?",
                         (cid,)).fetchone()
        return dict(r)


# ---------------------------------------------------------------- 定金

class DepositIn(BaseModel):
    customer: str = ""
    phone: str = ""
    product_id: int | None = None
    product: str = ""
    total: float = Field(ge=0)
    deposit: float = Field(ge=0)
    balance: float = Field(ge=0)
    promised_date: str = ""
    reminder_days: int = 7


@app.get("/api/deposits")
def deposit_list(request: Request, page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        total = conn.execute(
            "SELECT COUNT(*) n FROM deposits WHERE store_id=? OR store_id=0", (sid,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM deposits WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ? OFFSET ?",
            (sid, size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.post("/api/deposits")
def deposit_create(body: DepositIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        name = body.product
        if body.product_id:
            p = _assert_product_in_store(conn, body.product_id, sid)
            if p["status"] != "在库":
                raise HTTPException(400, "仅可锁定在库商品")
            conn.execute("UPDATE products SET status='已定' WHERE id=?", (p["id"],))
            name = name or p["name"]
        cur = conn.execute(
            """INSERT INTO deposits(customer,phone,product_id,product,total,deposit,balance,promised_date,reminder_days,status,store_id)
               VALUES(?,?,?,?,?,?,?,?,?,'已定',?)""",
            (body.customer, body.phone, body.product_id, name, body.total, body.deposit, body.balance,
             body.promised_date, body.reminder_days, sid),
        )
        _touch_customer(conn, body.customer, body.phone, body.deposit, body.balance)
        conn.commit()
        _log(conn, op["username"], "收定金", body.customer)
        return {"id": cur.lastrowid}


@app.post("/api/deposits/{did}/pay")
def deposit_pay(did: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        d = conn.execute("SELECT * FROM deposits WHERE id=?", (did,)).fetchone()
        if not d:
            raise HTTPException(404, "定金单不存在")
        if d["store_id"] not in (0, sid):
            raise HTTPException(403, "该定金单不属于当前工作门店")
        if d["status"] != "已定":
            raise HTTPException(400, "单据不可收尾款")
        bill = _next_bill_no(conn)
        bill_store = d["store_id"] or sid
        conn.execute(
            """INSERT INTO sales(bill_no,customer,phone,product,product_id,amount,paid,method,biz_date,type,status,store_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (bill, d["customer"], d["phone"], d["product"], d["product_id"], d["total"], d["total"],
             "尾款转单", date.today().isoformat(), "定金转单", "已完成", bill_store),
        )
        if d["product_id"]:
            p = conn.execute("SELECT * FROM products WHERE id=?", (d["product_id"],)).fetchone()
            conn.execute("UPDATE products SET status='已售' WHERE id=?", (d["product_id"],))
            _inv(conn, d["product_id"], (p["rfid_epc"] if p else ""), "out", op["username"],
                 store_id=bill_store)
        conn.execute("UPDATE deposits SET status='已完成', balance=0, deposit=? WHERE id=?", (d["total"], did))
        if d["phone"]:
            conn.execute("UPDATE customers SET due_amount=MAX(due_amount-?,0) WHERE phone=?", (d["balance"], d["phone"]))
            conn.execute("UPDATE customers SET total_amount=total_amount+? WHERE phone=?", (d["balance"], d["phone"]))
        conn.commit()
        _log(conn, op["username"], "尾款转正式单", bill)
        return {"ok": True, "bill_no": bill}


@app.post("/api/deposits/{did}/void")
def deposit_void(did: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        d = conn.execute("SELECT * FROM deposits WHERE id=?", (did,)).fetchone()
        if not d:
            raise HTTPException(404, "定金单不存在")
        if d["store_id"] not in (0, sid):
            raise HTTPException(403, "该定金单不属于当前工作门店")
        if d["status"] != "已定":
            raise HTTPException(400, "单据不可冲红")
        if d["product_id"]:
            conn.execute("UPDATE products SET status='在库' WHERE id=?", (d["product_id"],))
        conn.execute("UPDATE deposits SET status='已冲红' WHERE id=?", (did,))
        conn.commit()
        _log(conn, op["username"], "定金冲红", str(did))
        return {"ok": True}


# ---------------------------------------------------------------- 借货

class LoanIn(BaseModel):
    direction: str = "out"
    product: str = ""
    code: str = ""              # 单件向后兼容
    codes: list[str] = Field(default_factory=list)  # 批量扫码（EPC/条码/货号混合）
    party: str = ""
    qty: int = 1
    loan_date: str = ""
    due_date: str = ""


@app.get("/api/loans")
def loan_list(request: Request, page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        total = conn.execute(
            "SELECT COUNT(*) n FROM loans WHERE store_id=? OR store_id=0", (sid,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM loans WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ? OFFSET ?",
            (sid, size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.post("/api/loans")
def loan_create(body: LoanIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        st = "借出中" if body.direction == "out" else "借入中"
        # 解析商品：优先批量 codes，其次单件 code；direction=out 才真正置"借出"。
        # 借出商品必须属于当前工作门店（借入为外部货品，不查本店库存）。
        resolved: list[sqlite3.Row] = []
        if body.codes:
            seen_raw = set()
            seen_pid = set()
            for c in body.codes:
                c2 = (c or "").strip()
                if not c2 or c2 in seen_raw:
                    continue
                seen_raw.add(c2)
                p = _resolve_product(conn, c2, sid)
                if not p:
                    raise HTTPException(400, f"扫描的码 {c2} 未登记、不存在或不属于当前门店")
                if p["id"] in seen_pid:
                    continue
                seen_pid.add(p["id"])
                if p["status"] != "在库":
                    raise HTTPException(400, f"商品 {p['code']} 当前状态为{p['status']}，无法借出")
                resolved.append(p)
        elif body.code and body.direction == "out":
            p = _resolve_product(conn, body.code, sid)
            if not p:
                raise HTTPException(400, "扫描的码未登记、不存在或不属于当前门店")
            if p["status"] != "在库":
                raise HTTPException(400, "仅可借出在库商品")
            resolved.append(p)
        if body.direction == "out":
            for p in resolved:
                conn.execute("UPDATE products SET status='借出' WHERE id=?", (p["id"],))
                _inv(conn, p["id"], p["rfid_epc"], "out", op["username"], store_id=sid)
        # 主单字段：批量时自动合成（product 顿号拼名，code 取首件货号，qty=len）
        names = "、".join(p["name"] for p in resolved)
        first_code = resolved[0]["code"] if resolved else (body.code or "")
        qty = len(resolved) if resolved else body.qty
        product_str = names or body.product
        cur = conn.execute(
            "INSERT INTO loans(direction,product,code,party,qty,loan_date,due_date,status,store_id) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (body.direction, product_str, first_code, body.party, qty,
             body.loan_date or date.today().isoformat(), body.due_date, st, sid),
        )
        conn.commit()
        _log(conn, op["username"], "借货", product_str or body.code)
        return {"id": cur.lastrowid, "count": len(resolved)}


@app.post("/api/loans/{lid}/return")
def loan_return(lid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = conn.execute("SELECT * FROM loans WHERE id=?", (lid,)).fetchone()
        if not row:
            raise HTTPException(404, "记录不存在")
        if row["store_id"] not in (0, sid):
            raise HTTPException(403, "该借货记录不属于当前工作门店")
        if row["status"] in ("已归还", "已核销"):
            raise HTTPException(400, "已归还")
        if row["direction"] == "out" and row["code"]:
            p = conn.execute("SELECT * FROM products WHERE code=?", (row["code"],)).fetchone()
            if p:
                conn.execute("UPDATE products SET status='在库' WHERE id=?", (p["id"],))
                _inv(conn, p["id"], p["rfid_epc"], "in", op["username"],
                     store_id=row["store_id"] or sid)
        st = "已归还" if row["direction"] == "out" else "已核销"
        conn.execute("UPDATE loans SET status=? WHERE id=?", (st, lid))
        conn.commit()
        _log(conn, op["username"], "借货归还", row["product"])
        return {"ok": True}


# ---------------------------------------------------------------- 客户

class CustomerIn(BaseModel):
    name: str
    phone: str = ""
    level: str = "普通"
    birthday: str = ""
    preference: str = ""
    gold_discount: float | None = None  # 金价折扣待遇（0<值<=1）；积分由开单自动累计，不在此手改


@app.get("/api/customers/list")
def customer_list(request: Request, page: int = 1, size: int = 50):
    _require_auth(request)
    with _db(request) as conn:
        total = conn.execute("SELECT COUNT(*) n FROM customers").fetchone()["n"]
        rows = conn.execute("SELECT * FROM customers ORDER BY total_amount DESC LIMIT ? OFFSET ?", (size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.get("/api/customers/lookup")
def customer_lookup(request: Request, phone: str = ""):
    """开单手机号联想：精确匹配优先，其次号码包含匹配，最多 8 条，带出会员等级/积分/金价折扣。"""
    _require_auth(request)
    q = (phone or "").strip()
    with _db(request) as conn:
        if not q:
            return {"items": []}
        exact = conn.execute(
            "SELECT * FROM customers WHERE phone=? ORDER BY total_amount DESC LIMIT 1", (q,)
        ).fetchall()
        rows = list(exact)
        if not rows:
            rows = conn.execute(
                "SELECT * FROM customers WHERE phone LIKE ? OR name LIKE ? "
                "ORDER BY total_amount DESC LIMIT 8",
                (f"%{q}%", f"%{q}%"),
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["gold_discount"] = r["gold_discount"] if r["gold_discount"] else 1.0
            out.append(d)
        return {"items": out}


@app.post("/api/customers")
def customer_create(body: CustomerIn, request: Request):
    op = _require_auth(request)
    gd = body.gold_discount
    if gd is not None and not (0 < gd <= 1):
        raise HTTPException(400, "金价折扣需在 0~1 之间（如 0.98）")
    with _db(request) as conn:
        cur = conn.execute(
            "INSERT INTO customers(name,phone,level,birthday,preference,gold_discount) VALUES(?,?,?,?,?,?)",
            (body.name, body.phone, body.level, body.birthday, body.preference,
             gd if gd is not None else 1.0),
        )
        conn.commit()
        _log(conn, op["username"], "新增客户", body.name)
        return {"id": cur.lastrowid}


@app.put("/api/customers/{cid}")
def customer_update(cid: int, body: CustomerIn, request: Request):
    op = _require_auth(request)
    gd = body.gold_discount
    if gd is not None and not (0 < gd <= 1):
        raise HTTPException(400, "金价折扣需在 0~1 之间（如 0.98）")
    with _db(request) as conn:
        if gd is not None:
            conn.execute(
                "UPDATE customers SET name=?,phone=?,level=?,birthday=?,preference=?,gold_discount=? WHERE id=?",
                (body.name, body.phone, body.level, body.birthday, body.preference, gd, cid),
            )
        else:
            conn.execute(
                "UPDATE customers SET name=?,phone=?,level=?,birthday=?,preference=? WHERE id=?",
                (body.name, body.phone, body.level, body.birthday, body.preference, cid),
            )
        conn.commit()
        _log(conn, op["username"], "修改客户", body.name)
        return {"ok": True}


# ---------------------------------------------------------------- 维修 / 采购 / 委外

class RepairIn(BaseModel):
    customer: str = ""
    phone: str = ""
    item: str = ""
    issue: str = ""
    est_fee: float = 0
    actual_fee: float = 0
    receive_date: str = ""
    promised_date: str = ""
    status: str = "待维修"
    technician: str = ""
    remark: str = ""


@app.get("/api/repairs")
def repair_list(request: Request, page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        total = conn.execute(
            "SELECT COUNT(*) n FROM repairs WHERE store_id=? OR store_id=0", (sid,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM repairs WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ? OFFSET ?",
            (sid, size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.post("/api/repairs")
def repair_create(body: RepairIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        cur = conn.execute(
            """INSERT INTO repairs(customer,phone,item,issue,est_fee,actual_fee,receive_date,promised_date,status,technician,remark,store_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (body.customer, body.phone, body.item, body.issue, body.est_fee, body.actual_fee,
             body.receive_date, body.promised_date, body.status, body.technician, body.remark, sid),
        )
        conn.commit()
        _log(conn, op["username"], "接维修", body.item)
        return {"id": cur.lastrowid}


@app.put("/api/repairs/{rid}")
def repair_update(rid: int, body: RepairIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        old = conn.execute("SELECT * FROM repairs WHERE id=?", (rid,)).fetchone()
        if not old:
            raise HTTPException(404, "维修单不存在")
        if old["store_id"] not in (0, sid):
            raise HTTPException(403, "该维修单不属于当前工作门店")
        done = date.today().isoformat() if body.status == "已完成" else (old["done_date"] if old else "")
        conn.execute(
            """UPDATE repairs SET customer=?,phone=?,item=?,issue=?,est_fee=?,actual_fee=?,
               promised_date=?,status=?,technician=?,remark=?,done_date=? WHERE id=?""",
            (body.customer, body.phone, body.item, body.issue, body.est_fee, body.actual_fee,
             body.promised_date, body.status, body.technician, body.remark, done, rid),
        )
        if old and old["status"] != "已完成" and body.status == "已完成" and body.actual_fee:
            _touch_customer(conn, body.customer, body.phone, body.actual_fee, 0)
        conn.commit()
        _log(conn, op["username"], "更新维修", str(rid))
        return {"ok": True}


class PurchaseIn(BaseModel):
    supplier: str = ""
    product: str = ""
    qty: int = 1
    cost: float = 0
    order_date: str = ""
    expected_date: str = ""
    received_date: str = ""
    status: str = "待发货"
    paid: float = 0


@app.get("/api/purchases")
def purchase_list(request: Request, page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        total = conn.execute(
            "SELECT COUNT(*) n FROM purchases WHERE store_id=? OR store_id=0", (sid,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM purchases WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ? OFFSET ?",
            (sid, size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.post("/api/purchases")
def purchase_create(body: PurchaseIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        cur = conn.execute(
            """INSERT INTO purchases(supplier,product,qty,cost,order_date,expected_date,received_date,status,paid,store_id)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (body.supplier, body.product, body.qty, body.cost, body.order_date, body.expected_date,
             body.received_date, body.status, body.paid, sid),
        )
        conn.commit()
        _log(conn, op["username"], "采购", body.product)
        return {"id": cur.lastrowid}


@app.post("/api/purchases/{pid}/receive")
def purchase_receive(pid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = conn.execute("SELECT * FROM purchases WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "采购单不存在")
        if row["store_id"] not in (0, sid):
            raise HTTPException(403, "该采购单不属于当前工作门店")
        if row["status"] == "已入库":
            raise HTTPException(400, "已入库")
        today = date.today().isoformat()
        conn.execute("UPDATE purchases SET status='已入库', received_date=? WHERE id=?", (today, pid))
        code = _next_code(conn, "CG")
        unit = (row["cost"] / row["qty"]) if row["qty"] else row["cost"]
        cur = conn.execute(
            """INSERT INTO products(code,name,category,material,weight,cost,price,status,store_id) VALUES(?,?,?,?,?,?,?,'在库',?)""",
            (code, row["product"], "其他", "", 0, unit, unit, sid),
        )
        _inv(conn, cur.lastrowid, "", "in", op["username"], row["qty"] or 1, store_id=sid)
        conn.commit()
        _log(conn, op["username"], "采购入库", code)
        return {"ok": True, "code": code}


class OutsourceIn(BaseModel):
    factory: str = ""
    product: str = ""
    material: str = ""
    weight: float = 0
    gold_price: float = 0
    labor_fee: float = 0
    send_date: str = ""
    expected_date: str = ""
    received_date: str = ""
    status: str = "加工中"


@app.get("/api/outsourcings")
def outsource_list(request: Request, page: int = 1, size: int = 50):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        total = conn.execute(
            "SELECT COUNT(*) n FROM outsourcings WHERE store_id=? OR store_id=0", (sid,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT * FROM outsourcings WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT ? OFFSET ?",
            (sid, size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.post("/api/outsourcings")
def outsource_create(body: OutsourceIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        cur = conn.execute(
            """INSERT INTO outsourcings(factory,product,material,weight,gold_price,labor_fee,send_date,expected_date,received_date,status,store_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (body.factory, body.product, body.material, body.weight, body.gold_price, body.labor_fee,
             body.send_date, body.expected_date, body.received_date, body.status, sid),
        )
        conn.commit()
        _log(conn, op["username"], "委外加工", body.product)
        return {"id": cur.lastrowid}


@app.post("/api/outsourcings/{oid}/receive")
def outsource_receive(oid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        _assert_stock_unfrozen(conn)
        row = conn.execute("SELECT * FROM outsourcings WHERE id=?", (oid,)).fetchone()
        if not row:
            raise HTTPException(404, "加工单不存在")
        if row["store_id"] not in (0, sid):
            raise HTTPException(403, "该加工单不属于当前工作门店")
        if row["status"] == "已收货":
            raise HTTPException(400, "已收货")
        today = date.today().isoformat()
        cost = row["gold_price"] * row["weight"] + row["labor_fee"]
        conn.execute("UPDATE outsourcings SET status='已收货', received_date=? WHERE id=?", (today, oid))
        code = _next_code(conn, "WW")
        cur = conn.execute(
            """INSERT INTO products(code,name,category,material,weight,cost,price,status,store_id) VALUES(?,?,?,?,?,?,?,'在库',?)""",
            (code, row["product"], "黄金", row["material"], row["weight"], cost, cost * 1.2, sid),
        )
        _inv(conn, cur.lastrowid, "", "in", op["username"], store_id=sid)
        conn.commit()
        _log(conn, op["username"], "委外收货入库", code)
        # 成本照常按公式入库（业务流转），但不向无成本权限的账号回显金额
        return {"ok": True, "code": code, "cost": round(cost, 2) if _can_view_cost(conn, op) else None}


# ---------------------------------------------------------------- 日志 / 预约 / 公开

@app.get("/api/logs")
def log_list(request: Request, page: int = 1, size: int = 80):
    _require_auth(request)
    with _db(request) as conn:
        total = conn.execute("SELECT COUNT(*) n FROM operate_logs").fetchone()["n"]
        rows = conn.execute("SELECT * FROM operate_logs ORDER BY id DESC LIMIT ? OFFSET ?", (size, (page - 1) * size)).fetchall()
        return {"total": total, "page": page, "size": size, "items": [dict(r) for r in rows]}


@app.get("/api/logs/export")
def log_export(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT * FROM operate_logs ORDER BY id DESC").fetchall()
    lines = ["id,time,operator,store,action,target,result"]
    for r in rows:
        lines.append(",".join(str(r[k]).replace(",", " ") for k in ("id", "time", "operator", "store", "action", "target", "result")))
    return PlainTextResponse("\n".join(lines), media_type="text/csv; charset=utf-8")


@app.get("/api/appointments")
def appointment_list(request: Request):
    sess = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, sess)
        rows = conn.execute(
            "SELECT * FROM appointments WHERE store_id=? OR store_id=0 ORDER BY id DESC LIMIT 100",
            (sid,)).fetchall()
        return {"items": [dict(r) for r in rows]}


class ApptStatus(BaseModel):
    status: str


@app.put("/api/appointments/{aid}")
def appointment_update(aid: int, body: ApptStatus, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        sid, _ = _current_store(request, conn, op)
        row = conn.execute("SELECT store_id FROM appointments WHERE id=?", (aid,)).fetchone()
        if not row:
            raise HTTPException(404, "预约不存在")
        if row["store_id"] not in (0, sid):
            raise HTTPException(403, "该预约不属于当前工作门店")
        conn.execute("UPDATE appointments SET status=? WHERE id=?", (body.status, aid))
        conn.commit()
        _log(conn, op["username"], "预约跟进", f"{aid}:{body.status}")
        return {"ok": True}


class PublicAppt(BaseModel):
    name: str = ""
    contact: str = ""
    contact_type: str = "phone"
    category: str = ""
    product_id: int | None = None
    want_date: str = ""
    want_slot: str = ""
    remark: str = ""


@app.post("/api/public/appointments")
def public_appointment(body: PublicAppt, request: Request):
    with _db(request) as conn:
        conn.execute(
            """INSERT INTO appointments(tenant_id,name,contact,contact_type,category,product_id,want_date,want_slot,remark,status)
               VALUES(?,?,?,?,?,?,?,?,?,'pending')""",
            (_tenant_of(request), body.name, body.contact, body.contact_type, body.category, body.product_id, body.want_date, body.want_slot, body.remark),
        )
        conn.commit()
    return {"ok": True, "detail": "预约已提交，店铺将与您联系"}


@app.get("/api/public/showcase")
def public_showcase(request: Request):
    with _db(request) as conn:
        p = conn.execute("SELECT showcase_title, showcase_subtitle FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        rows = conn.execute(
            """SELECT id, code, name, category, material, weight, size, price, cert, status, origin,
                      showcase_order, showcase_desc
                 FROM products
                WHERE showcase_public=1 AND status='在库'
                ORDER BY (showcase_order=0) ASC, showcase_order ASC, id DESC
                LIMIT 10"""
        ).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            desc = (d.get("showcase_desc") or "").strip()
            if not desc:
                parts = []
                if d.get("origin"): parts.append(f"产地：{d['origin']}")
                if d.get("material"): parts.append(f"材质：{d['material']}")
                if d.get("weight") and float(d["weight"]) > 0: parts.append(f"金重：{d['weight']:.2f}g")
                if d.get("size"): parts.append(f"尺寸：{d['size']}")
                if d.get("price"): parts.append(f"参考价：¥{d['price']:,.0f}")
                desc = "｜".join(parts)
            d["display_desc"] = desc
            items.append(d)
        return {
            "title": (p and p["showcase_title"]) or "新品橱窗",
            "subtitle": (p and p["showcase_subtitle"]) or "本周臻品 · 限量发售",
            "items": items,
        }


# ---------------- 橱窗管理 API ----------------

class ShowcaseItemIn(BaseModel):
    id: int
    order: int = 0
    desc: str = ""


class ShowcaseSyncIn(BaseModel):
    items: list[ShowcaseItemIn]
    remove: list[int] = []


def _default_desc(row: dict) -> str:
    parts = []
    if row.get("origin"): parts.append(f"产地：{row['origin']}")
    if row.get("material"): parts.append(f"材质：{row['material']}")
    if row.get("weight") and float(row["weight"]) > 0: parts.append(f"金重：{row['weight']:.2f}g")
    if row.get("size"): parts.append(f"尺寸：{row['size']}")
    if row.get("price"): parts.append(f"参考价：¥{float(row['price']):,.0f}")
    return "｜".join(parts)


@app.get("/api/showcase/list")
def showcase_list(request: Request):
    """管理端：列出橱窗商品 + 所有在库商品，前端可勾选加入。"""
    _require_auth(request)
    with _db(request) as conn:
        in_showcase = conn.execute(
            """SELECT id, code, name, product_type, material, weight, size, price, origin,
                      showcase_order, showcase_desc, status, showcase_public, image_ts
                 FROM products
                WHERE showcase_public=1 AND status='在库'
                ORDER BY (showcase_order=0) ASC, showcase_order ASC, id DESC
                LIMIT 10"""
        ).fetchall()
        in_items = []
        for r in in_showcase:
            d = dict(r)
            if not d["showcase_desc"]:
                d["showcase_desc"] = _default_desc(d)
            in_items.append(d)
        others = conn.execute(
            """SELECT id, code, name, product_type, material, weight, size, price, origin, status,
                      showcase_public, image_ts
                 FROM products
                WHERE showcase_public=0 AND status='在库'
                ORDER BY id DESC
                LIMIT 500"""
        ).fetchall()
        p = conn.execute("SELECT showcase_title, showcase_subtitle FROM tenant_profiles ORDER BY id DESC LIMIT 1").fetchone()
        return {
            "title": (p and p["showcase_title"]) or "新品橱窗",
            "subtitle": (p and p["showcase_subtitle"]) or "本周臻品 · 限量发售",
            "in_showcase": in_items,
            "max": 10,
            "count": len(in_items),
            "pool": [dict(r) for r in others],
        }


@app.put("/api/showcase/sync")
def showcase_sync(body: ShowcaseSyncIn, request: Request):
    """批量同步橱窗：加入/移出/排序/修改描述，最多 10 件。"""
    op = _require_auth(request)
    if len(body.items) > 10:
        raise HTTPException(400, "橱窗商品最多 10 件")
    with _db(request) as conn:
        # 1) 移出：移除的商品从橱窗撤下，清空排序/描述
        for pid in body.remove:
            conn.execute(
                "UPDATE products SET showcase_public=0, showcase_order=0, showcase_desc='' WHERE id=?",
                (pid,),
            )
        # 2) 加入 / 更新：写入橱窗、排序号、自定义描述（描述为空时不覆盖，前端已默认生成好）
        for it in body.items:
            conn.execute(
                """UPDATE products SET showcase_public=1, showcase_order=?, showcase_desc=?
                   WHERE id=? AND status='在库'""",
                (it.order, it.desc or "", it.id),
            )
        conn.commit()
        ids = [str(it.id) for it in body.items]
        _log(conn, op["username"], "同步橱窗", f"{len(body.items)} 件：{','.join(ids[:5])}" + ("..." if len(ids) > 5 else ""))
        return {"ok": True, "count": len(body.items)}


# ---------------------------------------------------------------- 智能安防（防盗传感器）

class SensorIn(BaseModel):
    name: str = ""
    store_id: int = 1
    location: str = ""
    driver_code: str = ""
    enabled: bool = True
    heartbeat_timeout: int | None = None  # 秒，None=不改/默认15
    field_map: str = ""  # JSON 字符串：{"原始键":"标准键"}，空=不映射


def _valid_field_map(text: str) -> str:
    """校验字段映射 JSON：必须是 {str: str} 对象；空串合法。返回规范化后的 JSON 文本。"""
    text = (text or "").strip()
    if not text:
        return ""
    try:
        obj = json.loads(text)
    except Exception:
        raise HTTPException(400, "字段映射必须是合法 JSON")
    if not isinstance(obj, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in obj.items()):
        raise HTTPException(400, "字段映射必须是 {\"原始键\":\"标准键\"} 的 JSON 对象")
    return json.dumps(obj, ensure_ascii=False)


def _sensor_view(r) -> dict:
    """设备视图：密钥永不回显；在线判定只看设备上报刷新的 last_seen（超时按设备配置）。"""
    d = dict(r)
    ttl = r["heartbeat_timeout"] or sensors.ONLINE_TTL
    d["online"] = bool(r["last_seen"] and time.time() - r["last_seen"] < ttl)
    d["has_key"] = bool((r["auth_key"] or "").strip())
    d.pop("auth_key", None)
    drv = sensors.DRIVERS.get(r["driver_code"])
    d["driver_name"] = drv.name if drv else r["driver_code"]
    d["reports_epc"] = bool(drv and drv.reports_epc)
    return d


def _lan_base() -> str:
    return f"http://{_lan_ip()}:{PORT}"


@app.get("/api/sensors/drivers")
def sensor_drivers(request: Request):
    _require_auth(request)
    return {"items": [{"code": d.driver_code, "name": d.name, "reports_epc": d.reports_epc,
                       "fields": d.fields_doc}
                      for d in sensors.DRIVERS.values()]}


@app.get("/api/sensors")
def sensor_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute("SELECT * FROM sensors ORDER BY id").fetchall()
        return {"items": [_sensor_view(r) for r in rows]}


@app.post("/api/sensors")
def sensor_create(body: SensorIn, request: Request):
    op = _require_auth(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "设备名称必填")
    if body.driver_code not in sensors.DRIVERS:
        raise HTTPException(400, "未知设备类型")
    key = sensors.new_key()
    with _db(request) as conn:
        if body.store_id and not conn.execute(
                "SELECT id FROM stores WHERE id=?", (body.store_id,)).fetchone():
            raise HTTPException(400, "门店不存在")
        cur = conn.execute(
            "INSERT INTO sensors(name,store_id,location,driver_code,auth_key,enabled,"
            "heartbeat_timeout,field_map) VALUES(?,?,?,?,?,?,?,?)",
            (name, body.store_id or 1, body.location.strip(), body.driver_code,
             key, 1 if body.enabled else 0,
             body.heartbeat_timeout or sensors.ONLINE_TTL,
             _valid_field_map(body.field_map)))
        conn.commit()
        _log(conn, op["username"], "新增安防设备", name)
        sid = cur.lastrowid
    base = _lan_base()
    return {"id": sid, "auth_key": key,
            "http_url": f"{base}/api/sensors/ingest",
            "ws_url": f"{base.replace('http', 'ws', 1)}/ws/sensor?key={key}"}


@app.put("/api/sensors/{sid}")
def sensor_update(sid: int, body: SensorIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT * FROM sensors WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "设备不存在")
        fm = _valid_field_map(body.field_map)  # 空串合法=清除映射
        conn.execute(
            "UPDATE sensors SET name=?,store_id=?,location=?,enabled=?,"
            "heartbeat_timeout=?,field_map=? WHERE id=?",
            (body.name.strip() or row["name"], body.store_id or row["store_id"],
             body.location.strip(), 1 if body.enabled else 0,
             body.heartbeat_timeout if body.heartbeat_timeout is not None else row["heartbeat_timeout"],
             fm, sid))
        conn.commit()
        _log(conn, op["username"], "修改安防设备", body.name or row["name"])
        return {"ok": True}


@app.delete("/api/sensors/{sid}")
def sensor_delete(sid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT name FROM sensors WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "设备不存在")
        conn.execute("DELETE FROM sensors WHERE id=?", (sid,))
        conn.commit()
        _log(conn, op["username"], "删除安防设备", row["name"])
        return {"ok": True}


@app.post("/api/sensors/{sid}/rotate-key")
def sensor_rotate_key(sid: int, request: Request):
    """轮换接入密钥：旧密钥立即失效，新密钥仅本次返回。"""
    op = _require_auth(request)
    key = sensors.new_key()
    with _db(request) as conn:
        row = conn.execute("SELECT name FROM sensors WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "设备不存在")
        conn.execute("UPDATE sensors SET auth_key=? WHERE id=?", (key, sid))
        conn.commit()
        _log(conn, op["username"], "轮换设备密钥", row["name"])
    return {"auth_key": key,
            "ws_url": f"{_lan_base().replace('http', 'ws', 1)}/ws/sensor?key={key}"}


@app.post("/api/sensors/ingest")
def sensor_ingest(request: Request, body: dict = Body(default={}), key: str = Query(default="")):
    """设备 HTTP 上报通道：X-Sensor-Key 头（兼容 ?key=），与 WS 通道共用 handle()。"""
    k = request.headers.get("X-Sensor-Key") or key
    with _db(request) as conn:
        s = sensors.find_by_key(conn, k)
        if not s:
            raise HTTPException(401, "设备密钥无效")
        if not s["enabled"]:
            raise HTTPException(403, "设备已禁用")
        sensors.touch(conn, s["id"])
        res = sensors.handle(conn, s, body if isinstance(body, dict) else {},
                             sandbox=(_operator_mode(request) == "SANDBOX"))
        conn.commit()
        return res


@app.websocket("/ws/sensor")
async def sensor_ws(websocket: WebSocket, key: str = ""):
    """设备 WS 上报通道：鉴权后接收上报帧；heartbeat 仅刷新在线状态。"""
    with _db(websocket) as conn:
        s = sensors.find_by_key(conn, key)
        sid = s["id"] if (s and s["enabled"]) else 0
    await websocket.accept()
    if not sid:
        await websocket.close(code=4401)
        return
    sandbox = (websocket.headers.get("X-Operator-Mode", "").upper() == "SANDBOX")
    try:
        while True:
            msg = await websocket.receive_text()
            with _db(websocket) as conn:
                s2 = conn.execute("SELECT * FROM sensors WHERE id=?", (sid,)).fetchone()
                if not s2 or not s2["enabled"]:
                    await websocket.close(code=4403)
                    return
                sensors.touch(conn, sid)
                try:
                    data = json.loads(msg)
                except Exception:
                    conn.commit()
                    continue
                if not (isinstance(data, dict) and data.get("type") == "heartbeat"):
                    sensors.handle(conn, s2, data if isinstance(data, dict) else {},
                                   sandbox=sandbox)
                conn.commit()
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        pass


@app.post("/api/sensors/{sid}/simulate")
def sensor_simulate(sid: int, request: Request, body: dict = Body(default={})):
    """模拟事件：仅 simulator 驱动设备可用，事件走与真实设备完全相同的管线。"""
    op = _require_auth(request)
    with _db(request) as conn:
        s = conn.execute("SELECT * FROM sensors WHERE id=?", (sid,)).fetchone()
        if not s:
            raise HTTPException(404, "设备不存在")
        if s["driver_code"] != "simulator":
            raise HTTPException(400, "仅模拟设备支持此操作")
        sensors.touch(conn, sid)
        res = sensors.handle(conn, s, body, sandbox=(_operator_mode(request) == "SANDBOX"))
        conn.commit()
        _log(conn, op["username"], "模拟安防事件", s["name"])
        return res


@app.get("/api/sensors/settings")
def sensor_settings_get(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        data = sensors.get_settings(conn)
    data["webhook_secret"] = "******" if data.get("webhook_secret") else ""
    data["webhook_last"] = sensors.WEBHOOK_LAST
    return data


class SensorSettingsIn(BaseModel):
    armed: bool | None = None
    arm_time: str = ""
    disarm_time: str = ""
    webhook_url: str | None = None
    webhook_secret: str | None = None
    dedup_sec: int | None = None


@app.put("/api/sensors/settings")
def sensor_settings_put(body: SensorSettingsIn, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        data = sensors.get_settings(conn)
        if body.armed is not None and bool(body.armed) != bool(data.get("armed")):
            data["armed"] = bool(body.armed)
            _log(conn, op["username"], "安防布防" if body.armed else "安防撤防", "手动")
        if body.arm_time:
            data["arm_time"] = body.arm_time
        if body.disarm_time:
            data["disarm_time"] = body.disarm_time
        if body.webhook_url is not None:
            data["webhook_url"] = body.webhook_url.strip()
        if body.webhook_secret:
            data["webhook_secret"] = body.webhook_secret.strip()
        if body.dedup_sec is not None:
            data["dedup_sec"] = max(0, int(body.dedup_sec))
        sensors.save_settings(conn, data)
        conn.commit()
    return {"ok": True}


@app.get("/api/sensors/events")
def sensor_event_list(request: Request, status: str = "", page: int = 1, size: int = 50):
    _require_auth(request)
    with _db(request) as conn:
        where, args = "", []
        if status == "pending":
            where = "WHERE e.event_type='alarm' AND e.handle_status='未处理'"
        total = conn.execute(
            f"SELECT COUNT(*) n FROM sensor_events e {where}", args).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT e.*, s.name AS sensor_name, s.location AS sensor_location
                  FROM sensor_events e LEFT JOIN sensors s ON s.id=e.sensor_id
                  {where} ORDER BY e.id DESC LIMIT ? OFFSET ?""",
            args + [size, (page - 1) * size]).fetchall()
        pending = conn.execute(
            "SELECT COUNT(*) n FROM sensor_events WHERE event_type='alarm' AND handle_status='未处理'"
        ).fetchone()["n"]
        items = []
        for r in rows:
            d = dict(r)
            try:
                d["raw"] = json.loads(d.get("raw") or "{}")
            except Exception:
                pass
            try:
                d["epcs"] = json.loads(d.get("epcs") or "[]")
            except Exception:
                pass
            items.append(d)
        return {"total": total, "page": page, "size": size, "pending": pending, "items": items}


class EventHandleIn(BaseModel):
    action: str  # confirm=确认 / false_alarm=误报
    note: str = ""


@app.post("/api/sensors/events/{eid}/handle")
def sensor_event_handle(eid: int, body: EventHandleIn, request: Request):
    op = _require_auth(request)
    st = {"confirm": "已确认", "false_alarm": "误报"}.get(body.action)
    if not st:
        raise HTTPException(400, "未知处置动作")
    with _db(request) as conn:
        row = conn.execute("SELECT id FROM sensor_events WHERE id=?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "事件不存在")
        conn.execute(
            "UPDATE sensor_events SET handle_status=?,handler=?,handle_note=?,handled_at=datetime('now','localtime')"
            " WHERE id=?", (st, op["username"], body.note.strip(), eid))
        conn.commit()
        _log(conn, op["username"], "告警处置", f"#{eid} {st}")
        return {"ok": True}


class SensorPassIn(BaseModel):
    epc: str
    reason: str = ""
    minutes: int = 60


@app.get("/api/sensors/pass")
def sensor_pass_list(request: Request):
    _require_auth(request)
    with _db(request) as conn:
        rows = conn.execute(
            "SELECT * FROM sensor_pass WHERE expires_at>datetime('now','localtime')"
            " ORDER BY id DESC").fetchall()
        return {"items": [dict(r) for r in rows]}


@app.post("/api/sensors/pass")
def sensor_pass_create(body: SensorPassIn, request: Request):
    op = _require_auth(request)
    epc = body.epc.strip().upper()
    if not epc:
        raise HTTPException(400, "EPC 必填")
    with _db(request) as conn:
        cur = conn.execute(
            "INSERT INTO sensor_pass(epc,reason,expires_at,created_by)"
            " VALUES(?,?,datetime('now','localtime',?),?)",
            (epc, body.reason.strip(), f"+{max(1, body.minutes)} minutes", op["username"]))
        conn.commit()
        _log(conn, op["username"], "手工临时放行", f"{epc} {body.reason}")
        return {"id": cur.lastrowid}


@app.delete("/api/sensors/pass/{pid}")
def sensor_pass_delete(pid: int, request: Request):
    op = _require_auth(request)
    with _db(request) as conn:
        row = conn.execute("SELECT epc FROM sensor_pass WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "记录不存在")
        conn.execute("DELETE FROM sensor_pass WHERE id=?", (pid,))
        conn.commit()
        _log(conn, op["username"], "取消临时放行", row["epc"])
        return {"ok": True}


@app.websocket("/ws/security")
async def security_ws(websocket: WebSocket, token: str = ""):
    """工作区告警推送：浏览器 WS 无法带头，用 ?token= 业务令牌鉴权。"""
    with _lock:
        sess = _sessions.get(token)
    await websocket.accept()
    if not sess:
        await websocket.close(code=4401)
        return
    sensors.sec_clients().add(websocket)
    try:
        while True:
            await websocket.receive_text()  # 客户端无需发消息，仅保活
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:
        pass
    finally:
        sensors.sec_clients().discard(websocket)


async def _security_schedule_loop():
    """每日布防/撤防定时调度：30 秒检查一次，状态不符即切换（source=定时计划）。"""
    tenant = os.environ.get("TENANT_ID") or "tenant_trial"
    while True:
        try:
            with _db_for_tenant(tenant) as conn:
                data = sensors.get_settings(conn)
                want = sensors.desired_armed(data)
                if want is not None and want != bool(data.get("armed")):
                    data["armed"] = want
                    sensors.save_settings(conn, data)
                    _log(conn, "系统", "安防布防" if want else "安防撤防", "定时计划")
                    conn.commit()
        except Exception as e:
            logger.warning("安防定时调度异常: %s", e)
        await asyncio.sleep(30)


@app.on_event("startup")
async def _security_startup():
    sensors.bind_loop(asyncio.get_running_loop())
    asyncio.create_task(_security_schedule_loop())


# ---------------------------------------------------------------- 静态资源（最后注册）

@app.get("/{asset_path:path}")
def spa_asset(asset_path: str):
    if asset_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    if asset_path.startswith("logo/"):
        f = (LOGO_DIR / Path(asset_path).name).resolve()
        if f.is_file() and _safe_relative(f, LOGO_DIR.resolve()):
            return FileResponse(str(f))
    f = (FRONTEND_DIR / asset_path).resolve()
    if f.is_file() and _safe_relative(f, FRONTEND_DIR.resolve()) and f.suffix.lower() in (
        ".js", ".css", ".map", ".png", ".svg", ".woff2", ".ico", ".jpg", ".webp", ".html",
    ):
        # 业务页面脚本/样式每次校验更新，避免发布后浏览器缓存旧版（内网工具，开销可忽略）
        nocache = {"Cache-Control": "no-cache"} if f.suffix.lower() in (".js", ".css", ".html") else None
        return FileResponse(str(f), headers=nocache)
    index = FRONTEND_DIR / "index.html"
    if index.exists() and "." not in Path(asset_path).name:
        return FileResponse(str(index), headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Not Found"}, status_code=404)


if __name__ == "__main__":
    os.environ.setdefault("UNIFIED_ACCESS_MODE", "STANDALONE")
    logger.info("懿臻珠宝云独立启动 http://%s:%s  账号 admin / admin123456", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
