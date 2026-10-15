# 懿臻珠宝云 - 测试用例台账

> 每次升级自测时逐条回归执行，确认旧问题未复发。
> 记录格式：问题现象 → 根因 → 验证方法。
> 新问题随时追加；已彻底修复且不可能复发的标记「已归档」，不删除。

---

## TC-01 EPC 门店码格式迁移（旧格式兼容）

- **问题现象**：v1.0.5 将 EPC 格式从「前缀+品类码+序号」升级为「前缀+门店码+品类码+序号」，历史数据中存在旧格式与脏 EPC（随机十六进制串、尾部混入货号、品类码错位）。
- **根因**：`_migrate_clean_dirty_epc` 需同时识别两种格式，旧格式按「门店+品类」重新分配续号。
- **验证方法**：准备含旧格式 EPC 的租户库 → 执行迁移 → 校验所有 EPC 匹配现行正则（前缀+2位门店hex+2位品类码+序号位）且品类码与商品 `product_type_code` 一致、无重复、序号不冲突。

## TC-02 biz_config.bridge_key 列幂等补全

- **问题现象**：v1.0.5 新增 `bridge_key` 列；旧库迁移和全新初始化都依赖此列存在。
- **根因**：`migrate_schema` 的 ADD COLUMN 清单与 SCHEMA 建表语句必须同步维护。
- **验证方法**：迁移后库与全新 init 的库分别执行 `SELECT bridge_key FROM biz_config WHERE id=1` 均可成功；重复执行 upgrade.py 不报错（幂等）。

## TC-03 打包排除构建产物与本地配置

- **问题现象**：`build_package.py` 白名单收录整个 `scripts/` 目录，导致 PrintBridge EXE 构建产物（约 20MB）与门店本地配置 `print_agent.json` 险些打入插件包。
- **根因**：EXCLUDE_PARTS 原先只有 `__pycache__/.pyc`。
- **验证方法**：打包后检查 zip 内容：不含 `scripts/build/`、`scripts/dist/`、`print_agent.json`；体积 ≤ 50MB；根目录直接含 `plugin.json`。

## TC-04 沙箱入口必须走票证而非 /app/ 路径

- **问题现象**：自测时直接访问 `/app/jewelry/tenant_trial/` 返回 302/400「请选择已开通该应用的真实企业租户」。
- **根因**：`/app/{插件ID}/{租户ID}/` 是正式版入口（NORMAL 模式），沙箱必须先取 SANDBOX 票证再走 `/gw/{ticket}/`。
- **验证方法**：按升级规范 9.3 第⑤步流程取票证，入口页经 `/gw/{ticket}/` 返回 200。

## TC-05 Git Bash 下 curl 传中文 JSON 失败

- **问题现象**：Windows Git Bash 中 `curl -d '{"name":"中文"}'` 报 "There was an error parsing the body"。
- **根因**：命令行参数中文编码在 Windows 控制台传输时损坏。
- **验证方法**：需要中文请求体时，先用 Python 写 UTF-8 文件再 `curl --data-binary @body.json`。写入链路自测（涉及中文名称的数据）必须用此方式。

## TC-06 EPC 自动生成序号续号不冲突

- **问题现象**：同门店同品类下新建商品，EPC 序号必须接续该组已占用的最大序号。
- **根因**：`_gen_type_epc` 按（门店码+品类码）前缀 LIKE 查询取最大序号 +1。
- **验证方法**：沙箱中连续创建两条同品类商品 → EPC 序号递增且不重复；删除中间一条后再建，不得复用刚删的序号造成历史混淆（按当前实现为取最大值续号，验证实际行为符合预期）。

## TC-07 迁移脚本头部说明与实际 dataVersion 同步

- **问题现象**：upgrade.py 文档字符串曾停留在「dataVersion 1.0.0」，与实际数据版本（1.0.3）不符，误导后续维护。
- **根因**：版本递增时只改了 plugin.json，漏改脚本说明。
- **验证方法**：每次升级后检查 `scripts/upgrade.py` 头部说明中提到的数据版本语义与 plugin.json 的 dataVersion 一致。

## TC-08 打包变更清单对未提交改动的提示

- **问题现象**：changes.lst 由 git 提交记录生成，若改动未 commit，清单会缺项（仅有一行⚠提示）。
- **根因**：打包基于 git log 提取变更。
- **验证方法**：升级打包前确认插件目录改动已 commit，或核对 changes.lst 尾部⚠清单与实际改动一致。

## TC-09 数据核对区分"本来没数据"与"迁移丢数据"

