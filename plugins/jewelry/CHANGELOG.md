# CHANGELOG — 懿臻珠宝云

## v1.2.53.261021（未发布）

### 总部 / 门店页面彻底分拆，系统管理也拆两页

- **总部管理 vs 门店管理拆成两个独立页面**：门店管理页只保留门店详情卡组（基本信息/安防/手持机/打印机/库位）与一行一店的门店列表；总部管理「分店管理」的门店方块不再条件渲染同一份详情，改为「管理」按钮跳转 `openStorePage()` 到门店管理页并选中该店，改一边不会影响另一边
- **系统管理拆成「总部系统」（`hq-system`，仅总部账号可见）与「系统管理」（`system`，所有账号可见）**：总部系统含用户与门店权限 / EPC 编码规则 / 标签打印模板 / 经办人类别；门店系统含安防中心 / 打印与扫描助手 / 操作日志 / 问题上报。旧入口 `profile`/`epc`/`tpl`/`clerk`/`users` 统一兼容跳转到总部系统
- **登录按角色自动落位**：`landingByRole()` 总部账号进总部管理，门店账号进门店管理（登录、会话恢复、手持机 WebView 三处同源）
- **门店「修改资料」的门店名称改为只读**（门店编码本就只读），新建门店表单仍可填名称
- **打印机卡片**：RFID 打印机行、小票打印机行各自右侧「测试页」按钮；小票测试走标准驱动纯文本任务（`biz='receipt'` 一次覆盖全部小票类业务）
- **下载入口集中**：手持机 APP / 打印助手 EXE 两条下载链接只保留在「打印与扫描助手」页卡片头部，登录页与按钮行移除
- **演示数据清理**：删除误入安防的「柜台-RFID读写器」（UHF-RFID 非安防注册驱动），`migrate_schema` 幂等清理存量
- 前端缓存版本 → 20261021b10（app.css b02）

## v1.2.52.261021（未发布）

### 打印功能大简化：打印机/规格/连接全部固定，删掉复杂配置

固定方案：打印机 ZMIN X19D（USB、300dpi），标签 66×25.4mm 横版（间隙 5mm，可打印区左侧 25×25mm），撕裂线 17.0mm 为打印机硬件撕纸参数（助手启动自动下发 `CONFIG tear,17.0`，FEED 一张正好停在撕裂线）。

- **C# 助手裁剪**：删除标签纸形状库（LabelPaperStore/LabelPaper）、设备档案（DeviceProfiles）、连接巡检（ConnectionProbeService）、蓝牙双通道（BlePrintService/BtSppPrintService）、打印机配置窗体（FormPrinterConfig）及对应本地接口（/api/labelpapers、/api/profiles、/api/printer-prefs、/api/printer-status、/api/print-config/apply、/api/rfid/*、/api/printers）；device_cmd 仅保留 exec；主窗体精简为「打印机状态 + 测试页 + 服务地址/门店密钥绑定」
- **网页端收缩**：门店详情「打印机」卡片精简为在线状态 + 打印机清单 + 测试页；「打印与扫描助手」页删除标签纸形状库、标签格式指派、业务指派三块 UI（云端 label_papers 表/API 保留以备后用）；app.js/i18n 同步清理死代码与失效 key；前端缓存版本 → 20261021b01
- **排版引擎**：rfid_print.py 画布 827×413（70×35）→ 779×300（66×25.4）；无模板回退布局与内建模板「珠宝RFID标准签（66×25.4）」统一（FALLBACK_DEFINITION）；build_zmin_content 默认 66/25.4/间隙5/300dpi
- **测试页**：云端下发的助手测试页固定 66×25.4、300dpi、USB
- 顺手修复 i18n.it.js 存量语法错误（sb.keyGen 值未转义引号导致意语字典加载失败）

## v1.2.51.261020（未发布）

### 打印配置管理：三层模型 + 链路指派 + 连接巡检

