"""BugPulse 缺陷跟踪 - 插件数据库模块。

负责：租户库定位、连接、建表结构（幂等）、种子数据。
仅在插件进程上下文（环境变量）下使用，不依赖平台数据库。
"""

import hashlib
import os
import re
import secrets
import sqlite3
from pathlib import Path

PLUGIN_ID = os.environ.get("PLUGIN_ID", "bugtracker")
VERSION = os.environ.get("PLUGIN_VERSION", "1.0.0")
DATA_VERSION = os.environ.get("DATA_VERSION", "1.0.0")
DB_DIR = Path(os.environ.get("TENANT_DB_DIR", ""))

TENANT_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")

# ---------------------------------------------------------------- 密码哈希（PBKDF2-SHA256，标准库实现，列表/接口永不回显）


def hash_password(plain: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), bytes.fromhex(salt), 100_000)
    return f"pbkdf2_sha256$100000${salt}${digest.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    """校验密码；兼容历史明文库（不含 $ 分隔符视为明文，命中后由调用方升级为哈希）。"""
    if "$" not in stored:
        return plain == stored
    try:
        algo, iters, salt, digest = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), bytes.fromhex(salt), int(iters))
        return secrets.compare_digest(calc.hex(), digest)
    except Exception:
        return False

# 数据库结构（随版本幂等演进：建表 IF NOT EXISTS，新增列见 migrate_schema 的 alters）
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'MEMBER',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  descr TEXT DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 100,
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  module TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'major',
  priority TEXT NOT NULL DEFAULT 'p2',
  assignee TEXT DEFAULT '未指派',
  reporter TEXT DEFAULT '',
  -- 外部上报来源（免登录 /api/report 写入；站内创建为空串）
  source_plugin TEXT DEFAULT '',
  source_reporter TEXT DEFAULT '',
  steps TEXT DEFAULT '',
  actual TEXT DEFAULT '',
  expected TEXT DEFAULT '',
  created TEXT DEFAULT (datetime('now','localtime')),
  updated TEXT DEFAULT (datetime('now','localtime'))
);

-- 截图凭据：图片二进制存 storage 目录，本表只存元数据；删 bug 级联删行并删文件
CREATE TABLE IF NOT EXISTS bug_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  orig_size TEXT DEFAULT '',
  created TEXT DEFAULT (datetime('now','localtime'))
);

-- 评论与流转历史统一存本表（type=comment/activity）
CREATE TABLE IF NOT EXISTS bug_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'comment',
  created TEXT DEFAULT (datetime('now','localtime'))
);

-- 审计日志（PRODUCTION_SUPPORT 模式每笔修改必记）
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator TEXT DEFAULT '',
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  created TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(project_id);
CREATE INDEX IF NOT EXISTS idx_images_bug ON bug_images(bug_id);
CREATE INDEX IF NOT EXISTS idx_comments_bug ON bug_comments(bug_id);
"""


def connect(tenant_id: str) -> sqlite3.Connection:
    """按租户定位库文件并连接（库名 db_{plugin}_{tenant}_v{dataVersion}.sqlite）。"""
    if not TENANT_RE.match(tenant_id):
        raise ValueError(f"非法租户标识：{tenant_id}")
    base = DB_DIR if str(DB_DIR) else Path(os.environ.get("TENANT_DB_DIR", "."))
    path = Path(base) / f"db_{PLUGIN_ID}_{tenant_id}_v{DATA_VERSION}.sqlite"
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def migrate_schema(conn: sqlite3.Connection) -> None:
    """幂等补列：结构演进时在此追加 ALTER（已存在则跳过）。"""
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(bugs)").fetchall()}
    alters = [
        ("source_plugin", "source_plugin TEXT DEFAULT ''"),
        ("source_reporter", "source_reporter TEXT DEFAULT ''"),
    ]
    for col, ddl in alters:
        if col not in existing:
            conn.execute(f"ALTER TABLE bugs ADD COLUMN {ddl}")


def ensure_inbox(conn: sqlite3.Connection) -> None:
    """确保「外部上报箱」项目存在（幂等，外部免登录上报的落点）。"""
    conn.execute(
        "INSERT OR IGNORE INTO projects(key,name,descr,seq) "
        "VALUES('INBOX','外部上报箱','外部插件应用用户免登录上报入口',900)"
    )


