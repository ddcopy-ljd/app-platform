# 珠宝云：调拨/库位/经办人/开单日期 - 实施计划

> 版本节奏：随 v1.0.8 / dataVersion 1.0.8 发布（智能安防 v1.0.7/1.0.7 在制在前）。工作区直接开发，不触碰安防在制改动，不提交；发布时机与提交拆分由用户决定。

## Task 1: 数据层迁移（locations / clerk_types / transfers / 新列）
- **Status**: `completed`（TR-1.1/1.2/1.3 全过；另修复存量 bug：assign_rule_epcs 不再强校验品类段/门店段，EPC 格式合规且全库唯一即终身保留）
- **Priority**: high
- **Depends On**: None
- **Description**:
  - `db.py`：SCHEMA 新增 locations（id,store_id,code,name,sort_order,active,UNIQUE(store_id,code)）、clerk_types（id,name UNIQUE,sort_order,is_default,active）、transfers（id,transfer_no UNIQUE,from_store_id,to_store_id,status,created_by,sent_at,received_by,received_at,remark,created）、transfer_items（id,transfer_id,product_id,epc,product_name,result,diff_reason,received_at）。
  - products 加 `location_id INTEGER`、`cert_location_id INTEGER`；sales 加 `clerk_type TEXT DEFAULT '店员'`、`clerk_name TEXT DEFAULT ''`。
  - migrate_schema 的 alters 补上述加列；新增幂等种子：clerk_types 四个默认类别（店员 is_default=1/主播/代理/代销，已存在不重复插入）；存量 sales 空类别回填「店员」。
  - 新增「在途」状态口径：`_inv`/库存汇总允许在途；不改 EPC 相关任何逻辑（跨店只改 store_id）。
  - plugin.json 暂不动版本号（发布时再统一 1.0.8/1.0.8）；代码按 dataVersion 1.0.8 语义编写，upgrade.py 头部说明同步。
- **Acceptance Criteria Addressed**: AC-8, NFR-1, NFR-5
- **Test Requirements**:
  - `rule` TR-1.1: 在当前 1.0.7 结构开发库副本上连跑两次 migrate_schema，PRAGMA/建表结果两次一致，products/sales 存量行数与抽样字段零变化，sales.clerk_type 全部回填「店员」；证据=sqlite 比对输出。
  - `rule` TR-1.2: 全新 init 后 clerk_types 恰 4 行且「店员」is_default=1；证据=sqlite 查询。
  - `rule` TR-1.3: py_compile db.py/upgrade.py 通过。

## Task 2: 库位主数据 API 与前端管理
- **Status**: `completed`（TR-2.1/2.2 接口实测全过；TR-2.3 浏览器走查并入 Task 8）
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - main.py：GET /api/locations?store_id=（只返回该门店，支持 active 过滤）、POST（编号门店内唯一，冲突 400）、PUT /api/locations/{id}（改名/排序/停用；停用不删历史）、DELETE 仅允许无商品引用时删除（否则要求停用）。
  - 前端设置/基础数据区新增「库位管理」：门店切换、列表、增改、停用开关；入口与现有基础数据页面风格一致。
  - i18n：本功能全部新增 key 三语齐全（后续 Task 8 统一核查，本任务先写全）。
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `rule` TR-2.1: 新增 A-01 成功；同店重复 A-01 返回 400；异店可同号。
  - `rule` TR-2.2: 停用后 GET active=1 不含、全量列表含且 active=0；有引用时 DELETE 返回 400/冲突提示。
  - `rule` TR-2.3: 浏览器中库位增/改/停用操作均成功且刷新后保持。

## Task 3: 商品位置字段与无证书/库位筛选
- **Status**: `completed`（TR-3 接口全过；浏览器走查并入 Task 8）
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - main.py：商品创建/更新/详情接收 location_id、cert_location_id（校验属于该商品门店或为空，跨店库位 400）；product_list 增加参数 `has_cert`（0=未配证书，cert 为空/纯空白）、`location_id`、`cert_location_id`、q 检索范围扩展到两个位置名称（join locations）。
  - 前端商品表单：两个库位下拉，数据源按当前选择门店过滤；商品列表筛选条加「未配证书」开关与库位下拉；列表/详情展示位置名；options/导出等既有接口不破坏。
  - 造数脚本 seed_test_data.py 兼容新列（无需强制赋值）。
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-3.1: 总店商品表单下拉只含总店启用库位；选存保存后 GET 详情回显 id 正确，改存后旧位置释放可给别的商品使用。
  - `rule` TR-3.2: has_cert=0 结果集 cert 全部为空白，数量与 SQL `WHERE TRIM(cert)=''` 一致；location_id 筛选与 join 直连计数一致。
  - `rule` TR-3.3: 指定他店 location_id 创建/更新商品返回 400。

