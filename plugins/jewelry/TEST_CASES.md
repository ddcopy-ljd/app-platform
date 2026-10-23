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

## TC-36 扫描助手 App 应用内自升级（1.2.20）

- **需求**：手持机 App 具备自升级能力（可选提示 + 支持强制），并顺带做「设备版本上报 + 门店可见」；判定机制为「提取手持机已安装 APK 的 md5，与服务端包 md5 不一致即升级」。
- **实现**：插件新增免鉴权 `GET /api/scan-app/info`（读 APK 旁 `.md5` sidecar → `{md5,size,force}`，sidecar 缺失回退现算；`force` 由 `<apk>.force` 控制）与既有 `GET /api/scan-app/download`；`devices` 表新增 `apk_md5`（WS `hello` 帧新增 `apk_md5` 字段上报已安装 base.apk 的 md5），`/api/devices` 每台设备返回 `need_upgrade`（上报 md5 非空且 ≠ 服务端包 md5）。App 侧：`UpdateChecker`（info → size 短路 → md5 比对 → 下载到私有目录 → 复核 md5 → `getPackageArchiveInfo` 校验包名/`versionCode≥当前`/签名一致 → Android 8+ 未授权先跳「安装未知应用」设置 → 拉起系统安装器，**不做无障碍自动点击/静默安装**），Manifest 加 `REQUEST_INSTALL_PACKAGES` + FileProvider(`res/xml/file_paths.xml`)；设置页新增「检查更新」条目 + 启动静默检查；`AppConfig.APP_VERSION` 改读 `BuildConfig.VERSION_NAME`（消除 1.1.0/1.0.1 双源）；`scripts/build_scan_app.bat` 产 `scan-assistant-release.apk` + `.md5` sidecar 到 `downloads/`。
- **验证方法**：
  1. 迁移：含旧 `devices`（无 `apk_md5`）的库跑 `upgrade.py`/`migrate_schema` 幂等，列补全且已有设备行不丢；
  2. API：`/api/scan-app/info` 的 `md5` == APK 实际 md5（32 位小写）、`size` == 文件字节数、`force` 默认 false（放入 `.force` 且内容非 0/false 时为 true）；`/api/devices` 中对已上报 md5 且与服务端不同的设备 `need_upgrade=true`、未上报(md5 空)为 false；
  3. App：改动打包后重装/覆盖安装，启动或设置页「检查更新」能提示；下载后 md5 复核失败必须拒绝安装；系统安装器确认后覆盖安装成功，重启后上报的 `apk_md5` 与服务端一致、卡片「待升级」消失；
  4. 部署红线：首次上线必然「全量重下载」（旧装机包 md5 与新包不同，属预期，不视为 BUG）；
  5. 浏览器：门店管理设备卡片显示「版本 vX」与「待升级」徽标，六语言无界面级中文残留，控制台无报错；
  6. 平台网关：无 Cookie 客户端经 `/app|/gw` 访问 `api/scan-app/info`、`api/scan-app/download` 不被拦（已在 `_MACHINE_PATHS` 白名单）。


## TC-37 借货提醒条与库存「借出」KPI 数据口径不一致（1.2.24）

- **问题现象**：库存分析页提醒条显示「足金手镯·同行老刘 外借逾期催还(2026-02-20)」，但「借出」KPI 卡片为 0——两处数据对不上。
- **根因**：提醒条查 loans 单据表（status 借出中/借入中 且逾期），KPI 查 products.status='借出'，两表靠 loan_create/loan_return 联动保持一致；而 seed（db.py 两处 loans 种子只插单不联动商品，且借出商品 J001 同时被定金 seed 锁为「已定」）与 _seed_demo_data.py（direction 写中文「借出/借入」——loan_create/loan_return 只认 'out'/'in'，还造出系统不存在的「已逾期」状态，且不联动 products）绕过 API 直写，造成单货脱节。
- **修复**：db.py 两处 loans seed 改为借出 J011（无 seed 销售/定金冲突）+ UPDATE products SET status='借出' 联动 + store_id 与商品门店一致(2)；_seed_demo_data.py 借货段 direction 改英文、状态改系统真实值、商品名以库内 code 实际为准、活动借出同步置 products 借出；清理 dev 库 6 条脏 loans（id=1,3,4,5,6,7）。
- **验证方法**：
  1. 全新建库：reminders 的 loansOverdue 出现「珍珠项链·同行老刘」（切到分店A可见）且该店 KPI 借出=1，总店 KPI 借出=0，两处一致；
  2. 存量 dev 库：提醒条只剩「钻石戒指·供应商A 借入逾期归还」（借入不影响商品 KPI），KPI 借出=0，一致；
  3. _seed_demo_data.py 重跑后 loans 无中文 direction、无「已逾期」状态，活动借出单对应商品 status 均为「借出」。

## TC-38 趋势折线：X 轴隔天抽稀 + 拖动平移窗口 + 缓存版本升级（1.2.24）

- **需求**：①日粒度 X 轴日期隔天显示一个；②折线图撑满面板；③看板标签统计点击 chip 下方数据不跟随；④实销总额趋势可左右拖动、统计范围随动。
- **根因/实现**：③为 index.html 静态资源版本号滞留 =20261013e161，浏览器缓存旧 app.js 无 	oggleTagSel——升版 =20261015a101（app.css/i18n.js/app.js 四处同步）；①	rendTicks 日粒度 step 恒 2（原 15d 内 step=1 每天显示）；②svg preserveAspectRatio=none+width:100% 本已拉伸，随缓存升版生效；④/api/dashboard/trend 新增 offset（窗口整体向过去平移 offset*n 天/月，ge=0/le=120），前端 ST.trendOffset + .trend-pan 鼠标/触摸拖动（90px=1 窗口，右拖看更早，松手换算），offset>0 显示「重置」按钮回当前窗口。
- **验证方法**：
  1. 30d：offset=0 末标签=今天，offset=1 窗口整体前移 30 天；6m：offset=1 前移 6 个月；
  2. 浏览器：15d/30d X 轴均为隔天一个日期；图上左右拖动松手后窗口平移、标签跟随，「重置」回到今天；切 range 下拉 offset 归零；
  3. 标签统计：点击 chip 后下方列表只显示选中标签（强刷后无缓存干扰）。

