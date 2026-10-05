"""懿臻珠宝云 - 插件数据库模块。

负责：租户库定位、连接、建表结构（幂等）、演示种子数据。
仅在插件进程上下文（环境变量）下使用，不依赖平台数据库。
"""

import os
import re
import sqlite3
from pathlib import Path

PLUGIN_ID = os.environ.get("PLUGIN_ID", "jewelry")
VERSION = os.environ.get("PLUGIN_VERSION", "1.0.0")
DB_DIR = Path(os.environ.get("TENANT_DB_DIR", ""))

TENANT_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")

# 数据库结构（dataVersion 1.0.0）
SCHEMA = """
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_i18n TEXT DEFAULT '{}',
  code TEXT UNIQUE,
  owner TEXT,
  bridge_key TEXT DEFAULT '',
  printer_name TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS biz_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  epc_prefix TEXT DEFAULT 'E28',
  seq_bits INTEGER DEFAULT 8,
  bridge_key TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  names TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0
);

-- 商品品类（戒指/项链/手镯…，按产品形态划分，可配置，绑定标签模板）
CREATE TABLE IF NOT EXISTS product_types (
  code TEXT PRIMARY KEY,
  names TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  label_template_id INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_i18n TEXT DEFAULT '{}',
  category TEXT DEFAULT '黄金',
  category_code TEXT DEFAULT '',
  material TEXT DEFAULT '',
  product_type TEXT DEFAULT '',
  product_type_code TEXT DEFAULT '',
  image BLOB,
  image_ts TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  size TEXT DEFAULT '',
  cert TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  price REAL DEFAULT 0,
  status TEXT DEFAULT '在库',
  store_id INTEGER,
  rfid_epc TEXT DEFAULT '',
  showcase_public INTEGER DEFAULT 0,
  showcase_order INTEGER DEFAULT 0,
  showcase_desc TEXT DEFAULT '',
  showcase_desc_i18n TEXT DEFAULT '{}',
  origin TEXT DEFAULT '',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  level TEXT DEFAULT '普通',
  total_amount REAL DEFAULT 0,
  due_amount REAL DEFAULT 0,
  birthday TEXT DEFAULT '',
  preference TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT UNIQUE,
  customer TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  product TEXT DEFAULT '',
  product_id INTEGER,
  amount REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  method TEXT DEFAULT '现金',
  biz_date TEXT DEFAULT (date('now','localtime')),
  type TEXT DEFAULT '普通',
  status TEXT DEFAULT '已完成',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tenant_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT DEFAULT '',
  name TEXT DEFAULT '懿臻珠宝',
  short_name TEXT DEFAULT '懿臻',
  slogan TEXT DEFAULT '懿德 · 臻品 · 云智',
  intro TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  hours TEXT DEFAULT '10:00-21:00',
  categories TEXT DEFAULT '黄金,钻石,翡翠,铂金,彩宝',
  logo TEXT DEFAULT '',
  storefront TEXT DEFAULT '',
  gallery TEXT DEFAULT '[]',
  published INTEGER DEFAULT 1,
  showcase_title TEXT DEFAULT '新品橱窗',
  showcase_subtitle TEXT DEFAULT '本周臻品 · 限量发售'
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  product_id INTEGER,
  product TEXT DEFAULT '',
  total REAL DEFAULT 0,
  deposit REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  promised_date TEXT DEFAULT '',
  reminder_days INTEGER DEFAULT 7,
  status TEXT DEFAULT '已定',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT DEFAULT 'in',
  product TEXT DEFAULT '',
  code TEXT DEFAULT '',
  party TEXT DEFAULT '',
  qty INTEGER DEFAULT 1,
  loan_date TEXT DEFAULT (date('now','localtime')),
  due_date TEXT DEFAULT '',
  status TEXT DEFAULT '借出中'
);

CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  item TEXT DEFAULT '',
  issue TEXT DEFAULT '',
  est_fee REAL DEFAULT 0,
  actual_fee REAL DEFAULT 0,
  receive_date TEXT DEFAULT (date('now','localtime')),
  promised_date TEXT DEFAULT '',
  done_date TEXT DEFAULT '',
  status TEXT DEFAULT '待维修',
  technician TEXT DEFAULT '',
  remark TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT DEFAULT '',
  product TEXT DEFAULT '',
  qty INTEGER DEFAULT 1,
  cost REAL DEFAULT 0,
  order_date TEXT DEFAULT (date('now','localtime')),
  expected_date TEXT DEFAULT '',
  received_date TEXT DEFAULT '',
  status TEXT DEFAULT '待发货',
  paid REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outsourcings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory TEXT DEFAULT '',
  product TEXT DEFAULT '',
  material TEXT DEFAULT '',
  weight REAL DEFAULT 0,
  gold_price REAL DEFAULT 0,
  labor_fee REAL DEFAULT 0,
  send_date TEXT DEFAULT (date('now','localtime')),
  expected_date TEXT DEFAULT '',
  received_date TEXT DEFAULT '',
  status TEXT DEFAULT '加工中'
);

CREATE TABLE IF NOT EXISTS label_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  size_width REAL DEFAULT 75,
  size_height REAL DEFAULT 25,
  layout TEXT DEFAULT '{}',
  cols INTEGER DEFAULT 1,
  gap REAL DEFAULT 0,
  copies INTEGER DEFAULT 1,
  default_printer TEXT DEFAULT '',
  is_rfid INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  epc TEXT DEFAULT '',
  type TEXT DEFAULT 'scan',
  qty INTEGER DEFAULT 1,
  ts TEXT DEFAULT (datetime('now','localtime')),
  operator TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS operate_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT DEFAULT (datetime('now','localtime')),
  operator TEXT DEFAULT '',
  store TEXT DEFAULT '',
  action TEXT DEFAULT '',
  target TEXT DEFAULT '',
  result TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT DEFAULT '',
  name TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  contact_type TEXT DEFAULT 'phone',
  category TEXT DEFAULT '',
  product_id INTEGER,
  want_date TEXT DEFAULT '',
  want_slot TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'EMPLOYEE'
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT UNIQUE,
  device TEXT DEFAULT '',
  scanned_count INTEGER DEFAULT 0,
  book_count INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  surplus_count INTEGER DEFAULT 0,
  shortage_count INTEGER DEFAULT 0,
  abnormal_count INTEGER DEFAULT 0,
  dup_count INTEGER DEFAULT 0,
  status TEXT DEFAULT '完成',
  operator TEXT DEFAULT '手持机',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER,
  result TEXT DEFAULT '相符',
  epc TEXT DEFAULT '',
  product_id INTEGER,
  code TEXT DEFAULT '',
  product TEXT DEFAULT '',
  book_status TEXT DEFAULT '',
  dup_count INTEGER DEFAULT 0
);

-- 多终端协同盘点：任务会话
CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT UNIQUE,
  task_key TEXT UNIQUE,
  status TEXT DEFAULT '进行中',
  operator TEXT DEFAULT '',
  snapshot_version TEXT DEFAULT '',
  started TEXT DEFAULT (datetime('now','localtime')),
  ended TEXT DEFAULT '',
  result_id INTEGER DEFAULT 0
);

-- 多终端协同盘点：任务内设备与临时编号
CREATE TABLE IF NOT EXISTS stocktake_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  device_key TEXT DEFAULT '',
  device_no INTEGER DEFAULT 0,
  name TEXT DEFAULT '',
  last_seen TEXT DEFAULT (datetime('now','localtime')),
  finished INTEGER DEFAULT 0,
  UNIQUE(session_id, device_key)
);

-- 多终端协同盘点：实时扫描记录（全局按任务+EPC去重）
CREATE TABLE IF NOT EXISTS stocktake_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  epc TEXT DEFAULT '',
  device_key TEXT DEFAULT '',
  device_no INTEGER DEFAULT 0,
  rssi INTEGER DEFAULT 0,
  scanned_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(session_id, epc)
);
"""


