"""懿臻珠宝云 - 智能安防：防盗传感器接入与告警。

抽象驱动层 + 统一事件处理管线：
- 新增设备类型 = 新增一个 SensorDriver 子类并 @register，判定/通知/路由零改动；
- 设备两通道接入（HTTP POST /api/sensors/ingest、WS /ws/sensor）汇入同一个 handle()；
- 放行判定以商品状态为事实来源：已售/借出自动放行，冲红/归还后自动恢复拦截；
  sensor_pass 仅承载委外/展览等商品状态之外的手工临时放行；
- 告警双通道通知：工作区 WS 推送（界面弹窗声响）+ Webhook 外发（HMAC 签名）；
- 在线状态只信设备上报帧刷新 last_seen，服务端不得自刷。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import sqlite3
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger("jewelry.security")

# 设备在线判定阈值（秒）：只以设备上报帧刷新 last_seen
ONLINE_TTL = 15
# 商品处于这些状态时 EPC 通过自动放行（事实来源，无需额外授权表）
PASS_PRODUCT_STATUS = ("已售", "借出")

# ---------------------------------------------------------------- 驱动抽象层


@dataclass
class Report:
    """归一化设备上报。kind: epc=检测到EPC通过 / signal=开关量告警信号 / ping=心跳。"""
    kind: str
    epcs: list[str] = field(default_factory=list)
    alarm: bool = False
    ts: str = ""


class SensorDriver:
    """防盗设备驱动基类。parse 只负责报文→Report 转换，不做业务判定。"""

    driver_code = ""
    name = ""
    reports_epc = False  # 能力：是否上报 EPC 明细
    # 接入指南：标准字段说明 [{field, required, desc}]，供 drivers 接口/接入文档展示
    fields_doc: list[dict] = []

    def parse(self, raw: dict) -> list[Report]:
        raise NotImplementedError


DRIVERS: dict[str, SensorDriver] = {}


def register(cls):
    drv = cls()
    DRIVERS[drv.driver_code] = drv
    return cls


@register
class UhfRfidGate(SensorDriver):
    """UHF RFID 防盗通道门：上报经过门口的 EPC 明细。"""

    driver_code = "uhf_rfid_gate"
    name = "UHF RFID 防盗通道门"
    reports_epc = True
    fields_doc = [
        {"field": "epcs", "required": False, "desc": "EPC 数组，如 [\"E280...\"]；与 epc 二选一"},
        {"field": "epc", "required": False, "desc": "单个 EPC 字符串；与 epcs 二选一"},
        {"field": "type", "required": False, "desc": "\"heartbeat\" 表示心跳帧（不产生事件）"},
        {"field": "ts", "required": False, "desc": "设备侧时间戳（仅留痕）"},
    ]

    def parse(self, raw: dict) -> list[Report]:
        if raw.get("type") == "heartbeat":
            return [Report(kind="ping")]
        epcs = raw.get("epcs") or ([raw["epc"]] if raw.get("epc") else [])
        epcs = [str(e).strip().upper() for e in epcs if str(e).strip()]
        if not epcs:
            return []
        return [Report(kind="epc", epcs=epcs, ts=str(raw.get("ts") or ""))]


@register
class EasGate(SensorDriver):
    """传统 EAS 门禁（声磁/射频）：仅上报告警开关量，无 EPC 明细。"""

    driver_code = "eas_gate"
    name = "EAS 防盗门禁"
    fields_doc = [
        {"field": "alarm", "required": True, "desc": "true=检测到防盗标签经过；false=正常"},
        {"field": "type", "required": False, "desc": "\"heartbeat\" 表示心跳帧（不产生事件）"},
        {"field": "ts", "required": False, "desc": "设备侧时间戳（仅留痕）"},
    ]

    def parse(self, raw: dict) -> list[Report]:
        if raw.get("type") == "heartbeat":
            return [Report(kind="ping")]
        return [Report(kind="signal", alarm=bool(raw.get("alarm")), ts=str(raw.get("ts") or ""))]


@register
class ContactSensor(SensorDriver):
    """通用开关量传感器（门磁/震动/智能锁/PIR）：state=alarm/open/tamper 触发告警。"""

    driver_code = "contact_sensor"
    name = "通用开关量传感器"
    fields_doc = [
        {"field": "state", "required": True, "desc": "alarm/open/tamper/triggered 触发告警，其他值正常"},
        {"field": "type", "required": False, "desc": "\"heartbeat\" 表示心跳帧（不产生事件）"},
        {"field": "ts", "required": False, "desc": "设备侧时间戳（仅留痕）"},
    ]

    def parse(self, raw: dict) -> list[Report]:
        if raw.get("type") == "heartbeat":
            return [Report(kind="ping")]
        state = str(raw.get("state") or "").lower()
        return [Report(kind="signal", alarm=state in ("alarm", "open", "tamper", "triggered"),
                       ts=str(raw.get("ts") or ""))]


@register
class Simulator(SensorDriver):
    """模拟驱动：直接接受系统构造的 Report 字段，用于无硬件开发调试与演示。"""

    driver_code = "simulator"
    name = "模拟设备"
    reports_epc = True
    fields_doc = [
        {"field": "kind", "required": False, "desc": "epc（默认）/ signal / ping"},
        {"field": "epcs", "required": False, "desc": "kind=epc 时的 EPC 数组"},
        {"field": "alarm", "required": False, "desc": "kind=signal 时是否告警"},
        {"field": "ts", "required": False, "desc": "时间戳（仅留痕）"},
    ]

    def parse(self, raw: dict) -> list[Report]:
        kind = str(raw.get("kind") or "epc")
        if kind == "ping":
            return [Report(kind="ping")]
        epcs = raw.get("epcs") or ([raw["epc"]] if raw.get("epc") else [])
        epcs = [str(e).strip().upper() for e in epcs if str(e).strip()]
        return [Report(kind=kind if kind in ("epc", "signal") else "epc",
                       epcs=epcs, alarm=bool(raw.get("alarm")),
                       ts=str(raw.get("ts") or ""))]


# ---------------------------------------------------------------- 设置

_DEFAULTS = {"armed": False, "arm_time": "21:00", "disarm_time": "10:00",
             "webhook_url": "", "webhook_secret": "", "dedup_sec": 60,
             "webhook_last": ""}


def get_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT data FROM sensor_settings WHERE id=1").fetchone()
    data = dict(_DEFAULTS)
    if row and row["data"]:
        try:
            data.update(json.loads(row["data"]))
        except Exception:
            pass
    return data


def save_settings(conn: sqlite3.Connection, data: dict) -> None:
    merged = dict(_DEFAULTS)
    merged.update(data)
    conn.execute(
        "INSERT INTO sensor_settings(id,data) VALUES(1,?)"
        " ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        (json.dumps(merged, ensure_ascii=False),))


def desired_armed(data: dict, now: datetime | None = None) -> bool | None:
    """按每日布撤防时刻计算当前应处状态；时刻未配置返回 None（不校正）。"""
    now = now or datetime.now()
    arm, disarm = str(data.get("arm_time") or ""), str(data.get("disarm_time") or "")
    if not arm or not disarm:
        return None
    hhmm = now.strftime("%H:%M")
    if arm == disarm:
        return None
    if arm > disarm:  # 跨夜：如 21:00 布防、10:00 撤防
        return hhmm >= arm or hhmm < disarm
    return arm <= hhmm < disarm


# ---------------------------------------------------------------- 设备辅助


def find_by_key(conn: sqlite3.Connection, key: str):
    """按接入密钥查设备。返回 Row 或 None；调用方负责 401/403。"""
    key = (key or "").strip()
    if not key:
        return None
    for r in conn.execute("SELECT * FROM sensors WHERE enabled=1").fetchall():
        if r["auth_key"] and hmac.compare_digest(r["auth_key"], key):
            return r
    # 密钥可能属于已禁用设备：再查一次用于返回 403 而非 401
    for r in conn.execute("SELECT * FROM sensors WHERE enabled=0").fetchall():
        if r["auth_key"] and hmac.compare_digest(r["auth_key"], key):
            return r
    return None


def touch(conn: sqlite3.Connection, sensor_id: int) -> None:
    """仅在收到设备上报帧时刷新 last_seen（心跳/事件均算）。禁止其他路径调用。"""
    conn.execute("UPDATE sensors SET last_seen=? WHERE id=?", (time.time(), sensor_id))


def new_key() -> str:
    return "sk_" + secrets.token_urlsafe(24)


def _apply_field_map(raw: dict, field_map: dict) -> dict:
    """按设备字段映射把原始报文字段重命名为驱动标准名。
    field_map: {"原始键": "标准键", ...}；标准键不在原始报文中则不做重命名。
    """
    if not field_map:
        return raw
    if not isinstance(raw, dict):
        return raw
    mapped = dict(raw)
    for src, dst in field_map.items():
        if src != dst and src in raw:
            mapped.setdefault(dst, raw[src])
    return mapped


# ---------------------------------------------------------------- 事件判定


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _insert_event(conn, sensor_id: int, event_type: str, severity: str,
                  epcs: list, raw: dict, handle_status: str = "") -> dict:
    cur = conn.execute(
        "INSERT INTO sensor_events(sensor_id,event_type,severity,epcs,raw,event_ts,handle_status)"
        " VALUES(?,?,?,?,?,?,?)",
        (sensor_id, event_type, severity, json.dumps(epcs, ensure_ascii=False),
         json.dumps(raw, ensure_ascii=False), _now_str(), handle_status))
    return {"id": cur.lastrowid, "sensor_id": sensor_id, "event_type": event_type,
            "severity": severity, "epcs": epcs, "event_ts": _now_str(),
            "handle_status": handle_status}


def _epc_allowed(conn, epc: str) -> tuple[bool, dict]:
    """放行判定：商品状态 已售/借出 → 放行；或有未过期手工放行记录 → 放行。"""
    p = conn.execute(
        "SELECT id,code,name,status,price,image_ts FROM products WHERE rfid_epc=?",
        (epc,)).fetchone()
    if p and p["status"] in PASS_PRODUCT_STATUS:
        return True, {"code": p["code"], "name": p["name"], "status": p["status"],
                      "via": "商品状态"}
    row = conn.execute(
        "SELECT id FROM sensor_pass WHERE epc=? AND expires_at>?",
        (epc, _now_str())).fetchone()
    if row:
        return True, {"code": (p["code"] if p else ""), "name": (p["name"] if p else ""),
                      "status": (p["status"] if p else ""), "via": "临时放行"}
    info = {"code": (p["code"] if p else ""), "name": (p["name"] if p else ""),
            "status": (p["status"] if p else "未登记"),
            "price": (p["price"] if p else 0)}
    return False, info


def _dup_alarm(conn, sensor_id: int, dedup_sec: int, epcs: list[str]) -> bool:
    """窗口内同传感器已有覆盖任一 EPC（或 signal）的告警 → 抑制。"""
    since = datetime.fromtimestamp(time.time() - dedup_sec).strftime("%Y-%m-%d %H:%M:%S")
    rows = conn.execute(
        "SELECT epcs FROM sensor_events WHERE sensor_id=? AND event_type='alarm'"
        " AND event_ts>=?", (sensor_id, since)).fetchall()
    if not rows:
        return False
    if not epcs:  # signal 类：窗口内已有告警即抑制
        return True
    seen: set[str] = set()
    for r in rows:
        try:
            seen.update(json.loads(r["epcs"] or "[]"))
        except Exception:
            pass
    return bool(seen.intersection(epcs))


def handle(conn: sqlite3.Connection, sensor, raw: dict, sandbox: bool = False) -> dict:
    """统一事件处理入口（HTTP/WS 双通道共用）。sensor 为 sensors 表 Row。"""
    drv = DRIVERS.get(sensor["driver_code"])
    if not drv:
        return {"ok": False, "error": f"未知驱动 {sensor['driver_code']}"}
    # 字段映射（设备厂商字段名可能不同，如 tags→epcs）
    try:
        fm = json.loads(sensor["field_map"] or "{}")
    except Exception:
        fm = {}
    mapped = _apply_field_map(raw if isinstance(raw, dict) else {}, fm)
    try:
        reports = drv.parse(mapped)
    except Exception as e:
        logger.warning("驱动 %s 解析报文失败: %s", drv.driver_code, e)
        _insert_event(conn, sensor["id"], "parse_error", "warning", [],
                      {"raw": raw, "field_map": fm, "error": str(e)})
        conn.commit()
        return {"ok": False, "error": "报文解析失败", "parse_error": True}
    settings = get_settings(conn)
    armed = bool(settings.get("armed"))
    dedup_sec = int(settings.get("dedup_sec") or 60)
    events = []
    for rep in reports:
        if rep.kind == "ping":
            continue
        ev = None
        if not armed:
            # 撤防中：一律 info 留痕，不产生告警
            etype = "pass" if rep.kind == "epc" else "info"
            ev = _insert_event(conn, sensor["id"], etype, "info",
                               rep.epcs, {"raw": raw, "disarmed": True})
        elif rep.kind == "signal":
            if rep.alarm and not _dup_alarm(conn, sensor["id"], dedup_sec, []):
                ev = _insert_event(conn, sensor["id"], "alarm", "critical", [],
                                   {"raw": raw}, handle_status="未处理")
            elif rep.alarm:
                continue
            else:
                ev = _insert_event(conn, sensor["id"], "info", "info", [], {"raw": raw})
        elif rep.kind == "epc":
            denied, denied_info, allowed = [], [], []
            for epc in rep.epcs:
                ok, info = _epc_allowed(conn, epc)
                (allowed if ok else denied).append(epc)
                if not ok:
                    denied_info.append({"epc": epc, **info})
            if denied:
                fresh = [e for e in denied
                         if not _dup_alarm(conn, sensor["id"], dedup_sec, [e])]
                if fresh:
                    ev = _insert_event(
                        conn, sensor["id"], "alarm", "critical", fresh,
                        {"raw": raw, "products": [d for d in denied_info if d["epc"] in fresh]},
                        handle_status="未处理")
            if ev is None and allowed:
                ev = _insert_event(conn, sensor["id"], "pass", "info", allowed,
                                   {"raw": raw, "via": "授权通行"})
        if ev:
            events.append(ev)
    conn.commit()
    alarms = [e for e in events if e["event_type"] == "alarm"]
    if alarms:
        notify_alarms(conn, sensor, alarms, settings, sandbox)
    return {"ok": True, "events": len(events), "alarms": len(alarms)}


# ---------------------------------------------------------------- 通知

# 工作区推送客户端集合（/ws/security），由 main.py 的路由注册/注销
_sec_clients: set = set()
_sec_loop: asyncio.AbstractEventLoop | None = None
# Webhook 最近一次外发结果（进程级，供设置界面展示）
WEBHOOK_LAST = ""


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _sec_loop
    _sec_loop = loop


def sec_clients() -> set:
    return _sec_clients


def notify_alarms(conn, sensor, alarms: list[dict], settings: dict, sandbox: bool) -> None:
    payload = {"type": "alarm", "sensor_id": sensor["id"], "sensor_name": sensor["name"],
               "location": sensor["location"], "alarms": alarms, "ts": _now_str()}
    # 通道1：工作区 WS 推送（界面弹窗+声响）
    if _sec_clients and _sec_loop:
        msg = json.dumps(payload, ensure_ascii=False)
        for ws in list(_sec_clients):
            try:
                _sec_loop.call_soon_threadsafe(
                    lambda w=ws, m=msg: asyncio.ensure_future(_safe_send(w, m)))
            except Exception:
                pass
    # 通道2：Webhook 外发（异步线程，不阻塞 ingest 响应）
    url = str(settings.get("webhook_url") or "").strip()
    if url:
        threading.Thread(target=_webhook_send,
                         args=(url, str(settings.get("webhook_secret") or ""), payload, sandbox),
                         daemon=True).start()


async def _safe_send(ws, msg: str) -> None:
    try:
        await ws.send_text(msg)
    except Exception:
        _sec_clients.discard(ws)


def _webhook_send(url: str, secret: str, payload: dict, sandbox: bool) -> None:
    """外发告警：HMAC-SHA256 签名，最多 3 次指数退避重试；沙箱只记录不真实外发。"""
    global WEBHOOK_LAST
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest() if secret else ""
    if sandbox:
        WEBHOOK_LAST = f"沙箱拦截未外发 {_now_str()}"
        logger.info("[SANDBOX] webhook 拦截不外发 url=%s sig=%s", url, sig[:12])
        return
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={"Content-Type": "application/json",
                         "X-Security-Signature": sig})
            with urllib.request.urlopen(req, timeout=8) as resp:
                WEBHOOK_LAST = f"成功 HTTP {resp.status} {_now_str()}"
                logger.info("webhook 外发成功 url=%s", url)
                return
        except Exception as e:
            WEBHOOK_LAST = f"失败 {e} {_now_str()}"
            time.sleep(2 ** attempt)
    logger.warning("webhook 外发失败 url=%s: %s", url, WEBHOOK_LAST)