- **数据模型**：`store_printers` 表扩展 6 列（`iface` 链路 USB/NET/BT、`printer_ip` NET 地址、`media_json` 标签方案、`rev` 版本、`updated_at/updated_by` 审计），`migrate_schema` 幂等补列，复用原 PK(store_id,biz_code) 不建新表
- **bind-printer API 扩展**：校验 `iface∈{USB,NET,BT}`，NET 必填 IP（否则 400），写 `media_json`（纸方案+撕纸位置），`rev+1` 乐观锁，返回新字段；标签类业务同步旧列 `stores.printer_name` 保持兼容
- **打印下发带链路**：`_bridge_enqueue` / 回退重打 / `print-control` 测试页三处 payload 增加 `interface`/`printerIp`，由门店指派行驱动，不再硬编码 "USB"
- **前端打印配置页两 Group**：🏷 标签格式（标签方案下拉 + 撕纸位置 mm + 应用按钮，下发助手 `/api/print-config/apply` 发 `CONFIG tear` 指令改 NV）/ ⚙ 设备与连接（业务行=打印机下拉+链路下拉+NET IP 框+状态点+测连接）；状态点 key 对齐助手 `ProfileKey(brand|NET?ip:name)`
- **助手连接巡检（不打打印任务）**：新增 `ConnectionProbeService` 60s 定时巡检——USB=SDK 主板 SN 枚举（不开端口）、BT=SERIALCOMM 串口在位、NET=TCP 9100、DRIVER=Windows 打印队列；结果存内存+`status.json`；新增本地接口 `GET/POST /api/printer-status`（立即巡检）、`POST /api/printer-status/register`（登记云端指派目标）、`POST /api/print-config/apply`（撕纸 NV 持久）
- 修复 `print_agent_status` 中 `bd` 变量未定义导致 500 的 bug；biz 数组补齐 iface/printer_ip/media/rev/审计字段
- 前端缓存版本 → 20261020b19

## v1.2.50.261019（未发布）

### 打印助手改 http 回环 + 门店管理内置「打印机」管理卡片

- **C# PrintAgent 本地服务改 http 仅回环监听**（127.0.0.1:18180）：原 https 自签证书需手动导入系统信任才能被浏览器放行（死结），改 http 后浏览器直连零配置；csproj 同步移除 pfx 复制项，顺带对齐助手「仅回环」约束
- 新增本地接口 `GET /api/profiles`（设备档案回显）与 `POST /api/printer-prefs`（用途备注/列表移除，按 ProfileKey 存设备档案）
- **门店详情页新增「🖨 打印机」卡片**（与安防/手持机并列，覆盖本机全部打印机，不止 RFID）：打印机列表（品牌/接口/在线态/系统默认）、**用途备注**（prompt 输入，行内 📝 显示）、**从列表移除**（confirm 后隐藏，底部「已移除」区可一键恢复）、标签纸绑定下拉、ZMIN 校准/测试页；**全部直发本机助手，档案仅存门店电脑本地，不经云端下发**（云端 WS 任务通道不变）；助手不在线时提示「请在门店电脑上启动 PrintAgent」
- **总店视图可达**：总部管理「分店管理」子页门店卡片新增「管理」按钮（selectStore），门店详情卡组（基本信息/安防/手持机/打印机/库位）上提为共用块，总店/分店两视图均可用；修复打印机偏好保存时 hidden 被「旧值 OR」覆盖导致「恢复显示」无效的问题
- 手机/电脑选择门店时自动探测本机助手并加载标签纸档案与设备档案；i18n 六语言补齐卡片文案，`toast.agentNoAgent` 去除证书字样
- 前端缓存版本 → 20261020a07

### 打印全链路排查修复（录入→打印→盘点 E2E 实测）

