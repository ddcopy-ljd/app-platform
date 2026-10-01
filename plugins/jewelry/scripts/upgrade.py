"""懿臻珠宝云 - 数据迁移脚本（版本升级用）。

当前 dataVersion 1.0.0 尚未有旧库迁移需求，仅做幂等建表与新增列补全。
参数约定与 init 一致，另支持 --old-db-path 等。
"""

import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import SCHEMA, migrate_schema  # noqa: E402


def _arg(name: str, fallback: str = "") -> str:
    prefix = "--" + name.lower().replace("_", "-") + "="
    for a in sys.argv[1:]:
        if a.lower().startswith(prefix):
            return a[len(prefix):]
    return os.environ.get(name.upper(), fallback)


def main() -> None:
    tenant_id = _arg("tenant-id", "tenant_trial")
    new_db = Path(_arg("new-db-path", ""))

    if new_db:
        conn = sqlite3.connect(new_db)
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        migrate_schema(conn)  # 幂等补齐新增列（如 showcase_order、origin 等）
        conn.commit()
        conn.close()
        print(f"upgrade 完成：租户 {tenant_id} -> {new_db.name}（schema 已幂等更新至 v1.0.0）")
    else:
        print("警告：未传入 --new-db-path，跳过迁移", file=sys.stderr)


if __name__ == "__main__":
    main()