def db_file(tenant_id: str) -> Path:
    """返回某租户的库文件路径（文件名由平台命名约定决定）。"""
    return DB_DIR / f"db_{PLUGIN_ID}_{tenant_id}_v{VERSION}.sqlite"


def connect(tenant_id: str, read_only: bool = False) -> sqlite3.Connection:
    """打开（必要时创建）某租户的 SQLite 库。read_only 仅用于查询上下文。"""
    if not DB_DIR:
        raise RuntimeError("TENANT_DB_DIR 未设置")
    if not TENANT_RE.match(tenant_id or ""):
        raise ValueError("非法租户标识")
    path = db_file(tenant_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if read_only:
        if not path.exists():
            raise FileNotFoundError(f"租户库不存在：{path.name}")
        uri = f"file:{path.as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    if not read_only:
        migrate_schema(conn)
    return conn


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    names = {r[1] for r in rows}
    return col in names


def _relax_products_code_unique(conn: sqlite3.Connection) -> None:
    """放开 products.code 的唯一约束（同款多件可共享货号，底层仍以 EPC/条码 唯一标识单件）。

    SQLite 不允许直接 DROP 由 UNIQUE 约束生成的自动索引，只能重建表。这里按当前表结构
    （含 ALTER 增补列）重建，保留全部数据与列，仅去掉 code 上的 UNIQUE。
    """
    has_unique = False
    for row in conn.execute("PRAGMA index_list(products)"):
        # index_list 列：seq, name, unique, origin, partial
        if row[2] == 1 and row[3] == "u":
            cols = conn.execute(f"PRAGMA index_info({row[1]})").fetchall()
            if len(cols) == 1 and cols[0][2] == "code":
                has_unique = True
                break
    if not has_unique:
        return
    cols = conn.execute("PRAGMA table_info(products)").fetchall()
    col_defs = []
    for r in cols:
        name, ctype, notnull, dflt, pk = r[1], r[2], r[3], r[4], r[5]
        d = f'"{name}" {ctype}'
        if pk:
            d += " PRIMARY KEY"
        if notnull:
            d += " NOT NULL"
        if dflt is not None:
            d += f" DEFAULT ({dflt})"
        col_defs.append(d)
    new_sql = "CREATE TABLE products_new (\n  " + ",\n  ".join(col_defs) + "\n)"
    # 自建索引（sql 非空者）需重建；自动索引随旧表删除
    user_indexes = [
        dict(r) for r in conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products' AND sql IS NOT NULL"
        ).fetchall()
    ]
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        conn.execute(new_sql)
        conn.execute("INSERT INTO products_new SELECT * FROM products")
        conn.execute("DROP TABLE products")
        conn.execute("ALTER TABLE products_new RENAME TO products")
        for idx in user_indexes:
            if idx["sql"]:
                try:
                    conn.execute(idx["sql"])
                except Exception:
                    pass
    finally:
        conn.execute("PRAGMA foreign_keys=ON")


def migrate_schema(conn: sqlite3.Connection) -> None:
    """幂等建表，并为旧库补齐列。"""
    conn.executescript(SCHEMA)
    alters = [
        ("sales", "product_id", "INTEGER"),
        ("products", "rfid_epc", "TEXT DEFAULT ''"),
        ("products", "showcase_public", "INTEGER DEFAULT 0"),
        ("products", "showcase_order", "INTEGER DEFAULT 0"),
        ("products", "showcase_desc", "TEXT DEFAULT ''"),
        ("products", "origin", "TEXT DEFAULT ''"),
        ("products", "high_value", "INTEGER DEFAULT 0"),
        ("products", "name_i18n", "TEXT DEFAULT '{}'"),
        ("products", "category_code", "TEXT DEFAULT ''"),
        ("products", "showcase_desc_i18n", "TEXT DEFAULT '{}'"),
        ("stores", "name_i18n", "TEXT DEFAULT '{}'"),
        ("tenant_profiles", "showcase_title", "TEXT DEFAULT '新品橱窗'"),
        ("tenant_profiles", "showcase_subtitle", "TEXT DEFAULT '本周臻品 · 限量发售'"),
        ("label_templates", "definition", "TEXT DEFAULT '{}'"),
        ("categories", "label_template_id", "INTEGER DEFAULT NULL"),
        ("products", "product_type", "TEXT DEFAULT ''"),
        ("products", "product_type_code", "TEXT DEFAULT ''"),
        ("products", "image", "BLOB"),
        ("products", "image_ts", "TEXT DEFAULT ''"),
        ("biz_config", "bridge_key", "TEXT DEFAULT ''"),
        ("stores", "bridge_key", "TEXT DEFAULT ''"),
        ("stores", "printer_name", "TEXT DEFAULT ''"),
        ("products", "barcode", "TEXT DEFAULT ''"),
        ("biz_config", "epc_cleaned", "INTEGER DEFAULT 0"),
    ]
    for table, col, decl in alters:
        if not _has_column(conn, table, col):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    _relax_products_code_unique(conn)
    conn.commit()
    _seed_base_dicts(conn)
    _backfill_category_code(conn)
    _migrate_material_and_type(conn)
    conn.commit()
    _migrate_clean_dirty_epc(conn)
    conn.commit()