- **盘点对账归一化缺失（严重）**：`rfid-scan` 隔空盘点与手持机批量上传 `stocktake/upload` 原样拿 UHF 回读的芯片编码值（BCD+版本+校验 24 hex）直接对账，全部匹配不上、账面整单盘亏；补 `_norm_epc` 归一化（与协同盘点任务 `_do_scan` 同口径），芯片 hex 与明文 EPC 双格式实测均正确匹配。新旧 EPC 格式（字母前缀 ASCII-hex / 20 位数字 BCD）均兼容
- **补打条码漂移（严重）**：`print/labels` 每次打印都重新分配 12 位印刷条码并覆盖库存，已贴出标签的条码随即失效（扫码找不到商品）；改为条码仅在首次打印时分配，补打沿用原条码
- **`_epc_cfg` 兜底前缀位数不一致（防御）**：默认数字前缀从 10 位 `6901234567` 改为 8 位 `69012345`，与 `db.py` 迁移及 AGENTS 的 20 位 EPC 结构对齐（配置缺失的租户库不再生成 22 位异形 EPC）
- E2E 回归：录入自动分配 20 位 EPC → 打印 ZPL `^RFW` 写芯值与 `chip_epc_hex` 一致、`decode_chip_epc` 回读还原一致 → 盘点芯片 hex/明文双通 → 补打条码不变

### 标签模板收敛为单一 66mm 标准签

- 内置模板只保留「珠宝RFID标准签（66×25.4）」；「简约价签（条码66×25.4）」「EPC盘点签（66×25.4）」及旧版「标准标签」等全部列入幂等清理名单，启动时自动删除
- 清理前先解绑引用再删行，避免悬空；未绑定品类自动落到标准签（原逻辑保留）
- 老库升级即生效：`_ensure_builtin_label_templates` 每次启动幂等执行，25 个品类已全部绑定标准签

### 品类管理补齐「所属分组」读写（group_name）

- `main.py` `ProductTypeIn` 新增 `group_name` 字段（默认「主播希川」）；GET 返回、POST/PUT 写入 `group_name`，旧库默认已按「主播希川」回填（建表迁移已做）
- 电脑端品类管理：列表增加「所属分组」列，新增/编辑表单改为分组下拉（从已有品类动态聚合）
- 手机端品类管理：每条品类显示所属分组 tag；编辑表单「所属分组」= 常用分组下拉 + 自由输入（可存任意新分组名）；多语言 i18n 同步补齐
- 分组查询排序 `ORDER BY group_name, sort_order`，不同分组品类自然分组展示

### 看板出库 store_id 过滤补漏

- `main.py` dashboard_overview 区间出库 `r_out` 查询补 `AND (l.store_id=? OR l.store_id=0)`；入库 `r_in` 已有同条件，出库此前漏掉导致多门店场景跨店计算

## v1.2.49.261019（未发布）

### 客户应收（customers.due_amount）数据一致性修复

- `db.py` 新增 `_reconcile_customers_due()`，启动时（migrate_schema 末尾）从 sales + deposits 重算所有客户 due_amount，幂等、可覆盖历史脏数据；公式 = Σ MAX(0, amount-paid)（已冲红 sales 排除） + Σ balance（已定 deposits）
- `main.py` 定金冲红 `deposit_void` 补回 customers.total_amount / due_amount 回滚（之前只改 deposits 表，漏掉客户往来账，长期导致应收累积偏差）

## v1.2.48.261019（未发布）

### EPC 新格式 + 品类绑定（生成/锁定/编辑规则）

- EPC 改为 GS1 式 20 位纯数字：数字前缀(8,可配) + 门店码(4) + 品类码(2) + 序号(6)，各(门店+品类)独立计数（`_gen_type_epc`）；印刷条码同构 12 位纯数字（`_compute_item_barcode`，序号与 EPC 独立计数、同货号聚集连续）
- 新增商品保存即自动分配 EPC；**品类必选**（未选 400「请先选择品类再生成EPC」）；已生成 EPC 的商品**品类锁定**（改品类 400，需重新建档）；EPC 修改仅限「在库」状态、全库唯一（409），修改记审计日志
- 商品表单：品类标红星必填；已生成 EPC 后品类按钮 🔒 禁用（前端+服务端双重锁定）

