# plugins/AGENTS.md — 应用插件开发要求

> 本文件是**应用插件**（`plugins/{id}/`）的强制开发要求。跨模块通用规则、架构红线、密钥安全总则以根目录《AGENTS.md》为准；插件系统结构/契约以同目录《STRUCTURE.md》为准。冲突时：根目录 AGENTS.md > 本文件。

---

## 1. 数据库规则

1. 库文件命名：`db_{plugin_id}_{tenant_id}_v{dataVersion}`（版本前缀带 v）；
   租户 ID 仅允许字母、数字、下划线。
2. **建库/改结构只能通过 `scripts/init.py`（新库）与 `scripts/upgrade.py`（版本间迁移）在数据任务阶段完成；禁止插件运行时自动建表/迁库。**
3. 迁移脚本：平台已把旧库完整复制到 `NEW_DB_PATH`，脚本只做增量 DDL/数据修复；
   必须幂等；**不得删除/清空旧数据**（平台不回滚，删了无法恢复）；120 秒超时。
4. `dataVersion`：结构未变沿用旧号（平台全量复制即可）；结构变更必须递增并实现 upgrade.py。
5. 数据修复/迁移必须先备份修复前数据；写 UPDATE 前先 SELECT 确认影响范围。
6. SQLite 连接约束：`with _db(request) as conn` 退出即关闭，**所有查询（含派生映射）必须在 with 块内完成**；
   跨线程投递的 FastAPI 端点写成同步 `def` 交线程池执行——async 端点内 `run_coroutine_threadsafe(...).result()` 会死锁。
7. 枚举值（状态、支付方式、等级）库中存中文，仅在展示层做多语言映射。

---

## 2. 后端编码规范（FastAPI）

1. 新增/修改模型必须同步更新：Pydantic 入参、建表/迁移脚本、前端表单与字典。
2. 静态路径与参数路径冲突时（如 `/api/sensors/settings` 与 `/api/sensors/{sid}`），静态路由必须先注册。
3. 可扩展接口用注册表模式（参考 sensors.py：抽象基类 + `@register` + DRIVERS dict），新增类型零改动核心管线；
   HTTP/WS 双通道路径汇入同一个处理函数。
4. 设备侧异常输入不得让进程崩溃：驱动解析失败要落库记录（如 `parse_error` 事件，含原始报文+错误信息）。
5. Webhook：单目标、HMAC-SHA256 签名头、指数退避重试；SANDBOX 模式强制拦截。
6. 服务必须启用 GZip；珠宝云默认端口 8002。
7. 重启服务必须使用项目 `.venv` 的 Python（缺依赖时优先检查解释器是否用错），Windows 下走 start_*.bat 约定的环境。

---

## 3. 前端编码规范（Vue3 SPA）

1. 统一 Vue3（global build）+ 集中状态对象 + methods；新键/新函数必须注册，禁止在 app.js 与 i18n.js 重复声明同名全局函数（曾致栈溢出白屏）。
2. **多语言强制**：所有用户可见文案走 `t('key')`，禁止硬编码中文；三语键齐全（zh/en/it）需要在其他任务完成后，提示用用户此项未做。实施采用「zh 键先行」，但英文字典缺键会导致切换后残留中文，交付前必须补齐。
3. `t()` 与 computed 必须显式依赖响应式语言状态，确保切换语言即时重渲染。
4. **全局字号不低于 14px**：8px–13.5px 一律提升到 14px（含 PC 覆盖层），图标元素除外。
5. 页面脚本加 no-cache 头，普通刷新生效，无需 Ctrl+F5。
6. 带鉴权的图片（如二维码 `<img>`）必须携带登录凭证，否则 401 裂图。
7. 界面布局按指针类型判定：有鼠标的设备用宽屏布局，触屏用移动布局（不要只看窗口宽度）；移动端专属样式必须用 `.app-shell.mobile` 前缀限定，禁止通用 `@media (max-width:...)` 误伤 PC 缩窗。
8. 物理尺寸预览使用 CSS 物理单位（如标签 `width:70mm;height:35mm`），保证缩放 100% 时与实物一致。
9. **数据信息卡片尽量多放详情**：各功能中的数据信息卡片（门店/商品/设备/订单等汇总卡）内的数据要尽可能多加详情字段（数量、金额、状态、占比等），避免只放单一指标；后端按需以 `detail=1` 之类的参数聚合返回，不做无条件的重查询。
10. **SVG 驼峰属性禁止动态绑定**：in-DOM 模板中 `:viewBox` 会被 HTML 解析器小写化为 `:viewbox`，Vue 按小写名 setAttribute 后 SVG 不识别，viewBox 静默失效（图表 1:1 渲染只占容器左半，TC-43）；`viewBox` 必须写静态属性（解析器对 `<svg>` 内静态属性有大小写修正表），尺寸常量化即可。
11. **文字颜色禁止浅色**：所有正文、标签、状态、提示类文字颜色不得浅于 `#6B5A48`（次级）/`#5C4A38`（弱化）——即 CSS 变量 `--text2`/`--text3` 当前值；新增样式禁止直接硬编码浅灰/浅棕（如 `#999`、`#888`、`#9ca3af`、`#B0A08C`、`#8B7A6B`），一律用 `var(--text)`/`var(--text2)`/`var(--text3)`。用户已三次反馈浅色文字看不清（经营分析标签、打印代理离线徽标等），此规则为红线。

