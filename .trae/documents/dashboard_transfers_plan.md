# 看板销售同比环比 + 调拨收发功能 Implementation Plan

## Repository Research

### A. 看板现状
- 后端 `/api/dashboard/overview`（main.py L1122）返回 todaySales{amount,count}、monthSales{amount}，仅有当期绝对额，无同比/环比。
- `/api/dashboard/trend`（main.py L1172）返回近 6 个月 `['YYYY-MM'...]` + `[amount...]`，无同比对比列。
- sales 表 biz_date 是 ISO 日期字符串 `YYYY-MM-DD`（已有 substr(biz_date,1,7) 分组的先例），status 排除'已冲红'，`store_id=? OR store_id=0` 同口径。
- 前端 dashboard section（index.html L117-177）KPI 卡片 L121-L122 绑定 dashData.todaySales.amount / dashData.monthSales.amount，trend 图用 trendData.months+amounts。
- app.js loadDash()（L630）并行拉 4 个 API 写入 ST.dashData/trendData/catSales/remindData。

### B. 调拨现状
- 后端完整：创建（POST /api/transfers）、列表（GET scope=out/in）、详情、验收（POST /api/transfers/{tid}/receive，要求 to_store_id==sid 且 status='在途'，items 全量一致，不符必填原因）。
- 前端"发"：列表页有"＋新建调拨"按钮 → 选货抽屉 → 目标门店弹窗 → POST 创建 → 在途。
- 前端"收"：列表 Tab 切"📥 收货" → 点卡片 → 详情弹窗打开 → 详情弹窗底部有 **`📥 开始验收` 按钮**（transferTab==='in' && status==='在途' 时显示）→ startReceive 逐件标记 ✓/✗/原因 → confirm 后 submitReceive。
- **用户反馈"只看个列表就完了"**：可能原因（1）详情弹窗入口在卡片上没有显式"接收"引导文字；（2）发送方卡片也没有显式"已发出"状态徽章；（3）浏览器未走查真实操作链。需要走查确认。

### C. 数据库版本
- 不涉及 schema 变更（看板是计算字段，调拨全链路后端已齐），**dataVersion 不动**，**softwareVersion 1.1.0 → 1.1.1**。

## Files and Modules

- `plugins/jewelry/main.py`: 扩展 /api/dashboard/overview 增加 todaySales 环比 & monthSales 同比/环比；扩展 trend 返回 12 个月 + 同期去年对比（或加新的 sales-stats 接口，取轻量方案直接改 overview 和 trend）。
- `plugins/jewelry/frontend/index.html`: dashboard KPI 卡片加同比环比副标签；transfers 列表卡片显式发/收引导（或详情弹窗首屏状态徽章）。
- `plugins/jewelry/frontend/app.js`: loadDash 逻辑不变（overview 自动带新字段），加小的 helper 函数格式化环比数字（+/-xx%）。
- `plugins/jewelry/frontend/i18n.js`: 加新 i18n 键（同比/环比/环比升/环比降/调拨发出/调拨验收等显式引导键）。
- `plugins/jewelry/frontend/app.css`: 新增环比正负配色（+green、-red）。
- `plugins/jewelry/plugin.json`: softwareVersion 1.1.0 → 1.1.1。
- `plugins/jewelry/scripts/upgrade.py`: 版本记录串。

## Implementation Steps

### 1. 后端看板扩展（main.py）
**overview 扩展**：
- todaySales：环比（昨日比今日）`todaySales.momPct` = (今-昨)/昨*100（昨为0时 null）。
- monthSales：本月比上月 MoM `monthSales.momPct` + 本月比去年同期 YoY `monthSales.yoyPct`。
- 用 SQLite 日期函数 date('now')、date('now','-1 day')、date('now','start of month','-1 month')、date('now','start of month','-1 year')、date('now','start of month','-11 months') 计算窗口。
- 同口径：`status!='已冲红' AND (store_id=? OR store_id=0)`，`biz_date BETWEEN start AND end` 范围比较（避免 DATE() 包裹破坏索引，沿用现有 substr 分组已牺牲一次，范围 compare 对单日/单月汇总表影响不大）。

**trend 扩展**：
- 从 `date('now','start of month','-5 months')` 改为 `date('now','start of month','-11 months')`（12 个月）。
- 返回结构加 `amounts_last_year`（12 个月去年同期的每月金额，与 months 按 month 对齐），前端可据此画同比双色柱或悬停 tooltip。
- 或返回简化版：`yoyAmounts` 与 amounts 一一对应（months[i] 对应去年同月）。

### 2. 前端看板展示
- KPI 卡片今日：副行从 `N 笔` 改为 `N 笔 · 环比 {todaySales.momPct>=0?'↑':'↓'}|abs(xx)%`（昨=0 时不显环比）。
- KPI 卡片本月：副行从无 → 加 `环比 xx% · 同比 xx%`。
- 趋势图：加同比叠加——在每个月份柱子旁叠加一根浅灰/透明柱表示去年同月金额；或改用 tooltip 悬停显示（不引入 ECharts，保持无外部依赖）。
- 环比/同比格式化 helper：`pctText(v, suffix='')`，正带 ↑ 绿，负带 ↓ 红，null 不显示。