### 打印 RFID 标签移入商品详情面板（新增/编辑共用）

- EPC 行新增「🖨 打印」按钮：新增态先自动保存（服务端分配 EPC）→ 弹确认框（品名/款号/EPC）→ 出纸，对应「录一件、打一张、贴一张」流程；保存成功后自动弹「立即打印标签」确认
- EPC 被手改 → 红色警示「保存后需重新打印标签并替换旧标签」；未保存改动时点打印被拦截（防标签与档案不一致）

### 标签模板化（3 个内建模板 + 品类绑定）

- 新增 `label_templates` 内建种子（`_ensure_builtin_label_templates`，按名字幂等）：**珠宝RFID标准签**（店名/品名/规格/价格/条码/证书/EPC条码+写芯）、**简约价签**（无 RFID）、**EPC盘点签**；未绑定模板的品类自动默认绑定标准签，品类管理可逐类改绑
- 打印链路统一走 `/api/print/labels`：按品类绑定模板逐件出 ZPL（无绑定回退默认布局），再按打印桥在线状态自动路由（桥→本地直打→云端）；打印次数照常累计
- 模板改版为实测纸型 **66×25.4 gap5**，内容收窄至左侧 25×25mm 可打印区（品名→价格→条码→EPC→规格），ZMIN X19D 真机验证出纸+写芯成功

### 商品录入弹窗与商品管理布局

- 录入/入库弹窗加宽至 780px；短值字段收窄：品类|材质|克重一行三列、尺寸|成本|售价一行三列；「状态+RFID EPC」行上移至价格策略卡片上方
- 商品管理：「打印标签 / 批量导入 / +新增商品 / 展开标签」同行居左于列表上方；业务说明独占整行；属性标签筛选改 `<details>` 折叠**默认收起**（选中显示「已选 N」）；「属性标签」更名「商品分类」

### 经营分析：金价面板合并

- 国际金价/本地金价合并为单面板（内部同一行显示），与【本月】时间选择同一行、宽度与下方 KPI 区对齐；窄屏自动隐藏更新时间/币种代码（悬停提示）

### 经营看板时间选择对齐销售分析

- 看板时间选择由下拉框改为与【销售分析】同款按钮页签组（今日/昨天/近7天/本月/近3个月/自定义），自定义区间带起止日期 + 查询；页签旁显示当前区间文本
- 默认区间由「近6个月」调整为「近3个月」（页签组内档位，与销售分析默认一致）；首屏同步写入当前区间，避免区间文本显示为空

### 待办提醒显示货号，点开直达单据详情

- 定金单提醒行显示锁定商品「货号」，借货提醒行显示借货货号；三类提醒（定金单/借货/维修）支持点击打开对应单据详情
- 定金单详情顶部展示锁定商品的**实物照 + 货号**，便于取货时核对；后端 `/api/dashboard/reminders` 定金单带出 `product_code`/`has_image`/`image_ts`
- 维修单表无商品字段，维修提醒暂无法显示货号（后续如需支持需为维修单增加商品关联）

### 定金单「编辑」修复

- 修复：定金单详情点「编辑」无对应处理分支，直接关闭面板（表现为"闪退"）；现改为打开编辑表单并真正保存
- 后端新增 `PUT /api/deposits/{did}`：仅「已定」单可编辑；已锁定商品不可更换；按新旧值差额回写客户累计消费/应收（不新建客户行）

### 其他

- 新增插件根 [AGENTS.md](AGENTS.md)（规则/入口/验证指引），整理 agents/print/AGENTS.md（删除过时裸 PCLE 序列与重复判据，修正 config.json 定位）
- 静态资源戳升 `20261019a04`（app.js）/ `20261019a02`（i18n.js）/ `20261019a06`（app.css）；版本 softwareVersion 1.2.48.261019（dataVersion 不变 1.2.24）

