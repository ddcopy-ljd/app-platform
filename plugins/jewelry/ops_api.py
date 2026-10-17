"""懿臻珠宝云 · 运维端 API（/api/ops/*，全局只读巡检）。

唯一准入方式：平台网关 PRODUCTION_SUPPORT 穿透票证注入的两个头同时成立——
  X-System-Bypass-Auth: true          （网关穿透，无业务会话）
  X-Operator-Mode: PRODUCTION_SUPPORT （必须恰为生产运维模式）
普通业务 Bearer 登录、SANDBOX 穿透（同样 bypass 但 mode=SANDBOX）一律 403。

本模块全部端点只读租户业务库，不产生任何写操作与对外副作用；
受控写操作（终止盘点/解冻/账号重置等）为后续阶段，届时必须逐笔写 operate_logs。
"""

from __future__ import annotations

import logging
import time
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger("jewelry.ops")

router = APIRouter(prefix="/api/ops", tags=["ops-console"])

# main.py 在模块加载末期注入的依赖（避免与 main 循环导入）
_deps: dict = {}


def init(*, open_conn, tenant_of, software_version: str, scan_info) -> None:
    """由 main.py 调用：注入开库函数、租户解析函数、插件版本与扫描助手包指纹函数。"""
    _deps["open_conn"] = open_conn
    _deps["tenant_of"] = tenant_of
    _deps["software_version"] = software_version
    _deps["scan_info"] = scan_info


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
