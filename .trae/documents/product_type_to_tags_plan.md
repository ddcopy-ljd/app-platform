# 商品品类并入标签 实现方案

## Context

用户要求：商品表单里的「品类」字段不要了，改为商品标签。现有商品的品类值自动写成同名标签。

经确认的四项必须保留能力：**计件/计重定价**、**标签模板绑定**、**销售/库存饼图统计**、**三大组分组**（主播希川/古董款/专柜款）。

经确认的架构决策：
- **品类能力并入标签表**：`pricing_mode`（计件/计重）、`label_template_id`（模板绑定）迁到 `product_tags`
- 总部「商品品类与标签模板」页 → 合并为**「标签管理」页**（标签行上直接配计价模式/模板）
- `product_types` 表和 `products.product_type/product_type_code` 冗余列**不删**（零破坏），仅代码层废弃

## 核心机制：主标签

商品可有多个标签，需要唯一权威标签来派生计价/模板/统计。定义**主标签 = 商品标签中 `sort_order` 最小者（并列取 `id` 最小）**。

复用现有函数（勿新造）：
- [_set_product_tags](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L1894-L1907) — 覆盖式保存标签
- [_attach_tags](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L1910-L1923) — 读取填充 `tags` 字段
- [_gen_type_epc](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L451) / [_resolve_type](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L514) — EPC 前缀/品类名兜底

新增 `_primary_tags(conn, pids)`：窗口函数取每商品 `rn=1` 的主标签。

## 改动清单

### 1. db.py

**加列**（写进 `product_tags` 建表定义 + migrate_schema 的 alters 列表 `(table,col,decl)`）：
- `legacy_code TEXT DEFAULT ''` — 承载原品类 code
- `pricing_mode TEXT DEFAULT 'piece'`
- `label_template_id INTEGER DEFAULT NULL`
- `group_name TEXT DEFAULT '主播希川'`

**新增幂等迁移 `_migrate_types_into_tags(conn)`**，在 migrate_schema 调用 `_migrate_material_and_type` 之后执行：
1. 遍历 `product_types`：按 `names.zh` 找/建同名 `product_tags` 行；回填 `legacy_code`（品类 code）、`group_name`、`pricing_mode`、`label_template_id`（**仅回填空值，保留人工配置**）
2. 遍历 `products`：按 `product_type_code` 或 `product_type` 中文名匹配标签，`INSERT OR IGNORE INTO product_tag_links`
3. 幂等靠 `UNIQUE(name)` + `UNIQUE(product_id,tag_id)`

### 2. main.py

| 位置 | 改动 |
|---|---|
| L5494-5514 `type_modes` | 改为 `_resolve_pricing_mode(conn,p)`：取主标签的 `pricing_mode`，多标签冲突以主标签为准，空则 `'piece'` |
| L3498 `_bound_tpl` | 主标签 `JOIN label_templates ON lt.id = t.label_template_id`，回退原 categories 绑定 |
| L2449-2452 商品列表 JOIN | 删 `LEFT JOIN product_types`，计价模式由 `_primary_tags` 提供 |
| L2625-2696 create/update | `_set_product_tags` 后调 `_sync_legacy_type(conn,pid,tag_ids)`：取主标签 `legacy_code` 回写 `product_type_code`（空→`'99'`）与 `product_type`（标签名），保证 EPC/筛选/`_resolve_type` 不断 |
| `ProductTagIn` + `/api/product-tags` | 加 `pricing_mode`/`label_template_id`/`group_name`/`legacy_code` 字段，POST/PUT 校验写入（PUT 加模板存在校验） |
| L2284 `label_template_delete` | used 检查追加查 `product_tags` |
| L1431/1543 销售/库存饼图 | `p.product_type` 分组改**主标签名**分组（无标签→`'未分类'`），占比合计=100% |
| L1468-1488 `/api/dashboard/tag-stats` | 两条聚合改「只计主标签」，分母=区间总额；另返回按主标签 `group_name` 的三大组口径 |
| L2068 `/api/product-types` GET | 补返回 `group_name`（修复现存缺陷）；端点保留只读兼容 |

### 3. 前端

**index.html**：
- 删商品表单品类按钮（L2797-2804）+ 品类弹窗（L3162-3189）
- 商品表单标签区（L2869-2875）保留平铺 chips，按 `group_name` 分组渲染
- 商品页标签筛选（L384）与统计筛选（L246）复用现有 `tagList` chips
- 总部管理页（L1611-1646）改「标签管理」：列 = 名称/分组/计价模式/绑定模板/操作，`bindTypeTemplate` → `bindTagTemplate(tagId,tplId)`

**app.js**：
- 删 `pickType` / `addCustomType` / `ensureTypeCode`（L455-472、L788-812）
- `productTypeName` 改取 `p.tags[0]`
- 商品表单 chips 按 `group_name` 分组
- 排序 `case 'type'` 改主标签名

**i18n.js**：标签管理页新文案（`tag.manage`/`tag.group`/`tag.pricingMode` 等），旧 `type.*` 键保留不删。

## 验证

1. **迁移**：旧库跑 `scripts/upgrade.py`，核对 `product_tag_links` 商品覆盖数 = 原 `product_type<>''` 商品数；标签名与品类中文名一一对应；`pricing_mode`/`label_template_id` 已回填
2. **计价**：Python 造中文数据建 2 标签商品 → `/api/products/options` 计价模式 = 主标签；计重商品开单核对 克重×金价+工费
3. **模板**：给主标签绑模板 → 打印取到该模板
4. **饼图**：`/api/sales/analysis`、`/api/inventory/summary`、`/api/dashboard/tag-stats` 各 pct 合计 = 100%
5. **表单/列表**：`/app/` 走查商品表单（无品类选择器、标签可选）、标签管理页（可配计价/模板）、控制台无报错
6. **清理**测试数据，确认库内无脏数据

## 约束

- 版本号与 `plugin.json` 不动，待确认后再升
- 后端零破坏：空参数保持全量行为
- 一项目任务完成后，未确认不执行 git commit/push