## TC-39 商品标签与固定字段（品类/材质/类型）重复（1.2.24）

- **问题现象**：标签字典 seed 含「项链/手链/戒指/金饰/银饰/翡翠/钻石」，与 product_type（项链/手链/戒指）和 category（金/银/翡翠/钻石材质）同维度两处维护——同一商品可在两处打不同值，统计口径必然分裂。
- **根因**：标签定位是「固定字段之外的扩展维度」（风格/场景/客群/营销），seed 却塞入了品类/材质/类型词；违反「固定字段管口径、标签管运营」分层原则。
- **修复**：db.py seed 10 个标签 → 8 个纯扩展维度标签（古风/现代/轻奢/简约/收藏级/婚庆/送礼/本命年）；dev 库删除 7 个重复标签并对齐新 seed（关联表 0 条引用，无副作用）；group_name 分组的启用留待后续。
- **验证方法**：
  1. 全新建库：`SELECT name FROM product_tags` 只有 8 个扩展维度标签，无任何与 category/product_type 重名的词；
  2. 存量 dev 库：标签字典为 古风/现代/轻奢/简约/收藏级/婚庆/送礼/本命年（sort_order 1-8），product_tag_links 无孤儿引用（JOIN product_tags 无空 name）；
  3. 商品编辑页给商品打标签、看板标签统计 chips 只显示字典内标签，点选后下方列表正确过滤。

## TC-40 商品标签分组（固定枚举 + 5 处分块展示）（1.2.24）

- **需求**：标签按固定分组归类展示与维护，便于统计管理汇总：①组为固定枚举（风格/工艺/场景/客群/营销），只允许在组内新增标签，禁止自由造组（否则同义组名碎片化、统计失效）；②单组归属（一个标签只属一组，避免统计重复计数），跨组可多选；③5 处标签选择处（经营看板标签统计 / 商品列表标签筛选 / 库存分析标签库存占比 / 销售分析标签销售占比 / 商品编辑表单商品标签）+ 标签管理表单统一按组分块渲染。
- **实现**：后端 `main.py` 新增常量 `TAG_GROUPS=["风格","工艺","场景","客群","营销"]` 作单一数据源（前端禁止硬编码），`GET /api/product-tags` 响应增 `groups`；`product_tag_create`/`product_tag_update` 校验 `group_name` 必须在枚举内（空串=未分组合法，非法值 400「分组「X」不在预定义分组内」）；`/api/dashboard/tag-stats` items 增 `group_name`。`db.py` 标签种子 20 个按 5 组分配（风格5/工艺4/场景3/客群4/营销4），常量化 `_SEED_PRODUCT_TAGS` 供 seed_demo 与 ensure_new_seeds 共用；**ensure_new_seeds 仅「全新演示库」灌入**（判定=products 本次新灌，即外网沙箱基线），真实租户表空不灌（防删光后升级复活）。前端 `app.js` 新增共用 `tagGrouped()`（按后端 `groups` 组序归并，后端未覆盖的组/空组追加末尾，组内保持原序）+ `tagGroupName()`（空组→i18n `tag.ungrouped`），5 处选择处统一改为 `.tag-pick-wrap` + `.tag-group` 分块渲染；标签管理表单「分组」字段由自由输入 `input+datalist` 改为固定枚举 `select`（未分组 + 5 组）；6 语言字典加 `tag.ungrouped`；静态资源版本号升 `?v=20261016a103`（app.css/i18n.js/app.js 同步）。
- **验证方法**：
  1. API（临时脚本，仓库外）：`GET /api/product-tags` 返回 `groups`=5 组；非法分组「乱造组」新建返回 400；合法分组新建成功且 `group_name` 落库、删除回显 `unlinked`；`/api/dashboard/tag-stats` 每 item 含 `group_name`；
  2. 新建库：`product_tags` 共 20 条，`group_name` 分布 风格5/工艺4/场景3/客群4/营销4；
  3. 浏览器走查（dev 库）：看板标签统计、商品列表标签筛选、库存分析「标签库存占比」、销售分析「标签销售占比」、商品编辑表单「商品标签」五处 `.tag-group-name` 均渲染 5 组（风格/工艺/场景/客群/营销）；标签管理表单下拉选项 = 未分组+5 组且表格「分组」列有值；console 无新增报错；
  4. 测试数据（临时在库商品 + 已售商品标签关联）验证后全部清理，`product_tag_links` 归零；存量租户库旧标签 `group_name` 为空→归入「未分组」，属预期；
  5. 沙箱链路（ensure_new_seeds，临时库模拟三场景）：全新空库→标签 20+去年销售 3 单+各业务表均有数据；真实租户（products 非空）删光标签重跑→标签不复活（仍 0）；幂等重跑→各表行数不变；
  6. UI 操作链路（dev 库）：商品编辑弹层勾选跨组标签（古风+婚庆）→「确认提交」→API 回读 tags 两项→再取消保存→tags 空；商品列表筛选/看板统计/库存分析/销售分析四处点 chip 后 items 均只含选中标签；标签管理新建（选组落库）→删除→列表还原；走查后 `product_tag_links`=0、无残留测试标签；
  7. 统计口径核对（API vs SQL 直连 49 项）：库存汇总（在库/已定/借出/已售 count+price+cost、onHand、profit、profitRate、分类合计）、看板区间销售额与 YoY（去年同月有数）、销售分析本月+去年同月（revenue/bills/items/avgPerBill/分类合计/人员合计）、标签统计双口径（stock_count/stock_price/sale_amount/sale_count/group_name）、趋势 6m 标签数与去年同期非全 0。

## TC-41 沙箱票证回归登录 401：沙箱库密码是基线库的（1.2.31）

