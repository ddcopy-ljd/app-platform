# AGENTS.md — AI 开发规则（本仓库强制遵守）

本文件是所有 AI Agent（及协作者）在本仓库工作时的**强制规则**。开始任何任务前必须通读本文件；
规则之间冲突时，按「平台/插件合同（《应用插件开发说明.md》）> 本文件硬约束 > 其他文档」处理。规则与项目记忆有冲突，要提示用户

---

## 1. 仓库地图

多租户插件化 SaaS 平台：FastAPI + Vue3 + SQLite，三端代码同仓库。

| 路径 | 说明 | 运行方式 |
|---|---|---|
| `platform/` | 平台核心：网关、插件生命周期、多版本沙箱升级、WS 透传 | 本地测试用 8000 端口，`start_platform.bat` |
| `plugins/{id}/` | 应用插件（当前 jewelry 珠宝云）：后端 + SPA + 建库/迁移脚本 + 推广页 | 本地测试用 8002 端口，`start_jewelry.bat` |
| `scan-assistant/` | 普通安卓手机辅助 App（Kotlin，摄像头扫码盘点） | Gradle |

- 平台与插件**数据库严格分离**：平台不读写插件业务表；插件不写平台库（只经内网 API 查询订阅/鉴权）。
- 架构与鉴权合同细节以《应用插件开发说明.md》为准，本文件只固化必须遵守的红线与流程。

---

## 2. 通用工作流程（每个任务都按此执行）

1. **先理解再动手**：需求有歧义必须先澄清（给出选项让用户选），禁止自行脑补后大规模实施。
2. **复杂任务先规划**：≥3 个文件、跨模块、高风险、需求不清的任务，先确认总体需求，再一个需求一个需求的入手，获批后再写代码。
3. **维护任务清单**：多步骤任务用 Todo 列表跟踪，完成一项标记一项。
4. **读后再改**：编辑前先读文件确认最新内容与确切路径；禁止猜测路径；优先编辑已有文件，禁止无必要新建文件。
5. **最小改动**：只做被要求的事，不顺手重构、不"顺手优化"无关代码；不同技术路线分支禁止直接合并（提取所需功能点重新实现）。
6. **提交纪律**：一项目任务完成后，如果用户对以下动作没有确认，就不执行：git commit/push 等命令；
7. 经用用户确认：后端改动跑 E2E/冒烟；前端改动浏览器走查；全部通过后如实汇报结果（包括失败项与遗留项），禁止谎报。
8. **不主动创建文档**：*.md/README 只在用户明确要求时创建（规则/测试台账文件本身的维护除外）。

---

## 3. 架构与网关红线

1. 插件前端**禁止使用绝对路径**请求 API（会错误指向平台自身路由）；统一用相对路径 + 封装的 api()。
2. 三条链路不可混用：`/app/` 工作区 SPA、`/gw/` API 透传、`/market/` 推广页静态伺服；
   WS 透传路径为 `/app/{plugin}/{tenant}/ws/{path}` → 插件 `/ws/{path}`。
3. 插件进程必须同时支持：平台 SSO Token 穿透（一次性、5 分钟有效、当场换签业务 Token）与自身账号密码登录。
4. 三种运行模式的响应约定：
   - `NORMAL`：连真实租户库，允许真实外部动作；
   - `SANDBOX`：连沙箱库，**必须 Mock/拦截所有短信、邮件、Webhook、扣费等对外动作**；
   - `PRODUCTION_SUPPORT`：连真实库、最高权限，**每一笔修改强制审计日志**，前端红色边框防呆。
5. 设备/代理的在线状态**只信其上报帧**刷新 `last_seen`，服务端严禁自己刷新（否则静默掉线会永远显示在线）。

---

## 4. 数据库规则

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

## 5. 后端编码规范（FastAPI）

1. 新增/修改模型必须同步更新：Pydantic 入参、建表/迁移脚本、前端表单与字典。
2. 静态路径与参数路径冲突时（如 `/api/sensors/settings` 与 `/api/sensors/{sid}`），静态路由必须先注册。
3. 可扩展接口用注册表模式（参考 sensors.py：抽象基类 + `@register` + DRIVERS dict），新增类型零改动核心管线；
   HTTP/WS 双通道路径汇入同一个处理函数。