- **问题现象**：沙箱自测时 `/api/products` 返回 0 条，需判断是 tenant_trial 正式库本来就无数据，还是迁移脚本丢了数据。
- **根因**：不能只看 API 返回，必须直接比对新旧库文件。
- **验证方法**：用 sqlite3 分别打开 `platform/data/tenant_dbs/jewelry/` 下旧版本库与新版本库，比对核心表（products/stores 等）行数一致。

## TC-10 epc_cleaned 一次性闸门导致种子/造数/历史脏码永久漏网

- **问题现象**：开发库 100 件商品 EPC 100% 不合规（手持机实扫 24 位芯片 TID），迁移清理却从不触发：init 顺序为「SCHEMA→migrate_schema（置 epc_cleaned=1）→灌种子」，种子与造数脚本在闸门置位后写入脏码，且 seed_test_data.py 还主动置位闸门；更严重的是旧版本在脏数据仍存在时提前置位闸门，之后任何升级都永远跳过清理。
- **根因**：①清理闸门只能挡住"闸门之前就存在"的脏数据，种子/造数路径必须自行保证合规；②一次性闸门与"幂等校正"不兼容——闸门一旦被错误置位不可挽回。
- **修复**：种子/造数落库即合规；`_migrate_clean_dirty_epc` 取消闸门 early-return，每次迁移都调用幂等的 `assign_rule_epcs`（合规码原样保留，第二次执行零改动；products.rfid_epc 全部写入入口均为系统规则生成，重跑不误伤）。
- **验证方法**：①全新 init 后校验 12 件种子 EPC 全部匹配现行正则且品类段一致；②造数脚本产物 100% 合规；③`db.assign_rule_epcs(conn)` 连跑两次，第二次返回空映射（幂等）；④构造 `epc_cleaned=1` 且含 100 件脏 EPC 的库执行 migrate_schema，迁移后 0 不合规/0 品类错位，再跑一次 EPC 零变化；⑤干净库执行 migrate_schema，EPC 零变化；⑥历史脏库经重排后 inventory_logs、stocktake_items（按 product_id）、stocktake_scans（按旧→新映射）引用一致，盘盈未登记标签（product_id IS NULL）保留原值。

## TC-11 材质英文长码迁移转换后不落库

- **问题现象**：库里存 `PLATINUM/GOLD/...` 长码时，`_migrate_material_and_type` 虽在局部变量完成转换与推断，但长码场景用 `want or cur_mat` 取值，推断结果为兜底 `OTH` 时反而把 OTH 落库，长码永不收敛为简写。
- **根因**：以转换后的局部变量判断现状 + 错误地用兜底值覆盖确定的长码信息。
- **验证方法**：插入 material='PLATINUM' 的商品后执行迁移 → 落库必须为 `PT`（推断出更精确材质时除外）；再跑一次迁移结果不变（幂等）。

## TC-12 打包后工作区继续改码导致"包-源码漂移"

- **问题现象**：v1.0.5 打包（22:48）后工作区又改了 db.py/main.py/app.js/print_agent.py（多门店打印桥），沙箱跑的是包内旧码，自测结论无法覆盖工作区新码。
- **根因**：打包不是冻结点；插件改动又未 commit，changes.lst 也缺项（与 TC-08 叠加）。
- **验证方法**：沙箱验证前先 `git status` 确认待发布改动已全部 commit 且打包时间晚于最后一次源码修改；必要时解包 zip 与工作区逐文件比对。修复必须重新打包（版本号递增）后重走沙箱，不得把沙箱结论外推到未打包代码。

## TC-13 安防中心 E2E 全链路

- **问题现象**：防盗 RFID 传感器接口属于全新功能，无法通过旧用例回归覆盖。
- **根因**：新增 sensors/sensor_events/sensor_pass/sensor_settings 四表 + sensors.py 驱动管线 + 前端安防中心 + 布防调度通知。
- **验证方法**：运行 `test_sec_e2e.py`，需通过全部 30 项断言（AC-1~AC-11），核心检查点：
  1. 注册设备→密钥仅展示一次→列表不回显；
  2. 正确/错误/禁用密钥的鉴权码 200/401/403；
  3. 布防中在库 EPC 触发告警（含商品信息）、已售/借出/手工放行自动放行；
  4. EAS 布防告警 vs 撤防只记 info；
  5. 60 秒重复抑制与窗口过期后重新告警；
  6. /ws/security 收到告警推送；WebHook 外发带 HMAC 且 SANDBOX 拦截；
  7. 定时布防调度与手动切换均正确；
  8. 事件确认/误报字段完整，全部写 operate_logs。

