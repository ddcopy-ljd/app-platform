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

