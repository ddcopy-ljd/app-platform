# 珠宝云「系统管理 → 问题上报」集成 BugTracker 方案

## Context（背景与目标）

用户希望在珠宝云（jewelry 插件）的「系统管理」区新增一个【问题上报】子页，调用 BugTracker（bugtracker 插件）已有的上报页面，让门店人员在不离开珠宝云的情况下提交缺陷/需求。

**关键前提（探索已证实）**：BugTracker 早已内置完整的「免登录外部上报」能力，无需新建后端：
- 后端接口 `POST /api/report`（[BugTracker/main.py L548](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/BugTracker/main.py#L548)）：接收 `{source, reporter, title, kind, detail, images}`，落「外部上报箱 INBOX」项目，带来源插件/上报人归属、限频（同租户 5 次/分钟）。
- 独立上报页 `GET /report`（[main.py L631](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/BugTracker/main.py#L631) → [report.html](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/BugTracker/frontend/report.html)）：自带表单 + 提交逻辑，且**已支持 URL 参数 `?source=jewelry&user=<上报人>`**——带参时自动隐藏「来源应用/上报人」输入框并锁定（report.html L123-139）。页面内 API 基址用 `window.__APP_BASE__` 拼接（L16），经平台网关访问时由网关注入，完全合规。

**结论**：本功能是**纯前端 + i18n** 改动，用内嵌 iframe 打开 BugTracker 的 `/report` 页。**不动 jewelry 后端、不动数据库、不涉及 dataVersion 迁移。**

用户已确认两项决策：① 内嵌 iframe（附「新窗口打开」兜底链接）；② 本地直连时上报页地址写死 `http://127.0.0.1:8003/report`（bugtracker 默认端口），平台网关下用 `/app/bugtracker/{tenant}/report`。

## 上报页地址解析规则（核心逻辑）

在 app.js 新增函数 `reportPageUrl()`：
- **平台网关模式**：`API`（= `window.__APP_BASE__`，形如 `/app/jewelry/{tenant}/`）非空 → 由它推导出网关根，拼 `/app/bugtracker/{ST.tenant}/report?source=jewelry&user=<上报人>`。
  - 具体：取 `API` 去掉结尾斜杠后按 `/` 分段，末两段是 `{plugin}/{tenant}`，用 `bugtracker` 替换 plugin 段，得到 `/app/bugtracker/{tenant}/`，再拼 `report?...`。
- **本地直连模式**：`API` 为空串 → 返回 `http://127.0.0.1:8003/report?source=jewelry&user=<上报人>`。
- `user` 取当前登录人显示名：`encodeURIComponent((ST.user && (ST.user.display_name || ST.user.username)) || '')`。

> 租户来源：`ST.tenant` 在登录响应里已赋值（[app.js L1086](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L1086) `ST.tenant = r.tenant`）。

## 改动清单

### 1. 前端 app.js（[plugins/jewelry/frontend/app.js](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js)）
- `ADMIN_SUBS` 数组（L260）追加一项：`{ key: 'report', icon: '🐞', label: '问题上报' }`。
  - 说明：现有 ADMIN_SUBS 各 label 均为硬编码中文（未走 t()），本项沿用同一模式，保持一致、最小改动；不重构既有项。
- `isAdminSubAllowed()`（L551）：`report` 属于门店级/全员可用 → 落到末尾 `return true`，无需特判（默认即可见）。
- 新增函数 `reportPageUrl()`（见上解析规则）与 `openReportWindow()`（`window.open(reportPageUrl(), '_blank')`）。
- `go('system')` 分支（L694-703）：`report` 子页无需预加载数据（iframe 自带），不加分支即可。
- methods 注册：`reportPageUrl`、`openReportWindow`（供模板绑定）。

### 2. 前端 index.html（[plugins/jewelry/frontend/index.html](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html)）
- 仿照既有 `<section v-if="tab==='system' && adminSub==='security'">` 模式，新增一个 section：`v-if="tab==='system' && adminSub==='report'"`，内含：
  - 顶部 `page-head`：业务说明 `<details class="biz-guide">`（文案走 `t('biz.report')`）+ 一个「🔗 新窗口打开」按钮（`@click="openReportWindow"`，文案 `t('report.openNew')`）。
  - iframe：`:src="reportPageUrl()"`，`class="report-frame"`，`frameborder="0"`，设较高高度（见 CSS）。iframe 直接指向解析出的绝对/相对 URL，**不违反「禁止绝对路径请求 API」**（这是打开另一个插件的页面，非本插件 API 调用）。
  - 提示条：`t('report.tip')`（说明上报将进入 BugTracker 待处理箱，由质量团队跟进）。

### 3. 前端 app.css（[plugins/jewelry/frontend/app.css](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.css)）
- 新增 `.report-frame { width:100%; height: 78vh; min-height:520px; border:1px solid var(--border,#e5e7eb); border-radius:12px; background:#fff; }`（字号无关，仅容器样式）。

### 4. i18n 三语（[plugins/jewelry/frontend/i18n.js](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/i18n.js)）
- zh/en/it 各补键：`biz.report`、`report.openNew`、`report.tip`（约 3 键 × 3 语）。
- 注意 AGENTS.md 红线：三语键必须齐全；Vue global build 模板黑名单（本改动模板表达式仅函数调用 + 静态类名，无 `.bind/.apply` 等敏感词，安全）。

## 不做的事（范围控制）
- 不改 jewelry 后端 main.py、不加代理接口、不动 db.py/plugin.json/dataVersion。
- 不重构既有 ADMIN_SUBS 的 i18n。
- 不改 BugTracker 任何代码（其上报能力已完备）。

## 验证（仅测改动面，遵守 2 分钟超时必杀）
1. **前端语法**：无后端改动，跳过 py_compile；浏览器直接走查。
2. **平台网关走查（主路径）**：经平台 8000 打开 jewelry（`/app/jewelry/tenant_trial/`）→ 系统管理 → 点「问题上报」子页 → iframe 应加载 BugTracker `/report` 页，来源/上报人已自动带入并隐藏；填标题+描述提交 → 返回受理编号 INBOX-xxx。需确保 bugtracker 试运行服务在跑（若未起，用「新窗口打开」兜底或提示）。
3. **本地直连走查**：8002 jewelry 直连 → 问题上报子页 iframe 指向 `http://127.0.0.1:8003/report`（需本地起 bugtracker 于 8003；若端口不同按 TEST_CASES 换空端口）。
4. **语言切换**：切 en/it，`report.openNew`/`report.tip`/`biz.report` 文案随之切换、无残留中文。
5. **控制台**：无本页面新增 JS 报错。
6. 测试产生的上报记录属 BugTracker INBOX（外部上报箱），非珠宝云业务数据；如需清理，在 bugtracker 侧删除该条 INBOX 记录即可（不影响 jewelry 库）。

## 交付后提示（不在本次实施内）
- 意大利语/英语文案为翻译补全，交付时提示用户可复核措辞。
- 本功能依赖 bugtracker 插件在目标租户已授权开通且服务运行；若未开通，iframe 会显示平台 403 拦截页——属预期，走查时说明。