## TC-14 安防接入易用性四改进（心跳超时/字段映射/原始报文/接入指南）
- **问题现象**：不同厂商设备心跳节奏不一、字段名各异，接入调试缺少原始报文视图与自助接入文档。
- **根因**：设备级配置缺少 heartbeat_timeout/field_map；解析失败不留痕；驱动字段说明未暴露。
- **验证方法**：运行 `test_sec4.py`，需通过全部 7 项断言：
  1. `/api/sensors/drivers` 返回各驱动 `fields` 字段说明；
  2. 创建设备支持心跳超时与字段映射，非法映射 JSON 被 400 拒绝；
  3. 字段映射生效：设备以 `tags` 上报自动按映射当作 `epcs` 处理；
  4. 驱动解析失败落 `parse_error` 事件（含原始报文与错误信息）；
  5. 事件流 JOIN 返回 sensor_name，供原始报文调试面板展示；
  6. 设备视图按各自 heartbeat_timeout 判定在线；
  7. 更新设备可修改心跳超时、清空字段映射。
  浏览器走查：安防中心五面板齐全（含「接入指南」「原始报文调试」），设备行有「编辑」按钮，编辑表单含心跳超时与字段映射。

## TC-15 快速开单会员联想把 `{items:[...]}` 当数组用导致渲染抛错（1.0.9）
- **问题现象**：开单输入不存在的手机号（如 13900000209）时，「一键新建会员」按钮不出现，控制台报 `TypeError: (d._memList || []).filter is not a function`，Vue render 中断。
- **根因**：`GET /api/customers/lookup` 返回结构是 `{"items": [...]}`，前端 `onPhoneInput/quickCreateMember` 误把整个响应当数组赋给 `_memList`，对象没有 `filter`。
- **验证方法**：浏览器开单面板手机号填一个库中不存在的 11 位号码，等待 0.5 秒，应出现「＋ 一键新建会员」按钮且控制台无报错；再填已有会员号码应出现联想卡片（等级/积分/金价折扣率）。

## TC-16 中文段缺 `pay.cash/wechat/card/transfer` 字典键（1.0.9）
- **问题现象**：中文界面下开单支付方式下拉显示原始 key（`pay.cash`、`pay.wechat`…）而非「现金/微信/刷卡/转账」。
- **根因**：i18n 的 en/it 段有 pay.* 键，zh 段长期缺键（历史遗留，旧版单笔支付下拉同样受影响，只是未被注意）。
- **验证方法**：中文语言下打开快速开单，展开支付方式下拉，四项必须显示中文；切换 EN/IT 各核对一遍；组合支付两行分别选微信/刷卡，提交后销售卡片子摘要显示「微信 ￥5,000 + 刷卡 ￥1,000」。

## TC-17 入库单把 computed `curStoreName` 当函数调用导致整单渲染崩溃（1.0.9）
- **问题现象**：分店账号在「门店管理」点「📥 入库」，入库弹窗完全不出现（`v-if` 已翻转但渲染失败），控制台报 `TypeError: curStoreName is not a function`（商品档案表单共用同一模板块，同样受影响）。
- **根因**：`curStoreName` 在 app.js 中注册为 **computed**，模板里却写成 `curStoreName()` 调用；computed 在模板中自动解包为值，加括号即对字符串/undefined 做函数调用，render 抛错后 Vue 丢弃本次渲染。
- **验证方法**：切到分店（顶栏门店切换器选非总店），「门店管理 → 📥 入库」弹窗正常打开，入库门店只读框显示当前门店名、控制台无报错；商品管理 → ＋ 新增商品同样正常显示门店名。

## TC-18 协同任务「功能名 #序号」与门店手持机列表（1.1.0）
- **问题现象**：同名功能多个操作者同时发起手持机协同任务时，手持机端和网页端只显示一串 RW 长编号，无法辨认任务归属；门店管理也看不到本店绑定了哪些手持机。
- **根因**：任务无「门店+功能类型」维度的序号；设备列表只在弹窗中可查。1.1.0 起 tasks 增加 type_seq（按 store_id+type 永久递增，部分唯一索引 `idx_tasks_type_seq`），任务 brief 下发 type_seq，网页/手持机统一显示「功能名 #序号」（销售开单/盘点/借货/调拨出库/调拨收货/商品EPC/入库EPC/扫码），epc_product、epc_inbound 从 generic 拆为独立类型；门店管理新增手持机卡片。
- **验证方法**：
  1. 迁移：对租户库跑两次 `migrate_schema` 均成功（幂等），tasks 有 type_seq 列与 `idx_tasks_type_seq`，历史任务 type_seq=0；
  2. API：同门店连发两个 epc_product 任务再发一个 loan，type_seq 依次为 1、2、1；`GET /api/devices` 含 current_task_type/current_task_seq；
  3. 浏览器：分店视图「门店管理」自动选中本店，出现「📱 手持机 (N)」卡片，列出每台设备名称/SH-码/当前任务标签/在线状态/启停状态；快速开单 📱 协同浮层显示「销售开单 #n」+ RW 长编号，切 EN/IT 显示 `Sale #n` / `Vendita #n`（序号不变）；商品编辑表单 RFID EPC 旁 📱 协同显示「商品EPC #n」；控制台无报错；
  4. 手持机 App（1.1.0）：任务列表两行卡片（粗体「功能名 #序号」+ 长编号），工作页 tvTaskNo 同步；
  5. 注意：手持机卡片在 PC 端必须加在 `v-if="tab==='stores'"` 的 curStore 详情区（`!isPc && tab==='profile'` 内的同名卡片只服务移动端），两端都要验证。