## v1.2.44（未发布）

### 手机端补齐【总部管理】五子页

- 「我的」页「系统」分组新增「总部管理」入口，含 5 个子 Tab 对齐电脑端：**总部信息**（基本信息编辑 + 展示开关）、**企业推广**（按语言录入 i18n 内容 + 官网预览）、**分店管理**（门店分组列表 + **新建/编辑门店**，名称必填、新增门店码 `^[A-Z0-9]{2}$`、编辑只读）、**品类管理**（增删改 + 计价模式）、**分类管理**（一级分类 tag_groups + 二级分类 product_tags 增删改 + 分组筛选）
- 复用既有接口：`/api/profile`、`/api/shops`、`/api/stores`、`/api/product-types`、`/api/tag-groups`、`/api/product-tags`、`/api/label-templates`；手机端 6 语言各补 71 键，静态资源戳升 `20261018b10`
- 分店管理的设备清单（打印/扫描/安防三组）未移植，仅保留门店基础信息

### 手机端【实销总额趋势】新增纵坐标

- 趋势图左侧新增 Y 轴：区间最大值均分 4 段（5 条刻度，0 ~ 最大值），刻度位置与柱高对齐；中文 ≥1万按「万」、其余语言 ≥1千按「k」缩写

### 标签打印适配 ZMIN X19D（结构化任务）

- ZMIN X19D 固件不识别 ZPL：`^XA` 文本经 SDK 透传「成功」但零出纸（假成功）。改走 PrintAgent 的 `printerType:"rfid"` 结构化任务（SDK 原生标签排版），模板 slot 点阵（300DPI）换算为 mm 坐标；无模板时回退固定版式
- `rfid_print.py` 新增 `build_zmin_content`/`_slot_to_content_el`；`main.py` `print_labels`/`_bridge_enqueue` 增加结构化任务下发路径

### 扫码 EPC 归一化（芯片 hex → 库内可读 EPC）

- 芯片里存的是编码 hex（前缀/门店段按 ASCII），库内 `rfid_epc` 存明文，二者无解码环节导致 UHF 扫 EPC 全落 `unknown`；另 Gen2 的 EPC 长度以 16 位字为单位，9 字节 EPC 会被写侧补 1 字节 `00` 到 10 字节
- `rfid_print.py` 新增 `decode_chip_epc`（逆变换 + 按 `biz_config` 规则自检 + 裁固件补零，认不出原样返回）；`main.py` 新增 `_norm_epc`，在扫描入库 `_do_scan` 与通用定位 `_resolve_product` 各归一化一次

### 演示数据修复：【经营分析】-【利润分析】成本口径

- 演示销售明细 `sale_items.product_id` 为空（旧种子按商品名匹配、短名对不上全名）导致成本算成 0、利润率虚高 100%；种子/补齐/明细改写为取销售单自带 `product_id`，并新增 `_ensure_sale_item_links` 幂等回填（仅演示单号生效，真实租户不受影响）
- 实测：默认区间 2026-10 利润率 100% → 18.4%；`sale_items` 空关联 11 → 0 行
- 版本 softwareVersion 1.2.44（dataVersion 不变 1.2.24）

## v1.2.43（未发布）

### 标签打印路由修复（USB 直连实测定位）

- 前端 `submitLabelPrint`：门店打印代理在线时优先 `route=agent` 经云端 WS 下发到代理（原逻辑只看 `printSupported`，STANDALONE 下误直发服务器本机打印机，选「打印桥」不出纸）；代理在线时跳过失效的本地直打步骤（旧 Python 桥 18080 端口，新 C# 助手为 18180 HTTPS）
- 静态资源戳升 `20261018a20`

### 助手产物统一到插件包 downloads/（各查各的 MD5 自升级）