- **问题现象**：v1.2.31 沙箱服务票证回归时，`POST /api/auth/login`（admin/123456）返回 401。
- **根因**：沙箱库 = 正式版基线库（v1.0.5 trial 库）全量复制 + 链式迁移，**users 表是基线库的真实账号**（密码不等于种子脚本的 admin/123456）；迁移只补结构/空表种子，不会重置已有 users。本地 dev 库的 123456 只是 dev 种子密码。
- **可执行验证方法**：票证回归前若需账号登录，两选一：①向基线库使用者要 trial 库密码；②按「用开发库替换沙箱数据 SOP」停服→备份→dev 库覆盖→启动（dev 库密码已知），回归后按需恢复备份。本轮回归采用②，v1.2.31 沙箱 20 项全过（health 版本/登录/标签 groups+group_name/非法组 400/合法组落库+删除/tag-stats 带组/YoY=862.6/trend 12m/销售分析双月/库存分布与 SQL 一致）。
- **注意**：断言基线要跟当前库走——库存类断言先 SQL 直连查实际分布，禁止照抄上一个环境的数据（本轮误把替换前沙箱库的 在库11/借出1 写成断言，替换后 dev 库 store1 实为 在库5/已定4）。

## TC-42 看板「标签统计」改「销售额统计」：品类 top10 + 维度切换 + 独立时间段（1.2.32 待发布）

- **问题现象**：外网沙箱看板「标签统计」横向柱状图全 0——沙箱商品未打标签（product_tag_links=0），标签口径无数据；且卡片区间跟随看板全局，无独立时间段。
- **需求**：卡片改名「销售额统计」，默认显示品类 top10 汇总（品类有真实销售数据），维度 品类/标签 可切换（标签统计能力保留），卡片自带时间段下拉（今天/本周/本月/近3月/近6月/今年，默认近6月，与看板全局区间解耦）。
- **实现**：`/api/dashboard/tag-stats` 加 `dim` 参数（缺省 tag 保持分析页共用不破坏）：`dim=category` 时按 `COALESCE(NULLIF(p.product_type,''),'未分类')` 聚合销售（排除已冲红、store_id 当前店或 0）按金额 DESC LIMIT 10，返回 name/sale_amount/sale_count/sale_pct。前端 `saleStatsDim/saleStatsRange` 状态 + `loadSaleStats()`（`dateRangeCompute` 扩展 week/6m/year 模式）；品类行显示「￥金额 · N 件 · pct%」，标签行保留原双口径；i18n 6 文件新增 `tag.salesStatsTitle/tag.dimCategory/tag.dimTag/rg.3m/rg.6m/rg.year`。
- **验证方法**：
  1. API vs SQL 直连（dev 库 28 项）：6 个时间段逐项金额/件数/占比一致、条数≤10、按金额降序；dim=tag 兼容（缺省 dim=tag、含库存口径字段）；category 缺省区间=近6月有数据；
  2. 浏览器走查：默认品类+近6月，top1 手链 ￥32,600，存在 width>2% 的条形；切「标签」出现 5 组 chip 且标签行含「在库」；下拉切「本月」行数 6→2 再切回恢复；EN 标题 Sales Stats / Category / Tag，切回中文恢复；
  3. 外网沙箱验证（升级后）：品类维度柱状图非全 0（沙箱品类有真实销售）。

## TC-45 趋势图拖动按整窗跳变，改为按天/月连续平滑平移（1.2.35）

- **问题现象**：拖动「实销总额趋势」松手后按 90px/窗口离散跳变，一次跳一个完整查询时段（30 天或 6 个月），无法按落点精确查看历史区间。
- **根因**：后端 `offset` 语义=窗口数（日粒度偏移 offset*n 天）；前端松手时 `Math.round(dx/90)` 换算窗口数，拖动中不取数。
- **修复**：①后端 `offset` 改为连续时间单位（日粒度=天、月粒度=月，上限 730），窗口长度 n 不变；②前端拖放位移按 `容器宽/点数` 换算 px→天/月，拖动中 120ms 防抖实时取数，取数后把残余位移（不足 1 单位）重新锚到指针（`_trendDragX0=lastX-residual`），松手无可见跳变；请求序号 `_trendReqSeq` 防乱序响应覆盖；pointer capture 防拖出元素中断；历史边界（日 730/月 36）加 0.3 阻尼。
- **验证方法**：API（11 项）：offset=0/1/2 窗口恒 30 点、右端逐天平移、相邻窗 amounts[1..29] 滑动对齐；月粒度 offset=1 右端=上月且滑动对齐；730 合法/731 报 422。浏览器 PointerEvent 模拟拖动：30d 拖 80px（499px 宽）→shift=5、右端 10/16→10/11；微拖 5px→shift 不变；6m 拖 100px→shift=1/labels 2026-04~09；再拖 85px→shift=2（连续累加非整窗跳）；无当前版本 console 报错。
- **踩坑**：浏览器走查时子代理用「再注入一份 app.js script」硬刷版本，会把模块状态（trendData 点数）搞乱导致拖动换算按旧点数误判；硬刷一律用页面重新导航，禁止注入脚本。

## TC-46 看板新增「前五排行」7 榜：周转/利润/销量/会员/店员/滞销/品类（1.2.36 待发布）

- **需求**：经营看板新增 7 个 TOP5 榜——①周转最快（到货建档→首销天数最短）②利润率最高 ③销量最多 ④会员消费最多 ⑤店员销售最多 ⑥滞销品（当前在库库龄最长）⑦品类销售额最高（product_type）。卡片自带时间段下拉（同销售额统计卡，默认近6月）；周转/滞销为库存实时状态榜不受时段影响。
- **实现**：后端 `GET /api/dashboard/rankings?start=&end=`（缺省近6月，`date('now','start of month','-5 months')`）；销售榜统一 `status!='已冲红' AND (store_id=? OR store_id=0)`；周转 `MIN(julianday(biz_date)-julianday(substr(created,1,10)))` HAVING d>=0；利润 `(amount-cost*qty)/amount` 排序，无成本权限 rate/profit/cost 返回 None 但排序按真实口径；会员 JOIN customers 且 customer_id>0；店员按非空 clerk_name 分组、单数=COUNT(DISTINCT bill_no)。前端 `.rank-grid`（auto-fill minmax 230px）7 块、前三名金/银/铜徽标，i18n 6 语言 rank.* 键，静态版本 a108。
- **种子补强**（全新演示库才生效，老库守卫不重灌）：①12 件商品 created 错开为各自首销日前 6~26 天（`arrival` 映射 UPDATE），修复前全部默认「今天」导致周转榜全被 HAVING 过滤为空、滞销库龄全 0；②14 单销售补 clerk_name（林雅/陈强），修复前店员榜永远空；③修正两条销售 product_id（蓝宝石戒指 9→10、和田玉平安扣 10→11，后期插入 J0095 后编号错位），修复后 JOIN 名称与金额口径才正确。dev 库手动执行了同等对齐（UPDATE sales/products）。
- **验证方法**：临时脚本对 7 榜逐项 API vs SQLite 直连 SQL 对账（名称/排序/金额/天数/单数全一致，8 项 PASS）；全新临时库跑 seed_demo+ensure_new_seeds：12 商品 14 单、负周转商品 0、周转 top5 非空、无 product_id 名实不符；浏览器走查：a108 版本下 .rank-box=7、7 个标题与首行数据正确、滞销标题带「（当前在库库龄）」、下拉切 year 后销量/店员数值变化（古法手串 1→2 件、林雅 ￥66,480→￥99,080）、切回 6m 正常、无 a108 资源 console 报错。
- **踩坑**：①商品 status 由定金/借出链路在服务启动时对账刷新，滞销榜核对必须以查询当时的实时 status 为准，不能用历史快照；②sqlite3.Row 取不存在的列别名抛 IndexError（不是 KeyError），对账脚本 SELECT 别名要与取值键一致。