def seed_demo(conn: sqlite3.Connection) -> None:
    """首次建库种子：演示账号 + 原型默认项目/缺陷（与 demo.html 对齐）。"""
    if conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] > 0:
        return
    conn.execute(
        "INSERT INTO users(username,password,display_name,role) VALUES(?,?,?,?)",
        ("admin", hash_password("admin123456"), "李工 (测试主管)", "TENANT_ADMIN"),
    )
    conn.execute(
        "INSERT INTO users(username,password,display_name,role) VALUES(?,?,?,?)",
        ("qa", hash_password("qa123456"), "周小文 (测试员)", "MEMBER"),
    )
    projects = [
        ("ERP", "珠宝云 ERP 核心服务", "涵盖多门店库存进销存、智能定价、结算收银及财务对账核心业务中台"),
        ("AIR", "空管智能运行调度平台", "提供航班动态航线防相撞雷达监控、空域容量评估与应急指挥调度"),
        ("APP", "全渠道会员导购小程序", "面向前端消费者的电商小程序、积分商城、离线扫码购移动终端"),
    ]
    for key, name, descr in projects:
        conn.execute("INSERT INTO projects(key,name,descr) VALUES(?,?,?)", (key, name, descr))
    bugs = [
        (1, "ERP-101", "高并发批量结算时库存流水行锁竞争导致死锁 (Deadlock)", "收银结算", "open", "blocker", "p0", "王工 (后端开发)", "李工 (QA)",
         "1. 开启100并发线程并发提交相同SKU的黄金首饰结算订单\n2. 监控数据库连接池及活跃事务",
         "MySQL 报 1213 错误: Deadlock found when trying to get lock; try restarting transaction",
         "通过分布式 Redis Key 排序加锁或乐观锁防重，保障库存原子性无死锁"),
        (1, "ERP-102", "Safari 浏览器结算弹窗关闭时 CSS 关键帧动画白屏", "收银前端", "in_progress", "major", "p2", "赵工 (前端UI)", "周小文 (测试员)",
         "1. 在 iOS Safari 17.5 打开收银结账面板\n2. 点击右上角关闭并在未结束时轻扫页面",
         "视图层白屏，需手动刷新页面恢复", "淡出动画平稳过渡，不阻塞主线程绘制"),
        (1, "ERP-103", "跨境商品税率报表导出缺少 BOM 头部导致 Excel 乱码", "财务报表", "testing", "minor", "p3", "孙工 (报表组)", "运营主管",
         "1. 财务结算后台选择带有繁体/外文名称商品导出报表\n2. Windows Excel 打开",
         "多语言编码失真呈现为乱码符号", "标准 UTF-8 附带 BOM 标记，各操作系统 Office 正确识别"),
        (2, "AIR-201", "主副雷达信号切换突跳时雷达航迹追踪预测位置偏差", "雷达融合计算", "open", "blocker", "p0", "陈博士 (算法工程师)", "现场保障总监",
         "1. 接入 2 号二次雷达降级数据流\n2. 观察卡尔曼滤波输出的航迹外推坐标",
         "航迹出现横向跳变 3.2 海里，触发假告警", "平滑加权融合，偏离门限进行平滑滤波抑制"),
        (3, "APP-301", "无网络状态下扫码购离线缓存未限制大小引发内存溢出闪退", "离线结账引擎", "in_progress", "critical", "p1", "钱工 (移动端)", "李工 (QA)",
         "1. 断开手机网络\n2. 连续扫描 150 件测试条形码",
         "小程序内存占用突破 600MB 并崩溃退出", "设定 IndexedDB 分批持久化，单次常驻内存不超过 50MB"),
    ]
    for pid, code, title, module, status, sev, pri, assignee, reporter, steps, actual, expected in bugs:
        conn.execute(
            "INSERT INTO bugs(project_id,code,title,module,status,severity,priority,assignee,reporter,steps,actual,expected) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, code, title, module, status, sev, pri, assignee, reporter, steps, actual, expected),
        )
        bid = conn.execute("SELECT id FROM bugs WHERE code=?", (code,)).fetchone()["id"]
        conn.execute(
            "INSERT INTO bug_comments(bug_id,author,text,type) VALUES(?,?,?,'comment')",
            (bid, reporter, f"创建缺陷 {code}，状态 [{status}]。"),
        )
    # 项目 seq 推进到已用编号之后（ERP 已有 101/102/103 → 下一个 104）
    conn.execute("UPDATE projects SET seq = 104 WHERE key='ERP'")
    conn.execute("UPDATE projects SET seq = 202 WHERE key='AIR'")
    conn.execute("UPDATE projects SET seq = 302 WHERE key='APP'")
    ensure_inbox(conn)
    conn.commit()
