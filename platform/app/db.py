import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from .config import PLATFORM_DB, SANDBOX_TENANT_ID
from .security import hash_password

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'platform_admin'
);
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    is_sandbox INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🧩',
    category TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    features TEXT NOT NULL DEFAULT '[]',
    current_version TEXT,
    gateway_state TEXT NOT NULL DEFAULT 'NORMAL',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_apps (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    plugin_id TEXT NOT NULL REFERENCES plugins(id),
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (tenant_id, plugin_id)
);
CREATE TABLE IF NOT EXISTS plugin_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_id TEXT NOT NULL REFERENCES plugins(id),
    software_version TEXT NOT NULL,
    data_version TEXT NOT NULL,
    package_name TEXT NOT NULL,
    package_size INTEGER NOT NULL,
    manifest TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded',
    progress INTEGER NOT NULL DEFAULT 0,
    source_version TEXT,
    trial_tenants TEXT NOT NULL DEFAULT '[]',
    prepared_at TEXT,
    switched_at TEXT,
    error TEXT,
    log TEXT NOT NULL DEFAULT '',
    UNIQUE (plugin_id, software_version)
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    operator TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
"""

# 可重复执行的字段升级：(表, 字段, 定义)
COLUMN_MIGRATIONS = [
    ("plugins", "app_status", "TEXT NOT NULL DEFAULT 'OPEN'"),
    ("plugin_versions", "service_state", "TEXT NOT NULL DEFAULT 'stopped'"),
    ("plugin_versions", "service_port", "INTEGER"),
    ("plugin_versions", "service_pid", "INTEGER"),
    ("plugin_versions", "service_started_at", "TEXT"),
    ("plugin_versions", "service_error", "TEXT"),
]

DEMO_TENANTS = [
    ("t001", "懿珠宝行", 0),
    ("t002", "华东贸易有限公司", 0),
    ("t003", "北辰科技", 0),
    (SANDBOX_TENANT_ID, "虚拟沙箱租户", 1),
]


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(PLATFORM_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def audit(conn: sqlite3.Connection, operator: str, action: str, target: str, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO audit_logs (ts, operator, action, target, detail) VALUES (?,?,?,?,?)",
        (now_str(), operator, action, target, detail),
    )


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        for table, column, definition in COLUMN_MIGRATIONS:
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        # 演示环境初始化；生产环境需通过 PLATFORM_ADMIN_PASSWORD 显式设置管理员密码
        if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            password = os.environ.get("PLATFORM_ADMIN_PASSWORD", "admin123")
            conn.execute(
                "INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)",
                ("admin", hash_password(password), "平台管理员"),
            )
        if not conn.execute("SELECT 1 FROM tenants LIMIT 1").fetchone():
            conn.executemany(
                "INSERT INTO tenants (id, name, is_sandbox) VALUES (?,?,?)", DEMO_TENANTS
            )
        # 服务重启时中断的后台任务回退到可重试状态
        conn.execute("UPDATE plugins SET gateway_state='NORMAL' WHERE gateway_state='MAINTENANCE'")
        conn.execute(
            "UPDATE plugin_versions SET service_state='stopped', service_pid=NULL, service_port=NULL "
            "WHERE service_state<>'stopped'"
        )
        conn.execute(
            "UPDATE plugin_versions SET status='failed', error='服务重启导致任务中断，可重试' "
            "WHERE status IN ('preparing','switching')"
        )