## TC-44 外网沙箱「销售额统计-标签维度」全 0：打标种子固化（1.2.34）

- **问题现象**：外网沙箱商品从未打标（product_tag_links=0），看板「销售额统计」切标签维度横向柱状图全 0；本地 dev 正常只因手动打过标。
- **根因**：`_SEED_PRODUCT_TAGS` 只灌标签字典，不含打标关系；沙箱/演示库 links 永远为空。
- **修复**：新增 `_SEED_PRODUCT_TAG_LINKS`（12 个演示商品按品类/名称→标签映射，覆盖五组）与 `_ensure_product_tag_links()`，`seed_demo` 与 `ensure_new_seeds` 均调用；三重守卫：①links 非空不灌（租户已自行打标）；②product_tags 数≠种子数不灌（租户增删过字典，与 TC-40「不复活」一致）；③只按演示商品名匹配，真实租户商品自然 0 匹配。外网已有沙箱库（links=0）升级后也会自动补齐。
- **验证方法**：临时脚本四场景：①SCHEMA+migrate+ensure_new_seeds 全新演示库 links=42/tags=20 且有销售数据的标签>0；②重跑幂等仍 42；③真实租户（自建商品名+自建标签）links=0 标签不复活；④已有 42 条的 dev 库重跑不变。沙箱票证：`/api/dashboard/tag-stats?dim=tag` 返回项 sale_amount 非全 0 且与 SQL 直连一致。

## TC-43 趋势图纵轴仅 3 档 + 折线右半段空缺（1.2.32 待发布）

- **问题现象**：看板「实销总额趋势」①纵轴只有 0/半程/最大 3 档，读数粒度粗；②近30日折线只画到约一半宽度，右半段时间轴有刻度无折线。
- **根因**：①`trendYAxis()` 只返回 3 条刻度、SVG 仅 2 条固定横向网格线；②**主因**：`<svg :viewBox="...">` 动态绑定在 in-DOM 模板中被 HTML 解析器小写化为 `:viewbox`，Vue 按小写名 setAttribute 后 SVG 不识别该属性，viewBox 静默失效——SVG 按 1:1 坐标渲染（坐标系 300 宽 vs 容器 450~510px），折线与网格全部只占容器左 ~60%；③次因：`trendLinePoints()` 对 `null` 断点 `continue` 跳过，含 null 的序列（去年同期）折线提前中断。
- **修复**：viewBox 改**静态属性** `viewBox="0 0 300 120"`（HTML 解析器对 `<svg>` 内静态属性有 viewBox 大小写修正表可正确识别），`trendSvgW/H` 简化为常量 300/120；`trendYAxis()` 0→区间最大均分 4 档（5 刻度）；SVG 横向网格线 `v-for trendHLines()` 4 条对齐刻度；`trendLinePoints()` null 按 0 处理。
- **验证方法**：浏览器走查：`.trend-svg` getAttribute('viewBox')="0 0 300 120"；`.trend-line-cur` 与 `.trend-svg` 的 getBoundingClientRect().width 比值 ≥0.95（修复前 ≈0.66）；trendYAxis() 5 条递降刻度；近30日 30 点、切近6月后比值仍 ≥0.95；控制台无当前版本号资源的新报错。

## TC-47 标签打印弹层选「打印桥」点打印无反应：前端路由判定只看 printSupported（1.2.43）

- **问题现象**：PC 端「RFID 标签打印」弹层，打印方式选「打印桥·打印代理」，点击打印按钮无任何反应、不出纸、无报错 toast。
- **根因**：`submitLabelPrint` 的回退分支只以 `ST.printSupported` 判定本地能力——STANDALONE 模式下插件服务器本机装有打印机使该值为 true，于是选「打印桥」仍把 ZPL 直发服务器 DASCOM 打印机（队列有任务但实体机在门店，表现为"没反应"）；同时本地直打端口 18080 是旧 Python 桥遗留，新 C# PrintAgent 走 18180 HTTPS + `/api/print`，本地直打同样失效。叠加因素：代理密钥被上一轮测试清理吊销后 PrintAgent 离线，弹层代理状态显示异常加剧误判。
- **修复**：路由判定改为**代理在线优先**——`ST.agent && ST.agent.online` 时第一跳即 `route=agent` 经云端 WS 下发到门店代理，且跳过本地直打步骤；代理离线时才尝试本地直打，失败回退 `route=agent` 由后端明确报 400「打印代理不在线」。静态戳 `20261018a20`。
- **验证方法**：①USB 直连基本盘：`usb_raw_test.ps1` OpenPort/WriteToPort 均 rc=0，证明硬件链路正常，问题纯在软件路由层；②代理在线实打 1 张走 route=agent 到 ZMIN（浏览器走查，仅选 1 商品仅点 1 次）；③代理离线守卫：沙箱票证 `POST /api/print/labels {route:'agent'}` 返回 400「打印代理不在线：总部」，不静默吞任务；④后端 route=agent 且代理离线时严禁降级直发服务器打印机（防再次"假成功"）。

## TC-48 ZMIN X19D 走代理"软件全成功但零出纸"：raw_passthrough 发 ZPL 固件不识别（历史用例）