## Task 4: 经办人类别（后端+开单/列表/小票）
- **Status**: `completed`（TR-4.1/4.2/4.3 接口脚本 21 项全过；浏览器实测：类别管理增/改/停用、默认店员无停用按钮、开单默认店员、主播+人名 tag、类别筛选与空态均 PASS）
- **实现备注（小票偏差）**: 现状打印桥（scripts/print_agent.py + ws job）仅支持 ZPL 标签 RAW 通道，receipt_sale 仅是预留业务绑定码、无销售小票渲染链路；rfid_print.py 无小票模板。为不触碰安防在制的打印桥/exe 区域，本期小票以**浏览器 58mm HTML 打印窗**实现（printReceipt：window.open 写收据 HTML 后 window.print，热敏机配系统打印驱动即可出纸），含店名/单号/业务日期/经办人（类别·人名）/客户/商品/金额/欠款/支付方式/落款；字段已全部落库为快照，未来打印桥实装票据通道时可直接复用同数据。DOM 捕获小票 HTML 验证：销售小票/单号/经办人/主播/网页小明/金额/日期全部命中（自动化浏览器拦截 window.open 属环境手势限制，真实浏览器正常）。
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - main.py：GET /api/clerk-types；POST/PUT（增、改名、停用；默认类别不可停用/删除）；sales 保存 clerk_type 名称快照+clerk_name；SaleReq 加两字段，clerk_type 缺省取默认类别；sale_list 支持 clerk_type/clerk_name 筛选并返回新字段。
  - 前端：设置区新增经办人类别管理（极简列表增改停用）；开单 sheet 加类别下拉（默认默认类别）与人名输入；销售列表显示类别/人名并可筛选；小票渲染（rfid_print.py 的销售模板）加「经办人：类别 人名」行。
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `rule` TR-4.1: 开单不传 clerk_type 时落默认类别「店员」；传「主播」+人名后列表/详情/小票数据三处均含。
  - `rule` TR-4.2: 类别改名后历史销售单仍显示旧名（快照验证）；停用类别新单下拉不含；停用默认类别被拒。
  - `rule` TR-4.3: /api/sales?clerk_type=主播 结果全部命中。

## Task 5: 开单日期现状验证与回归固化
- **Status**: `completed`（TR-5.1 PASS：默认单单号 XS20261006105 biz_date=2026-10-06；改期单 XS20261006110 biz_date=2026-10-03；两单 created 均为 2026-10-06 13:56，biz_date≠created 验证通过；测试单已自清。TEST_CASES 正式补录在 Task 8）
- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - 不改代码，验证现有链路：默认当天、改选历史日期、列表与小票展示、created 与 biz_date 区分；将结论记入 TEST_CASES（或确认无回归）。
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `rule` TR-5.1: 两单（默认/改 3 天前）biz_date 符合预期、created=当天；证据=/api/sales 与表行。

## Task 6: 调拨后端（建单/在途/部分验货/差异退回）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 单号生成器 _next_transfer_no（DB 风格，如 DB+日期+序列）。
  - POST /api/transfers：body {to_store_id, product_ids:[]}；校验：非空、≤50、全部存在且同属一个调出店、状态=在库、目标店≠调出店；事务内建 transfers(status=在途)+items(result='')、商品批量 status='在途'（store_id 不变）、写 transfer_out 日志。
  - GET /api/transfers?scope=out|in&status=；GET /api/transfers/{id}（含 items 与门店名）。
  - POST /api/transfers/{id}/receive：body items[{product_id, ok:bool, reason}]；仅在途单、仅一次；所有明细必须给出判定；ok=false 的 reason 必填（否则 400 并指出商品）；事务内：相符→store_id=to/status=在库/transfer_in；不符→留 from/status=在库/transfer_back+原因；单据状态=已完成（全符）或部分完成（有差异），记 received_by/时间。
  - 状态守卫：在途商品销售开单/再调拨/借出均 400（在 create_sale、loan、transfer 三处统一校验非「在库」即拒，开单现状已有状态校验，覆盖测试即可）。
  - inventory summary/dashboard 增加在途计数（归属调出店资产）。