---

## 4. 发布与升级流程

按同目录《STRUCTURE.md》第五章五步流水线执行（取基线 verdict → 开发+迁移脚本 → 打包 → 上传触发沙箱 → 轮询+自测）。
要点：目标版本必须高于正式版；插件包排除构建产物与本地配置；打包脚本**禁止硬编码模块白名单**——必须自动发现顶层 `.py` 并校验 import 链完整性，否则新增模块进包即 `ModuleNotFoundError`（已发生过真实事故）；**正式切换只能由人工在平台执行，AI 严禁代为切换**；
升级自测可调用 `plugin-upgrade-selftest` 技能。多个插件版本允许同时试运行；未指定版本的沙箱票证默认路由到最高试运行版本。

**版本管理（plugin_service.delete_version / register_package 已实现）：**
- 非正式版（uploaded / failed / preparing / trial / trial_passed）**可以删除**：DELETE /api/plugins/{id}/versions/{vid}
  自动 stop_if_running 停服务 + 删 DB 行 + 清包目录 + 清该版本所有租户 DB 快照（含 trial 沙箱库）+ 清 storage 快照
- 受保护不可删除：current_version 正式版、status=init/switching 数据任务中、插件 gatew_state=MAINTENANCE
- 上传**同 softwareVersion 的非正式版** → 自动替换（删旧行+清旧包+清旧数据快照 → 插新行+新包），不再报"版本号必须递增"
- 上传同 softwareVersion 但已是 current_version 正式版 → 仍然拒绝（保护正式版不被误替换）

---

## 5. 插件高频踩坑速查（违反过且造成过实际事故）