> **已过时（2026-10-21）**：ZPL 已从云端全链路删除；文中的 `printerType:"rfid"` 结构化通道也已停用（SDK 只输出栅格图、不渲染条码）。当前唯一通路：`/api/print/labels` → `rfid_cmd` → 助手翻译 PCLE → USB，见 AGENTS.md 硬性约束第4条与 agents/print/AGENTS.md。

- **问题现象**：TC-47 修复后 route=agent 任务正常送达助手（task_ack 成功、助手 /api/tasks 显示"指令透传成功"），但打印机始终不出纸；助手读 EPC/校准等 USB 功能全部正常，唯独打印无输出。
- **根因**：插件 `_bridge_enqueue` 的 C# 协议分支发 `printerType:"raw_passthrough"` + **ZPL 文本**（^XA/^FO/^FD）；ZMIN X19D 固件不识别 ZPL，LabelPrinter.dll `SetPrinterParams` 收到不报错 → 假成功。能真出纸的路径只有：①结构化 `printerType:"rfid"` 任务（SDK 原生 ZMLabel/LabelObject 排版，坐标单位 mm）；②统一指令 PCLE（ZMPCLx64 免驱）。决定性证据：旧目录助手收结构化四角测试任务两次均出纸（用户确认），同机 ZPL 透传零出纸。
- **修复**：`rfid_print.py` 新增 `build_zmin_content()`（模板 slots/回退固定布局 → 结构化 content，**300DPI 点阵÷11.811=mm**，勿按 203DPI 的 ÷8 换算；EPC 走 content.epc=chip_epc_hex、rfidBlock=0）；`main.py` `_bridge_enqueue` C# 分支改逐件发 `printerType:"rfid"` + `interface:"USB"`（printerName=主板SN），缺 items 直接抛错禁止回退 ZPL 透传；enqueue_zpl 回退分支按 product_ids 重建结构化数据；print-control 的 csharp test 页同改结构化。旧 Python 桥维持 ZPL type:job（得实机型正常）。
- **验证方法**：①8002 STANDALONE `POST /api/print/labels {product_ids:[1],route:'agent'}` → 助手 /api/tasks 出现 printerType=rfid 任务且"已完成：打印并写入成功"，实体出纸、条码/文字/EPC 正确（2026-10-18 实打 J001 通过，条码 HQ04000009、EPC 453238485104000001）；②回归守卫：任何 csharp 代理任务 payload 不得再出现 raw_passthrough+^XA；③旧桥不受影响（agent_type=legacy 仍走 ZPL）。

## TC-49 演示销售明细 product_id 为空导致【利润分析】成本 0 / 利润率虚高 100%（1.2.44）

- **问题现象**：演示租户【经营分析】→【利润分析】卡默认区间利润率显示 100%（成本 0），2026 全年虚高 69.1%；排行榜「利润」榜出现假高值。
- **根因**：演示入库的销售明细 `sale_items.product_id` 大面积为空（23 行中 11 行）——`_ensure_sale_details` / `_backfill_demo_sales` 按「商品名」精确匹配，而演示销售单用的是短名（如「翡翠吊坠」对不上商品全名「翡翠观音吊坠」）匹配失败；后端成本口径 `SUM(COALESCE(p.cost,0))` 把无关联行算 0。
- **修复**：种子/补齐/明细改写为取销售单自带 `product_id`；新增 `_ensure_sale_item_links()` 幂等回填老库空关联，**仅对演示单号（`_DEMO_BILL_NOS`）生效**，真实租户不受影响。
- **验证方法**：①探针 `GET /api/dashboard/biz-analysis`：默认区间 2026-10 cost=33600 / profit=7600 / rate=18.4%（修复前 rate=100%）、全区间 rate=17.6%；②sqlite 直连 `sale_items` 空 product_id 行数 11→0；③沙箱票证同口径复测一致（v1.2.44 trial：cost 33600、rate 18.4、空关联 0）。
- **连带说明**：补上 product_id 后，既有门店归属迁移 `_migrate_store_scope` 把原先 `store_id=0` 的演示单据按商品所属门店回填（store 1:19 / store 2:4），门店 1 视图收入相应减少 13260——属该迁移既定设计（历史单据按商品归属门店），非缺陷。

## TC-50 UHF 扫 EPC 全部落 unknown：芯片存编码 hex、库内存明文，且固件按字边界补零（1.2.44）