- **落盘位置统一**：运维端上传的助手产物（扫描助手 APK / 打印助手 EXE）由原 `STORAGE_DIR/agents/`（跨版本持久）改为**直接写入插件包内 `downloads/`**——上传即就地覆盖、与下载接口同址取件，发布后立即对全租户生效；`.md5` sidecar、`.force` 强更标记、`manifest.json` 发布历史同目录存放（`ops_api.pub_dir()`）
- **下载链路**：`GET /api/scan-app/download` 与 `GET /api/print-agent/download` 统一从 `downloads/` 取件（保留各自开发构建产物兜底）
- **各查各的 MD5 自升级**：扫描助手沿用 `GET /api/scan-app/info`（md5/size/force）；打印助手新增 `GET /api/agent/version`（返回 `{md5,url,version}`，`url` 指向 `/api/print-agent/download`）——代理端以 md5 与本地比对决定是否下载
- **平台网关**：`_MACHINE_PATHS` 增列 `api/agent/version`，无 Cookie 代理端免鉴权可达
- **打包**：`build_package.py` 打包白名单移除 `downloads/`，插件包默认不再预置两个助手程序（改由运维端上传）
- 版本 softwareVersion 1.2.43（dataVersion 不变 1.2.24）

## v1.2.42（未发布）

### 【总部管理】五子页拆重构

- 原单一「总部管理」页拆为 5 个子 Tab：**总部信息**（修改总部基本信息/资料）、**企业推广**（多语言网站内容录入 + `/site` 预览）、**分店管理**（门店信息 + 门店卡片内展开设备清单：打印助手/扫描助手/安防设备三组）、**品类管理**（原品类管理原样搬入）、**分类管理**（原标签管理升级为两级）
- **分类管理两级化**：一级分类=标签类别，新增 `tag_groups` 表 + CRUD（可增删改；原固定枚举迁移为初始数据「风格/工艺/场景/客群/营销」，递增 dataVersion）；二级分类=标签（沿用 `product_tags`，`group_name` 校验改为查表并提示先创建分类）；改名同步标签 `group_name`、删除仅解绑标签不删标签
- **企业推广**：`GET/PUT /api/profile` 补 `i18n` 字段持久化（修复原未落库缺口）；`/site` 支持 6 语言渲染（`?lang=` → Accept-Language → zh；zh 环境下 tw/hk/mo → zhHant）
- 后端新增 `/api/tag-groups`（GET/POST/PUT/DELETE），并入 `_EXEC_ADMIN_PREFIXES` 执行权限
- 前端：`ST.shopsTab` + `switchShopsTab` + computed `shopsTabs`（修复 v-for 不能迭代 method 的空渲染）；6 语言补 `shops.tab.*` / `tagGroup.*` 等键；静态资源戳升 `20261017a2`
- 版本 softwareVersion 1.2.42 / dataVersion 1.2.24

## v1.2.41（未发布）

### 打印助手重写为 C# WinForms（PrintAgent）

- 打印助手 PrintBridge(Python) 重写为 C# 自包含 **PrintAgent**（.NET 8 WinForms）：打印机参数统一界面（标签规格按方案保存、打印/网络/蓝牙参数全局统一保存、列出可连接打印机、选中测试打印、EPC 结果自适应不遮挡）；对外下载名仍 `PrintBridge.exe`
- **门店 Key 实例级化**：新增 `print_agents` 表，`stores` 幂等移除 `store_key/scan_key`（dataVersion 1.2.23）；新增 `print-agent-key` / `print-agents` / `revoke` / `scan-device-key` / `scan-devices` 路由，移除 `bridge-key`
- 版本 softwareVersion 1.2.41 / dataVersion 1.2.23

## v1.2.40（未发布）

### 运维端高危写操作增加人脸确认