4. 设备侧异常输入不得让进程崩溃：驱动解析失败要落库记录（如 `parse_error` 事件，含原始报文+错误信息）。
5. Webhook：单目标、HMAC-SHA256 签名头、指数退避重试；SANDBOX 模式强制拦截。
6. 服务必须启用 GZip；珠宝云默认端口 8002。
7. 重启服务必须使用项目 `.venv` 的 Python（缺依赖时优先检查解释器是否用错），Windows 下走 start_*.bat 约定的环境。

---

## 6. 前端编码规范（Vue3 SPA）

1. 统一 Vue3（global build）+ 集中状态对象 + methods；新键/新函数必须注册，禁止在 app.js 与 i18n.js 重复声明同名全局函数（曾致栈溢出白屏）。
2. **多语言强制**：所有用户可见文案走 `t('key')`，禁止硬编码中文；三语键齐全（zh/en/it）需要在其他任务完成后，提示用用户此项未做。实施采用「zh 键先行」，但英文字典缺键会导致切换后残留中文，交付前必须补齐。
3. `t()` 与 computed 必须显式依赖响应式语言状态，确保切换语言即时重渲染。
4. **全局字号不低于 14px**：8px–13.5px 一律提升到 14px（含 PC 覆盖层），图标元素除外。
5. 页面脚本加 no-cache 头，普通刷新生效，无需 Ctrl+F5。
6. 带鉴权的图片（如二维码 `<img>`）必须携带登录凭证，否则 401 裂图。
7. 界面布局按指针类型判定：有鼠标的设备用宽屏布局，触屏用移动布局（不要只看窗口宽度）。
8. 物理尺寸预览使用 CSS 物理单位（如标签 `width:70mm;height:35mm`），保证缩放 100% 时与实物一致。

---

## 7. Android 原生 App 规范（scan-assistant）

1. **必须 Kotlin 原生实现，禁止 WebView/H5**；App 设置页分组、条目按既定结构维护。
2. 必须签名 APK（CI release 使用固定 release.jks，保证可直接覆盖升级；不同签名无法覆盖安装）。
3. 版本语义：`重构.功能.修订`——修 BUG 只进 z 位（1.3.9 → 1.3.10，不是 1.4.0）。
4. 物理扳机、功能键广播、屏幕按钮三个触发通道共用同一套状态机，避免重复触发；
   C27 扳机不产生按键事件，需监听 `android.rfid.FUN_KEY` 广播并处理 down+false 双拍；
   C72 的 `startInventoryTag()` 首次可能假失败，需连续重试最多 3 次、间隔 200ms。
6. 同一会话扫描数据按 `UNIQUE(session_id, epc)` 全局去重；实时显示新增/重复计数。
8. **盘存中禁止强杀 App/拔电池**（UHF 模块会锁死，只能整机重启）——代码与提示都要规避。

---

## 8. 密钥与安全

1. **任何密钥禁止明文写入代码/配置**（如 AGENT_API_KEY 一律从环境变量读取）；已进入 git 历史的密钥必须作废更换。
2. 设备/门店密钥只在创建/轮换时回显一次，列表接口永不回显；轮换需用户确认。
3. 推广页红线：只能放独立子目录（promo/）；纯静态、相对路径引用、禁止越目录引用（平台 404）、禁止读主站 Cookie/LocalStorage、禁止提交业务表单。
4. 安全审查发现风险只报告可证实、可利用且由本次变更引入的问题，不扩大、不臆测。

---

## 9. 测试与验收（交付前必做）

** 执行前，声音通过用户，确认后，才执行升级自测时逐条回归历史用例。超时120秒后，放弃执行，进入下一环节。** 