- 插件前端用绝对路径 → 网关下 404/指向平台路由。
- 全局函数重复声明（app.js/i18n.js）→ 栈溢出白屏。
- 多网卡自动检测拿到虚拟网卡 IP → 手持机连不上；多网卡环境建议手填主机地址。
- 迁移/建库脚本不幂等、删数据 → 重跑失败/数据永久丢失。
- 服务端自刷心跳时间 → 假在线。
- async 端点内跨线程 `.result()` → 事件循环死锁。
- 用错 Python 解释器（系统 Python 缺 qrcode 等依赖）→ 启动/接口异常。
- EPC 混入非十六进制字符 → `^RFW` 写芯片失败。
- UTF-8 BOM 导致 `json.load` 崩（print_agent.json 需 utf-8-sig 读取）；写 VERSION 等配置用 `Set-Content` 会带 BOM → 用 `[System.IO.File]::WriteAllText(path, value, [System.Text.Encoding]::ASCII)`。
- 手持机一台没扫到时点结束核对会被后端拒绝 → 必须提供「强制终止任务」出口（红色描边、二次确认、不生成结果、一键解冻）。
- 销售冻结必须覆盖协同任务「进行中」与「待核对」两种状态，直到核对确认才解除。
- 手动启动 8002（含 WMI 拉起）忘记 `HOST=0.0.0.0` → 只监听 127.0.0.1，手机/手持机扫激活码后 fail to connect；**任何非 start_jewelry.bat 方式启动都必须显式带 HOST=0.0.0.0**，启动后用 `netstat` 确认是 `0.0.0.0:8002 LISTENING`，再让设备扫码。
- Vue global build（`vue.global.prod.js`）模板编译器白名单极严：模板表达式里**任何位置**出现 `.bind/.apply/.call` 字符串（哪怕在引号里、作为 i18n 键名字段）都触发 SyntaxError: Unexpected token ')'，整页渲染中断；改造前端必须先全局扫 `\{\{.*\}\}` 找这些敏感词，键名用 `storeBind/assignOk/...` 等替换。同理 `.constructor/__proto__/prototype/Reflect/Proxy` 也在黑名单。
- 调拨发送弹窗（transferSendOpen）被下层选货抽屉（transferMode）或协同面板（scanCoop.type=transfer_out）遮罩拦截 → 打开发送确认弹窗前必须先 `exitCoopScan(); ST.transferMode = false` 再 `ST.transferSendOpen = true`；三层 modal-mask 叠在一起 send-open 按钮点不动。
- **设备/代理/手持机绑定按"谁用谁管"原则下沉到门店管理**：全局侧边栏/底部 tab bar/首页**禁止放**"手持机绑定""打印机管理"等全局入口（会造成店长在分店视角无从管起、或 CEO 在总店误绑到自己门店）；PC 端总店视角走 `tab=shops`（总部管理）、分店视角走 `tab=stores`，移动端"更多"菜单里放一个 `🏪 门店/总部管理` 入口（HQ→shops、分店→stores）；每个门店的手持机激活码按钮直接嵌在该门店的设备卡片里。
- **系统管理 adminSub 入口不能重复**：品类/标签模板/企业资料等"企业整体级"功能，如果已经搬移到 shops section（总部管理），必须从 `ADMIN_SUBS` 数组里移除对应 key；`normalizeAdminSub()` 自动校正但 UI 上仍会渲染空按钮，造成用户困惑。
- **移动端死代码 section 及时清理**：旧 `v-if="!isPc && tab==='profile'"` 在 `go('profile')` 重定向后永远不渲染，是隐藏的 Vue 模板编译坑高发区（残留模板可能被动态组件编译）；改完导航后顺手删或改为跳转入口。
- **refreshAll() 必须包含所有依赖 curStoreId 的 API**：切店后 `refreshAll()` 里漏了 `loadTransfers()` → 切到分店A看不到该店发起的调拨（还停留上一个门店的 transfersOut 数据）；判断一个状态对象是否依赖 curStoreId 很简单——后端 API 路径里有 store_id 过滤或 scope=out/in 这样的视角参数，就必须在 refreshAll 里刷新；同类漏刷新还会发生在：scope 化的列表（调拨/协同任务/扫码会话）、需要门店级鉴权的配置项、门店视角统计等。
- **dataVersion 不能大于 softwareVersion**（平台 `_validate_manifest` 按点分元组比较，如 1.3.0 > 1.2.16.x 直接 400 拒绝上传）；结构变更递增 dataVersion 时取「不高于当前 softwareVersion 前三段」的号（如 1.2.16.x 周期用 1.2.16）。
- 调拨 scan_codes 是"扫码额外商品"，不是"手动勾选商品的 EPC 再发一遍"：前端 submitTransfer() 之前把同一批勾选商品同时塞进 product_ids 和 scan_codes → 后端 scan_codes 解析成 scan_pids 后与 product_ids 合并去重，`len(raw_ids) != len(ids)` 抛 400 "调拨商品存在重复选择"；scan_codes 真正用途是协同扫描面板扫进来的、不在 transferSel 里的额外商品；修法：前端当前无此场景直接砍 scan_codes（方案 B）；后端 `scan_pids` 解析时跳过已在 body.product_ids 里的 pid（方案 C 防御式）。
- **直接改 `ST.tab` 切页不会触发 `go()` 里的数据加载**（loadInv/loadSaleAnalysis/loadAnaTagStats 等都在 go() 内）：走查/调试改完 tab 必须手动调对应 load 函数，否则统计区块因 `v-if="rows().length"` 数据为空不渲染，会误判"功能缺失"（库存/销售分析的标签区块踩过）。
- **走查断言先查 i18n 实际键值**：商品编辑弹层保存按钮是 `act.submit`「确认提交」（不是「保存」）、销售分析标签区块是 `sale.tagShare`「标签销售占比」（不是「标签实销占比」）；凭臆测写断言导致保存从未触发、区块误判未渲染。
- **种子表"只对演示库灌"禁止用"表空就灌"判定**：真实租户删光字典后升级会复活（product_tags 曾因此只进 seed_demo、致外网沙箱无标签）。正确判定 = 联动主表（如 products）本次是否新灌——主表新灌=全新演示库才灌字典种子（TC-40，`_SEED_PRODUCT_TAGS` 常量化后 seed_demo 与 ensure_new_seeds 共用）。
- **Edit main.py 成对代码块必须带独有上下文**：`product_tag_create` 与 `product_tag_update`、list 接口间的 `return {"list": ...}` 等代码完全相同，Edit 会报 multiple matches——用各自独有的前后行（如上一行 SQL）做唯一锚点。