# 基础字典：语言 / EPC 业务配置 / 商品分类（多语言名称）
def _seed_base_dicts(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO languages(code,name,is_default,sort_order) VALUES(?,?,?,?)",
        [("zh", "中文", 1, 1), ("en", "English", 0, 2), ("it", "Italiano", 0, 3)],
    )
    conn.execute("INSERT OR IGNORE INTO biz_config(id,epc_prefix,seq_bits) VALUES(1,'E28',6)")
    categories = [
        ("01", '{"zh":"黄金","en":"Gold","it":"Oro"}', 1),
        ("02", '{"zh":"钻石","en":"Diamond","it":"Diamante"}', 2),
        ("03", '{"zh":"翡翠","en":"Jadeite","it":"Giada"}', 3),
        ("04", '{"zh":"铂金","en":"Platinum","it":"Platino"}', 4),
        ("05", '{"zh":"彩宝","en":"Colored gems","it":"Pietre colorate"}', 5),
        ("06", '{"zh":"银饰","en":"Silver","it":"Argento"}', 6),
        ("07", '{"zh":"珍珠","en":"Pearl","it":"Perla"}', 7),
        ("99", '{"zh":"其他","en":"Other","it":"Altro"}', 99),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO categories(code,names,sort_order) VALUES(?,?,?)", categories
    )
    # 商品品类（产品形态：戒指/项链…，中英意三语）
    product_types = [
        ("01", '{"zh":"戒指","en":"Ring","it":"Anello"}', 1),
        ("02", '{"zh":"项链","en":"Necklace","it":"Collana"}', 2),
        ("03", '{"zh":"手链","en":"Bracelet","it":"Bracciale"}', 3),
        ("04", '{"zh":"手镯","en":"Bangle","it":"Bracciale rigido"}', 4),
        ("05", '{"zh":"耳饰","en":"Earrings","it":"Orecchini"}', 5),
        ("06", '{"zh":"吊坠","en":"Pendant","it":"Ciondolo"}', 6),
        ("07", '{"zh":"胸针","en":"Brooch","it":"Spilla"}', 7),
        ("08", '{"zh":"摆件","en":"Ornament","it":"Oggetto"}', 8),
        ("99", '{"zh":"其他","en":"Other","it":"Altro"}', 99),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO product_types(code,names,sort_order) VALUES(?,?,?)", product_types
    )


# 旧「分类」(黄金/钻石…) 语义上是材质，统一迁移为业界标准英文简写；
# 品类（戒指/项链…）按商品名称关键字推断，无法推断归入「其他」。
# 简写取业界惯例：Au 金 / Pt 铂 / Ag 银 / DIA 钻石 / JAD 翡翠 / CGS 彩宝 / PRL 珍珠 / OTH 其他
_MAT_BY_CATCODE = {
    "01": "AU", "02": "DIA", "03": "JAD", "04": "PT",
    "05": "CGS", "06": "AG", "07": "PRL", "99": "OTH",
}
_MAT_BY_ZHNAME = {
    "黄金": "AU", "金": "AU", "铂金": "PT", "银饰": "AG", "银": "AG",
    "钻石": "DIA", "翡翠": "JAD", "彩宝": "CGS",
    "珍珠": "PRL", "其他": "OTH",
}
# 早期版本使用的英文长码 → 简写（存量数据幂等收敛）
_MAT_FULL_TO_SHORT = {
    "GOLD": "AU", "PLATINUM": "PT", "SILVER": "AG", "DIAMOND": "DIA",
    "JADEITE": "JAD", "COLORED_GEMSTONE": "CGS", "PEARL": "PRL", "OTHER": "OTH",
}
_VALID_MAT = set(_MAT_BY_CATCODE.values())
# 品名材质关键字（旧分类为兜底「其他」时按品名推断，顺序即优先级，铂必须先于金）
_MAT_NAME_KEYWORDS = [
    ("PT", ("铂金", "白金", "pt")),
    ("AG", ("银", "ag", "s925")),
    ("DIA", ("钻石", "钻", "dia")),
    ("JAD", ("翡翠", "玉", "jad")),
    ("PRL", ("珍珠", "prl")),
    ("CGS", ("彩宝", "彩钻", "宝石", "cgs")),
    ("AU", ("足金", "黄金", "金", "k金", "au", "g750", "999")),
]


def _infer_material_by_name(name: str) -> str:
    n = (name or "").lower()
    for mat, keys in _MAT_NAME_KEYWORDS:
        if any(k in n for k in keys):
            return mat
    return ""
# (品类码, 中文名, 关键字) —— 顺序即优先级（手链/手串先于手镯，耳钉先于泛称）
_TYPE_KEYWORDS = [
    ("03", "手链", ("手链", "手串")),
    ("04", "手镯", ("手镯", "镯")),
    ("01", "戒指", ("戒指", "戒")),
    ("02", "项链", ("项链", "锁骨链", "链")),
    ("05", "耳饰", ("耳钉", "耳环", "耳饰", "耳")),
    ("06", "吊坠", ("吊坠", "坠")),
    ("07", "胸针", ("胸针",)),
    ("08", "摆件", ("摆件",)),
]


def _infer_product_type(name: str) -> tuple[str, str]:
    import json as _json
    for code, zh, keys in _TYPE_KEYWORDS:
        if any(k in (name or "") for k in keys):
            return code, zh
    return "99", "其他"