1. 每插件维护 `TEST_CASES.md`：发现问题按「问题现象 → 根因 → 可执行验证方法」入册（如 TC-13/TC-14）；
2. 测试分层：后端 E2E（接口+判定+迁移）→ 核心冒烟（既有业务页面/接口）→ 浏览器走查（渲染、交互、控制台无报错）。
3. 数据结构变更必须做写入链路验证：实际创建一条数据再删除，确认新代码对迁移后的库读写正常、自动字段格式正确。
4. 测试数据（设备、商品、事件、临时放行）**必须全部清理**，沙箱/开发库不留脏数据；
   清理后再查一次确认。
5. PowerShell 5.1 发中文 JSON 体会乱码入库——测中文链路一律用 Python 或浏览器。

---

## 10. 发布与升级流程

按《应用插件开发说明.md》第九章五步流水线执行（取基线 verdict → 开发+迁移脚本 → 打包 → 上传触发沙箱 → 轮询+自测）。
要点：目标版本必须高于正式版；插件包排除构建产物与本地配置；**正式切换只能由人工在平台执行，AI 严禁代为切换**；
升级自测可调用 `plugin-upgrade-selftest` 技能。多个插件版本允许同时试运行；未指定版本的沙箱票证默认路由到最高试运行版本。

**版本管理（plugin_service.delete_version / register_package 已实现）：**
- 非正式版（uploaded / failed / preparing / trial / trial_passed）**可以删除**：DELETE /api/plugins/{id}/versions/{vid}
  自动 stop_if_running 停服务 + 删 DB 行 + 清包目录 + 清该版本所有租户 DB 快照（含 trial 沙箱库）+ 清 storage 快照
- 受保护不可删除：current_version 正式版、status=init/switching 数据任务中、插件 gatew_state=MAINTENANCE
- 上传**同 softwareVersion 的非正式版** → 自动替换（删旧行+清旧包+清旧数据快照 → 插新行+新包），不再报"版本号必须递增"
- 上传同 softwareVersion 但已是 current_version 正式版 → 仍然拒绝（保护正式版不被误替换）

---

## 11. 高频踩坑速查（违反过且造成过实际事故）

