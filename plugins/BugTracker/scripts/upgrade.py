"""BugPulse 缺陷跟踪 - 版本间数据迁移脚本（幂等，只增量 DDL，禁止删数据）。

平台已把旧库完整复制到 NEW_DB_PATH；本脚本只做结构补齐与 storage 迁移。
可用环境变量：OLD_DB_PATH / NEW_DB_PATH / OLD_STORAGE / NEW_STORAGE /
              TENANT_ID / OLD_DATA_VERSION / NEW_DATA_VERSION
"""

import os
import shutil
import sqlite3
from pathlib import Path

import sys
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import SCHEMA, migrate_schema, ensure_inbox  # noqa: E402


def main() -> None:
    new_db = os.environ.get("NEW_DB_PATH", "")
    if not new_db:
        print("警告：未传入 NEW_DB_PATH，跳过迁移", file=sys.stderr)
        return

    conn = sqlite3.connect(new_db)
    conn.row_factory = sqlite3.Row
    # 幂等：补齐全部表结构（IF NOT EXISTS）+ 增量列 + 外部上报箱项目
    conn.executescript(SCHEMA)
    migrate_schema(conn)
    ensure_inbox(conn)
    # 历史外部上报无门店字段：统一归入「总部」（幂等：仅补空值，不覆盖已有）
    conn.execute(
        "UPDATE bugs SET source_store='总部' "
        "WHERE source_plugin != '' AND (source_store IS NULL OR source_store = '')"
    )
    conn.commit()
    conn.close()

    # storage（截图文件）随版本复制
    old_storage = os.environ.get("OLD_STORAGE", "")
    new_storage = os.environ.get("NEW_STORAGE", "")
    if old_storage and new_storage and os.path.isdir(old_storage):
        shutil.copytree(old_storage, new_storage, dirs_exist_ok=True)

    print(f"upgrade 完成：租户 {os.environ.get('TENANT_ID', '')} "
          f"{os.environ.get('OLD_DATA_VERSION', '')} -> {os.environ.get('NEW_DATA_VERSION', '')}")


if __name__ == "__main__":
    main()
