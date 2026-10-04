/* 懿臻珠宝云 · 多语言支持（中文 + 英文）
 * 回退：目标语言缺词时自动回退到中文
 */

var LANG_MAP = {
  'zh-Hans': 'zh', 'zh': 'zh', 'en': 'en'
};

var LANG_LABELS = {
  'zh-Hans': '简体中文', 'en': 'English'
};

var LANG_KEYS = ['zh-Hans', 'en'];

var I18N = {
  zh: {
    // nav
    'nav.dashboard': '经营看板', 'nav.products': '商品管理', 'nav.inventory': '库存管理',
    'nav.sales': '销售开单', 'nav.deposits': '定金尾款', 'nav.loans': '借货管理',
    'nav.customers': '客户管理', 'nav.repairs': '维修管理', 'nav.purchases': '采购管理',
    'nav.outsourcings': '委外加工', 'nav.logs': '操作日志', 'nav.appointments': '到店预约',
    'nav.profile': '店铺资料', 'nav.site': '迷你网站', 'nav.sale': '快速开单',
    'nav.logout': '退出登录', 'nav.more': '我的', 'nav.rfid': 'RFID盘点', 'nav.showcase': '橱窗展示',
    // login
    'login.user': '用户名', 'login.userPh': '请输入用户名', 'login.pass': '密码',
    'login.passPh': '请输入密码', 'login.submit': '登 录', 'login.hint': '演示账号：admin / 123456',
    'login.title': '懿臻珠宝云', 'login.sub': 'Jewelry Cloud · 独立工作台',
    'login.err': '用户名或密码错误', 'login.success': '登录成功',
    // kpi
    'kpi.stock': '在库商品', 'kpi.today': '今日销售', 'kpi.month': '本月销售',
    'kpi.due': '尾款待收', 'kpi.trend': '近6月销售趋势', 'kpi.todo': '待办提醒',
    'kpi.recent': '最近销售', 'kpi.quick': '快捷入口', 'kpi.catSales': '近6月品类销售占比',
    'kpi.stockCost': '成本', 'kpi.todayCount': '笔', 'kpi.unit': '元',
    // cats
    'cat.all': '全部', 'cat.gold': '黄金', 'cat.diamond': '钻石', 'cat.jade': '翡翠',
    'cat.platinum': '铂金', 'cat.gemstone': '彩宝', 'cat.other': '其他',
    // actions
    'act.add': '新增商品', 'act.edit': '编辑', 'act.del': '删除', 'act.print': '打印标签',
    'act.void': '冲红', 'act.payBal': '收尾款', 'act.deposit': '收定金',
    'act.clear': '清除', 'act.save': '保存', 'act.cancel': '取消', 'act.confirm': '确认',
    'act.submit': '确认提交', 'act.export': '导出CSV', 'act.inbound': '入库', 'act.copy': '复制入库',
    'act.copyNew': '复制新增',
    'act.scan': '盘点', 'act.return': '归还', 'act.receive': '入库', 'act.takeDelivery': '收货',
    'act.close': '关闭', 'act.viewSite': '查看网站', 'act.acceptAppt': '接受预约',
    // inv
    'inv.in': '入库', 'inv.copy': '复制', 'inv.copyHint': '在库商品（点【复制】以它为模板快速登记同款新货）',
    'inv.tabStock': '在库商品', 'inv.tabCount': '库存盘点',
    'inv.freezeTip': '⚠ 盘点任务进行中，销售与出入库已冻结。请到「库存盘点」页签处理，完成后自动恢复。',
    'inv.frozenBanner': '盘点进行中，销售与出入库已冻结，点击前往处理：',
    'inv.frozenBlock': '盘点任务进行中，该操作已冻结。请先完成盘点核对或强制终止任务。',
    'inv.scan': '盘点', 'inv.stock': '在库', 'inv.reserved': '已定', 'inv.loaned': '借出', 'inv.sold': '已售',
    'inv.scanSim': '模拟高频扫描', 'inv.scanStart': '开始盘点', 'inv.scanResult': '盘点结果',
    'inv.scanned': '已感应', 'inv.bookCount': '账面', 'inv.surplus': '盘盈', 'inv.shortage': '盘亏',
    'inv.scanTip': '点击「开始盘点」模拟 RFID 高频读写器批量感应',
    // ph
    'ph.searchProd': '搜索商品名称/编码/EPC...',
    'ph.customer': '客户姓名', 'ph.phone': '手机号', 'ph.product': '商品名称',
    'ph.code': '商品编码', 'ph.amount': '金额', 'ph.paid': '实收',
    // empty
    'empty.prod': '暂无商品', 'empty.sale': '暂无销售记录', 'empty.dep': '暂无定金记录',
    'empty.loan': '暂无借货记录', 'empty.repair': '暂无维修记录', 'empty.cust': '暂无客户数据',
    'empty.pur': '暂无采购记录', 'empty.out': '暂无委外加工记录', 'empty.log': '暂无操作记录',
    'empty.appt': '暂无预约，可从公开页 /site 提交', 'empty.todo': '暂无待办',
    // sheet
    'sheet.sale': '快速开单', 'sheet.product': '商品信息', 'sheet.inbound': '入库登记',
    'sheet.deposit': '收定金', 'sheet.loan': '新增借货', 'sheet.repair': '接维修单',
    'sheet.purchase': '新增采购', 'sheet.outsource': '新增委外加工', 'sheet.customer': '客户信息',
    'sheet.rfid': 'RFID 隔空盘点',
    // form labels
    'lbl.code': '编码', 'lbl.name': '名称', 'lbl.category': '品类', 'lbl.material': '材质',
    'lbl.weight': '克重', 'lbl.size': '尺寸', 'lbl.cost': '成本', 'lbl.price': '售价',
    'lbl.cert': '证书号', 'lbl.status': '状态', 'lbl.epc': 'RFID EPC', 'lbl.showcase': '允许上橱窗',
    'lbl.customer': '客户', 'lbl.phone': '手机号', 'lbl.product': '商品',
    'lbl.amount': '金额', 'lbl.paid': '实收', 'lbl.method': '支付方式', 'lbl.date': '日期',
    'lbl.total': '总价', 'lbl.deposit': '定金', 'lbl.balance': '尾款', 'lbl.promisedDate': '交货日期',
    'lbl.reminderDays': '提前提醒(天)', 'lbl.direction': '方向', 'lbl.party': '对方',
    'lbl.qty': '数量', 'lbl.loanDate': '借出日期', 'lbl.dueDate': '应还日期',
    'lbl.item': '物品', 'lbl.issue': '问题', 'lbl.estFee': '预估费', 'lbl.actualFee': '实收费',
    'lbl.receiveDate': '收件日期', 'lbl.promisedDate2': '预约完成', 'lbl.technician': '师傅',
    'lbl.supplier': '供应商', 'lbl.factory': '加工厂', 'lbl.goldPrice': '金价', 'lbl.laborFee': '工费',
    'lbl.sendDate': '发出日期', 'lbl.expectedDate': '预计到货', 'lbl.orderDate': '下单日期',
    'lbl.level': '等级', 'lbl.birthday': '生日', 'lbl.preference': '偏好',
    'lbl.out': '借出', 'lbl.in': '借入', 'lbl.remark': '备注', 'lbl.highValue': '高价值',
    'lbl.name2': '姓名', 'lbl.contact': '联系人', 'lbl.contactType': '联系方式',
    'lbl.wantDate': '期望日期', 'lbl.wantSlot': '期望时段',
    // statuses
    'st.inStock': '在库', 'st.reserved': '已定', 'st.sold': '已售', 'st.loaned': '借出',
    'st.done': '已完成', 'st.voided': '已冲红', 'st.pending': '待维修', 'st.repairing': '维修中',
    'st.waitTake': '待取件', 'st.shipping': '待发货', 'st.inTransit': '运输中', 'st.received': '已入库',
    'st.processing': '加工中', 'st.delivered': '已收货', 'st.loanOut': '借出中', 'st.loanIn': '借入中',
    'st.returned': '已归还', 'st.writeOff': '已核销', 'st.confirmed': '已确认', 'st.cancelled': '已取消',
    // toast
    'toast.saveOk': '保存成功', 'toast.delOk': '已删除', 'toast.voidOk': '已冲红',
    'toast.payOk': '尾款已收，已转正式单', 'toast.loginOk': '登录成功', 'toast.fillForm': '请填写必填项',
    'toast.epcWritten': 'RFID EPC 已写入', 'toast.printOk': '标签打印完成',
    'toast.scanOk': '盘点完成', 'toast.apptOk': '预约已确认', 'toast.noProdFile': '该条目无商品档案（盘盈/异常项）',
    'toast.fillFactory': '请填写加工厂', 'toast.fillSupplier': '请填写供应商',
    'toast.fillCustomer': '请填写客户姓名', 'toast.fillProduct': '请填写商品名称',
    'toast.fillCode': '请填写商品编码', 'toast.fillAmount': '请填写金额',
    'toast.saveFirst': '请先保存商品再生成EPC', 'toast.epcGenOk': 'EPC 已生成：', 'toast.epcReused': '已存在EPC：',
    'toast.fillCatCode': '请填写分类编码', 'toast.fillCatName': '请填写分类名称（中文或英文）',
    'toast.returnOk': '已归还，库存已恢复', 'toast.receiveOk': '已收货入库',
    'toast.custSaveOk': '客户已保存', 'toast.profileSaveOk': '店铺资料已保存',
    'toast.exportOk': '已导出CSV', 'toast.apptAcceptOk': '预约已接受',
    // 标签打印/协同盘点补充提示（zh only，英文待后续补齐）
    'toast.pickLabel': '请先选择要打印的商品',
    'toast.printSent': '已发送到打印机', 'toast.zplDone': 'ZPL 指令已生成',
    'toast.coStarted': '盘点任务已开启，请手持机扫码加入',
    'toast.coEndReview': '已核对，请查看差异并确认',
    'toast.coDone': '盘点完成，销售已恢复',
    'toast.coAborted': '任务已强制终止，销售已恢复',
    'toast.coUrlCopied': '加入地址已复制',
    'co.cfStart': '开启盘点任务后，本店销售与出入库将暂停，直到主管核对确认。确定开启？',
    'co.cfEnd': '确定结束扫描？\n\n结束后：手持机停止上传，系统合并各设备扫描结果并生成差异（相符/盘亏/异常）供你核对。\n注意：销售与出入库仍然冻结，核对无误后需再点【核对确认，解除销售冻结】才会恢复营业。',
    'co.cfReview': '差异核对无误？确认后解除销售/出入库冻结，任务完成。',
    'co.cfAbort': '【强制终止任务】\n\n立即解除销售/出入库冻结，本次盘点不生成核对结果，已扫描数据仅作记录。确定终止？',
    // print
    'print.fold': '对折标签', 'print.hangtag': '挂绳标签', 'print.rfid': 'RFID芯片标签',
    'print.copies': '打印份数', 'print.preview': '打印预览', 'print.print': '打印',
    'print.close': '关闭', 'print.template': '标签模板', 'print.printer': '打印机',
    // support
    'support.banner': '生产运维穿透模式 · 所有修改将写入审计日志',
    // misc
    'misc.unit': '元', 'misc.pcs': '件', 'misc.bills': '笔',
    'misc.tenant': '租户', 'misc.operator': '操作人', 'misc.action': '操作', 'misc.target': '目标',
    'misc.time': '时间', 'misc.result': '结果', 'misc.store': '门店',
    'misc.role.admin': '店长', 'misc.role.staff': '店员',
    // remind
    'remind.deposits': '定金尾款到期', 'remind.loansOverdue': '借货逾期',
    'remind.repairsPending': '维修待处理', 'remind.days': '天前',
    // site
    'site.title': '迷你网站', 'site.slogan': '懿德 · 臻品 · 云智',
    'site.intro': '面向中高端珠宝门店的数智化经营', 'site.gallery': '门店图集',
    'site.appointment': '到店预约', 'site.products': '商品橱窗',
    'site.contact': '联系我们', 'site.hours': '营业时间', 'site.address': '门店地址',
    'site.name': '店铺名称', 'site.shortName': '简称', 'site.phone': '联系电话',
    'site.wantDate': '期望到店日期', 'site.wantSlot': '期望时段',
    'site.morning': '上午', 'site.afternoon': '下午', 'site.evening': '晚上',
    'site.submitAppt': '提交预约', 'site.apptOk': '预约已提交，我们将尽快与您联系',
    'site.back': '返回工作台',
    // biz 业务说明（默认收起，点击展开）
    'biz.title': '业务说明',
    'biz.dashboard': '看板是开店后的第一屏：在库商品数量与成本、今日/本月销售、尾款待收，一屏掌握经营概况。\n近 6 月销售趋势柱图用于观察淡旺季走势。\n待办提醒聚合三类事项：定金尾款到期、借货逾期、维修待处理，点标题可展开明细。\n所有数据由业务单据实时汇总，无需手工维护。',
    'biz.products': '商品是全店业务的档案基础，一物一码：商品编码唯一，RFID EPC 与商品一一对应。\n【新增商品】= 建档入口：编码需手工填写、EPC 可留空，可设置状态、是否上橱窗、⭐高价值标记，适合单品精细建档。\n【复制新增】= 以现有商品为模板快速建档：品类/材质/克重/成本/售价等全部预填，只需填新编码（EPC 可留空），保存即得新品，适合同款多色/多尺寸的系列录入。\n【入库】在「库存管理」页：收货入账入口，编码与 EPC 留空时系统自动生成，固定「在库」、不上橱窗，适合新货批量快速上柜。\n状态流转：在库 → 已定（收定金锁定）→ 已售；借出归还后自动恢复在库。\n⭐高价值商品：盘点时未扫到会置顶提醒，防止贵重货品漏盘。\n勾选「允许上橱窗」后，商品将同步到迷你网站对外展示。',
    'biz.inventory': '库存概况四个口径：在库（数量+成本）、已定锁定、借出、已售。\n【入库登记】新货快速入账：编码/EPC 留空自动生成，入库即带电子标签。\n【复制入库】参照在库商品一键复制，编码与 EPC 自动换新，适合同款批量录入。\n【盘点任务】全店唯一盘点入口：主管开启任务 → 销售/出入库自动冻结 → 各手持机扫码加入并下载商品快照 → 按住扳机批量扫 EPC 自动上传 → 主管结束扫描并核对差异 → 确认后解冻。\n盘点期间销售与出入库暂停；手持机故障或误开任务时，用【强制终止任务】立即解冻（不生成盘点结果）。\n盘点结果分三类：相符 / 盘亏 / 异常，历史批次与逐条明细可在本页查询。',
    'biz.sales': '开单即售货：选择在库商品或自定义名称，填金额与实收，自动生成单号，商品状态转「已售」。\n实收小于金额时，差额记为该客户欠款，自动累计到客户档案。\n【冲红】用于撤销错单：原单保留并标记「已冲红」，商品恢复在库，金额不再计入销售。\n开单时填写的客户姓名+手机号会自动建档到「客户管理」。',
    'biz.deposits': '定金单用于「先收定金、后取货」的预留/定制业务。\n收定金时可锁定一件在库商品（状态转「已定」，他人无法再售），也可不锁定做无现货定制。\n尾款 = 总价 − 定金，系统自动计算；交期临近会进入看板待办提醒。\n【收尾款】客户付清后一键转正式销售单，锁定商品转「已售」。\n【冲红】取消订单：单据标记已冲红，锁定的商品自动恢复在库。',
    'biz.loans': '管理同行/客户间的借出与借入：借出减少可售库存，借入记录临时货源。\n借出时填在库商品编码，商品状态转「借出」。\n【归还/核销】借出归还后商品自动恢复在库；借入归还仅核销记录。\n超过应还日期未归还的，进入看板「借货逾期」待办提醒。',
    'biz.repairs': '维修单跟踪售后维修全流程：待维修 → 维修中 → 待取件 → 已完成。\n接件时登记客户、物品、问题与预估费，完工后补填实收费。\n待维修/维修中的单据会进入看板待办提醒，防止遗漏。\n点【更新状态】逐步推进流程，每次操作自动留痕。',
    'biz.purchases': '采购单跟踪向供应商进货：下单（待发货）→ 确认入库。\n【确认入库】后系统自动创建商品档案并生成 RFID EPC，直接进入在库，无需二次建档。\n记录成本与已付金额，便于与供应商对账。',
    'biz.outsourcings': '委外加工跟踪从发料到回收：发料（加工中）→ 收货入库。\n成本 = 金价 × 克重 + 工费，系统自动核算。\n【收货入库】后自动生成商品档案与 RFID EPC，进入在库。',
    'biz.customers': '客户档案在销售/定金开单时按「姓名+手机号」自动建档，也可手工新增。\n系统自动累计每位客户的消费总额与欠款（销售单实收不足部分）。\n等级、生日、偏好信息用于会员分层营销与回访。',
    'biz.appointments': '客人在迷你网站（/site）自助提交到店预约，在此集中查看与跟进。\n状态流转：已联系 → 已到店 → 已成交，点按钮即更新。\n预约含期望到店日期与时段，便于安排接待。',
    'biz.profile': '店铺资料（名称、口号、简介、电话、地址、营业时间）会同步展示到迷你网站。\n修改后点保存即生效，客人打开 /site 即可看到最新信息。',
    'biz.logs': '全店关键操作自动留痕：谁、在什么时间、对什么做了什么。\n可按时间回溯业务变动，支持一键导出 CSV 备查。',
    'biz.more': '「我的」汇集个人中心入口：客户、借货、维修、采购、委外、日志等管理页，以及店铺资料与迷你网站预览。\n电脑端这些功能在左侧导航直达。',
    // 通用
    'common.yes': '是', 'common.no': '否', 'common.copy': '复制', 'common.refresh': '刷新',
    'common.detail': '明细', 'common.op': '操作', 'common.time': '时间', 'common.device': '设备',
    'common.expected': '期望：', 'common.overdue': '逾期', 'common.cost': '成本',
    // 表头 / 列
    'th.showcase': '橱窗', 'th.highValue': '高价值', 'th.material': '材质',
    'th.device': '设备', 'th.devName': '名称', 'th.lastSeen': '最近在线',
    'th.batchNo': '批次号', 'th.scanBook': '扫描/账面', 'th.matched': '相符', 'th.shortage': '盘亏', 'th.abnormal': '异常',
    'th.result': '结果', 'th.goodsNo': '货号', 'th.goods': '商品', 'th.bookStatus': '账面状态',
    // 看板
    'dash.cost': '成本', 'dash.bills': '笔', 'dash.birthday': '生日', 'dash.due': '待付',
    'q.products': '商品', 'q.inventory': '库存', 'q.sales': '销售', 'q.deposits': '定金',
    'q.loans': '借货', 'q.repairs': '维修', 'q.customers': '客户', 'q.logs': '日志',
    // 商品/库存按钮
    'act.labelPrint': '🏷 排版打印', 'act.labelLayout': '🏷 标签排版',
    'act.genEpc': '生成EPC', 'act.addNew': '新增', 'act.accept': '接件', 'act.purchase': '采购',
    'act.sendOut': '发料', 'act.addCustomer': '客户', 'act.updateStatus': '更新状态',
    'act.returnWriteOff': '归还/核销', 'act.confirmReceive': '确认入库', 'act.receiveStock': '收货入库',
    'act.allowShowcase': '允许上橱窗',
    'hv.hint': '⭐ 高价值商品（盘点时未扫到将置顶提醒）',
    // 库存概况
    'inv.reservedLocked': '已定锁定',
    // 协同盘点任务
    'co.taskTitle': '🧭 盘点任务',
    'co.desc': '主管开启任务后销售/出入库自动暂停，并生成唯一的盘点二维码；各手持机用 App 扫此码即领取任务（自动配置服务地址、加入并下载商品快照），再在手持机上点【开始盘点】；全部结束后主管核对确认，解除冻结。',
    'co.hostPh': '主机地址（自动检测；如 192.168.1.20:8002）',
    'co.start': '开启盘点任务', 'co.task': '任务', 'co.joinUrl': '手持机加入地址（扫码自动配置）',
    'co.deviceNo': '号机', 'co.submitted': '已提交', 'co.scanning': '盘点中', 'co.noDevice': '尚无手持机加入',
    'co.scanned': '扫描', 'co.book': '账面',
    'co.endScan': '结束扫描并核对', 'co.confirm': '核对确认，解除销售冻结', 'co.abort': '强制终止任务',
    'co.abortHint': '手持机故障/扫不到/误开任务时点此立即解冻',
    'co.qrAlt': '盘点任务二维码', 'co.qrLoading': '二维码加载中…',
    'co.qrCap': '手持机扫码领取任务', 'co.qrCap2': '领取后在设备上点【开始盘点】',
    'co.totalScanned': '全局已扫', 'co.recentBatches': '最近盘点批次',
    'co.statusRunning': '进行中', 'co.statusReview': '待核对',
    'co.batchTitle': '盘点批次',
    // 销售
    'sale.pay': '支付', 'sale.stockItem': '在库商品', 'sale.customName': '自定义名称', 'sale.productName': '商品名称',
    'pay.cash': '现金', 'pay.wechat': '微信', 'pay.card': '刷卡', 'pay.transfer': '转账',
    // 定金
    'dep.paid': '已付', 'dep.lockHint': '锁定在库商品（可选）', 'dep.noStock': '无现货定制',
    // 借货
    'loan.codePh': '借出请填在库编码',
    // 客户
    'cust.normal': '普通', 'cust.silver': '银卡', 'cust.gold': '金卡',
    'cust.empty': '暂无客户，可从销售/定金开单时自动建档', 'cust.emptyShort': '暂无客户',
    // 预约
    'appt.want': '期望：', 'appt.contacted': '已联系', 'appt.arrived': '已到店', 'appt.done': '已成交',
    'appt.pending': '待联系', 'appt.emptyM': '暂无预约，访客可从公开页 /site 自助提交',
    // 店铺资料 / EPC / 分类管理
    'pf.name': '名称', 'pf.slogan': '口号', 'pf.intro': '简介', 'pf.phone': '电话',
    'pf.hours': '营业时间', 'pf.address': '地址', 'pf.previewSite': '预览迷你网站',
    'epc.title': 'EPC 编码规则', 'epc.prefix': '前缀', 'epc.seqBits': '序号位数（1-8）',
    'epc.hint': 'EPC = 前缀 + 分类码 + 序号（十六进制）。例如 E280 + 01 + 00000001', 'epc.save': '保存规则',
    'cat.mgrTitle': '商品分类管理', 'cat.title': '商品分类', 'cat.zhName': '中文名', 'cat.enName': '英文名',
    'cat.sort': '排序', 'cat.saveEdit': '保存修改', 'cat.addNew': '新增分类', 'cat.codePh': '如 08',
    // 标签排版弹窗
    'label.title': '🏷 RFID 标签排版打印',
    'label.pick': '打印商品（70×35mm / 300dpi · 得实 DL-735RE）',
    'label.empty': '尚未选择，可从下方添加，或去商品列表点「排版打印」',
    'label.add': '＋ 添加在库商品…', 'label.fields': '标签内容字段',
    'label.printer': '打印机', 'label.selPrinter': '— 请选择 —', 'label.noPrinter': '未检测到打印机',
    'label.copies': '份数', 'label.font': '机内中文字体（^A@ 字体名，按打印机实际配置）',
    'label.writeEpc': '同时写入 RFID 芯片 EPC（^RFW）',
    'label.simulate': '仅生成 ZPL 指令（不实际打印，用于预览/调试）',
    'label.sent': '已发送', 'label.sheetsTo': '张到', 'label.genSim': '已生成', 'label.sheetsCmd': '张标签指令（模拟）',
    'label.viewZpl': '查看 ZPL 指令', 'label.sending': '发送中…', 'label.genZpl': '生成 ZPL 指令', 'label.print': '打印标签',
    'label.fld.store': '门店名称', 'label.fld.name': '商品名称', 'label.fld.spec': '材质克重',
    'label.fld.price': '售价', 'label.fld.cert': '证书号', 'label.fld.barcode': '货号条码', 'label.fld.epcText': 'EPC明文',
    // 盘点结果明细
    'sd.scanBook': '扫描', 'sd.book2': '账面',
    // 状态（补充）
    'st.apptPending': '待联系', 'st.apptContacted': '已联系', 'st.apptArrived': '已到店', 'st.apptDone': '已成交',
    // 表单/底部栏/RFID 补充
    'lbl.mobile': '手机',
    'form.nameLangTitle': '选择名称语言：绿色=已录入，红色=未录入',
    'form.hvHint': '⭐ 高价值商品（盘点时未扫到将置顶提醒）',
    'rfid.hint': '独立运行时可用「模拟扫描」读取全部已写入 EPC 的在库标签；也可粘贴读写器回传的 EPC 列表。',
    'rfid.epcPh': 'EPC（每行一个）',
    'rfid.sensed': '感应',
    'tab.dashboard': '看板', 'tab.products': '商品', 'tab.deposits': '定金', 'tab.mine': '我的',
    'act.updateShort': '更新', 'act.receiveShort': '入库', 'act.takeShort': '收货', 'act.returnShort': '归还',
  },

  en: {
    // nav
    'nav.dashboard': 'Dashboard', 'nav.products': 'Products', 'nav.inventory': 'Inventory',
    'nav.sales': 'Sales', 'nav.deposits': 'Deposits', 'nav.loans': 'Loans',
    'nav.customers': 'Customers', 'nav.repairs': 'Repairs', 'nav.purchases': 'Purchasing',
    'nav.outsourcings': 'Outsourcing', 'nav.logs': 'Audit Logs', 'nav.appointments': 'Appointments',
    'nav.profile': 'Store Profile', 'nav.site': 'Mini Site', 'nav.sale': 'New Sale',
    'nav.logout': 'Sign Out', 'nav.more': 'Me', 'nav.rfid': 'RFID Count', 'nav.showcase': 'Showcase',
    // login
    'login.user': 'Username', 'login.userPh': 'Enter username', 'login.pass': 'Password',
    'login.passPh': 'Enter password', 'login.submit': 'Sign In', 'login.hint': 'Demo: admin / 123456',
    'login.title': 'Jewelry Cloud', 'login.sub': 'Independent Workspace',
    'login.err': 'Invalid username or password', 'login.success': 'Signed in',
    // kpi
    'kpi.stock': 'In Stock', 'kpi.today': "Today's Sales", 'kpi.month': 'Monthly Sales',
    'kpi.due': 'Pending Balance', 'kpi.trend': '6-Month Trend', 'kpi.todo': 'Reminders',
    'kpi.recent': 'Recent Sales', 'kpi.quick': 'Quick Actions', 'kpi.catSales': 'Category Sales Share (6M)',
    'kpi.stockCost': 'Cost', 'kpi.todayCount': 'bills', 'kpi.unit': '',
    // cats
    'cat.all': 'All', 'cat.gold': 'Gold', 'cat.diamond': 'Diamond', 'cat.jade': 'Jade',
    'cat.platinum': 'Platinum', 'cat.gemstone': 'Gemstone', 'cat.other': 'Other',
    // actions
    'act.add': 'Add Product', 'act.edit': 'Edit', 'act.del': 'Delete', 'act.print': 'Print Label',
    'act.void': 'Void', 'act.payBal': 'Pay Balance', 'act.deposit': 'Take Deposit',
    'act.clear': 'Clear', 'act.save': 'Save', 'act.cancel': 'Cancel', 'act.confirm': 'Confirm',
    'act.submit': 'Submit', 'act.export': 'Export CSV', 'act.inbound': 'Inbound', 'act.copy': 'Copy',
    'act.copyNew': 'Copy & Add',
    'act.scan': 'Count', 'act.return': 'Return', 'act.receive': 'Receive', 'act.takeDelivery': 'Take Delivery',
    'act.close': 'Close', 'act.viewSite': 'View Site', 'act.acceptAppt': 'Accept',
    // inv
    'inv.in': 'Inbound', 'inv.copy': 'Copy', 'inv.copyHint': 'In-stock items (click [Copy] to register a same-style new item from it as template)',
    'inv.tabStock': 'In-stock Items', 'inv.tabCount': 'Stocktaking',
    'inv.freezeTip': '⚠ Stocktaking in progress: sales and inbound/outbound are frozen. Go to the "Stocktaking" tab to finish it.',
    'inv.frozenBanner': 'Stocktaking in progress: sales and inbound/outbound frozen. Tap to handle: ',
    'inv.frozenBlock': 'A stocktaking task is active; this action is frozen. Please finish or abort the task first.',
    'inv.scan': 'Count', 'inv.stock': 'In Stock', 'inv.reserved': 'Reserved', 'inv.loaned': 'Loaned', 'inv.sold': 'Sold',
    'inv.scanSim': 'Simulate HF Scan', 'inv.scanStart': 'Start Count', 'inv.scanResult': 'Count Results',
    'inv.scanned': 'Scanned', 'inv.bookCount': 'Book Count', 'inv.surplus': 'Surplus', 'inv.shortage': 'Shortage',
    'inv.scanTip': 'Click "Start Count" to simulate RFID HF reader batch scanning',
    // ph
    'ph.searchProd': 'Search name/code/EPC...',
    'ph.customer': 'Customer name', 'ph.phone': 'Phone', 'ph.product': 'Product',
    'ph.code': 'Product code', 'ph.amount': 'Amount', 'ph.paid': 'Paid',
    // empty
    'empty.prod': 'No products', 'empty.sale': 'No sales', 'empty.dep': 'No deposits',
    'empty.loan': 'No loans', 'empty.repair': 'No repairs', 'empty.cust': 'No customers',
    'empty.pur': 'No purchases', 'empty.out': 'No outsourcings', 'empty.log': 'No logs',
    'empty.appt': 'No appointments', 'empty.todo': 'No reminders',
    // sheet
    'sheet.sale': 'New Sale', 'sheet.product': 'Product Info', 'sheet.inbound': 'Inbound',
    'sheet.deposit': 'Take Deposit', 'sheet.loan': 'New Loan', 'sheet.repair': 'New Repair',
    'sheet.purchase': 'New Purchase', 'sheet.outsource': 'New Outsource', 'sheet.customer': 'Customer',
    'sheet.rfid': 'RFID Count',
    // form labels
    'lbl.code': 'Code', 'lbl.name': 'Name', 'lbl.category': 'Category', 'lbl.material': 'Material',
    'lbl.weight': 'Weight', 'lbl.size': 'Size', 'lbl.cost': 'Cost', 'lbl.price': 'Price',
    'lbl.cert': 'Cert No.', 'lbl.status': 'Status', 'lbl.epc': 'RFID EPC', 'lbl.showcase': 'Showcase',
    'lbl.customer': 'Customer', 'lbl.phone': 'Phone', 'lbl.product': 'Product',
    'lbl.amount': 'Amount', 'lbl.paid': 'Paid', 'lbl.method': 'Method', 'lbl.date': 'Date',
    'lbl.total': 'Total', 'lbl.deposit': 'Deposit', 'lbl.balance': 'Balance', 'lbl.promisedDate': 'Promise Date',
    'lbl.reminderDays': 'Remind (days)', 'lbl.direction': 'Direction', 'lbl.party': 'Party',
    'lbl.qty': 'Qty', 'lbl.loanDate': 'Loan Date', 'lbl.dueDate': 'Due Date',
    'lbl.item': 'Item', 'lbl.issue': 'Issue', 'lbl.estFee': 'Est. Fee', 'lbl.actualFee': 'Actual Fee',
    'lbl.receiveDate': 'Receive Date', 'lbl.promisedDate2': 'Promise Date', 'lbl.technician': 'Tech',
    'lbl.supplier': 'Supplier', 'lbl.factory': 'Factory', 'lbl.goldPrice': 'Gold Price', 'lbl.laborFee': 'Labor Fee',
    'lbl.sendDate': 'Send Date', 'lbl.expectedDate': 'Expected', 'lbl.orderDate': 'Order Date',
    'lbl.level': 'Level', 'lbl.birthday': 'Birthday', 'lbl.preference': 'Preference',
    'lbl.out': 'Out', 'lbl.in': 'In', 'lbl.remark': 'Remark', 'lbl.highValue': 'High Value',
    'lbl.name2': 'Name', 'lbl.contact': 'Contact', 'lbl.contactType': 'Contact Type',
    'lbl.wantDate': 'Want Date', 'lbl.wantSlot': 'Want Slot',
    // statuses
    'st.inStock': 'In Stock', 'st.reserved': 'Reserved', 'st.sold': 'Sold', 'st.loaned': 'Loaned',
    'st.done': 'Completed', 'st.voided': 'Voided', 'st.pending': 'Pending', 'st.repairing': 'Repairing',
    'st.waitTake': 'Wait Pickup', 'st.shipping': 'Pending', 'st.inTransit': 'In Transit', 'st.received': 'Received',
    'st.processing': 'Processing', 'st.delivered': 'Delivered', 'st.loanOut': 'Lent Out', 'st.loanIn': 'Borrowed',
    'st.returned': 'Returned', 'st.writeOff': 'Written Off', 'st.confirmed': 'Confirmed', 'st.cancelled': 'Cancelled',
    // toast
    'toast.saveOk': 'Saved', 'toast.delOk': 'Deleted', 'toast.voidOk': 'Voided',
    'toast.payOk': 'Balance paid, converted to sale', 'toast.loginOk': 'Signed in', 'toast.fillForm': 'Please fill required fields',
    'toast.epcWritten': 'RFID EPC written', 'toast.printOk': 'Label printed',
    'toast.scanOk': 'Count completed', 'toast.apptOk': 'Appointment confirmed', 'toast.noProdFile': 'No product file (surplus/abnormal item)',
    'toast.fillFactory': 'Please enter factory', 'toast.fillSupplier': 'Please enter supplier',
    'toast.fillCustomer': 'Please enter customer name', 'toast.fillProduct': 'Please enter product name',
    'toast.fillCode': 'Please enter product code', 'toast.fillAmount': 'Please enter amount',
    'toast.saveFirst': 'Save the product before generating EPC', 'toast.epcGenOk': 'EPC generated: ', 'toast.epcReused': 'Existing EPC: ',
    'toast.fillCatCode': 'Please enter category code', 'toast.fillCatName': 'Please enter category name (zh or en)',
    'toast.returnOk': 'Returned, stock restored', 'toast.receiveOk': 'Received and stocked',
    'toast.custSaveOk': 'Customer saved', 'toast.profileSaveOk': 'Store profile saved',
    'toast.exportOk': 'Exported CSV', 'toast.apptAcceptOk': 'Appointment accepted',
    // print
    'print.fold': 'Fold Label', 'print.hangtag': 'Hang Tag', 'print.rfid': 'RFID Label',
    'print.copies': 'Copies', 'print.preview': 'Preview', 'print.print': 'Print',
    'print.close': 'Close', 'print.template': 'Template', 'print.printer': 'Printer',
    // support
    'support.banner': 'Production Support Mode · All changes are audit-logged',
    // misc
    'misc.unit': '', 'misc.pcs': 'items', 'misc.bills': 'bills',
    'misc.tenant': 'Tenant', 'misc.operator': 'Operator', 'misc.action': 'Action', 'misc.target': 'Target',
    'misc.time': 'Time', 'misc.result': 'Result', 'misc.store': 'Store',
    'misc.role.admin': 'Manager', 'misc.role.staff': 'Staff',
    // remind
    'remind.deposits': 'Deposit balance due', 'remind.loansOverdue': 'Loan overdue',
    'remind.repairsPending': 'Repair pending', 'remind.days': 'd before',
    // site
    'site.title': 'Mini Site', 'site.slogan': 'Yi · Zhen · Cloud',
    'site.intro': 'Digital management for mid-to-high-end jewelry stores',
    'site.gallery': 'Gallery', 'site.appointment': 'Appointment',
    'site.products': 'Showcase', 'site.contact': 'Contact', 'site.hours': 'Hours', 'site.address': 'Address',
    'site.name': 'Store Name', 'site.shortName': 'Short Name', 'site.phone': 'Phone',
    'site.wantDate': 'Preferred Date', 'site.wantSlot': 'Preferred Slot',
    'site.morning': 'Morning', 'site.afternoon': 'Afternoon', 'site.evening': 'Evening',
    'site.submitAppt': 'Submit Appointment', 'site.apptOk': 'Appointment submitted. We will contact you soon.',
    'site.back': 'Back to Workspace',
    // biz business guide (collapsed by default)
    'biz.title': 'Business Guide',
    'biz.dashboard': 'Dashboard is your daily overview: stock count & cost, today/monthly sales, pending balances, all at a glance.\n6-month bar chart helps spot seasonal trends.\nReminders aggregate three types: deposit balances due, overdue loans, pending repairs. Click the header to expand details.\nAll data is aggregated from business documents in real time, no manual maintenance needed.',
    'biz.products': 'Products are the foundation of the entire shop. Each item has a unique code; its RFID EPC is one-to-one mapped.\n[Add Product] = the master-data entry: code is required, EPC is optional; you can set status, showcase flag and high-value flag. Best for detailed single-item archiving.\n[Copy & Add] = quick archiving from a template: category/material/weight/cost/price are all pre-filled from the source product, you only enter a new code (EPC optional), save to create the new item. Best for series entry like same-style different-size products.\n[Inbound] is on the Inventory page: receiving/goods entry. Code and EPC are auto-generated when left blank; status is fixed to In-Stock and not showcased. Best for bulk receiving and quick shelfing.\nStatus flow: In-Stock → Reserved (locked by deposit) → Sold; returned loans auto-restore to In-Stock.\nHigh-value items: if missed during stocktake, they will be pinned at the top as a warning.\nTick "Allow showcase" to publish the product on the mini website.',
    'biz.inventory': 'Inventory overview covers four metrics: In-Stock (count + cost), Reserved, Loaned, Sold.\n[Inbound]: fast receiving entry. Code/EPC are auto-generated when left blank; each inbound comes with an RFID tag.\n[Copy Inbound]: clone an existing in-stock item, code and EPC will be auto-renewed. Great for bulk entry of identical products.\n[Stocktake Task]: the single stocktake entrypoint for the shop. Manager starts the task → sales/inbound/outbound are auto-frozen → each handheld scans the QR code to join and download the snapshot → hold the trigger to batch-scan EPC and auto-upload → manager ends scan and reviews differences → confirm to unfreeze.\nSales and inventory operations are paused during stocktake. If a device fails or the task is opened by mistake, use [Force Abort] to immediately unfreeze without generating a stocktake result.\nResults are categorized: Matched / Shortage / Abnormal. Historical batches and item-level details can be viewed on this page.',
    'biz.sales': 'A sales bill records a sale: pick an in-stock product or enter a custom name, fill amount and received payment, a bill number is auto-generated, and the product status changes to Sold.\nWhen received < amount, the gap is recorded as customer debt and auto-accumulated in the customer profile.\n[Void] reverses a mistaken bill: the original bill is kept as Voided, the product returns to In-Stock, and the amount is excluded from sales.\nCustomer name + phone entered here auto-creates a customer record in the Customer Management page.',
    'biz.deposits': 'Deposits handle "pay deposit first, collect goods later" reservations or custom orders.\nYou may lock an in-stock product (status becomes Reserved, preventing others from selling it) or leave it unlocked for no-stock customization.\nBalance = Total − Deposit, auto-calculated; nearing the promised date triggers a reminder on the dashboard.\n[Pay Balance]: when the customer pays the remainder, it converts to a formal sales bill and the reserved product becomes Sold.\n[Void] cancels the order: the bill is marked Voided and any locked product is released back to In-Stock.',
    'biz.loans': 'Manage loans out to / from peers or customers. Loans out reduce available stock; loans in record temporary sources.\nWhen loaning out, enter an in-stock product code; its status becomes Loaned.\n[Return/Write-off]: returning a loan-out restores the product to In-Stock; returning a loan-in writes off the record only.\nOverdue loans (past the due date) appear on the dashboard "Loan Overdue" reminder.',
    'biz.repairs': 'Repair orders track the full after-sales workflow: Pending → In Repair → Awaiting Pickup → Completed.\nAt intake, register customer, item, issue and estimated fee; fill actual fee after completion.\nPending and In-Repair orders appear in the dashboard reminders to prevent omissions.\nClick [Update Status] to advance the workflow; every step is auto-logged.',
    'biz.purchases': 'Purchase orders track supplier procurement: Ordered (Pending) → Confirm Receive.\nAfter [Confirm Receive], the system auto-creates a product record and generates an RFID EPC, placing it directly into stock without re-entry.\nRecords cost and paid amount for supplier reconciliation.',
    'biz.outsourcings': 'Outsourcing tracks material dispatch to a factory and finished goods receipt: Dispatched (Processing) → Received & Stocked.\nCost = Gold Price × Weight + Labor Fee, auto-calculated by the system.\nAfter [Receive & Stock], a product record and RFID EPC are auto-generated and placed in stock.',
    'biz.customers': 'Customer profiles are auto-created from sales and deposit bills by name + phone, and can also be added manually.\nThe system auto-accumulates each customer\'s total spending and outstanding debt (the gap when received < amount on a sales bill).\nLevel, birthday and preference support member segmentation and follow-up marketing.',
    'biz.appointments': 'Visitors submit appointments through the mini website (/site); they are viewed and managed here.\nStatus flow: Contacted → Arrived → Closed. Click the buttons to update.\nAppointments include preferred date and time slot for reception planning.',
    'biz.profile': 'Store profile (name, slogan, intro, phone, address, hours) is synced to the mini website.\nClick Save after changes; visitors will see the latest info when opening /site.',
    'biz.logs': 'Key shop operations are automatically logged: who, when, what action, on which target.\nYou can trace business changes over time and export CSV with one click.',
    'biz.more': '"Me" gathers personal-center entries: customers, loans, repairs, purchases, outsourcing, logs, store profile and mini-site preview.\nOn PC these are accessible directly from the left sidebar.',
  }
};

var currentLang = 'zh';

function dictOf(lang) { return I18N[LANG_MAP[lang]] || I18N.zh; }

function t(key) {
  var dict = dictOf(currentLang);
  return dict[key] != null ? dict[key] : (I18N.zh[key] != null ? I18N.zh[key] : key);
}

function detectLang() {
  var saved = null;
  try { saved = localStorage.getItem('yi_lang'); } catch (e) {}
  if (saved && (I18N[saved] || LANG_MAP[saved])) return saved;
  var nav = (navigator.language || '').toLowerCase();
  if (nav.indexOf('zh') === 0) return 'zh-Hans';
  if (nav.indexOf('en') === 0) return 'en';
  return 'zh-Hans';
}

function switchLang(lang) {
  if (I18N[lang] || LANG_MAP[lang]) {
    currentLang = lang;
    try { localStorage.setItem('yi_lang', lang); } catch (e) {}
  }
}

currentLang = detectLang();