- 插件前端用绝对路径 → 网关下 404/指向平台路由。
- 全局函数重复声明（app.js/i18n.js）→ 栈溢出白屏。
- 多网卡自动检测拿到虚拟网卡 IP → 手持机连不上；多网卡环境建议手填主机地址。
- 迁移/建库脚本不幂等、删数据 → 重跑失败/数据永久丢失。
- 服务端自刷心跳时间 → 假在线。
- async 端点内跨线程 `.result()` → 事件循环死锁。
- 用错 Python 解释器（系统 Python 缺 qrcode 等依赖）→ 启动/接口异常。
- EPC 混入非十六进制字符 → `^RFW` 写芯片失败。
- UTF-8 BOM 导致 `json.load` 崩（print_agent.json 需 utf-8-sig 读取）。
- 手持机一台没扫到时点结束核对会被后端拒绝 → 必须提供「强制终止任务」出口（红色描边、二次确认、不生成结果、一键解冻）。
- 销售冻结必须覆盖协同任务「进行中」与「待核对」两种状态，直到核对确认才解除。
- 手动启动 8002（含 WMI 拉起）忘记 `HOST=0.0.0.0` → 只监听 127.0.0.1，手机/手持机扫激活码后 fail to connect；**任何非 start_jewelry.bat 方式启动都必须显式带 HOST=0.0.0.0**，启动后用 `netstat` 确认是 `0.0.0.0:8002 LISTENING`，再让设备扫码。
- 设备与电脑同网段（都是 192.168.1.x）但手持机浏览器打不开、App fail to connect，电脑端 netstat 抓不到任何外部连接 → 光猫/路由器开了 **AP 隔离/用户隔离（或外网防火墙）**，二层直接阻断无线互访，设备 ping 电脑报 `Destination Host Unreachable`；进路由后台关 AP 隔离/防火墙。诊断用 USB+开发者模式：`adb shell ping <电脑IP>`，同网段却 Host Unreachable 即可确诊；应急联调可 `adb reverse tcp:8002 tcp:8002` 走 USB 线（App 服务器地址填 `http://127.0.0.1:8002`，但用期间不能拔线）。
- Windows 用户名含中文（俊达）时 Kotlin daemon 把 classpath 转义成 `C:\Users\u4FCAu8FBE\…` → 本地 `compileReleaseKotlin` 报一堆 jar 找不到；工程 gradle.properties 必须设 `kotlin.compiler.execution.strategy=in-process`。本机已有完整工具链（JDK17 Temurin、SDK `C:\Android` 含 build-tools 34/android-34、Gradle 8.2），本地构建前设 `ANDROID_HOME=C:\Android`，不必默认走 CI。
- Vue global build（`vue.global.prod.js`）模板编译器白名单极严：模板表达式里**任何位置**出现 `.bind/.apply/.call` 字符串（哪怕在引号里、作为 i18n 键名字段）都触发 SyntaxError: Unexpected token ')'，整页渲染中断；改造前端必须先全局扫 `\{\{.*\}\}` 找这些敏感词，键名用 `storeBind/assignOk/...` 等替换。同理 `.constructor/__proto__/prototype/Reflect/Proxy` 也在黑名单。
- 调拨发送弹窗（transferSendOpen）被下层选货抽屉（transferMode）或协同面板（scanCoop.type=transfer_out）遮罩拦截 → 打开发送确认弹窗前必须先 `exitCoopScan(); ST.transferMode = false` 再 `ST.transferSendOpen = true`；三层 modal-mask 叠在一起 send-open 按钮点不动。
- **设备/代理/手持机绑定按"谁用谁管"原则下沉到门店管理**：全局侧边栏/底部 tab bar/首页**禁止放**"手持机绑定""打印机管理"等全局入口（会造成店长在分店视角无从管起、或 CEO 在总店误绑到自己门店）；PC 端总店视角走 `tab=shops`（总部管理）、分店视角走 `tab=stores`，移动端"更多"菜单里放一个 `🏪 门店/总部管理` 入口（HQ→shops、分店→stores）；每个门店的手持机激活码按钮直接嵌在该门店的设备卡片里。
- **系统管理 adminSub 入口不能重复**：品类/标签模板/企业资料等"企业整体级"功能，如果已经搬移到 shops section（总部管理），必须从 `ADMIN_SUBS` 数组里移除对应 key；`normalizeAdminSub()` 自动校正但 UI 上仍会渲染空按钮，造成用户困惑。
- **移动端死代码 section 及时清理**：旧 `v-if="!isPc && tab==='profile'"` 在 `go('profile')` 重定向后永远不渲染，是隐藏的 Vue 模板编译坑高发区（残留模板可能被动态组件编译）；改完导航后顺手删或改为跳转入口。
- **refreshAll() 必须包含所有依赖 curStoreId 的 API**：切店后 `refreshAll()` 里漏了 `loadTransfers()` → 切到分店A看不到该店发起的调拨（还停留上一个门店的 transfersOut 数据）；判断一个状态对象是否依赖 curStoreId 很简单——后端 API 路径里有 store_id 过滤或 scope=out/in 这样的视角参数，就必须在 refreshAll 里刷新；同类漏刷新还会发生在：scope 化的列表（调拨/协同任务/扫码会话）、需要门店级鉴权的配置项、门店视角统计等。
- **调拨 scan_codes 是"扫码额外商品"，不是"手动勾选商品的 EPC 再发一遍"**：前端 submitTransfer() 之前把同一批勾选商品同时塞进 product_ids 和 scan_codes → 后端 scan_codes 解析成 scan_pids 后与 product_ids 合并去重，`len(raw_ids) != len(ids)` 抛 400 "调拨商品存在重复选择"；scan_codes 真正用途是协同扫描面板扫进来的、不在 transferSel 里的额外商品；修法：前端当前无此场景直接砍 scan_codes（方案 B）；后端 `scan_pids` 解析时跳过已在 body.product_ids 里的 pid（方案 C 防御式）。

---

## 12. 规则维护

- 本文件随项目演进持续更新：新确认的硬约束、重复出现的踩坑、流程变更，在任务完成后即时补入对应章节。
- 条目必须具体、可执行（"必须/禁止 + 对象 + 条件"），不写空泛原则。
- 与本文件冲突的旧文档以本文件为准，并顺手修正旧文档消除矛盾。
