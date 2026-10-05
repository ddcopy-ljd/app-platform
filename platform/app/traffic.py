"""平台 HTTP 流量统计：按「租户 × 应用插件 × 小时」记录上行 / 下行。

方向约定（以服务器为中心）：
- in_bytes  入站：客户端 -> 平台，即客户端侧的上行 / 上传
- out_bytes 出站：平台 -> 客户端，即客户端侧的下行 / 下载

统计口径包含请求行、请求头、请求体与响应状态行、响应头、响应体，
比纯 body 略大，更接近网卡上真实经过的 HTTP 字节数（不含 TLS 开销）。
下行 out_bytes 为 gzip 压缩后在网络上实际传输的字节（真实流量）；
out_raw_bytes 为压缩前字节数，两者之差即压缩节省的流量。
请求体一般不压缩，in_bytes 即实际上行流量。

存储：单张小时级汇总表 traffic_hour(day, hour_of_day, tenant_id, plugin_id, source)，
     日 / 月 / 每日各时段分布均由它聚合得出，滚动保留最近 12 个自然月。
"""

import sqlite3
import threading
from datetime import date, datetime, timedelta

from .config import PLATFORM_DB

# ---------------------------------------------------------------- 归属常量
SOURCE_APP = "app"             # 企业业务访问：/app/{plugin}/{tenant}、网关票据 /gw/{ticket}
SOURCE_PROMO = "promo"         # 插件推广页：/market、/market-preview
SOURCE_PLATFORM = "platform"   # 平台管理后台自身：/api、/static、首页

PLATFORM_ID = "__platform__"   # 平台自身流量
UNKNOWN_ID = "__unknown__"     # 无法归属（票据失效等），保证总量守恒
NO_TENANT = "-"                # 该来源无租户概念

KEEP_MONTHS = 12               # 可查询的最近自然月数
_FLUSH_SECONDS = 30            # 定时落库间隔
_FLUSH_RECORDS = 200           # 内存缓冲条数上限

SCOPE_KEY = "traffic_ctx"

# 路径级统计（路由归并后 + 归属三维）：支撑「接口 / 路径 Top」分析
_PATH_DDL = (
    """CREATE TABLE IF NOT EXISTS traffic_path (
    day TEXT NOT NULL,
    hour_of_day INTEGER NOT NULL,
    route TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '-',
    plugin_id TEXT NOT NULL DEFAULT '-',
    tenant_id TEXT NOT NULL DEFAULT '-',
    requests INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    in_bytes INTEGER NOT NULL DEFAULT 0,
    out_bytes INTEGER NOT NULL DEFAULT 0,
    out_raw_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, hour_of_day, route, source, plugin_id, tenant_id)
);""",
    "CREATE INDEX IF NOT EXISTS idx_tp_day ON traffic_path(day);",
)

SCHEMA = (
    """
CREATE TABLE IF NOT EXISTS traffic_hour (
    day TEXT NOT NULL,              -- 'YYYY-MM-DD'
    hour_of_day INTEGER NOT NULL,   -- 0..23
    tenant_id TEXT NOT NULL,        -- 无租户时 '-'
    plugin_id TEXT NOT NULL,        -- __platform__ / __unknown__
    source TEXT NOT NULL,           -- app / promo / platform
    requests INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    in_bytes INTEGER NOT NULL DEFAULT 0,
    out_bytes INTEGER NOT NULL DEFAULT 0,       -- 下行：gzip 压缩后实际传输
    out_raw_bytes INTEGER NOT NULL DEFAULT 0,   -- 下行：压缩前
    PRIMARY KEY (day, hour_of_day, tenant_id, plugin_id, source)
);""",
    "CREATE INDEX IF NOT EXISTS idx_th_day ON traffic_hour(day);",
    "CREATE INDEX IF NOT EXISTS idx_th_tenant ON traffic_hour(tenant_id, day);",
    "CREATE INDEX IF NOT EXISTS idx_th_plugin ON traffic_hour(plugin_id, day);",
) + _PATH_DDL

_DIM_COLUMN = {"tenant": "tenant_id", "app": "plugin_id"}
_STATUS_LINE_EXTRA = len(b"HTTP/1.1 200 \r\n")
_HEADER_EXTRA = len(b": \r\n")