- **问题现象**：打印出的标签（结构化 rfid 任务、芯片写入成功）用手持机读 EPC 得 `45323848510400000100`，而本系统 `products.rfid_epc` 存的是 `E28HQ04000001`——两值形态不同；把该值喂给盘点/入库链路会落 `unknown`，仅走摄像头扫条码（`barcode`/`code` 回退）能匹配。
- **根因**：两处叠加。①**编码不对称**：`chip_epc_hex()` 写入芯片时把前缀/门店段按 ASCII 编码（`E28HQ…` → `4532384851…`），库内却存明文，全仓无反向解码（`fromhex/unhexlify` 仅 PBKDF2 在用）；匹配点 [main.py](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L5446-L5455) `_classify_scan`、`_resolve_product` 都是明文等值比对，手持机 [TaskActivity.kt](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/agents/scan/app/src/main/java/com/yizhen/scanassistant/TaskActivity.kt#L577-L583) 只做 `epcRaw.uppercase()`。②**固件补零**：Gen2 的 PC 字以 16 位字为单位记录 EPC 长度，奇数字节的 EPC（`E28HQ…` 编码后恰为 9 字节）被写侧补 1 字节 `00` 到 10 字节；旧全 hex 格式 13 位（奇数 nibble）则补 1 个 0 位到 14 位。二者都不是读端造成的。
- **修复**：`rfid_print.py` 新增 `decode_chip_epc()`（`chip_epc_hex` 逆变换：前缀 ASCII + 门店段 ASCII/hex + 品类码 + 序号；用 `db._epc_rule` 的合规正则自检，并逐字节/逐 nibble 裁掉固件补零；认不出原样返回不猜）；`main.py` 新增 `_norm_epc(conn, raw)`，在扫描入库 [main.py](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py#L5484-L5485) `_do_scan` 与通用定位 `_resolve_product` 各归一化一次，保证入库值与 `products.rfid_epc` 同口径。
- **验证方法**：①单测 12 例（含实读值/无补零/明文/旧全 hex 补零/他厂标签/奇数长度/条码/product_id）全过；②真实端点回归：`POST /api/tasks/start` 建盘点任务 → `POST /api/device/scan?key=…` 喂 `45323848510400000100` → verdict `in_store`、`accepted=["E28HQ04000001"]`；喂他厂 `E2003412345678901234` → `unknown`；明文值因同 EPC 排重不重复入库；③清理：任务、task_scans、operate_logs 该条日志已删净（tasks=0、task_scans=0）。
- **回归守卫**：新增打印/扫码链路不得再出现「芯片 hex 直比明文 EPC」；若后续改 EPC 规则（前缀/序号位数），`decode_chip_epc` 需同步（它按 `biz_config.epc_prefix/seq_bits` 自检，规则变了会自动退回原样返回而非误判）。

## TC-51 打印后 USB 回读天线位的规则（2026-10-18 修正版）

- **问题现象**：①纯打印（无 RF 写入）任务后带 `RD epc` 回读 → 必报 `-4003 USB读取超时`；②打印前空读天线位却能读到值。
- **根因**：X19D 的 RFID 天线在打印/编码工位，走纸后**天线位停的是纸道里最近经过/停留的那张标签，与"本次写入张"无固定对应**（10-18 两次实测：①纯打印+RD → -4003（天线区空）；②J001 结构化写入成功后回读得 `3000202610171511`=前一日 15:11 写入的旧标签——"写入张停天线位"的推测被推翻）。`CAL rfid` 校准只调写入射频位置，不改变走纸结果。
- **10-18 复测补充**：读数随机性取决于**射频场内标签张数**——场边仅一张时读数 100% 稳定（TID/EPC 各 10/10 同值零抖动），并非永远混读；但打印写入张（`3000202610181917`）打印后已到撕纸位，前读/后读 TID/EPC 均为纸道旧张，**写入值永不出现**，"按 TID 匹配回读"（Java SDK 官方 LSF 先读后打工作流思路）同样无法闭环。TID 读取新能力见 AGENTS.md「TID 读取」条目（官方参数 255,0,0,2）。
- **正确用法**：校验芯片写入 = ①**手持机 UHF 扫该标签**（唯一可靠手段，兼验 TC-50 归一化）；②目视无错误标记块。USB 空读 `POST /api/calibrate {"action":"epc_read"}` 只反映**天线位当前那张**（可能是纸道里任意旧标签），不可作为本次写入的校验依据。
- **验证方法**：USB `printerType:"rfid_cmd"` + `RD epc`：纯打印任务 → `EPC=读取失败(-4003…)`；空读天线位（有写入张停留时）→ 读到其 EPC。
- **回归守卫**：USB 任务缓冲内禁放 RD 仍生效（代码剥离、打印后独立读，勿改回）；`3000202610171526` 型回读值先按 `3000`+BCD 时间拆解判来源，勿当出厂码。

## TC-52 三通道打印成功要素（BT 时序 + 统一指令坐标，2026-10-18 三通道实打出纸验证）

- **问题现象**：①BT 发指令「写入成功」但打印机无任何反应/无回传；②三通道打印「通道名+EEEEEE」双行标签，第二行 EEEEEE 不出现；③统一指令发 `q528/Q208,40`（PCLE 裸指令）报「未知指令」。
- **根因与要素（均已修入本项目 PrintAgent）**：
  1. **BT 时序三要素**（[BtSppPrintService.cs](agents/print/Services/BtSppPrintService.cs)，对齐实测跑通的 BtPrintTest 工具）：开壳后等 RFCOMM 链路 **5 秒**（原 1 秒拨号未完成，指令全丢）；发送后保活 **≥6 秒**再关串口（发完即关 → 数据截断）；响应读取不按单次 `read<buf` 提前断开。GBK 编码不变。BT 仍不做读（RQ/RD 无回传，固件限制，与 10-17 结论一致），但打印经时序修复后稳定。
  2. **NET 反馈监听**（[RfidTransport.cs](agents/print/Services/Rfid/RfidTransport.cs) 重写）：打印指令走 TCP 9100；RD/RQ 回读数据由打印机**反连主机 9200** 反馈口送回（原只读 9100 同链路永远收不到）；有数据重置超时窗口。9200 监听失败时退化为仅同链路读。
  3. **统一指令 `T` 坐标单位是 mm**：y=80 按点阵理解 → 超出 25.4mm 标签高度，**静默打到纸外**（EEEEEE 消失的真因）；双行安全布局 y=6/14mm。`L 66,25.4,5` 尺寸同为 mm；**不认 PCLE 裸 `q/Q`**，尺寸/间隙用 `L`。
- **验证方法（已全通）**：同一指令流 `N / L 66,25.4,5 / S 4,12 / T 6,6,0,4,1,1,N,"通道名" / T 6,14,0,4,1,1,N,"EEEEEE" / PRINT 1` 三通道各打 1 张：USB(`1550958756`)、BT(`COM6`)、NET(`192.168.1.180:9100`，打印机接网后)——三张均「通道名+EEEEEE」双行齐全。
- **回归守卫**：改 BT/NET 通道代码时禁动 5s/6s/9200 三个参数；统一指令排版一律 mm 且不得超出 `L` 声明的标签高度。

## TC-53 USB 通道偶发卡死（助手进程侧，待查根因）（2026-10-18）

- **问题现象**：长时间连续多任务打印（USB/BT/NET 混合十数次）后，USB 任务受理成功但**派发挂起**——任务不落账（/api/tasks 无记录）、无回执；BT/NET 任务不受影响。
- **暂定处置**：重启 PrintAgent.exe 即恢复（重启后 USB 立即正常）。与 AGENTS.md「USB 挂死=断电重启打印机」不同：本次打印机正常，卡的是**助手进程**。
- **疑因（待查）**：UsbPcleService 串行化/无超时保护（ZMPCLx64 调用阻塞后锁不释放）。
- **验证方法**：复现路径=连续混合三通道打印后单发 USB 任务，观察 /api/tasks 是否 75 秒不落账。
- **关联现象（2026-10-18）**：打印机硬件错误 **-103**（介质/碳带态）会跨助手重启持续存在，**打印机断电重启才恢复**（助手重启无效）；恢复前每次云端重发都会按序列消耗商品条码号（当天 0A/0B/0C 三号被失败尝试占用，无孤儿数据，仅号段跳空）。

## TC-54 打印机侧自动校验 RFID 写入：三种思路全部不可行，手持机是唯一手段（2026-10-18）

- **问题现象**：希望打印后由打印机自动回读芯片验证写入。实测三种思路均失败：①打印后回读天线位——多标签混读（前读 3000…1520、打印写入后读 3000…1524，均非刚写入值）；②退纸把撕纸位标签拉回天线——`ZM_SetPrinterState(1)`+`ZM_EnableBackFeed` 前置解锁后行程仅=纸道松弛余量（打印后纸绷紧，1-2 步即 -3200），够不回；③打印前读→打印→后读对比——前读值≠写入目标张（混读），身份链无法建立。
- **根因**：X19D 天线区射频场覆盖纸道一列标签（30mm 间距多张同场），`ZM_ReadRFTagDataUSB` 每次随机应答其一；SDK 结构化打印把纸绷紧送出撕纸位，退纸行程不足。另：冷启动后 SDK 未初始化时 `SetPrinterState(1)` 报 -3243、`EnableBackFeed` 报 -3219，跑过一次 SDK 任务后才成功；`ZM_FeedMedia` 该状态下恒 -3237。
- **结论**：**芯片写入校验唯一可靠手段=手持机 UHF 扫**（兼验 TC-50 归一化）；打印机侧只信 SDK「打印并写入成功」回执+目视无错误标记块。勿再投入退纸/回读方向（本次已穷尽；10-18 晚 Java SDK 挖出官方 TID 读取 + LSF 先读后打工作流后复测，TID 身份链方案亦无法闭环，见 TC-51 复测补充）。
- **验证方法**：复现=打一张带 `content.epc` 的结构化标签（已确认「打印并写入成功」），立即 `POST /api/calibrate {"action":"epc_read"}` 多次——只会读到纸道里其他标签或空白厂码，永远读不到刚写入值。

## TC-55 EPC 芯片编码 BCD 数字格式 + 打标状态闭环（2026-10-18，函数级 19 项断言全过）

- **变更内容**：①EPC 芯片编码新增 GS1 式纯数字格式：可读 EPC=数字前缀(10位,biz_config.epc_num_prefix 默认 `6901234567`)+门店(store_id 补零 2 位)+品类(2 位)+序号(6 位十进制)=20 位；写芯按 BCD 打包 10 字节+版本号 `01`+前 10 字节异或校验（如 J002 类新签 → `69012345670104000001016D`，96bit 整）。旧字母前缀格式（E28HQ04000001 → ASCII-hex 9 字节）存量保留，`decode_chip_epc` 双格式兼容（新格式判别在旧纯 hex 分支**之前**，24 hex+版本+校验三重验证）。②products 加 `label_status`（''未打标/issued 已下发/verified 已验证）：`/api/print/labels` 真发送且 write_epc 后置 issued（verified 不降级）、`/api/inventory/rfid-scan` 账实相符置 verified；商品列表带出并在名称行加徽章（issued 黄/verified 绿，i18n 键 `lbl.lblIssued`/`lbl.lblVerified` 六语言）。
- **根因（验证中抓到的 bug）**：`_gen_type_epc` 解包 `_epc_cfg` 三元组时错位——把第 1 个元素（旧字母前缀 `E28`）当成数字前缀用，导致新签仍是 E28 开头旧格式；内存库断言 `main_gen_type` FAIL 抓住后改为 `_prefix, _bits, num_prefix = _epc_cfg(conn)` 修复。
- **验证方法**：C:\Temp 临时脚本（已删）跑 19 项断言：新旧编码/解码往返、旧芯片固件补 1 字节回读归一化、校验字节损坏/版本异常宁原样返回不猜、`_strip_epc_prefix` 双格式短码、ZPL `^RFW,H` 写芯串、内存库 `migrate_schema` 补列、`assign_rule_epcs` 新旧终身码均保留且幂等、数字序号接续、`main._gen_type_epc` 真函数输出 `69012345670104000002`。
- **回归守卫**：①`decode_chip_epc` 新格式判别必须保持在前（否则 24 hex 会被旧纯 hex trim 分支截尾误判）；②`_epc_cfg` 返回 `(旧字母前缀, 序号位数, 新数字前缀)`，解包顺序勿颠倒；③`assign_rule_epcs` 新旧两套序号空间独立（新格式只进 seen 不进旧序号池 used）；④印刷条码 `_compute_item_barcode` 与 EPC 解耦未动，仍走旧门店字母码+hex 序号。

## TC-56 门店段升级 4 位自定义 BCD 数字码（前缀缩 8 位，2026-10-18，函数级 18 项 + 真链路全过）

- **变更内容**：应用户要求「门店前缀也用 BCD 替代」，新格式 EPC 由「前缀10+门店2+品类2+序号6」升级为「**前缀8(69012345)+门店4(自定义数字码)+品类2+序号6**=20 位数字，BCD 打包 96bit 不变」；`biz_config.store_num_map`（JSON `{"1":"7777"}`）可自定义门店码，缺省按 store_id 补零 4 位；印刷条码同步改为「门店4+品类2+序号6十进制=**12 位纯数字**」（与 EPC 短码一致），序号由 hex 改十进制；`assign_rule_epcs` 补全/重排路径由旧字母格式改为新数字格式（新格式存量进新序号池防撞号）；`biz_config.epc_num_prefix` 存量 10 位默认自动升级 8 位；删除 main.py 死函数 `_store_seg`（`db.store_segment` 仅保留用于旧格式 EPC 重排）。
- **根因（两处脚本期望值教训，非代码 bug）**：①异或校验字节随数字内容变化，不能复用旧样本的校验值；②门店映射生效后期望值须同步（7777 替代 0001）。另：`POST /api/products` 创建响应**本来就不含 barcode**（条码在打印预览/批量补全时才分配，main.py `_compute_item_barcode` 调用点），真链路断言勿在创建响应上验条码。
- **验证方法**：C:\Temp 临时脚本（已删）函数级 18 项：新结构编码（`69012345000104000001`→`69012345000104000001010A`）/解码往返、校验损坏不猜、旧格式兼容、短码截 8 位得 12 位数字、迁移升级 10 位默认、映射优先/缺省补零/回退、assign 旧保留+新保留+空 EPC 补新格式+幂等、`_gen_type_epc`/`_compute_item_barcode` 真函数；真链路：创建商品得 `69012345000104000001`→模拟扫描账实相符→`label_status=verified`→删除，接口+直查库确认零残留。
- **回归守卫**：①`_strip_epc_prefix` 对 20 位纯数字截**前 8 位**（前缀长度），勿回退为 10；②`assign_rule_epcs` 新格式存量必须进 `used_new` 序号池，否则补全撞号；③EPC 与条码序号空间独立（各自 LIKE 前缀计数）；④旧条码存量（HQ 开头）不受影响，LIKE 前缀不同互不干扰。

## TC-57 快速开单：客户名称联想静默失效 + 录入币种换算覆盖（2026-10-23）
- **问题现象**：①开单弹层输入已有客户名称无联想下拉（手机号联想正常）；②当日金价/商品行金价/工费/单价/组合支付金额输入框均为裸 CNY 数字，与小计/应收的 $ 显示混排。
- **根因**：①`onNameInput` 模板已绑定 `@input` 但**漏注册进 Vue methods**，输入时调用 undefined 静默失败（无控制台报错）；②这些输入框 `v-model.number` 直接绑 CNY 内部值，未像整单优惠 `sDiscountInput` 一样做显示币种 getter/setter。
- **修复**：①补注册 `onNameInput`；②新增 `saleEntryRate()/toEntryV()/fromEntryV()`，金价行走 `sGoldInput` computed，商品行金价/工费/单价与组合支付金额走 `:value/@input` 换算（内部仍存 CNY，提交与 biz-config 保存口径不变）。
- **验证方法**：临时脚本（已删）——开单弹层输入已有客户名/备用号 → 下拉出现可选中回填；金价 520 CNY 显示 $72.8、改输 100 → 内部 714.29 CNY、小计 $1,028.01；支付输 1000 → 内部 7142.86 CNY、实收合计 $1,000.00。
- **回归守卫**：①模板 `@input/@click` 引用的函数必须注册进 methods（联想类失败静默无报错，尤须自查）；②开单弹层所有金额输入一律走 `toEntryV/fromEntryV`（或 computed），禁止 `v-model.number` 直接绑 CNY 字段。

## TC-58 品类记录删除后被"复活"：种子补插写在每连接路径上（2026-10-23，界面复现→修复→复测全过）
- **问题现象**：商品品类管理删除任意品类（如 COUNTER_RING）→ 接口返回 200、确认框正常，但刷新列表/直查库该记录仍在，表现为"无法删除"。
- **根因**：`db.py ensure_new_seeds()`（main.py 每次 `_db` 连接都会调用）里有一段**无条件执行的「老库补插古董款/专柜款分组」`INSERT OR IGNORE`**，COUNTER_RING/COUNTER_NECK/SET 等都在名单；删除后任意下一次请求（如刷新列表的 GET）把同 code 行原样插回。注释"已存在的 code 跳过"只防重复插入，防不了"删除后重插"。
- **修复**：把该补插块并入上方「product_types 表为空」分支——新空库仍灌完整分组；有数据的库不再自动补插。历史上需要补插的老库在既往版本已补齐。
- **验证方法**：界面新增一次性品类 TESTT1 → 列表点删除（接受原生 confirm）→ 连续 3 次 loadProductTypes → 直查库无该行（修复前同路径必复活）。
- **回归守卫**：①`ensure_new_seeds` 内禁止新增"无表空守卫"的 INSERT OR IGNORE（每次连接都会跑，删除型操作都会被复活）；②"老库一次性升级补数据"应走 upgrade.py 数据任务，勿落在每连接种子路径。

## TC-59 静态资源缓存协商 + 总部管理三个表单塌陷上移（2026-10-23）
- **问题现象**：①`spa_asset`/`mobile_asset`/`/logo/` 对图片/字体/manifest 等资源不返回缓存头，`/site` 动态页无缓存头，浏览器吃启发式缓存旧资源；`?v=` 版本串漏升即陈旧。②总部管理→品类管理/分类管理（一级、二级）三个表单挤在卡片底部，`.form-row` 内 5 个字段组（含嵌套 flex 的「语言+名称」）布局塌陷：品类名称/标签名称输入框被压成细缝无法录入，标签颜色色块被拉成细条。
- **根因**：①Starlette `FileResponse` 自带 ETag 但**不处理 If-None-Match**（只有 StaticFiles 有 304 协商），且伺服代码只对 js/css/html 加 no-cache。②`.form-row{display:flex}` 子项全部 `flex:1` + 嵌套 flex 容器，长表格之下字段组宽度分配塌陷。
- **修复**：①`main.py` 新增 `_no_cache_file(request, f)`：`Cache-Control: no-cache` + 自算 ETag（mtime_ns+size）+ If-None-Match 命中返回 304（不传正文）；`/`、`spa_asset`、`mobile_asset`、`/logo/` 全部改走该函数，`/site` 补 no-cache 头。②三个表单整体移到卡片标题/提示行之后、表格之前，字段分行重排（语言固定宽 + 名称 `flex:1` 独立占位；二级分类颜色/排序/分组独立一行）；`resetTagEdit()` 分组预填当前筛选 `ST.tagFilter`（仅新增路径，编辑按原值回填）。
- **验证方法**：`python` 脚本 GET 5 条代表路径断言 `Cache-Control: no-cache`，再带 `If-None-Match` 复请求断言 304；浏览器普通 reload（非 Ctrl+F5）断言新追加的 CSS 规则生效、还原后消失；`elementFromPoint` 逐控件断言命中自身；界面实际新增品类/一级分类/二级分类（含 chip 筛选→新增标签分组默认=筛选值）走查。
- **回归守卫**：①新加静态资源路由必须复用 `_no_cache_file`，禁止裸 `FileResponse`（会退回启发式缓存）；②表单字段禁止在 `.form-row` 里嵌套 flex 容器拼「下拉+输入」，语言选择用 `flex:0 0 Npx` 固定占位独立 form-group。
