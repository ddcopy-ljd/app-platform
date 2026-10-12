# 库存分析页改造（截图需求 1-5 + PC 宽屏重排）

## Context
用户截图（AI 示意稿）对珠宝云「库存管理」页提出 6 项改造，核心指示：**截图是手机布局，电脑端必须按屏幕宽度重新组织布局（多列/分区），不能只拉宽**。改名「库存分析」已在早前完成（nav.inventory 三语已是 库存分析/Inventory Analysis/Analisi Scorte）。金额按 dev 库真实计算，示意图数字仅示意。一次性全做。

需求清单（编号沿用截图）：
- ① 库存统计呈现 4 个金额：库存成本、库存售价、预计利润、预计利润率；点【已定锁定】显示商品明细+锁定原因
- ② 五个状态卡（在库/已定锁定/借出/已售/调拨在途）变小，新增第 6 个【维修在途】；界面显示公式「在店库存总数 = 在库 + 已定锁定」
- ③ 右侧区域放「分类库存占比」环形图（TOP5）+ 分类明细表（分类名称/库存/库存成本/库存售价）
- ④ 导出功能：库存表格可勾选表头项，导出 CSV + 打印（打印走浏览器 window.print，用户自备打印机）
- ⑤ 新增【进销存查询】子 tab：按时间段查询进货/销售数量与总金额、期末库存
- ⑥ PC 宽屏两栏布局：左=统计+表格，右=占比图+明细（移动端保持现有单列）

## 现状关键代码
- 页面：[index.html L488-720](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L488)（invSub='stock'/'count' 两 tab；5 张 stat-card；PC 表格 L607 起，移动卡片 L662 起）
- 后端：[main.py L2606 /api/inventory/summary](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L2606)（inStock/reserved/loaned/sold/inTransit 的 count/cost，无售价）
- 数据口径：products.status ∈ 在库/已定/已售/借出/在途；维修在途 = repairs 表 status NOT IN ('已完成','已取走')（同 dashboard L1286 先例）；负库存/已下架不参与（示意稿口径：当前库存=在库+已定，成本/售价同口径）
- 环形图先例：index.html L204-217 / L253-266 SVG donut（stroke-dasharray + donutColor() + donut-legend），直接复用
- 列显隐先例：app.js L4388-4428 mt-gear 菜单（hiddenIdx 持久化 mtStore）——导出勾选列参照此交互
- 导出先例：/api/logs/export CSV；打印先例：reportPageUrl/openReportWindow（8003 报表页）——本需求打印用简单方案：前端生成打印窗口 window.print()
- PC 布局：app.css L643-653 `.app-shell.pc` 已有 inv-stats-grid 5 列规则；两栏先例 `.rfid-flow` grid 1.5fr/1fr

## 实施方案

### A. 后端（main.py，全部同步 def + with _db 内完成查询）
1. 扩展 `GET /api/inventory/summary`：
   - cnt() 增加 price 汇总：`SUM(price)`；返回 inStock/reserved/loaned/sold/inTransit 各 {count,cost,price}
   - 新增 `repairing`（维修在途 count，repairs 表口径同上）
   - 新增 `metrics`：{stockCost, stockPrice, profit, profitRate, onHand}（onHand=在库+已定件数；金额口径=在库+已定，负库存不参与——products 无数量列，天然每件一行，无负库存问题）
   - 新增 `categories`：按 product_type 分组的 {cat,count,cost,price}（status IN ('在库','已定')，成本权限复用 _can_view_cost，无权限时 cost/price 置 None）
2. 新增 `GET /api/customers/{cid}/locks` 不适用——已定明细用现有 products 列表即可：`GET /api/inventory/locked-items`：status='已定' 的商品行 + 锁定原因（JOIN deposits 取单号/客户/定金日期；deposits.status='进行中' 关联口径见 main.py L5739 置已定逻辑）。静态路由注册在 `/api/inventory/{…}` 参数路由之前（本文件无冲突参数路由，保持先注册习惯）。
3. 新增 `GET /api/inventory/psi?start=&end=`（进销存查询）：
   - 进：purchases 区间（order_date BETWEEN）SUM(qty)、SUM(cost)，status 排除已取消（先 SELECT 确认枚举）
   - 销：sale_items JOIN sales（biz_date BETWEEN，status!='已冲红'）COUNT(*) 件数、SUM(subtotal) 金额
   - 存：当前时点 在库/已定 件数与金额（期末库存，注明"当前值"）
   - 按品类分组行 + 合计行；全部件数+金额（截图注"都只显示数量"但需求文字要"数量和总金额"，两者都给，表格列以数量为主、金额为辅）

### B. 前端结构（index.html 库存 section）
1. **PC 两栏骨架**：`invSub==='stock'` 内容包进 `.inv-layout`（CSS grid）：
   - `.app-shell.pc .inv-layout { grid-template-columns: minmax(0,1fr) 380px; }`，<1200px 时回落单列（媒体查询）
   - 左栏：统计区 + 搜索/表格；右栏（仅 PC）：分类库存占比卡（donut+图例）→ 分类明细表
   - 移动端：占比区以折叠 section 形式排在表格之后（同一数据源，v-if 控制位置）