## TC-19 看板销售同比环比 + 调拨收发链路 + Vue 模板 `.bind` 白名单拦截坑（1.1.1）
- **问题现象**：① 看板 KPI 卡片只有今日/本月绝对额，无同比/环比；趋势图只有 6 个月单柱，看不出同比对比；② 前端调起调拨发送弹窗时被下层选货抽屉遮罩层拦截（modal z-index 竞争）；③ Vue 模板编译器白名单拦截 `.bind` 关键字导致整页 SyntaxError，所有业务渲染中断。
- **根因**：
  1. `/api/dashboard/overview` 只返回绝对额，`_current_store` 同口径的日/月/同比聚合缺失；`/api/dashboard/trend` 只拉 6 个月无去年同期。
  2. `openTransferSend()` 只设 `transferSendOpen=true` 打开发送弹窗，**没关 `transferMode=false`（选货抽屉遮罩）** 也没 `exitCoopScan()`（协同面板遮罩），三层 modal-mask 叠在一起。
  3. Vue 3 template compiler 白名单明确禁止 `Function.prototype.apply/call/bind` —— **任何模板表达式只要出现 `.bind` 字面量就被拦截**，哪怕位置在字符串里（如 `t('hq.bindStore')` 键名），会被编译器当作函数绑定调用生成非法 JS，`new Function(code)` 抛 SyntaxError: Unexpected token ')'。
- **验证方法**：
  1. API：`/api/dashboard/overview` 含 todaySales.momPct、monthSales.momPct、monthSales.yoyPct；分母为 0 时返回 null；`/api/dashboard/trend` 返回近 12 个月 + `amountsLastYear`（去年同期）。
  2. 前端：看板今日卡片「今日 N 笔 · 环比 ↓xx%」、本月卡片「本月 ￥xxx · 环比 ↓xx% · 同比 ↓xx%」，趋势图有双色柱（本年金 / 去年灰）；三语切换键齐全。
  3. **关键模板白名单约束**：所有 i18n 键名、模板表达式、helper 函数里**禁止出现 `.bind`、`.apply`、`.call`** 字符串；键名改用 `storeBind/assignOk` 等不敏感命名。
  4. 调拨创建链：选货抽屉勾选后点「📤 发送」按钮 → 发送确认弹窗无遮罩拦截（需在 `openTransferSend` 里先 `exitCoopScan()` + `transferMode=false` 再 `transferSendOpen=true`）。
  5. 调拨验收链（**Python API 验证**）：`POST /api/auth/switch-store {store_id: 6}` 切店 → `GET /api/transfers?scope=in` 能看到 to_store_id=当前店 的在途单 → `GET /api/transfers/{tid}` 拉到 items → `POST /api/transfers/{tid}/receive {items:[{product_id,ok,reason}]}` 校验：当前工作门店必须是接收方（to_store_id）；status 必须是在途；items 必须与明细完全对齐；不符必填原因。
- **踩坑档案**：Vue global build（`vue.global.prod.js`）模板编译器白名单极严，`.bind/.apply/.call` 关键字任何位置（包括字符串）都触发 SyntaxError；改造前端先全局扫 `{{.*}}` 表达式找这些敏感词，再逐个改名。

## TC-20 外网沙箱商品管理/库存管理看不到数据（1.2.13）

