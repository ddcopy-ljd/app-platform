"""懿臻珠宝云 - 租户环境初始化脚本（首次建库 + 演示数据）。

由平台以子进程方式调用，参数通过命令行 --key=value 与同名环境变量传入：
  --tenant-id=     租户标识
  --new-db-path=   目标库文件绝对路径（建库于此）
  --new-storage=   存储目录（预留）
  --new-version=   软件版本
  --new-data-version= 数据版本
"""

import os
import sqlite3
import sys
from pathlib import Path

# 允许脚本直接运行时定位 db.py（加入包根目录到 sys.path）
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import SCHEMA, seed_demo, migrate_schema  # noqa: E402


def _arg(name: str, fallback: str = "") -> str:
    """优先命令行 --key=value，其次环境变量 KEY，最后 fallback。"""
    prefix = "--" + name.lower().replace("_", "-") + "="
    for a in sys.argv[1:]:
        if a.lower().startswith(prefix):
            return a[len(prefix):]
    return os.environ.get(name.upper(), fallback)


def main() -> None:
    tenant_id = _arg("tenant-id", "tenant_trial")
    new_db = Path(_arg("new-db-path", ""))

    if new_db:
        new_db.parent.mkdir(parents=True, exist_ok=True)
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(str(new_db) + suffix).unlink(missing_ok=True)
        conn = sqlite3.connect(new_db)
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        migrate_schema(conn)  # 幂等补列
        conn.commit()
        seed_demo(conn)
        conn.close()
        print(f"init 完成：租户 {tenant_id} -> {new_db.name}")
    else:
        print("警告：未传入 --new-db-path，跳过建库", file=sys.stderr)


if __name__ == "__main__":
    main()