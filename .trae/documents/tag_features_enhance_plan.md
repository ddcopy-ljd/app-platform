# 标签能力增强 实现方案

## Context

用户明确：**品类（product_type）保留作为商品基础属性，不做改动**；把「标签」作为商品的**扩展属性**，用于分类统计查询等。

现状盘点（已核实）：
- 商品表单可打标签（[index.html L2869-2875](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L2869-L2875) 平铺 chips）
- 商品列表已有标签 chips（展示在名称列下，[L417](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L417)）+ 多选筛选（[L384-387](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L384-L387)，命中任一即显示）
- 后端已有 `/api/dashboard/tag-stats`（[main.py L1452-1504](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L1452-L1504)）：支持 `start`/`end`/`tag_ids`，返回每标签**库存双口径**（数量/成本/标价 + pct）与**销售双口径**（金额/件数 + pct）
- 总部已有标签管理表（[index.html L1651-1677](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L1651-L1677)）：名称/排序/已关联商品数 + 增改删

本次要加的三项能力：
1. 销售分析 / 库存分析页增加**按标签维度**的筛选与占比图表
2. 总部标签管理页增加**分组**配置（主播希川/古董款/专柜款）
3. 商品列表把标签提升为**独立列**展示

## 关键复用点

`/api/dashboard/tag-stats` **已完全满足分析页所需**（区间 + 标签筛选 + 双口径），分析页标签维度**零后端改动**，直接复用该接口画图。

复用函数：`loadTagStats()`（[app.js L2455](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L2455)）、`tagChipStyle()`（[L2482](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L2482)）、`saleAnaDonut()` / `invCatDonut()` 环形饼图写法（[L1110](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L1110) / [L1360](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L1360)）。

## 改动清单

### 1. 后端

**db.py**：`product_tags` 建表定义（L142-146）+ migrate_schema 的 alters 列表各加一列：
- `group_name TEXT DEFAULT ''`

**main.py**：
- `ProductTagIn`（L2153 附近）加 `group_name: str = ""`
- `/api/product-tags` POST/PUT：校验并写入 `group_name`；GET 确认返回该列（用显式列名，勿依赖 `t.*`）
- 分析页接口**不改**（复用 tag-stats）

### 2. 前端 — 总部标签管理页

[index.html L1651-1677](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L1651-L1677)：
- 表头 `th` 增「分组」列，行内展示 `o.group_name`
- 编辑表单（L1668-1676）在颜色后加「分组」输入：`<input v-model="tagEdit.group_name" list="tag-groups">` + `<datalist id="tag-groups">` 预置三大组（主播希川/古董款/专柜款，允许自由输入）

[app.js](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js)：
- `addTag`/`editTag`/`resetTagEdit` 的 `tagEdit` 对象加 `group_name`
- `saveTag` 请求体带 `group_name`

**i18n.js**：加 `tag.group`（分组）文案，6 语言。

### 3. 前端 — 分析页加标签维度

**库存分析页**（饼图区 [index.html L820](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L820) 附近）：
- 加一排标签 chips（复用 `.cat-chips.tag-pick-chips`，多选 → `ST.anaTagSel`）
- 加「按标签库存占比」饼图：`v-for="s in invTagDonut()"`，数据源 = 按当前分析区间拉取的 tagStats（`stock_price`）

**销售分析页**（饼图区 [L979](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L979) 附近）：
- 同上，加标签 chips + 「按标签销售占比」饼图（`sale_amount`）

**app.js**：
- 新增 `loadAnaTagStats(scope)`：用分析页当前区间调 `/api/dashboard/tag-stats?start=&end=&tag_ids=`
- 新增 `invTagDonut()` / `saleAnaTagDonut()`：仿 `invCatDonut`/`saleAnaDonut` 的环形分段写法，TOP5 + 归一化 + 颜色轮换
- ST 增 `anaTagSel` / `anaTagStats`；`loadSaleAnalysis` / 库存分析加载函数末尾追加调用
- 区间切换时同步刷新（复用现有 `setListRange`/`applyDashCustomRange` 刷新钩子）

### 4. 前端 — 商品列表标签列

[index.html L390-430](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L390-L430)：
- 表头在「品类」列（L398）后插入 `<th class="th-tags">{{ t('tag.field') }}</th>`
- 表体对应插入 `<td class="cell-tags">` 渲染 `p.tags` chips（复用 `tagChipStyle`）；原名称列下的 `ptag-row` 保留（PC/移动端兼顾）
- 筛选 chips（L384-387）**保持多选 OR**不变；`app.css` 给 `.th-tags`/`.cell-tags` 定宽与换行

## 验证

1. **标签分组**：总部标签管理页新建标签并选「古董款」→ 保存后表格分组列正确、DB `product_tags.group_name` 落库；编辑改名/颜色/排序/分组均生效
2. **分析页**：销售分析页勾选 2 个标签 → 饼图与占比随筛选变化；切换时段（近7天/本月/自定义）图表同步刷新；库存分析页同理
3. **商品列表**：标签独立列正常展示；多标签筛选命中任一显示；移动端卡片视图布局不破
4. **回归**：现有品类选择器（表单）、品类饼图、`/api/dashboard/tag-stats` 首页统计卡均不受影响；控制台零报错
5. 测试数据全部清理，库内无脏数据

## 约束

- 品类相关代码**一律不动**（表单选择器、品类饼图、product_types 表）
- 版本号与 `plugin.json` 不动，待确认后再升
- 一项目任务完成后，未确认不执行 git commit/push