- **问题现象**：本地 STANDALONE 一切正常，但外网沙箱「商品管理」「库存管理」两个页面完全空白；而销售、客户、定金、调拨等页面有数据。
- **根因**：`main.py` 的 `_open()` 分两条分支——STANDALONE/无 `TENANT_DB_DIR` 分支会先 `seed_demo()`（灌 products）再 `ensure_new_seeds()`；而外网生产分支只调 `db.connect()` + `ensure_new_seeds()`，**从不调 `seed_demo()`**。但 `ensure_new_seeds()` 里补齐了 deposits/sales/transfers 等所有表，**唯独没有补 products**。于是外网沙箱老库 products 永远为空 → 商品/库存列表 `WHERE products.store_id=?` 查不到任何行。
- **验证方法**：模拟外网沙箱——只建 SCHEMA + migrate_schema（不 seed_demo），再调 `ensure_new_seeds()`：修复前 products=0；修复后 products=12，且按门店（总店 id=1）过滤可见 9 件、库存汇总「在库 8 件 / 成本 86300」有值；二次调用幂等（仍 12）。
- **修复**：抽出共享函数 `_ensure_products_seed()`（products 空表时灌 12 件 + 回填 category_code + 材质迁移 + 三语 + EPC 规则化），`seed_demo()` 与 `ensure_new_seeds()` 都调用它；并加防御：历史商品 `store_id IS NULL` 归到第一家门店（否则按门店过滤永远查不到）。
- **附带修复**：门店切换入口消失（`_ensure_stores_seed()` 保证 stores≥2，前端 select 仅 `stores.length>1` 才渲染）+ 操作日志空（`_ensure_operate_logs_seed()` 补 21 条覆盖全业务链）。

## TC-21 冒烟满负载时 tasks/transfers 超时（**已修复** 1.2.25）

- **问题现象**：`scripts/smoke_test.py` 串行打满约 50 个 GET 后，排在字母序末尾的 `/api/tasks*`、`/api/transfers*` 稳定超时（15s/30s 均无响应，重试仍失败）；但**单独直连这些端点秒回（0.04s）**。
- **根因（已定位）**：不是 `_lock` 争用（`_lock`/`_bridges_lock` 都是内存字典快速持锁，纳秒级），而是 `GET /api/dashboard/gold` 同步端点内的 `urllib.request.urlopen(req, timeout=8)` 阻塞 anyio worker 最多 8 秒。冒烟脚本每个请求带 `Connection: close`（每次新建 TCP 连接），50+ GET 并发丢进 Uvicorn 默认 worker 池（上限 40），单个慢端点占住 worker 导致字母序靠后的端点排队超时。
- **修复**（1.2.25）：金价行情改为**后台守护线程定时预拉**（每 5 分钟拉全 14 币种新浪汇率+伦敦金），`dashboard_gold` 端点改为纯读内存缓存、零阻塞 anyio worker。缓存结构改为 `{ccy: {ts, data}}` 每币种独立条目，读写全程加锁避免竞态。
- **验证方法**：`python scripts/smoke_test.py` → **所有 GET 端点秒回，tasks/transfers 不再归入 KNOWN**，报告应为 `FAIL=0`。单点直连 gold 响应 <40ms。

## TC-22 收定金面板输入框显示 `{{ t(...) }}` 原始代码（1.2.15）

- **问题现象**：【收定金】面板底部「交付时间」「交付要求」两个输入框内显示 `{{ t('dep.deliveryTimePh') }}` 等模板代码，而不是中文提示语。
- **根因**：Vue 不解析 HTML **属性值**里的 mustache 插值，`placeholder="{{ t('...') }}"` 会原样输出；属性插值必须用绑定语法 `:placeholder="t('...')"`。
- **验证方法**：浏览器打开收定金面板，读取两个输入框的 `placeholder` 属性应为中文文案；`document.body.innerText` 不含 `{{`。全局排查：`grep -n 'placeholder="{{' frontend/index.html` 应为 0 处。

## TC-23 收定金提交漏传交付时间/交付要求导致不入库（1.2.15）

- **问题现象**：收定金面板填写「交付时间」「交付要求」保存后，卡片与详情不显示，字段丢失。
- **根因**：`app.js saveDeposit()` 组装 POST /api/deposits 请求体时只带了 customer/phone/product/金额/日期/提醒天数，**漏传 `delivery_time`、`deliver_requirements`**（后端 DepositIn 与 deposits 表均有这两列）；且 `openDeposit()` 的 sheetData 初始对象也缺这两个键。
- **验证方法**：沙箱写入链路——POST /api/deposits 带两字段 → GET 列表回显 `delivery_time`/`deliver_requirements` 原值 → 冲红清理。sqlite 直连 `PRAGMA table_info(deposits)` 确认列存在。

## TC-24 PC 端看板快捷入口进入列表页空白 + 系统管理日志子页崩溃（1.2.15）