def ensure_schema(conn: sqlite3.Connection) -> None:
    for statement in SCHEMA:
        conn.execute(statement)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(traffic_hour)")}
    if "out_raw_bytes" not in cols:  # 旧库平滑升级：补压缩前字节数列
        conn.execute("ALTER TABLE traffic_hour ADD COLUMN out_raw_bytes INTEGER NOT NULL DEFAULT 0")
    pcols = {r[1] for r in conn.execute("PRAGMA table_info(traffic_path)")}
    if "plugin_id" not in pcols:  # 早期路径表无归属列，数据量小，直接重建
        conn.execute("DROP TABLE traffic_path")
        for statement in _PATH_DDL:
            conn.execute(statement)


def _headers_size(headers) -> int:
    return sum(len(k) + len(v) + _HEADER_EXTRA for k, v in (headers or []))


def route_of(path: str) -> str:
    """把请求路径归并为统计路由，避免高基数（一次性票据、资源 ID）撑爆 Top 表。

    /gw/{票据}/…          -> /gw/{ticket}   （票据一次性，统一归并）
    /app/{插件}/{租户}/…  -> 取前 4 段（带出插件/租户/一级资源）
    其余                   -> 取前 3 段（如 /api/auth/login、/static/app.js）
    """
    parts = [p for p in (path or "").split("/") if p]
    if not parts:
        return "/"
    if parts[0] == "gw":
        return "/gw/{ticket}"
    n = 4 if parts[0] == "app" else 3
    return ("/" + "/".join(parts[:n]))[:80]


def _month_floor(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, months: int) -> date:
    base = _month_floor(d)
    y, m = divmod(base.month - 1 + months, 12)
    return base.replace(year=base.year + y, month=m + 1)


def keep_from() -> date:
    """当前数据保留起点：含当月在内的最近 KEEP_MONTHS 个自然月的 1 号。"""
    return _add_months(date.today(), -(KEEP_MONTHS - 1))


def parse_day(value: str | None, default: date) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date() if value else default


def resolve_range(months: int = KEEP_MONTHS, start: str | None = None,
                  end: str | None = None) -> tuple[date, date]:
    """查询区间：默认最近 months 个自然月（含当月）。"""
    today = date.today()
    last = parse_day(end, today)
    first = parse_day(start, today) if start else _add_months(last, -(months - 1))
    return first, last


def _buckets(first: date, last: date, granularity: str) -> list[str]:
    if granularity == "month":
        out, cur = [], _month_floor(first)
        while cur <= last:
            out.append(f"{cur:%Y-%m}")
            cur = _add_months(cur, 1)
        return out
    if granularity == "day":
        out, cur = [], first
        while cur <= last:
            out.append(f"{cur:%Y-%m-%d}")
            cur = date.fromordinal(cur.toordinal() + 1)
        return out
    if granularity == "hour":
        out, cur = [], first
        while cur <= last:
            out.extend(f"{cur:%Y-%m-%d} {h:02d}" for h in range(24))
            cur = date.fromordinal(cur.toordinal() + 1)
        return out
    if granularity == "hod":
        return [f"{h:02d}" for h in range(24)]
    raise ValueError(f"不支持的粒度：{granularity}")


def _empty_cell(bucket: str) -> dict:
    return {"bucket": bucket, "requests": 0, "errors": 0,
            "in_bytes": 0, "out_bytes": 0, "out_raw_bytes": 0}


def _sum_cell(row) -> dict:
    return {"requests": row["requests"], "errors": row["errors"], "in_bytes": row["in_bytes"],
            "out_bytes": row["out_bytes"], "out_raw_bytes": row["out_raw_bytes"]}


# ---------------------------------------------------------------- 归属分类
def classify(scope: dict) -> dict:
    """按 URL 判定流量归属；/gw 票据的真实租户由 handler 回填。"""
    path = scope.get("path", "")
    if path.startswith("/app/"):
        seg = path.split("/")
        if len(seg) >= 4 and seg[2] and seg[3]:
            return {"source": SOURCE_APP, "plugin_id": seg[2], "tenant_id": seg[3]}
        return {"source": SOURCE_APP, "plugin_id": UNKNOWN_ID, "tenant_id": UNKNOWN_ID}
    if path.startswith("/gw/"):
        return {"source": SOURCE_APP, "plugin_id": UNKNOWN_ID, "tenant_id": UNKNOWN_ID}
    if path.startswith("/market/") or path.startswith("/market-preview/"):
        seg = path.split("/")
        return {"source": SOURCE_PROMO, "plugin_id": seg[2] if len(seg) > 2 else UNKNOWN_ID,
                "tenant_id": NO_TENANT}
    return {"source": SOURCE_PLATFORM, "plugin_id": PLATFORM_ID, "tenant_id": NO_TENANT}