def _migrate_material_and_type(conn: sqlite3.Connection) -> None:
    """把旧分类数据迁移为 英文材质 + 新品类（幂等：只补空值）。"""
    import json as _json
    type_names: dict[str, dict] = {}
    for code, names, _ in conn.execute("SELECT code,names,sort_order FROM product_types").fetchall():
        try:
            type_names[code] = _json.loads(names or "{}")
        except Exception:
            type_names[code] = {}

    rows = conn.execute(
        "SELECT id,name,category,category_code,material,product_type_code FROM products"
    ).fetchall()
    for r in rows:
        sets, args = [], []
        cur_mat = (r["material"] or "").strip()
        cur_up = cur_mat.upper()
        # 材质归一：早期英文长码先收敛为简写
        if cur_up in _MAT_FULL_TO_SHORT:
            cur_mat = _MAT_FULL_TO_SHORT[cur_up]
        # 期望材质：①旧分类码精确映射（兜底 99/OTH 视为未知）②旧中文分类名 ③品名关键字
        want = _MAT_BY_CATCODE.get(r["category_code"] or "")
        if want in ("", "OTH"):
            zh = _MAT_BY_ZHNAME.get((r["category"] or "").strip(), "")
            if zh and zh != "OTH":
                want = zh
        if want in ("", "OTH"):
            by_name = _infer_material_by_name(r["name"] or "")
            if by_name:
                want = by_name
        # 需要写入：
        # ① 旧英文长码（PLATINUM/GOLD…）必须收敛为简写落库——即使推断值
        #   与转换结果一致，库里存的仍是长码（不能用转换后的局部变量判断）；
        # ② 空/非法值一律补；当前是兜底 OTH 且能推断出精确材质时升级
        target = ""
        if cur_up in _MAT_FULL_TO_SHORT:
            # 长码本身就是确定材质：推断得到精确值时用推断值，否则直接用转换简写
            target = cur_mat if want in ("", "OTH") else want
        elif want and (cur_mat not in _VALID_MAT or (cur_mat == "OTH" and want != "OTH")):
            target = want
        if target:
            sets.append("material=?")
            args.append(target)
        # 品类：按品名推断
        if not (r["product_type_code"] or "").strip():
            tcode, tzh = _infer_product_type(r["name"] or "")
            sets.append("product_type_code=?")
            args.append(tcode)
            sets.append("product_type=?")
            args.append((type_names.get(tcode) or {}).get("zh") or tzh)
        if sets:
            args.append(r["id"])
            conn.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=?", args)


def store_segment(code: str, store_id: int = 0) -> str:
    """门店码归一化为 2 位十六进制段：本身恰为 2 位 0-9A-F 则原样保留；
    否则回退为门店序号的 2 位 hex（与 main.py 的 _hex_store_code 保持一致）。"""
    code = (code or "").strip().upper()
    if len(code) == 2 and all(c in "0123456789ABCDEF" for c in code):
        return code
    return f"{(store_id or 0) % 256:02X}"


def _epc_rule(conn: sqlite3.Connection):
    """返回 (prefix, seq_bits, 合规正则)。序号固定 4-6 位 hex。"""
    cfg = conn.execute("SELECT epc_prefix,seq_bits FROM biz_config WHERE id=1").fetchone()
    if cfg:
        prefix = (cfg[0] or "E28").strip() or "E28"
        bits = max(4, min(6, int(cfg[1] or 6)))
    else:
        prefix, bits = "E28", 6
    pat = re.compile(
        r"^" + re.escape(prefix) + r"([0-9A-F]{2})(\d{2})([0-9A-F]{%d})$" % bits
    )
    return prefix, bits, pat


def assign_rule_epcs(conn: sqlite3.Connection) -> dict[str, str]:
    """把全部商品的 EPC 校正为现行规则：前缀 + 门店码(2位hex) + 品类码(2位) + 序号。

    - 已合规、品类一致且不重复的 EPC 原样保留；
    - 空值、旧格式（无门店码）、随机芯片 TID、尾部混货号、品类错位、重复 EPC
      一律按「门店 + 品类」分组，从该组已占用序号之后续号重新分配；
    - 幂等：对已合规库重复执行不产生任何改动。
    返回 {旧EPC大写: 新EPC}（空 EPC 新建的不计入映射），供同步日志/盘点引用表。
    """
    prefix, bits, pat = _epc_rule(conn)
    seg_cache: dict[int, str] = {}

    def _seg(sid: int) -> str:
        if sid not in seg_cache:
            r = conn.execute("SELECT code FROM stores WHERE id=?", (sid,)).fetchone()
            seg_cache[sid] = store_segment(r[0] if r else "", sid)
        return seg_cache[sid]

    rows = conn.execute(
        "SELECT id,COALESCE(store_id,1),COALESCE(product_type_code,''),COALESCE(rfid_epc,'') "
        "FROM products ORDER BY id"
    ).fetchall()
    used: dict[tuple[str, str], set[int]] = {}
    seen: set[str] = set()
    parsed = []
    for pid, sid, tc, epc in rows:
        code = (tc or "99").strip().upper()[:2].ljust(2, "0") or "99"
        up = (epc or "").strip().upper()
        m = pat.match(up) if up else None
        keep = bool(m) and m.group(2) == code and up not in seen
        if keep:
            seen.add(up)
            used.setdefault((m.group(1), m.group(2)), set()).add(int(m.group(3), 16))
        parsed.append((pid, sid, code, epc or "", keep))

    def _take(key: tuple[str, str]) -> int:
        s = used.setdefault(key, set())
        n = 1
        while n in s:
            n += 1
        s.add(n)
        return n

    changed: dict[str, str] = {}
    for pid, sid, code, epc, keep in parsed:
        if keep:
            continue
        seg = _seg(sid)
        new = f"{prefix}{seg}{code}{_take((seg, code)):0{bits}X}"
        conn.execute("UPDATE products SET rfid_epc=? WHERE id=?", (new, pid))
        if epc:
            changed[epc.strip().upper()] = new
    return changed