- 运维端「强制终止盘点任务 / 重置账号密码」两个高危写操作前置**人脸确认**：浏览器端用本地 face-api.js（tinyFaceDetector + 68 landmarks + recognition）提取 128 维特征，服务端纯 Python 欧氏距离 1:N 比对（阈值 0.5 严格档）
- 模板存 `STORAGE_DIR/face/`（`templates.json` + `emergency.key`），**特征永不下发浏览器**；无摄像头/非 HTTPS 时用应急口令（PBKDF2-SHA256，20 万轮加盐）兜底；验证方式写入运维审计
- 接口：`GET /api/ops/face/status`、`GET /api/ops/face/templates`、`POST /api/ops/face/enroll`（重名 400、≤20 个）、`DELETE /api/ops/face/templates/{tid}`（删完最后一个自动停用）、`POST /api/ops/face/emergency`
- 版本 softwareVersion 1.2.40（dataVersion 不变 1.2.22）

## v1.2.39（未发布）

### 运维端受控写操作 + 强制改密链路

- 运维端受控写操作（main.py 内实现，复用业务引擎、每笔二次确认 + 强制审计，action 前缀「运维端·」）：`GET /api/ops/tasks/active`（进行中任务）、`POST /api/ops/tasks/{tid}/terminate`（强制终止：抢占终态 → 有扫描生成部分盘点报告 → 释放设备 → 立即解冻）、`GET /api/ops/users`（永不回显密码）、`POST /api/ops/users/{uid}/reset-password`（生成 8 位随机密码仅回显一次）
- **强制改密（dataVersion 1.2.22）**：`users.must_change_pwd=1` 时 `_require_auth` 除登出/查我/改密外一律 403；PC 端登录即弹出不可关闭的改密遮罩；自助改密 `POST /api/auth/change-password`
- 版本 softwareVersion 1.2.39 / dataVersion 1.2.22

## v1.2.38（未发布）

### 运维端助手发布与操作审计

- 新增运维端 API 模块 `ops_api.py`（仅平台 `PRODUCTION_SUPPORT` 穿透可进，普通登录/沙箱 403）：只读巡检 `GET /api/ops/context|overview|devices|audit`
- 助手发布（写操作，强制审计）：`GET /api/ops/agents`（发布状态 + 历史）、`POST /api/ops/agents/publish`（multipart 上传：校验扩展名/≤30MB/空文件 → MD5 → 临时文件原子替换 → `.md5` sidecar → `manifest.json` → `operate_logs`）、`POST /api/ops/agents/scan/force`（强更开关）
- 下载链路「发布目录优先」接入 `GET /api/scan-app/download` 与 `GET /api/print-agent/download`；运维端独立站点 `ops/` 随包发布
- 版本 softwareVersion 1.2.38（dataVersion 不变 1.2.21）

## v1.2.37.261017（未发布）

### 网页版手机应用 mobile/（三阶段交付）

新增免安装手机网页版独立站点 `mobile/`（H5/PWA，与主 SPA 同色系金酒红调性），访问路径 `/app/jewelry/{tenant}/mobile/`：

- **阶段1 清理对齐**：i18n 扩至 6 语言（补 zhHant/ja/ko，navigator.language 自动识别）；删除后端不支持的登录租户框；角色名 i18n 化；补齐沙箱/生产运维模式横幅（主 SPA 同文案）；成本脱敏对齐（无权限显示 ***）
- **阶段2 精美化**：统一缓动变量；卡片/统计格/菜单组切页依次淡入动画；tab-bar 顶部金线与 sheet 抽屉金线呼应；登录卡金边；金额等宽数字 tabular-nums
- **阶段3 切换引导**：主 SPA 检测到移动设备 UA 时顶部金渐变横幅「检测到手机访问，手机网页版体验更佳」，跳转 /mobile（可关闭，localStorage 记住，6 语言文案）
- **布局策略**：主 SPA 布局仅按 UA 判定，PC 浏览器窗口收窄不再切换手机版（isPcLayout 去屏宽兜底、删 resize 监听）
- **静态版本**：主 SPA `20261016a113`；mobile `20261016b5`