- **Acceptance Criteria Addressed**: AC-6, AC-7, AC-8, NFR-2, NFR-3
- **Test Requirements**:
  - `rule` TR-6.1: 3 件（混合同店在库）发出成功；重复 id/空列表/跨店混选/目标店相同/非在库 各返回 400。
  - `rule` TR-6.2: 发出后商品在途、汇总在途+3 在库-3、对在途品开单与再调拨均 400、EPC 与发出前逐字相同。
  - `rule` TR-6.3: 验货 2 符 1 不符且差异原因为空时整体 400 且库状态不变（事务回滚证据）；补原因后成功：2 件入店 1 件退回、单=部分完成、日志三类齐全。
  - `rule` TR-6.4: 对已完成单再次 receive 返回 409/400；scope=in/out 列表过滤正确。

## Task 7: 调拨前端（多选/扫码建单 + 验货页）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6, Task 3
- **Description**:
  - 商品列表加多选模式：勾选累计（跨页保留已选条）、扫码（EPC/货号查询）加入已选区，显示已选件数与清单（可移除）；「调拨」按钮弹窗选调入门店并提交，成功后清空选择并刷新。
  - 新「调拨」导航页：Tab 我发出的/我接收的；卡片列表（单号/门店/件数/相符差异/状态/时间）；详情抽屉展示明细。
  - 接收方验货页：逐项「相符/不符」切换，不符展开必填原因（含三个快捷原因），支持扫码自动把扫到的项标相符；底部「完成验货」；提交成功后展示入库/退回汇总。
  - 在途商品在商品列表有明显「在途」角标且不可选入新调拨。
- **Acceptance Criteria Addressed**: AC-6, AC-7, AC-9
- **Test Requirements**:
  - `rule` TR-7.1: 浏览器中扫码 1 件+勾选 2 件（跨页）建单成功，列表出现「在途」单。
  - `rule` TR-7.2: 验货页不符项不填原因时前端拦截+后端拒绝；完成后状态与件数汇总正确。
  - `rubric` TR-7.3: 操作顺畅度；scale 1-5；anchors 1=流程中断/无反馈，3=可完成但繁琐，5=勾选-扫码-验货闭环顺畅反馈清晰；threshold >=4；证据=浏览器走查记录。

## Task 8: 三语文案与回归
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - 全量核查新增界面无硬编码中文裸串，zh/en/it 三套 key 齐全；切换语言走查调拨/库位/经办人/开单四个场景。
  - 回归既有：销售（定/欠/冲红）、借货、盘点 rfid-scan、打印桥状态、商品 EPC 续号生成、dashboard 计数。
  - 更新 plugins/jewelry/TEST_CASES.md 新增本期用例（在途冻结、部分收货事务、差异原因必填、库位跨店校验、经办人快照、EPC 跨店不变）。
- **Acceptance Criteria Addressed**: AC-9, NFR-4
- **Test Requirements**:
  - `rule` TR-8.1: grep 新增模板无裸中文（t() 包裹）；三种语言切换无 key 缺失显示。
  - `rule` TR-8.2: 既有功能冒烟清单全部 200/行为不变（销售/借货/盘点/打印桥/EPC 续号）。
  - `rubric` TR-8.3: 整体体验；scale 1-5；anchors 1=多处残缺/错串，3=主流程可外语文案粗糙，5=三语完整自然；threshold >=4；证据=浏览器三语走查。

## Task 9: 打包发布准备（安防 v1.0.7 收敛后）
- **Status**: `pending`
- **Priority**: low
- **Depends On**: Task 8
- **Description**:
  - 智能安防在制改动收敛、v1.0.7 打包后：plugin.json 升 1.0.8/1.0.8、与用户确认提交拆分方式后 commit、build_package 核查 zip、上传沙箱（平台已支持多版本并行试运行）、按升级自测 skill 走流水线与票证回归（重点回归 AC-1~AC-8 接口面）；正式切换仍由人工执行。
- **Acceptance Criteria Addressed**: AC-1~AC-8（沙箱环境复验）
- **Test Requirements**:
  - `rule` TR-9.1: 沙箱流水线 trial/success 且沙箱回归 AC-1~AC-8 全通过；证据=流水线与回归记录。
