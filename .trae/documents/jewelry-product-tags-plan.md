# 珠宝插件「商品多标签 + 按标签分组统计」方案

## 背景（Context）

用户需求：一件商品可贴多个标签（如 项链、金饰、古风、现代），统计时可多选标签、按标签分组统计。
现状：`products` 表只有单值品类（category / product_type），无多标签能力；已有 `/api/dashboard/category-sales` 单维分组统计可参考。
命名红线：代码中既有 "label/标签" 全部指 RFID 打印标签（label_templates），本功能统一用 **tag / 商品标签** 命名，避免混淆。

## 已确认的关键口径（方案默认值，如需调整请在批准时说明）

1. **分组语义**：每个被选中的标签各为一组；商品贴了多个标签时，在每组中各计一次（UI 明示"多标签商品重复计入"，占比分母取各标签组之和）。
2. **统计口径**：同时给 库存（在库数量/成本/标价）+ 销售（金额/件数，近6个月或自选区间）两组结果。
3. **标签作用域**：标签字典建在**每个租户自己的独立库**内（每租户私有、跨租户完全隔离），同一租户内各门店共用一套；统计按当前工作门店过滤商品与销量，与品类/经办人类别同模式。
4. **定位**：标签用于各类业务统计工作（非随手贴），必须作为受控字典统一维护 → 采用关系表方案。
5. **企业网站/橱窗不显示标签**（内部运营属性，不对外）。

## 一、数据层（plugins/jewelry/db.py）

- SCHEMA 新增两表（`CREATE TABLE IF NOT EXISTS`，天然幂等，升级时 upgrade.py 自动建表，无需 ALTER）：
  - `product_tags(id INTEGER PK AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created TEXT DEFAULT (datetime('now','localtime')))`
  - `product_tag_links(product_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, UNIQUE(product_id, tag_id))` + tag_id 索引
- 演示标签只进 `seed_demo`（新库初始化）；**不进 `ensure_new_seeds`**——避免租户删光标签后升级"复活"（label_templates 已踩过此坑）。
- 建议默认演示标签：项链、手链、戒指、金饰、银饰、翡翠、钻石、古风、现代、婚庆。

## 二、后端（plugins/jewelry/main.py）

1. **标签 CRUD** `/api/product-tags`（仿 label-templates L2074-2121 写法 + `_log` 审计）：
   - GET 列表；POST 新建（重名 400）；PUT 改名/颜色/排序；DELETE 删除前先查关联商品数 N，前端确认"将解除 N 件商品的该标签"后级联删 links（标签是软属性，不拒绝删除）。
2. **商品建档/编辑带标签**：`ProductIn`（L1800）加 `tag_ids: list[int] = []`；`product_create`（L2442）/ `product_update`（L2481）提交后校验标签存在 → 先 DELETE 后 INSERT links；`batch-copy` 复制商品时一并复制标签。
3. **删除级联清理**（最高风险点）：`product_delete`（L2523）与 `batch-delete`（L2533）必须同步删 `product_tag_links`，否则统计虚增。
4. **商品列表附带标签**：`GET /api/products` 取完页数据后，一次 `SELECT product_id, tag_id FROM product_tag_links WHERE product_id IN (...)` 联 tags 表，Python 分组拼进每行 `tags` 字段；**不塞进 `_PRODUCT_COLS` 相关子查询**（避免每行子查询）。
5. **统计接口** `GET /api/dashboard/tag-stats?start=&end=&tag_ids=1,2,3`（缺省=近6个月、全部有商品关联的标签）：
   - 库存、销售**各自一条 SQL** `JOIN product_tag_links GROUP BY tag_id` 后在 Python 合并；禁止 sales+inventory 同一条 JOIN（交叉翻倍）。
   - 销售口径逐字照抄 category-sales（L1429-1430）：`status!='已冲红'`、`biz_date BETWEEN`、`(s.store_id=? OR s.store_id=0)`；库存口径 `products.status='在库' AND store_id=?`。
   - 成本/标价汇总受 `_can_view_cost` 列级权限限制，无权限返回 None。
   - 返回 `{items:[{tag_id,name,color,stock_count,stock_cost,stock_price,sale_amount,sale_count,pct}]}`。

## 三、前端（无构建 SPA：index.html + app.js + app.css + i18n）

- **index.html**：
  - 商品表单 sheet（L2558-2594 区域）加「商品标签」多选 chips 行（复用 cat-chips 样式，点击 toggle）。
  - 商品列表（L340 起）：行内显示小标签 chip；筛选区加标签多选（命中任一所选标签即显示），仿品类 chips L363-365。
  - 「总部管理」（tab==='shops'，品类区块 L1413 附近）加「商品标签」管理区块：增/改名/删除/颜色。
  - dashboard 加「标签统计」mini-chart 卡（自绘 CSS 条形/占比，不引 ECharts）：时间区间 + 标签多选 + 库存/销售切换，卡内注明重复计入口径。
- **app.js**：`ST.tags` 全局加载（并入 refreshAll）；`saveProductForm`（L3242）提交 tag_ids；`tagStats` 加载仿 category-sales（L1012）；列表筛选逻辑扩展（L481-507 filteredProducts 模式）。
- **i18n**：基线 `i18n.js` + en/it/ja/ko/zhHant 五个按需字典同步补 key（缺键回退中文），并同步升级 `I18N_VER`（i18n.js L677 与 index.html 引用处）。
- **app.css**：标签 chip 配色复用既有 tag-* 类，少量新增。

## 四、版本与发布

- `plugin.json`：`dataVersion` 1.2.17 → **1.2.18**；`softwareVersion` 同步递增；`features` 补一条"商品多标签与标签分组统计"。
- 升级走既有流水线：`scripts/upgrade.py` 对新库 `executescript(SCHEMA)` 即自动建两张新表，无需新增迁移条目。

## 五、验证（按 AGENTS.md 分级测试，禁止全量）

1. **后端 E2E（Python 脚本，避开 PowerShell 中文乱码）**：建 2 个标签 → 给商品贴多标签 → `tag-stats` 断言库存/销售数值与重复计入口径 → 编辑商品换标签 → 删标签/删商品后确认 links 级联清干净 → 清理全部测试数据再复查。
2. **迁移回归**：旧库副本 → upgrade.py 到 1.2.18，确认两表建成、老商品 tags 为空、既有功能不受影响。
3. **浏览器走查**：商品表单贴标、列表筛选、总部管理增删标签、dashboard 标签统计卡渲染、控制台无报错；切一门店验证统计口径。

## 关键文件清单

| 文件 | 改动 |
|---|---|
| plugins/jewelry/db.py | 两张新表 + seed_demo |
| plugins/jewelry/main.py | 标签 CRUD、ProductIn.tag_ids、删除级联、列表附带 tags、tag-stats |
| plugins/jewelry/frontend/index.html | 表单贴标、列表筛选、标签管理区块、统计卡 |
| plugins/jewelry/frontend/app.js | ST.tags、saveProductForm、tagStats、筛选 |
| plugins/jewelry/frontend/i18n*.js | 补 key + I18N_VER |
| plugins/jewelry/frontend/app.css | chip 样式微调 |
| plugins/jewelry/plugin.json | 版本号 + features |
| plugins/jewelry/TEST_CASES.md | 新增本功能用例入册 |
