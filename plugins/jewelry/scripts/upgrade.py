"""懿臻珠宝云 - 数据迁移脚本（版本升级用）。

平台先把旧库完整复制到 NEW_DB_PATH，本脚本只做增量迁移：
- 幂等执行 SCHEMA 建表与 migrate_schema 新增列补全（含 dataVersion 1.0.3 的
  biz_config.bridge_key、1.0.4 的 stores.bridge_key/stores.printer_name 多门店打印桥、
  1.0.5 的 store_printers 门店按打印业务指派打印机、
  1.0.7 的 sensors/sensor_events/sensor_pass/sensor_settings 智能安防四表、
  1.0.8 的 locations 库位/clerk_types 经办人类别/transfers/transfer_items 门店调拨
  与 products 两位置列、sales 两经办人列、users.can_view_cost 成本查看列级权限；
  dataVersion 1.0.9 的快速开单增强：product_types.pricing_mode 品类计价方式、
  biz_config.gold_price 当日金价、customers.points/gold_discount 会员积分与金价折扣、
  sales.discount/receivable/customer_id、sale_items 计重五列、新表 sale_payments 组合支付；
  dataVersion 1.1.0 的协同扫码序号：tasks.type_seq 同店同功能任务序号、
  唯一索引 idx_tasks_type_seq(store_id,type,type_seq WHERE type_seq>0)）；
- 幂等执行 EPC 现行规则化（前缀+门店段+品类码+序号）与材质英文长码收敛为简写。
参数/环境变量与平台约定一致：
  OLD_DB_PATH / NEW_DB_PATH / OLD_STORAGE / NEW_STORAGE /
  TENANT_ID / OLD_DATA_VERSION / NEW_DATA_VERSION（或 --old-db-path 等）。
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
    old_dv = _arg("old-data-version", "?")
    new_dv = _arg("new-data-version", "?")

    if new_db:
        conn = sqlite3.connect(new_db)
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        migrate_schema(conn)  # 幂等补齐新增列（如 showcase_order、origin 等）
        conn.commit()
        conn.close()
        print(f"upgrade 完成：租户 {tenant_id} -> {new_db.name}"
              f"（schema 已幂等迁移，dataVersion {old_dv} -> {new_dv}）")
    else:
        print("警告：未传入 --new-db-path，跳过迁移", file=sys.stderr)


if __name__ == "__main__":
    main()