2. **统计区改造（②）**：6 张小卡一行（inv-stats-grid 改 6 列，卡内 padding 缩小、数值 clamp 字号）：在库/已定锁定/借出/已售/调拨在途/维修在途；卡下加公式行：`在店库存总数 = 在库(N) + 已定锁定(M) = K`（点击公式行=清除状态筛选）
3. **金额指标（①）**：4 个金额做成一行紧凑指标条（库存成本/库存售价/预计利润/预计利润率），无成本权限显示 ***（复用 isCostVisible/cell-secret）
4. **已定明细（①）**：点【已定锁定】卡 → 打开右侧抽屉 sheet（复用现有 sheet 机制）列出商品（货号/名称/克重/售价）+ 锁定原因（定金单号/客户/日期）；数据源 locked-items
5. **分类占比（③）**：复用 donut SVG 写法（pathLength=100、donutColor、stroke-dasharray），中心显示「库存TOP5」+ 总件数；图例右侧显示百分比；下方明细表：分类名称/库存/库存成本/库存售价（成本无权限列显 ***）
6. **进销存查询 tab（⑤）**：inv-tabs 加第三个按钮 `invSub==='psi'`；内容：起止日期输入（默认本月）+ 查询按钮 + 表格（品类行：进货数量/进货金额/销售数量/销售金额/期末库存数量/期末库存金额 + 合计行）；移动端同页可用
7. **导出/打印（④）**：PC 表格工具条加两个按钮：
   - 「导出」→ 弹出列勾选面板（checkbox 列表，默认全选，交互仿 mt-gear 菜单），确认后前端把当前 invStockList/invStockGroups 拼 CSV（\uFEFF BOM 防 Excel 乱码）Blob 下载
   - 「打印」→ 生成打印窗口（新 window + 内联表格 HTML + 打印样式 + window.print()），列选择与导出共用同一勾选状态

### C. 状态与函数（app.js）
- ST 新增：`invMetrics`（随 summary 返回）、`lockedSheet`（已定明细抽屉数据/open 态）、`psi:{start,end,rows,loading}`、`invExportCols`（勾选列索引数组）、`invRightOpen`（PC 右栏开关，可选）
- 函数：`loadInv()` 扩展消费新字段；`openLockedItems()`、`closeLockedItems()`；`loadPsi()`；`donutInvCats()`（把 categories 转成 donut 需要的 pct/offset 序列，仿现有 catSales 处理）；`exportInvCSV()`、`printInv()`
- 全部注册进 methods（勿与 i18n.js 重名）

### D. i18n（zh/en/it 三份同步）
新键：`inv.repairing`（维修在途）、`inv.onHandFormula`（在店库存总数=在库+已定锁定）、`inv.metricCost/inv.metricPrice/inv.metricProfit/inv.metricRate`、`inv.catShare`（分类库存占比）、`inv.lockTitle/inv.lockReason/inv.lockNo`、`inv.tabPsi`（进销存查询）、`inv.psiIn/psiOut/psiEnd`、`inv.export/inv.print/inv.pickCols`；模板禁出现 .bind/.apply/.call 等黑名单词。

### E. CSS（app.css）
- `.inv-layout` PC 两栏 + 媒体查询回落；`.inv-stats-grid` 6 列（<1400px 3 列×2 行）；小卡紧凑样式 `.inv-mini`
- 公式条 `.inv-formula`、指标条 `.inv-metrics`（4 列 grid）
- 右栏 `.inv-side`（sticky top，复用 .section 卡片风格）
- 打印窗口样式内联在生成的 HTML 里，不进主 CSS

## 验证（按 AGENTS.md：只测改动相关）
1. 后端 E2E（Python 脚本，中文链路）：summary 新字段/维修在途口径/locked-items/psi 区间查询（造 1 条 purchases+1 条销售→查→删，恢复现场）；权限账号无 cost 字段
2. 浏览器走查 8002：
   - PC 1440×900：两栏布局生效（非拉宽）、6 小卡+公式+4 指标、点已定锁定弹明细、占比图+明细表渲染、进销存 tab 查询、导出 CSV 内容正确、打印窗口弹出
   - 移动视口 390×844：单列、占比区在表格后、功能可用
   - 三语切换无残留；控制台无 error
3. 测试数据清理 + TEST_CASES.md 入册（TC-30 起）

## 边界与假设
- 「负库存、已下架不参与」：products 无数量/下架列，示意稿该注释忽略；口径=在库+已定
- 维修在途不改 products.status（维修单与商品绑定松散），按 repairs 未完结单数计
- 导出为前端 CSV（与日志导出后端 CSV 不同，库存数据已在前端，避免新接口）
- 不 commit（等用户确认）