### 3. 调拨前端走查 + 入口显式化
**先验证现状**（浏览器走查）：
- 切分店A → 进入调拨 Tab → 找一张"在途"的调拨单 → 点卡片是否打开详情弹窗 → 弹窗底部是否有「📥 开始验收」按钮。
- 如果按钮存在且可点：说明后端+前端齐了，只是入口不够显眼，只需 UI 引导优化。
- 如果按钮缺失/显示条件没满足/点开详情弹窗报错：按具体问题修。

**若需优化**（按走查结果）：
- 列表卡片右上角显式徽章：发出方(scope=out)加"📤 已发出"/"📦 等待接收"；接收方(scope=in)加"📥 点我验收"。
- 详情弹窗顶部加状态徽章 + 大按钮：在途且当前用户是接收门店时显示醒目"📥 开始验收"大按钮。
- 发送方详情弹窗也加显式"📤 已发出给 XX 店 / 等待验收"状态提示。

### 4. 三语与版本
- i18n 新增键：`dash.mom` 环比、`dash.yoy` 同比、`dash.up` ↑ {pct}、`dash.down` ↓ {pct}、`dash.prevYear` 去年、`tr.promptReceive` 点此验收等。
- 资源版本 bump app.css?v=、i18n.js?v=、app.js?v=（看改了哪些）。
- plugin.json softwareVersion 1.1.1。
- upgrade.py 记录版本（无 SQL 变更）。

### 5. 验证
- 后端 API 连拉 overview/trend 确认新字段存在、值合理（昨日/上月/去年同月无销售时为 null/0）。
- 浏览器走查：看板 KPI 显示环比↑/↓数字、趋势图 12 个月带去年同比柱。
- 调拨走查（如现状有问题）：创建一张调拨 → 切店 → 点卡片 → 详情弹窗 → 验收 → 状态流转。
- 控制台无 error。

## Dependencies and Considerations

- 看板 API 改造是纯增量字段，旧前端不读新字段就不显示，向后兼容。
- 调拨现状后端全齐（已实现 receive），前端可能只是 UI 引导问题，先验证再决定改多少。
- SQLite 日期函数：`date('now','start of month')` 返回当月第 1 天；`date('now','-1 day')` 昨天；范围比较 `biz_date >= X AND biz_date < Y+1 day`。
- 当分母（昨日/上月/去年）为 0 时，环比无意义，返回 null 让前端不显。
- 趋势图扩展到 12 个月，若某几个月无销售就不返回月份，前端 chart-bars 会自动跳过还是需要补零？需要检查前端现有逻辑（main.py 已 `GROUP BY m ORDER BY m`，不补零；前端按 `for (m,i) in trendData.months` 渲染，缺失月自然没有柱子）。

## Validation

1. 启动服务后 API 实测：`curl /api/dashboard/overview` 看 todaySales.momPct、monthSales.momPct、monthSales.yoyPct 是否为数字或 null；`/api/dashboard/trend` 看 months 是否 12 个月、amounts_last_year 数组是否同长度。
2. 浏览器看板：今日 KPI 副行、本月 KPI 副行、趋势图同比柱是否显示正确，换 EN/IT 显示对应词。
3. 调拨：创建一张调拨（分店A→总店）→ 切总店 → 列表 Tab 收货 → 点卡片 → 详情弹窗 → 底部验收按钮存在；逐件扫码/手动标记 → 提交 → 调拨单变已完成。测试后清理。
4. 控制台无 error；无 SQL 注入风险（参数化已覆盖）。

## Risks

- **分母为 0 的环比**：当月首天（昨日=0）、新开店（历史为 0）时环比算 0/0，SQLite NULLIF 或前端显式 null 处理；后端用 `prev = COALESCE((SELECT SUM... WHERE biz_date BETWEEN ? AND ?), 0)`，再 `momPct = CASE WHEN prev>0 THEN ROUND((cur-prev)*100.0/prev,1) ELSE NULL END`。
- **趋势图扩展到 12 个月**：若前 6 个月完全无销售（新租户），返回的 months 不足 12 条，现有前端逻辑没问题，柱子按实际月份渲染；去年同期 amounts_last_year 补 null 即可，前端不渲染该侧。
- **调拨流程前端已齐但用户没看到**：走查后若只是 UI 引导问题，最小改动加徽章即可；若真有条件错误（如 transferReceiving 条件写错）则按实际修。
- **三语漏键**：新键必须 zh/en/it 都加齐；en 的 ↑/↓ 符号可复用（全球通用）或用 up/down arrow 文本。
- **版本号**：softwareVersion 1.1.0→1.1.1（小修订，非新功能大版本），dataVersion 不动（无 schema 变更）。