def bind(request, *, plugin_id: str | None = None, tenant_id: str | None = None,
         source: str | None = None) -> None:
    """路由处理函数回填真实归属（/gw 票据在解析后才能确定租户）。"""
    ctx = request.scope.get(SCOPE_KEY)
    if ctx is None:
        return
    if plugin_id:
        ctx["plugin_id"] = plugin_id
    if tenant_id:
        ctx["tenant_id"] = tenant_id
    if source:
        ctx["source"] = source


class TrafficStats:
    """小时级计数器：内存累加后按增量 UPSERT 落库，异常退出最多丢一个刷新周期的数据。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buf: dict[tuple, list[int]] = {}
        self._path_buf: dict[tuple, list[int]] = {}
        self._flushed_at = datetime.now()
        self._dirty = 0

    # ---------------------------------------------------------- 记录
    def record(self, ctx: dict, in_bytes: int, out_bytes: int, status: int,
               out_raw: int | None = None, route: str = "") -> None:
        """out_raw：压缩前下行字节数；缺省或小于实际值时按未压缩处理。
        route：归并后的请求路径，用于「接口 / 路径 Top」统计。"""
        if out_raw is None or out_raw < out_bytes:
            out_raw = out_bytes
        now = datetime.now()
        bad = 1 if status >= 400 else 0
        key = (f"{now:%Y-%m-%d}", now.hour, ctx.get("tenant_id") or NO_TENANT,
               ctx.get("plugin_id") or PLATFORM_ID, ctx.get("source") or SOURCE_PLATFORM)
        with self._lock:
            cell = self._buf.get(key)
            if cell is None:
                self._buf[key] = cell = [0, 0, 0, 0, 0]
            cell[0] += 1
            cell[1] += bad
            cell[2] += in_bytes
            cell[3] += out_bytes
            cell[4] += out_raw
            self._dirty += 1
            if route:
                pk = (key[0], key[1], route, key[4], key[3], key[2])  # day, hour, route, source, plugin, tenant
                pc = self._path_buf.get(pk)
                if pc is None:
                    self._path_buf[pk] = pc = [0, 0, 0, 0, 0]
                pc[0] += 1
                pc[1] += bad
                pc[2] += in_bytes
                pc[3] += out_bytes
                pc[4] += out_raw
        if self._dirty >= _FLUSH_RECORDS or (datetime.now() - self._flushed_at).total_seconds() >= _FLUSH_SECONDS:
            self.flush()

    # ---------------------------------------------------------- 落库
    def flush(self) -> None:
        with self._lock:
            rows = list(self._buf.items())
            self._buf = {}
            path_rows = list(self._path_buf.items())
            self._path_buf = {}
            self._dirty = 0
            self._flushed_at = datetime.now()
        if path_rows:
            with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
                ensure_schema(conn)
                conn.executemany(
                    "INSERT INTO traffic_path "
                    "(day, hour_of_day, route, source, plugin_id, tenant_id, "
                    "requests, errors, in_bytes, out_bytes, out_raw_bytes) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(day, hour_of_day, route, source, plugin_id, tenant_id) "
                    "DO UPDATE SET requests = requests + excluded.requests, errors = errors + excluded.errors, "
                    "in_bytes = in_bytes + excluded.in_bytes, out_bytes = out_bytes + excluded.out_bytes, "
                    "out_raw_bytes = out_raw_bytes + excluded.out_raw_bytes",
                    [(d, h, r, s, p, t, c[0], c[1], c[2], c[3], c[4])
                     for (d, h, r, s, p, t), c in path_rows],
                )
                conn.commit()
        if not rows:
            return
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            ensure_schema(conn)
            conn.executemany(
                "INSERT INTO traffic_hour "
                "(day, hour_of_day, tenant_id, plugin_id, source, requests, errors, in_bytes, out_bytes, out_raw_bytes) "
                "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day, hour_of_day, tenant_id, plugin_id, source) "
                "DO UPDATE SET requests = requests + excluded.requests, errors = errors + excluded.errors, "
                "in_bytes = in_bytes + excluded.in_bytes, out_bytes = out_bytes + excluded.out_bytes, "
                "out_raw_bytes = out_raw_bytes + excluded.out_raw_bytes",
                [(d, h, t, p, s, c[0], c[1], c[2], c[3], c[4]) for (d, h, t, p, s), c in rows],
            )
            conn.commit()

    # ---------------------------------------------------------- 查询辅助
    def _agg(self, where: str, params: list) -> dict:
        """单个区间的总量聚合。"""
        self.flush()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            ensure_schema(conn)
            row = conn.execute(
                "SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(errors),0) AS errors, "
                "COALESCE(SUM(in_bytes),0) AS in_bytes, COALESCE(SUM(out_bytes),0) AS out_bytes, "
                "COALESCE(SUM(MAX(out_raw_bytes, out_bytes)),0) AS out_raw_bytes "
                f"FROM traffic_hour WHERE {where}", params
            ).fetchone()
        return _sum_cell(row)

    def summary(self) -> dict:
        """今日 / 本月 / 近 12 个月的总量概览。"""
        today = date.today()
        return {
            "keep_from": f"{keep_from():%Y-%m-%d}",
            "keep_months": KEEP_MONTHS,
            "today": self._agg("day = ?", [f"{today:%Y-%m-%d}"]),
            "month": self._agg("day >= ?", [f"{_month_floor(today):%Y-%m-%d}"]),
            "months12": self._agg("day >= ?", [f"{keep_from():%Y-%m-%d}"]),
        }

    def query(self, dim: str = "tenant", granularity: str = "month", start: str | None = None,
              end: str | None = None, months: int = KEEP_MONTHS, plugin_id: str | None = None,
              tenant_id: str | None = None) -> dict:
        """按 dim（tenant / app）维度、granularity（month / day / hour / hod）粒度统计流量。"""
        if dim not in _DIM_COLUMN:
            raise ValueError("dim 只能为 tenant 或 app")
        if granularity not in ("month", "day", "hour", "hod"):
            raise ValueError("granularity 只能为 month / day / hour / hod")
        first, last = resolve_range(months, start, end)
        if (last - first).days > 400:
            raise ValueError("查询跨度不能超过 400 天")
        if granularity == "hour" and (last - first).days > 31:
            raise ValueError("小时粒度最多支持 31 天")

        col = _DIM_COLUMN[dim]
        where = ["day >= ?", "day <= ?"]
        params: list = [f"{first:%Y-%m-%d}", f"{last:%Y-%m-%d}"]
        if plugin_id:
            where.append("plugin_id = ?")
            params.append(plugin_id)
        if tenant_id:
            where.append("tenant_id = ?")
            params.append(tenant_id)
        if granularity == "hod":
            group_expr, group_by = "printf('%02d', hour_of_day)", "hour_of_day"
        else:
            group_expr = {"month": "substr(day, 1, 7)", "day": "day",
                          "hour": "day || ' ' || substr('0' || hour_of_day, -2)"}[granularity]
            group_by = group_expr

        self.flush()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            ensure_schema(conn)
            rows = conn.execute(
                f"SELECT {group_expr} AS bucket, {col} AS key, SUM(requests) AS requests, "
                f"SUM(errors) AS errors, SUM(in_bytes) AS in_bytes, SUM(out_bytes) AS out_bytes, "
                f"SUM(MAX(out_raw_bytes, out_bytes)) AS out_raw_bytes "
                f"FROM traffic_hour WHERE {' AND '.join(where)} GROUP BY {group_by}, {col} "
                f"ORDER BY {col}, bucket", params
            ).fetchall()
            names = self._names(dim, {r["key"] for r in rows})

        buckets = _buckets(first, last, granularity)
        index = {b: i for i, b in enumerate(buckets)}
        matrix: dict[str, list[dict]] = {}
        for row in rows:
            series = matrix.setdefault(row["key"], [_empty_cell(b) for b in buckets])
            cell = series[index[row["bucket"]]]
            cell["requests"] += row["requests"]
            cell["errors"] += row["errors"]
            cell["in_bytes"] += row["in_bytes"]
            cell["out_bytes"] += row["out_bytes"]
            cell["out_raw_bytes"] += row["out_raw_bytes"]

        result_rows = []
        for key, series in matrix.items():
            total = {"requests": sum(c["requests"] for c in series),
                     "errors": sum(c["errors"] for c in series),
                     "in_bytes": sum(c["in_bytes"] for c in series),
                     "out_bytes": sum(c["out_bytes"] for c in series),
                     "out_raw_bytes": sum(c["out_raw_bytes"] for c in series)}
            result_rows.append({"id": key, "name": names.get(key, key), "total": total, "series": series})
        result_rows.sort(key=lambda r: -(r["total"]["in_bytes"] + r["total"]["out_bytes"]))
        grand = {"requests": sum(r["total"]["requests"] for r in result_rows),
                 "errors": sum(r["total"]["errors"] for r in result_rows),
                 "in_bytes": sum(r["total"]["in_bytes"] for r in result_rows),
                 "out_bytes": sum(r["total"]["out_bytes"] for r in result_rows),
                 "out_raw_bytes": sum(r["total"]["out_raw_bytes"] for r in result_rows)}
        return {
            "dim": dim, "granularity": granularity,
            "start": f"{first:%Y-%m-%d}", "end": f"{last:%Y-%m-%d}",
            "buckets": buckets, "rows": result_rows, "total": grand,
        }

    # ---------------------------------------------------------- Top / 摘要
    _ALERT_ERR_COUNT = 200    # 单日错误数告警阈值
    _ALERT_ERR_RATE = 0.30    # 单日错误率告警阈值
    _ALERT_SPIKE = 3.0        # 流量环比暴涨倍数

    def top(self, start: str | None = None, end: str | None = None, limit: int = 20) -> dict:
        """指定范围内流量最大的请求路径 Top N。"""
        first, last = resolve_range(start=start, end=end)
        if (last - first).days > 400:
            raise ValueError("查询跨度不能超过 400 天")
        limit = max(1, min(int(limit), 100))
        where = ["day >= ?", "day <= ?"]
        params: list = [f"{first:%Y-%m-%d}", f"{last:%Y-%m-%d}"]
        self.flush()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            ensure_schema(conn)
            rows = conn.execute(
                "SELECT route, source, plugin_id, tenant_id, "
                "SUM(requests) AS requests, SUM(errors) AS errors, "
                "SUM(in_bytes) AS in_bytes, SUM(out_bytes) AS out_bytes, "
                "SUM(MAX(out_raw_bytes, out_bytes)) AS out_raw_bytes "
                f"FROM traffic_path WHERE {' AND '.join(where)} "
                "GROUP BY route, source, plugin_id, tenant_id "
                "ORDER BY in_bytes + out_bytes DESC LIMIT ?", params + [limit]
            ).fetchall()
            overall = conn.execute(
                "SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(errors),0) AS errors, "
                "COALESCE(SUM(in_bytes),0) AS in_bytes, COALESCE(SUM(out_bytes),0) AS out_bytes, "
                "COALESCE(SUM(MAX(out_raw_bytes, out_bytes)),0) AS out_raw_bytes "
                f"FROM traffic_path WHERE {' AND '.join(where)}", params
            ).fetchone()
        pname = self._names("app", {r["plugin_id"] for r in rows
                                    if r["plugin_id"] not in (PLATFORM_ID, UNKNOWN_ID, NO_TENANT)})
        tname = self._names("tenant", {r["tenant_id"] for r in rows
                                       if r["tenant_id"] not in (PLATFORM_ID, UNKNOWN_ID, NO_TENANT)})

        def owner(r) -> str:
            p, t = r["plugin_id"], r["tenant_id"]
            if p == PLATFORM_ID:
                return "平台自身"
            if p == UNKNOWN_ID:
                return "未归属"
            base = pname.get(p, p)
            if t in (NO_TENANT, UNKNOWN_ID, None, ""):
                return base
            return f"{base} · {tname.get(t, t)}"

        return {
            "start": f"{first:%Y-%m-%d}", "end": f"{last:%Y-%m-%d}",
            "rows": [{"route": r["route"], "owner": owner(r),
                      "requests": r["requests"], "errors": r["errors"],
                      "in_bytes": r["in_bytes"], "out_bytes": r["out_bytes"],
                      "out_raw_bytes": r["out_raw_bytes"]} for r in rows],
            "total": _sum_cell(overall),
        }

    def digest(self) -> dict:
        """首页每日摘要：昨日 / 今日流量 + 环比 + 异常告警。"""
        today = date.today()
        yesterday, before = today - timedelta(days=1), today - timedelta(days=2)
        cells = {
            "today": self._agg("day = ?", [f"{today:%Y-%m-%d}"]),
            "yesterday": self._agg("day = ?", [f"{yesterday:%Y-%m-%d}"]),
            "day_before": self._agg("day = ?", [f"{before:%Y-%m-%d}"]),
        }
        alerts: list[str] = []

        def check(label: str, c: dict) -> None:
            if c["requests"] >= 50 and c["errors"] >= self._ALERT_ERR_COUNT:
                alerts.append(f"{label}错误 {c['errors']:,} 次（请求 {c['requests']:,} 次），"
                              f"请查看「接口/路径 Top」定位来源")
            elif c["requests"] >= 100 and c["errors"] / c["requests"] >= self._ALERT_ERR_RATE:
                alerts.append(f"{label}错误率 {c['errors'] / c['requests']:.0%}，偏高")

        check("今日截至目前", cells["today"])
        check("昨日", cells["yesterday"])
        tb = cells["day_before"]["out_bytes"] + cells["day_before"]["in_bytes"]
        ty = cells["yesterday"]["out_bytes"] + cells["yesterday"]["in_bytes"]
        if tb > 0 and ty > tb * self._ALERT_SPIKE:
            alerts.append(f"昨日流量为前日的 {ty / tb:.1f} 倍，请留意异常来源")
        return {"date": f"{today:%Y-%m-%d}", **cells, "alerts": alerts}

    @staticmethod
    def _names(dim: str, keys: set[str]) -> dict:
        keys = {k for k in keys if k not in (PLATFORM_ID, UNKNOWN_ID, NO_TENANT)}
        if not keys:
            return {}
        table = "tenants" if dim == "tenant" else "plugins"
        marks = ",".join("?" * len(keys))
        try:
            with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
                rows = conn.execute(f"SELECT id, name FROM {table} WHERE id IN ({marks})", list(keys)).fetchall()
        except sqlite3.Error:
            return {}
        return {r[0]: r[1] for r in rows}


stats = TrafficStats()


class RawOutMiddleware:
    """位于 GZip 内层：统计压缩前的响应字节数，经 scope 传给外层 TrafficMiddleware 汇总。"""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        raw = 0

        async def _send(message):
            nonlocal raw
            if message["type"] == "http.response.start":
                raw += _STATUS_LINE_EXTRA + len(str(message.get("status", 200))) \
                    + _headers_size(message.get("headers")) + len(b"\r\n")
            elif message["type"] == "http.response.body":
                raw += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            scope["traffic_raw_out"] = raw


class TrafficMiddleware:
    """纯 ASGI 中间件：包装 receive / send 统计双向字节数，兼容流式响应。

    位于 GZip 外层，out_bytes 即客户端实际收到的压缩后字节数（真实流量）。
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        ctx = classify(scope)
        scope[SCOPE_KEY] = ctx
        query = scope.get("query_string", b"")
        if isinstance(query, str):
            query = query.encode("utf-8")
        in_bytes = len(scope.get("method", "")) + len(scope.get("path", "")) + len(query) \
            + len(b"  HTTP/1.1\r\n") + _headers_size(scope.get("headers"))
        out_bytes = 0
        status = 500

        async def _receive():
            nonlocal in_bytes
            message = await receive()
            if message["type"] == "http.request":
                in_bytes += len(message.get("body", b""))
            return message

        async def _send(message):
            nonlocal out_bytes, status
            if message["type"] == "http.response.start":
                status = message.get("status", 200)
                out_bytes += _STATUS_LINE_EXTRA + len(str(status)) \
                    + _headers_size(message.get("headers")) + len(b"\r\n")
            elif message["type"] == "http.response.body":
                out_bytes += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, _receive, _send)
        finally:
            stats.record(ctx, in_bytes, out_bytes, status, scope.get("traffic_raw_out"),
                         route_of(scope.get("path", "")))


def init_traffic() -> None:
    """启动：建表并清理超出保留期的数据。"""
    with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
        ensure_schema(conn)
        conn.execute("DELETE FROM traffic_hour WHERE day < ?", (f"{keep_from():%Y-%m-%d}",))
        conn.execute("DELETE FROM traffic_path WHERE day < ?", (f"{keep_from():%Y-%m-%d}",))
        conn.commit()


def shutdown_traffic() -> None:
    stats.flush()