def _migrate_clean_dirty_epc(conn: sqlite3.Connection) -> None:
    """一次性清理历史脏 EPC（随机十六进制串、尾部混入货号、品类码错位/空值）。

    规则与校正逻辑统一由 assign_rule_epcs 实现；本函数只保留
    「仅执行一次」（biz_config.epc_cleaned）的迁移闸门语义。
    """
    flag = conn.execute("SELECT epc_cleaned FROM biz_config WHERE id=1").fetchone()
    if flag and flag[0]:
        return
    assign_rule_epcs(conn)
    conn.execute("UPDATE biz_config SET epc_cleaned=1 WHERE id=1")


# 旧库商品只有中文品类名，按分类表回填 category_code
def _backfill_category_code(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT code, names FROM categories").fetchall()
    import json as _json
    name_to_code: dict[str, str] = {}
    for code, names in rows:
        try:
            m = _json.loads(names or "{}")
        except Exception:
            m = {}
        for v in m.values():
            if v:
                name_to_code[str(v)] = code
    for name, code in name_to_code.items():
        conn.execute(
            "UPDATE products SET category_code=? WHERE category=? AND (category_code IS NULL OR category_code='')",
            (code, name),
        )


def _backfill_demo_i18n(conn: sqlite3.Connection) -> None:
    """为内置演示商品补 中/英/意 三语名称与橱窗描述（幂等：直接覆盖）。"""
    import json as _json
    # code -> (zh名, en名, it名, zh橱窗, en橱窗, it橱窗)
    data = {
    "J001": ("足金手镯", "Gold Bangle", "Bracciale in oro",
             "产地：深圳水贝｜材质：足金999｜金重：28.60g｜尺寸：56号｜经典光面圆条，福韵满堂，妈妈婚嫁首选｜参考价：¥21,800",
             "Origin: Shenzhen Shuibei | Material: 999 gold | Weight: 28.60g | Size: 56 | Classic smooth bangle, fortune & joy, ideal for mothers/weddings | Ref: ¥21,800",
             "Origine: Shuibei, Shenzhen | Materiale: oro 999 | Peso: 28,60g | Taglia: 56 | Cerchio liscio classico, augurio di fortuna, ideale per mamme/matrimoni | Prezzo: ¥21.800"),
    "J002": ("钻石耳钉", "Diamond Stud Earrings", "Orecchini a punta con diamante",
             "产地：比利时安特卫普｜材质：18K金镶嵌30分天然真钻｜金重：2.40g｜H色VVS净度｜通勤百搭，闪耀出众｜参考价：¥4,280",
             "Origin: Antwerp, Belgium | 18K gold with natural 0.30ct diamond | Weight: 2.40g | Color H, VVS clarity | Versatile everyday sparkle | Ref: ¥4,280",
             "Origine: Anversa, Belgio | Oro 18K con diamante naturale 0,30ct | Peso: 2,40g | Colore H, purezza VVS | Brillante per tutti i giorni | Prezzo: ¥4.280"),
    "J003": ("翡翠观音吊坠", "Jadeite Guanyin Pendant", "Ciondolo in giada con Guanyin",
             "产地：缅甸帕敢｜材质：天然A货冰种翡翠｜总重：12.80g｜飘绿花雕，观音慈面，护佑平安｜附国检证书｜参考价：¥8,600",
             "Origin: Hpakan, Myanmar | Natural type-A icy jadeite | Weight: 12.80g | Green-float carving, Guanyin, blessing & safety | With certificate | Ref: ¥8,600",
             "Origine: Hpakan, Myanmar | Giada naturale tipo A, ghiaccio | Peso: 12,80g | Scultura Guanyin, protezione | Con certificato | Prezzo: ¥8.600"),
    "J004": ("铂金肖邦项链", "Platinum Chopard Chain", "Collana in platino Chopard",
             "产地：上海老庙｜材质：PT950 铂金｜金重：9.20g｜链长：45cm｜肖邦链柔韧有光，日常轻奢｜参考价：¥8,900",
             "Origin: Laomiao, Shanghai | Platinum PT950 | Weight: 9.20g | Length: 45cm | Supple shiny Chopard chain, daily luxury | Ref: ¥8,900",
             "Origine: Laomiao, Shanghai | Platino PT950 | Peso: 9,20g | Lunghezza: 45cm | Catena Chopard morbida e lucida, lusso quotidiano | Prezzo: ¥8.900"),
    "J005": ("红碧玺彩宝戒指", "Red Tourmaline Ring", "Anello con tormalina rossa",
             "产地：巴西米纳斯｜材质：18K金+3.2ct天然红碧玺｜金重：3.10g｜13号戒圈｜旺运招财，女王气场｜参考价：¥5,600",
             "Origin: Minas, Brazil | 18K gold + natural 3.2ct red tourmaline | Weight: 3.10g | Size 13 | Lucky & charismatic | Ref: ¥5,600",
             "Origine: Minas, Brasile | Oro 18K + tormalina rossa naturale 3,2ct | Peso: 3,10g | Taglia 13 | Portafortuna, carisma | Prezzo: ¥5.600"),
    "J006": ("黄金福字吊坠", "Gold Fortune Pendant", "Ciondolo della fortuna in oro", "", "", ""),
    "J007": ("银质一生一世对戒", "Silver Couple Rings", "Fedi d'argento (coppia)",
             "产地：广州番禺｜材质：925纯银镀铂金｜总重：8.50g｜17号戒圈｜刻字「一生一世」，情侣首选｜参考价：¥1,280",
             "Origin: Panyu, Guangzhou | 925 silver platinum-plated | Weight: 8.50g | Size 17 | Engraved «for ever», for couples | Ref: ¥1,280",
             "Origine: Panyu, Guangzhou | Argento 925 placcato platino | Peso: 8,50g | Taglia 17 | Inciso «per sempre», per coppie | Prezzo: ¥1.280"),
    "J008": ("古法黄金传承手串", "Heritage Gold Bracelet", "Bracciale in oro heritage",
             "产地：深圳百泰｜材质：足金999 古法工艺｜金重：42.30g｜18cm手围｜哑光磨砂，传家臻品｜参考价：¥32,600",
             "Origin: Baitai, Shenzhen | 999 gold, ancient craft | Weight: 42.30g | Wrist 18cm | Matte frosted, family heirloom | Ref: ¥32,600",
             "Origine: Baitai, Shenzhen | Oro puro 999, lavorazione antica | Peso: 42,30g | Polso 18cm | Opaco, pezzo di famiglia | Prezzo: ¥32.600"),
    "J009": ("祖母绿锁骨链", "Emerald Necklace", "Collana con smeraldo",
             "产地：哥伦比亚｜材质：18K金镶嵌1.8ct天然祖母绿｜金重：2.80g｜42cm锁骨链｜高贵典雅，收藏级｜参考价：¥12,800",
             "Origin: Muzo, Colombia | 18K gold with natural 1.8ct emerald | Weight: 2.80g | 42cm collarbone chain | Elegant, collectible | Ref: ¥12,800",
             "Origine: Muzo, Colombia | Oro 18K con smeraldo naturale 1,8ct | Peso: 2,80g | Collana 42cm | Elegante, da collezione | Prezzo: ¥12.800"),
    "J0095": ("蓝宝石戒指", "Sapphire Ring", "Anello con zaffiro",
              "产地：斯里兰卡｜材质：18K金+2.5ct皇家蓝蓝宝石｜金重：3.50g｜15号戒圈｜丝绒皇家蓝，尊贵非凡｜参考价：¥10,800",
              "Origin: Sri Lanka | 18K gold + 2.5ct royal blue sapphire | Weight: 3.50g | Size 15 | Velvet royal blue, noble | Ref: ¥10,800",
              "Origine: Sri Lanka | Oro 18K + zaffiro blu reale 2,5ct | Peso: 3,50g | Taglia 15 | Blu reale vellutato, nobile | Prezzo: ¥10.800"),
    "J010": ("和田玉平安扣", "Hetian Jade Peace Button", "Ciondolo di giada Hetian",
             "产地：新疆和田｜材质：和田玉羊脂白玉｜总重：15.60g｜平安扣圆圆满满，馈赠长辈佳品｜附鉴定证书｜参考价：¥7,800",
             "Origin: Hotan, Xinjiang | Hetian mutton-fat white jade | Weight: 15.60g | Peace button, ideal gift for elders | With certificate | Ref: ¥7,800",
             "Origine: Hotan, Xinjiang | Giada bianca Hetian di alta qualità | Peso: 15,60g | Ciondolo di pace, ideale in regalo agli anziani | Con certificato | Prezzo: ¥7.800"),
    "J011": ("珍珠项链", "Pearl Necklace", "Collana di perle", "", "", ""),
    }
    for code, (zh, en, it, dz, de, di) in data.items():
        ni = _json.dumps({"zh": zh, "en": en, "it": it}, ensure_ascii=False)
        di_ = _json.dumps({"zh": dz, "en": de, "it": di}, ensure_ascii=False)
        conn.execute(
            "UPDATE products SET name_i18n=?, showcase_desc_i18n=? WHERE code=?",
            (ni, di_, code),
        )



def ensure_schema(conn: sqlite3.Connection) -> None:
    migrate_schema(conn)


def ensure_new_seeds(conn: sqlite3.Connection) -> None:
    """为已有数据库补充新模块种子数据（每表独立检测）。"""
    if conn.execute("SELECT COUNT(*) FROM deposits").fetchone()[0] == 0:
        deposits = [
            ("王晓丽", "13800001111", 2, "钻石耳钉", 4280, 2000, 2280, "2026-02-15", 7, "已定"),
            ("赵明辉", "13600004444", 1, "足金手镯定制", 32000, 16000, 16000, "2026-02-28", 7, "已定"),
        ]
        conn.executemany("INSERT INTO deposits(customer,phone,product_id,product,total,deposit,balance,promised_date,reminder_days,status) VALUES(?,?,?,?,?,?,?,?,?,?)", deposits)
    if conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0] == 0:
        loans = [
            ("out", "足金手镯", "J001", "同行老刘", 1, "2026-01-20", "2026-02-20", "借出中"),
            ("in", "钻石戒指", "DR-8899", "供应商A", 1, "2026-01-25", "2026-02-15", "借入中"),
        ]
        conn.executemany("INSERT INTO loans(direction,product,code,party,qty,loan_date,due_date,status) VALUES(?,?,?,?,?,?,?,?)", loans)
    if conn.execute("SELECT COUNT(*) FROM repairs").fetchone()[0] == 0:
        repairs = [
            ("李强", "13900002222", "18K金链", "链扣断裂", 200, 180, "2026-01-18", "2026-01-25", "2026-01-24", "已完成", "王师傅", "配原装链扣"),
            ("张美凤", "13700003333", "翡翠手镯", "轻微裂纹修复", 500, 0, "2026-01-28", "2026-02-10", "", "维修中", "李师傅", ""),
        ]
        conn.executemany("INSERT INTO repairs(customer,phone,item,issue,est_fee,actual_fee,receive_date,promised_date,done_date,status,technician,remark) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", repairs)
    if conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0] == 0:
        purchases = [
            ("深圳金料供应", "足金金料", 100, 45000, "2026-01-05", "2026-01-15", "2026-01-14", "已入库", 45000),
        ]
        conn.executemany("INSERT INTO purchases(supplier,product,qty,cost,order_date,expected_date,received_date,status,paid) VALUES(?,?,?,?,?,?,?,?,?)", purchases)
    if conn.execute("SELECT COUNT(*) FROM outsourcings").fetchone()[0] == 0:
        outsourcings = [
            ("金艺加工厂", "镶钻吊坠", "18K金", 5.6, 380, 1200, "2026-01-12", "2026-01-22", "", "加工中"),
        ]
        conn.executemany("INSERT INTO outsourcings(factory,product,material,weight,gold_price,labor_fee,send_date,expected_date,received_date,status) VALUES(?,?,?,?,?,?,?,?,?,?)", outsourcings)
    if conn.execute("SELECT COUNT(*) FROM operate_logs").fetchone()[0] == 0:
        conn.execute("INSERT INTO operate_logs(operator,store,action,target,result) VALUES('admin','总店','初始化演示数据','jewelry','成功')")
    if conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0:
        customers = [("王晓丽", "13800001111", "金卡", 43600, 0, "1990-05-12", "偏好足金手镯"),
                     ("李强", "13900002222", "银卡", 12800, 21800, "1988-11-03", "钻石类"),
                     ("张美凤", "13700003333", "普通", 5600, 0, "1995-02-20", "彩宝")]
        conn.executemany("INSERT INTO customers(name,phone,level,total_amount,due_amount,birthday,preference) VALUES(?,?,?,?,?,?,?)", customers)
    if conn.execute("SELECT COUNT(*) FROM tenant_profiles").fetchone()[0] == 0:
        conn.execute(
            """INSERT INTO tenant_profiles(tenant_id,name,short_name,slogan,intro,contact,phone,address,hours,categories,published)
               VALUES('tenant_trial','懿臻珠宝总店','懿臻','懿德 · 臻品 · 云智',
                      '面向中高端珠宝门店的数智化经营。','张店长','13800000000','上海市黄浦区南京东路 88 号','10:00-21:00','黄金,钻石,翡翠,铂金,彩宝',1)"""
        )
    if conn.execute("SELECT 1 FROM users WHERE username='admin'").fetchone() is None:
        conn.execute("INSERT INTO users(username,password,display_name,role) VALUES('admin','123456','店长','TENANT_ADMIN')")
    if conn.execute("SELECT 1 FROM users WHERE username='staff'").fetchone() is None:
        conn.execute("INSERT INTO users(username,password,display_name,role) VALUES('staff','123456','店员','EMPLOYEE')")
    conn.commit()