- **问题现象**：PC 宽屏从经营看板点【客户管理】（快捷入口/KPI 卡）后内容区空白；系统管理切「操作日志」子页抛 `ReferenceError: loadLogs is not defined`。移动端正常。
- **根因**：① PC 内容区 section 以 `tab==='customers'`（loans/repairs/purchases/outsourcings 同理）为渲染条件，而看板入口走 `openSubView()` 只设 `subView` 不设 `tab`，tab 停留 dashboard；移动端靠 `sub-page` 覆盖层（只看 subView）所以不受影响。② `go('system')` 的 logs 分支调用从未定义的 `loadLogs()`。
- **验证方法**：浏览器控制台执行 `ST.isPc=true; openSubView('customers')` 后 `ST.tab` 应为 `'customers'` 且 `.card-list .cust-item` 数量 > 0；`openSubView('logs')` 应落到 `tab==='system' && adminSub==='logs'` 并渲染日志内容（1.2.15 起为 `.log-plain` 纯文本段落，见 TC-26）；移动端（isPc=false）`openSubView('customers')` 后 `ST.tab` 不应改变。

## TC-25 客户详情空白：模块级 var 不是响应式（1.2.15）

- **问题现象**：客户列表点开某个客户，整页空白（详情和列表都不显示）。
- **根因**：详情数据存在模块级普通 `var ST_CUST_DETAIL`，不在 `Vue.reactive` 的 ST 内——模板编译为 `_ctx.ST_CUST_DETAIL` 取不到（恒 undefined），详情 section 的 `&& ST_CUST_DETAIL` 永不成立；同时列表 section 因 `subView==='customer_detail'` 被隐藏 → 双空。移动端 sub-page 内更是没有详情渲染块。
- **教训**：凡被模板引用的状态必须放进 `ST`（Vue.reactive），模块级 var 模板读不到。
- **验证方法**：真实点击客户卡片（不要只 evaluate 调函数）：PC 端 `.cust-profile` 数量=1 且显示客户名；移动端 `.sub-page .cust-profile`=1；点返回按钮回列表（`.cust-item`>0）。

## TC-26 操作日志改纯文本段落（1.2.15）

- **需求**：日志不用卡片，一个文本多选段落（可拖选复制）。
- **实现**：`logText(list)` 把每条日志拼成一行（时间 · 操作人 · 动作 · 门店 · 对象 · 结果），整体渲染进 `.log-plain`（`white-space:pre-line; user-select:text`）。
- **验证方法**：PC 系统管理-操作日志与移动端日志子页均无 `.rec-card`，`.log-plain` 存在且行数=日志数，computed `userSelect==='text'`。

## TC-27 详情弹层字段表恒空：detailRows 误注册进 methods（1.2.15）

- **问题现象**：维修管理等卡片点开详情只显示进度时间线，没有维修内容字段表（`.detail-row` 数量=0）。
- **根因**：`detailRows` 是普通函数却注册在 `methods` 里，模板 `v-for="r in detailRows"`（无括号）取到的是函数本身而非返回值，v-for 遍历函数渲染 0 行。
- **教训**：模板以属性方式使用的取值函数必须注册进 `computed`，不能放 `methods`（methods 必须 `()` 调用）。
- **验证方法**：真实点击维修卡片，`.repair-steps .step`>0 且 `.detail-row`>=5，字段表含「维修物品/问题描述/技师/状态」等。

## TC-28 调拨审计日志必须带商品明细（1.2.15）

- **需求**：`调拨发出/调拨验收` 日志不能只记单号+件数，必须带商品名清单。
- **实现**：`_log` target 改为 `单号（N件：名1、名2…）`，超 10 件截断加 `…`；验收分列相符/不符明细。
- **验证方法**：走一次发出+验收 API，`operate_logs.target` 含商品名；前端 `.log-plain` 行内可见明细。

## TC-29 「＋ 新增门店」按钮点击无反应（1.2.17）

- **问题现象**：总部管理页点「＋ 新增门店」按钮，页面无任何变化（表单不弹出、无反馈），用户以为功能失效；实际表单一直显示着，直接填写点确认能保存。
- **根因**：`storeEditMode` 初始值为 `'new'`，模板 `v-if="storeEditMode==='new' || storeEdit.id"` 恒真 → 表单默认展开；`createStore()` 只是把状态重置为同样的 `'new'`，无视觉变化。
- **修复**：`storeEditMode` 初始值与 `resetStoreEdit()` 改为 `''`（收起），点按钮才展开表单。
- **验证方法**：进入总部管理 → 初始无门店表单 → 点「＋ 新增门店」表单展开 → 填写保存后表单收起且列表新增；「取消」按钮可收起表单。

## TC-30 库存分析页改造：金额指标/6 卡公式/分类占比/导出打印/进销存/PC 两栏（1.2.17）