### 看板与商品列表（同版本）

- **看板**：实销总额趋势卡独占一行且高度 140→112px；品类销售占比图例行与销售额统计行增加「在库 N 件」（后端 category-sales / tag-stats 接口补 stock_count）；销售额统计每行金额前加「销售额」名称、销售占比后加在库数，补全「标签」维度切换 chip（原 UI 缺失不可达）
- **商品列表**：修复标签两处重复渲染（名称下 ptag-row 与标签列）；标签默认不显示，列表上方新增「展开标签/收起标签」按钮，展开后标签同行 flex 排列；6 语言补 tag.expand/tag.collapse/tag.salesAmt

### 目录结构调整（同版本）

- **两个助手源码收归 `agents/`**：打印助手（`scripts/` 下 print_agent.py + PrintBridge.spec + build_exe.bat + 使用说明）整体迁入 `agents/print/`，扫描助手 Android 工程（Kotlin/Gradle）迁入 `agents/scan/`——原散落在 `scripts/` 的代理程序与安卓工程统一为独立构建线，`scripts/` 只保留平台数据任务脚本（init/upgrade/smoke）
- **统一四端命名**：主工作区 SPA / 网页版手机应用 `mobile/` / 运维端 `ops/` / 助手构建线 `agents/`（扫描 scan、打印 print）
- **打包规则**：`build_package.py` 排除整棵 `agents/`（含构建中间产物 build/dist），两个助手源码与产物均不入插件包；`STRUCTURE.md` 目录树与模块表同步更新

## v1.2.36.261016（未发布）

### 全局视觉升级（前端皮肤精致化）

在保持「金 #C9A961 + 酒红 #5C2233」品牌调性不变的前提下，对主工作区 SPA 全部页面进行统一质感升级。实现方式为在 `app.css` 末尾追加约 130 行覆盖层（静态版本 `20261016a109`），不改动任何既有选择器与页面结构，回归风险最小。

- **按钮**：主按钮/金色按钮新增柔和投影，hover 提亮并加深阴影，小按钮增加金色描边反馈
- **表单**：输入框/下拉/搜索框统一金色焦点光环（3px 外发光），hover 描边过渡
- **卡片**：统计卡、图表卡、提醒面板、商品卡、弹窗等统一双层阴影（`--shadow-card`），统计卡顶部增加高光渐变，快捷入口 hover 上浮
- **表格**：表头改为米白渐变 + 圆角 + 吸顶（sticky），新增隔行米色斑马纹，行 hover 金色高亮
- **侧栏导航**：选中项改为金色渐变胶囊 + 左侧金色指示条，hover 同步显示指示条
- **PC 顶栏**：半透明白 + 毛玻璃模糊（backdrop-filter）
- **弹窗**：头部米白渐变，弹出增加缩放过渡动画，遮罩阴影加深
- **排行榜**：前三名徽标升级为金/银/铜渐变，榜题改用酒红色
- **全局细节**：字体抗锯齿、金色文本选中色、8px 细滚动条、筛选 chips/标签 hover 金色反馈、卡片标题金色渐变分隔线、登录页投影强化

### 功能变更（同版本）

- **新增**：经营看板「前五排行」卡片——周转最快 / 利润率最高 / 销量最多 / 会员消费最多 / 店员销售最多 / 滞销品 / 品类销售额最高，共 7 个 TOP5 榜，自带时间段下拉（默认近6月；周转/滞销为库存实时口径）
- **调整**：「销售额统计」卡片维度按钮重构为品类/标签双 chip 切换（标签维度含库存双口径：在库数/库存成本）
- **种子数据补强**（仅全新演示库生效）：销售单补店员名、商品到货日按首销日前 6~26 天错开、修正 2 条销售的商品关联错位
- **测试台账**：TC-46 入册（排行榜口径对账 + 种子验证 + 浏览器走查结论）
