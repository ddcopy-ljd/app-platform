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
  唯一索引 idx_tasks_type_seq(store_id,type,type_seq WHERE type_seq>0)、
  dataVersion 1.2.16 客情维护：customers.anniversary 结婚纪念日列；
  dataVersion 1.2.17 会员管理：customers.created 建档时间列（会员总数/今日新增/本月新增统计）；
  dataVersion 1.2.18 商品标签：product_tags/product_tag_links 两表（SCHEMA 幂等建表，无 ALTER）；
  dataVersion 1.2.19 推广页多语言：tenant_profiles.i18n JSON 列（migrate_schema 幂等补列），
  languages 补种 ja/ko/zhHant（_seed_base_dicts INSERT OR IGNORE，随迁移重跑生效））；
  dataVersion 1.2.20 商品品类分组弹窗 + 价格策略/营销策略：product_types.group_name 分组列、
  products.price_mode/discount/discount_price/member_price/join_order_discount/member_only/gift_points
  七列，以及扫描助手自升级：devices.apk_md5 设备上报的已安装 APK 指纹
  （migrate_schema 幂等补列，老库自动补默认值））；
  dataVersion 1.2.21 商品标签分组：product_tags.group_name 分组列（migrate_schema 幂等补列）；
  dataVersion 1.2.22 运维端受控写操作：users.must_change_pwd 强制改密旗标列
  （migrate_schema 幂等补列；运维端重置密码置 1，用户改密后清零）；
  dataVersion 1.2.23 门店 Key 实例级化：新增 print_agents 表（打印助手实例级
  密钥/在线状态，SCHEMA 幂等建表），并从 stores 表幂等移除旧的 store_key/scan_key
  列（门店级 Key 改为设备实例级，由 print_agents/scan 设备密钥承载；
  migrate_schema 以 _has_column 守卫后 ALTER TABLE DROP COLUMN，老库自动收敛）；
  dataVersion 1.2.24 商品标签一级分类：tag_groups 表（标签类别可增删改，
  原后端固定枚举 TAG_GROUPS 迁移为初始数据，_seed_tag_groups 幂等灌入 5 个
  分组并把既有标签出现过的分组名一并纳入；SCHEMA 幂等建表，无 ALTER）；
  标签种子 _SEED_PRODUCT_TAGS 常量化，ensure_new_seeds 仅全新演示库（products 本次新灌）
  联动灌入——外网沙箱基线库可得演示标签，真实租户删光标签后升级不复活（TC-40）；
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

from db import SCHEMA, migrate_schema, ensure_new_seeds  # noqa: E402


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
        # 幂等补空表演示数据（ensure_new_seeds 对每张表独立 COUNT==0 才 seed，
        # 已有数据的表不动，安全）
        ensure_new_seeds(conn)
        conn.close()
        print(f"upgrade 完成：租户 {tenant_id} -> {new_db.name}"
              f"（schema 已幂等迁移 + 空表演示数据已补齐，dataVersion {old_dv} -> {new_dv}）")
    else:
        print("警告：未传入 --new-db-path，跳过迁移", file=sys.stderr)


if __name__ == "__main__":
    main()