- **需求**：①4 金额指标（库存成本/售价/预计利润/利润率，口径=在库+已定）+点【已定锁定】看明细与锁定原因 ②5 卡改 6 小卡（+维修在途）+公式「在店库存总数=在库+已定锁定」③分类库存占比环形图 TOP5+明细表 ④表头列勾选导出 CSV+打印 ⑤进销存查询子 tab（区间进货/销售/期末库存）⑥PC 两栏布局（左统计+表格，右占比；禁止只拉宽）。
- **实现**：`/api/inventory/summary` 扩展 price/repairing/metrics/categories；新增 `/api/inventory/locked-items`（products 已定 JOIN deposits 已定）与 `/api/inventory/psi`（purchases 按 order_date、sale_items×sales 按 biz_date 排除已冲红、期末=当前在库+已定，按品类分组+合计）。无 can_view_cost 权限时 cost/profit/inAmount/endCost 返回 null，前端 `***`。前端 `.inv-layout` grid 两栏（<1200px 回落单列，移动端占比区在表格后）；导出为前端 CSV（\uFEFF BOM）；打印 window.open 内联表格+window.print()。
- **验证方法**：E2E（Python）18 项：metrics.onHand=inStock+reserved、profit=price-cost、categories 合计=onHand、locked-items 数=reserved 数、psi 未来区间进销=0 而期末>0。浏览器走查：PC 视口 `.inv-layout` 内同时存在 `.inv-main` 与 `.inv-side`（含 donut+明细表）、6 小卡+公式行+4 指标条、点已定锁定弹抽屉含「锁定原因」列、选择列面板 11 复选框、导出 blob>0、打印新窗口生成、进销存 tab 默认本月且查询出行、isPc=false 单列且占比在表格后、EN/IT 切换新区域文案无界面级中文残留（商品名数据本身中文除外）、console 无 error。

## TC-31 商品管理列表「消失」：库存页状态筛选跨页隐形残留（1.2.18）

- **问题现象**：商品管理页商品列表整段空白（表格 0 行），但后端 `/api/products` 与 `ST.products` 均有数据；用户报「列表消失了」。
- **根因**：`prodStatusFilter` 是「库存分析」页可点状态卡（`goInvStatus`）的专属筛选，其清除横幅 `v-if` 限定 `tab==='inventory'`；但商品管理页表格数据源 `filteredProducts()` 也消费了 `prodStatusFilter`。用户从库存页点过某状态卡（如「已售」）再进商品管理，该筛选在商品页隐形生效且无任何清除入口 → 列表被筛空，看似消失。库存页改造后状态卡更多，更易误触发。
- **修复**：`filteredProducts()` 移除对 `prodStatusFilter` 的过滤（加注释说明该筛选为库存页专属）。商品页状态筛选本无 UI 入口，属死逻辑；`prodStatusFilter` 仅保留给库存页横幅清除与后续 invStockList 响应使用。
- **验证方法**：浏览器复现路径 `goInvStatus('已售') → go('products')`，修复前 `.table-products tbody tr` = 0、修复后 = 9；商品页搜索/品类/库位筛选仍正常（手镯→1、戒指→1、清空→9）。

## TC-32 总部管理下设门店列表：详情统计卡（删入库/扫描设备按钮）

- **需求**：总部管理（tab=shops）下设门店列表卡片加入门店详情；不放【入库】【扫描设备】按钮（go('stores') 在总店视角被重定向回首页，属死链；入库/设备在门店管理页已有）；数据信息卡片尽量多放详情。
- **实现**：`/api/stores` 新增 `detail=1`（`_store_card_stats`：在库/已定/库位数/销售笔数金额/今日/本月/库存成本售价，全部查询在 with _db 块内；无 can_view_cost 权限金额置 None→前端 `***`）。前端仅 `go('shops')` 时 `loadStores(true, true)`，其它页不带 detail；卡片 6 格统计 + 打印代理在线状态 + 负责人/打印机 + 成本/售价/销售合计行。
- **验证方法**：E2E 33 项（4 店 × onHand/reserved/locations/saleCount/saleAmount/saleMonth/stockCost 与 SQLite 直连逐项一致）；浏览器：4 卡渲染、卡内按钮数=0、三语无界面级中文残留（负责人数据值中文除外）。

## TC-33 销售分析页改造：分析/流水子 tab + KPI + 分类占比 + 热销榜 + 销售人员饼图