def seed_demo(conn: sqlite3.Connection) -> None:
    """写入演示数据（幂等：仅在接近空库时执行）。"""
    if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] > 0:
        return
    stores = [("总店", "HQ", "管理员"), ("分店A", "A001", "店长小张")]
    conn.executemany("INSERT INTO stores(name,code,owner) VALUES(?,?,?)", stores)

    products = [
        # J001 - 足金手镯 (1)
        ("J001", "足金手镯", "黄金", "足金999", 28.6, "56号", "GDH-88231", 18500, 21800, "在库", 1, "", 1, 1,
         "产地：深圳水贝｜材质：足金999｜金重：28.60g｜尺寸：56号｜经典光面圆条，福韵满堂，妈妈婚嫁首选｜参考价：¥21,800",
         "深圳·水贝"),
        # J002 - 钻石耳钉 (2)
        ("J002", "钻石耳钉", "钻石", "18K金+钻石", 2.4, "单只", "DZ-12034", 3200, 4280, "在库", 1, "", 1, 2,
         "产地：比利时安特卫普｜材质：18K金镶嵌30分天然真钻｜金重：2.40g｜H色VVS净度｜通勤百搭，闪耀出众｜参考价：¥4,280",
         "比利时·安特卫普"),
        # J003 - 翡翠吊坠 (3)
        ("J003", "翡翠观音吊坠", "翡翠", "冰种飘绿", 12.8, "", "FC-55410", 6800, 8600, "在库", 1, "", 1, 3,
         "产地：缅甸帕敢｜材质：天然A货冰种翡翠｜总重：12.80g｜飘绿花雕，观音慈面，护佑平安｜附国检证书｜参考价：¥8,600",
         "缅甸·帕敢"),
        # J004 - 铂金项链 (4)
        ("J004", "铂金肖邦项链", "铂金", "PT950", 9.2, "45cm", "BJ-20988", 7200, 8900, "在库", 1, "", 1, 4,
         "产地：上海老庙｜材质：PT950 铂金｜金重：9.20g｜链长：45cm｜肖邦链柔韧有光，日常轻奢｜参考价：¥8,900",
         "上海·老庙"),
        # J005 - 彩宝戒指 (5)
        ("J005", "红碧玺彩宝戒指", "彩宝", "18K金+红碧玺", 3.1, "13号", "CB-77421", 4100, 5600, "在库", 2, "", 1, 5,
         "产地：巴西米纳斯｜材质：18K金+3.2ct天然红碧玺｜金重：3.10g｜13号戒圈｜旺运招财，女王气场｜参考价：¥5,600",
         "巴西·米纳斯"),
        # J006 - 黄金吊坠（已定，不进橱窗）
        ("J006", "黄金福字吊坠", "黄金", "足金999", 6.8, "", "GDH-90344", 4600, 5600, "已定", 1, "", 0, 0, "",
         "深圳·水贝"),
        # J007 - 银质对戒 (6)
        ("J007", "银质一生一世对戒", "银饰", "925银", 8.5, "17号", "AG-12098", 900, 1280, "在库", 2, "", 1, 6,
         "产地：广州番禺｜材质：925纯银镀铂金｜总重：8.50g｜17号戒圈｜刻字「一生一世」，情侣首选｜参考价：¥1,280",
         "广州·番禺"),
        # J008 - 古法黄金 (7)
        ("J008", "古法黄金传承手串", "黄金", "足金999 古法", 42.3, "18cm", "GDH-98771", 26800, 32600, "在库", 1, "", 1, 7,
         "产地：深圳百泰｜材质：足金999 古法工艺｜金重：42.30g｜18cm手围｜哑光磨砂，传家臻品｜参考价：¥32,600",
         "深圳·百泰"),
        # J009 - 祖母绿吊坠 (8)
        ("J009", "祖母绿锁骨链", "彩宝", "18K金+祖母绿", 2.8, "42cm", "CB-98211", 9800, 12800, "在库", 1, "", 1, 8,
         "产地：哥伦比亚｜材质：18K金镶嵌1.8ct天然祖母绿｜金重：2.80g｜42cm锁骨链｜高贵典雅，收藏级｜参考价：¥12,800",
         "哥伦比亚·木佐"),
        # J0095 - 蓝宝戒指 (9)
        ("J0095", "蓝宝石戒指", "彩宝", "18K金+斯里兰卡蓝宝", 3.5, "15号", "CB-77520", 8200, 10800, "在库", 1, "", 1, 9,
         "产地：斯里兰卡｜材质：18K金+2.5ct皇家蓝蓝宝石｜金重：3.50g｜15号戒圈｜丝绒皇家蓝，尊贵非凡｜参考价：¥10,800",
         "斯里兰卡·拉特纳普勒"),
        # J010 - 和田玉 (10)
        ("J010", "和田玉平安扣", "翡翠", "和田玉羊脂玉", 15.6, "", "FC-88211", 5800, 7800, "在库", 1, "", 1, 10,
         "产地：新疆和田｜材质：和田玉羊脂白玉｜总重：15.60g｜平安扣圆圆满满，馈赠长辈佳品｜附鉴定证书｜参考价：¥7,800",
         "新疆·和田"),
        # J011 - 珍珠项链 (不进橱窗)
        ("J011", "珍珠项链", "珍珠", "南洋金珠+925银", 0, "45cm", "", 2600, 3600, "在库", 2, "", 0, 0, "",
         "菲律宾·巴拉望"),
    ]
    conn.executemany(
        """INSERT INTO products
            (code,name,category,material,weight,size,cert,cost,price,status,store_id,rfid_epc,
             showcase_public,showcase_order,showcase_desc,origin)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        products,
    )
    # 演示商品只写了中文品类名，按分类字典回填 category_code
    _backfill_category_code(conn)
    # 再迁移为 英文材质 + 新品类
    _migrate_material_and_type(conn)
    # 补内置演示商品的中/英/意三语名称与橱窗描述
    _backfill_demo_i18n(conn)
    # 种子 EPC 统一按现行规则生成（前缀+门店码+品类码+序号），幂等
    assign_rule_epcs(conn)
    conn.commit()

    customers = [("王晓丽", "13800001111", "金卡", 43600, 0, "1990-05-12", "偏好足金手镯"),
                 ("李强", "13900002222", "银卡", 12800, 21800, "1988-11-03", "钻石类"),
                 ("张美凤", "13700003333", "普通", 5600, 0, "1995-02-20", "彩宝")]
    conn.executemany("INSERT INTO customers(name,phone,level,total_amount,due_amount,birthday,preference) VALUES(?,?,?,?,?,?,?)", customers)

    now = "date('now','localtime')"
    sales = [
        ("XS20260101001", "王晓丽", "13800001111", "足金手镯", None, 21800, 21800, "现金", "2026-01-01", "普通", "已完成"),
        ("XS20260102001", "李强", "13900002222", "钻石耳钉", None, 4280, 4280, "微信", "2026-01-02", "普通", "已完成"),
        ("XS20260103001", "张美凤", "13700003333", "翡翠吊坠", None, 8600, 8600, "刷卡", "2026-01-03", "普通", "已完成"),
    ]
    conn.executemany(
        "INSERT INTO sales(bill_no,customer,phone,product,product_id,amount,paid,method,biz_date,type,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        sales,
    )

    conn.execute("INSERT INTO users(username,password,display_name,role) VALUES('admin','123456','店长','TENANT_ADMIN')")
    conn.execute("INSERT INTO users(username,password,display_name,role) VALUES('staff','123456','店员','EMPLOYEE')")
    conn.execute(
        """INSERT INTO tenant_profiles(tenant_id,name,short_name,slogan,intro,contact,phone,address,hours,categories,published,
                                       showcase_title,showcase_subtitle)
           VALUES('tenant_trial','懿臻珠宝总店','懿臻','懿德 · 臻品 · 云智',
                  '面向中高端珠宝门店的数智化经营，一物一码、RFID 隔空盘点。',
                  '张店长','13800000000','上海市黄浦区南京东路 88 号','10:00-21:00',
                  '黄金,钻石,翡翠,铂金,彩宝',1,'新品橱窗·十月臻选','限量上新 · 到店鉴赏享 9 折礼遇')"""
    )

    deposits = [
        ("王晓丽", "13800001111", 2, "钻石耳钉", 4280, 2000, 2280, "2026-02-15", 7, "已定"),
        ("赵明辉", "13600004444", 1, "足金手镯定制", 32000, 16000, 16000, "2026-02-28", 7, "已定"),
    ]
    conn.executemany("INSERT INTO deposits(customer,phone,product_id,product,total,deposit,balance,promised_date,reminder_days,status) VALUES(?,?,?,?,?,?,?,?,?,?)", deposits)

    loans = [
        ("out", "足金手镯", "J001", "同行老刘", 1, "2026-01-20", "2026-02-20", "借出中"),
        ("in", "钻石戒指", "DR-8899", "供应商A", 1, "2026-01-25", "2026-02-15", "借入中"),
    ]
    conn.executemany("INSERT INTO loans(direction,product,code,party,qty,loan_date,due_date,status) VALUES(?,?,?,?,?,?,?,?)", loans)

    repairs = [
        ("李强", "13900002222", "18K金链", "链扣断裂", 200, 180, "2026-01-18", "2026-01-25", "2026-01-24", "已完成", "王师傅", "配原装链扣"),
        ("张美凤", "13700003333", "翡翠手镯", "轻微裂纹修复", 500, 0, "2026-01-28", "2026-02-10", "", "维修中", "李师傅", ""),
    ]
    conn.executemany("INSERT INTO repairs(customer,phone,item,issue,est_fee,actual_fee,receive_date,promised_date,done_date,status,technician,remark) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", repairs)

    purchases = [
        ("深圳金料供应", "足金金料", 100, 45000, "2026-01-05", "2026-01-15", "2026-01-14", "已入库", 45000),
    ]
    conn.executemany("INSERT INTO purchases(supplier,product,qty,cost,order_date,expected_date,received_date,status,paid) VALUES(?,?,?,?,?,?,?,?,?)", purchases)

    outsourcings = [
        ("金艺加工厂", "镶钻吊坠", "18K金", 5.6, 380, 1200, "2026-01-12", "2026-01-22", "", "加工中"),
    ]
    conn.executemany("INSERT INTO outsourcings(factory,product,material,weight,gold_price,labor_fee,send_date,expected_date,received_date,status) VALUES(?,?,?,?,?,?,?,?,?,?)", outsourcings)

    # 为已上架橱窗的 10 件商品生成初始库存流水
    showcase_ids = [
        r[0] for r in conn.execute("SELECT id FROM products WHERE showcase_public=1").fetchall()
    ]
    for pid in showcase_ids:
        conn.execute(
            "INSERT INTO inventory_logs(product_id, type, qty, operator) VALUES(?,'in',1,'init')",
            (pid,),
        )

    conn.execute(
        "INSERT INTO operate_logs(operator,store,action,target,result) VALUES('admin','总店','初始化演示数据（含10件新品橱窗）','jewelry','成功')"
    )
    conn.commit()