- **需求**：按截图把「销售分析」页从纯流水列表改造为分析看板：日期选择（今天/昨天/近7天/本月/近3月/自定义）、4 KPI（客单价/连带率/平均单价/售罄率）、分类实销总额占比环形 TOP5+明细表（分类/实销数量/实销成本/实销总额）、商品热销榜（按销量件数 TOP10，含条码/规格/售价/热卖N件）、销售人员销售占比饼图；原流水列表（冲红/小票）保留为「销售流水」子 tab。
- **实现**：后端新增 `GET /api/sales/analysis?start=&end=`（静态路由注册在 `/api/sales/{sid}` 之前；缺省本月；start>end 自动交换；KPI/分类/热销/clerk 四段，成本无权限置 None；clerk_name 空回落 clerk_type 再回落「未指定」）。前端 `saleSub`（analysis/list）+ `saleAna` 状态；`saleAnaDonut/saleClerkDonut` 复用 donut 先例；`refreshAll()` 置 `saleAna.data=null` 缓存失效（开单/冲红后重拉）；`.sale-ana-grid` PC 两栏 <1200px 单列。
- **验证方法**：E2E 20 项（revenue/bills/items/avgPerBill/attachment 与直连一致、分类件数合计=items、pct 合计≈100、热销降序且 TOP1 一致、clerks 金额合计=revenue、未来区间全 0、倒序自动交换、无 token 401）；浏览器：近3月 KPI/双环形图/热销榜 4 条渲染、流水 tab 14 单含小票+冲红、今日空态「暂无销售记录」、自定义一年 revenue=181740/14 单、EN/IT 无界面级中文残留、移动单列、console 无 error。





## TC-34 商品多标签与按标签分组统计（1.2.18）

- **需求**：一件商品可贴多个标签（项链/金饰/古风/现代等受控字典，用于各类业务统计）；统计时可多选标签、按标签分组（每标签各一组，多标签商品在每组重复计入，占比分母=各组合计）；双口径=库存（在库数量/成本/标价）+销售（金额/件数，排除已冲红，缺省近6个月）。标签字典租户库内私有、租户内各门店共用；与 RFID 打印标签（label_templates）严格区分命名 tag。
- **实现**：db.py SCHEMA 新增 product_tags（name UNIQUE）/product_tag_links（UNIQUE(product_id,tag_id)+tag_id 索引），幂等建表无 ALTER；演示标签仅进 seed_demo。后端 /api/product-tags CRUD（纳高管只读闸门；删除级联解除关联并回显 unlinked）；ProductIn.tag_ids 覆盖式写入（_set_product_tags）；商品删除/批量删除级联清 links、批量复制继承标签；列表/详情 _attach_tags 一次 IN 查询附带 tags；/api/dashboard/tag-stats 库存与销售两条 GROUP BY 查询 Python 合并（禁止同条 JOIN 交叉翻倍），stock_cost 受 can_view_cost。前端：表单标签多选 chips、列表行内 ptag+标签筛选 chips（命中任一）、总部管理「商品标签」维护区块、dashboard 标签统计卡（多选标签+横向条形+口径 note）。
- **验证方法**：E2E（Python）：建标签→重名 400→商品贴多标→列表 tags 附带→tag-stats 与 SQLite 直连逐项一致（含重复计入、区间、tag_ids 过滤、无权限 stock_cost=None）→删标签 unlinked 正确且 links 清空→删商品级联→测试数据全清。浏览器走查：表单贴标保存回显、筛选 chips、总部管理增删改、统计卡渲染、EN 无界面级中文残留、console 无 error。迁移回归：旧库副本跑 upgrade.py 至 1.2.18，两表建成、老商品 tags=[]、既有读写正常。

## TC-35 推广页多语言可写（1.2.19）

- **问题现象**：企业网站 /site 固定中文渲染，租户无法按语言录入推广内容；橱窗商品已有 name_i18n/showcase_desc_i18n 列但 /site 未使用。
- **根因**：tenant_profiles 无多语言列；public_site 模板硬编码中文文案，无语言协商。
- **实现**：tenant_profiles.i18n JSON 列（{语言码:{字段:文本}}，缺字段回退中文主列）；/site 语言协商 ?lang > Accept-Language > zh（6 语言白名单）；插件固定文案内置 SITE_UI 文案包；橱窗商品名/描述接上 name_i18n/showcase_desc_i18n；总部管理企业资料卡新增「推广页多语言内容」区块（语言 chips + 独立编辑缓冲 profEdit，保存时序列化进 profile.i18n）。
- **验证方法**：
  1. 迁移：旧库跑两次 upgrade.py 幂等（tenant_profiles 有 i18n 列、languages 含 ja/ko/zhHant 六行）；
  2. API：PUT /api/profile 带合法 i18n JSON 后 GET /site?lang=en 显示英文内容、缺 ja 字段回退中文、Accept-Language: it 命中意语文案、非法 i18n（数组/非对象）被 400；
  3. 浏览器：总部管理按语言录入→保存→/site 顶部语言切换链接渲染对应语言（导航/预约表单/承诺文案跟随）→控制台无报错；
  4. 测试数据（录入的各语言内容）验证后恢复原值。
