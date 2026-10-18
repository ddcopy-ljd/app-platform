/* 懿臻珠宝云 · 多语言核心（中文基线常驻 + 逻辑）
 * 其余语言字典拆分在 i18n.<dict>.js（en/it/ja/ko/zhHant），由 index.html 按需同步加载。
 * 回退：目标语言缺词时自动回退到中文
 */

var LANG_MAP = {
  'zh-Hans': 'zh', 'zh': 'zh', 'en': 'en', 'it': 'it',
  'ja': 'ja', 'ko': 'ko', 'zh-Hant': 'zhHant'
};

var LANG_LABELS = {
  'zh-Hans': 'ZH', 'en': 'EN', 'it': 'IT', 'ja': '日本語', 'ko': '한국어', 'zh-Hant': '繁体'
};

var LANG_KEYS = ['zh-Hans', 'en', 'it', 'ja', 'ko', 'zh-Hant'];

/* 中文为基线字典常驻本文件；其余语言拆分为 i18n.<lang>.js 按需加载。
 * 新增语言：在此登记 LANG_MAP/LANG_LABELS/LANG_KEYS，并新建 i18n.<dict>.js 即可。 */
var I18N = {
  zh: {
    // nav
    'nav.dashboard': '经营看板', 'nav.products': '商品管理', 'nav.inventory': '库存分析', 'nav.transfers': '门店调拨',
    'nav.sales': '销售分析', 'nav.deposits': '定金尾款', 'nav.loans': '借货管理',
    'nav.customers': '会员管理', 'nav.repairs': '维修管理', 'nav.purchases': '采购管理',
    'nav.outsourcings': '委外加工', 'nav.logs': '操作日志', 'nav.appointments': '到店预约',
    'nav.profile': '系统设置', 'nav.site': '企业网站', 'nav.sale': '快速开单',
    'nav.logout': '退出登录', 'nav.more': '我的', 'nav.rfid': 'RFID盘点', 'nav.showcase': '橱窗展示',
    'nav.security': '安防中心',
    'nav.shops': '总部管理', 'nav.stores': '门店管理', 'nav.system': '系统管理',
    // login
    'login.user': '用户名', 'login.userPh': '请输入用户名', 'login.pass': '密码',
    'login.passPh': '请输入密码', 'login.submit': '登 录', 'login.hint': '演示账号：admin / 123456',
    'login.scanApp': '手持机扫描助手 App', 'login.printAgent': '打印代理 PrintBridge',
    'login.title': '懿臻珠宝云', 'login.sub': 'Jewelry Cloud · 独立工作台',
    'login.err': '用户名或密码错误', 'login.success': '登录成功',
    'login.handheld': '手持机绑定',
    'hq.storeBind': '绑定门店', 'hq.generating': '正在生成激活码…', 'hq.needStore': '请先选择工作门店',
    'hq.pending': '请用手持机 App 扫描此二维码',
    'hq.waiting': '手持机已扫码，请核对设备名后确认',
    'hq.approve': '确认登录', 'hq.deny': '拒绝',
    'hq.done': '已确认，手持机可进入系统', 'hq.denied': '已拒绝该设备登录',
    'hq.expired': '二维码已过期，请关闭后重新生成',
    'scan.label': '商品识别', 'scan.barcode': '扫条码', 'scan.qrcode': '扫二维码', 'scan.epc': '扫EPC码',
    'scan.epcBusy': 'EPC 扫描中…（小功率，对准商品后等待提示音）',
    'scan.found': '已识别商品', 'scan.notFound': '未找到对应商品',
    'scan.unavailable': '当前环境不支持扫码（请在手持机 App 中使用）',
    // kpi
    'kpi.stock': '在库商品', 'kpi.today': '今日销售', 'kpi.month': '本月销售',
    'kpi.due': '尾款待收', 'kpi.trend': '实销总额趋势', 'kpi.todo': '待办提醒',
    'kpi.recent': '最近销售', 'kpi.quick': '快捷入口', 'kpi.catSales': '品类销售占比',
    'kpi.stockCost': '成本', 'kpi.todayCount': '笔', 'kpi.unit': '元',
    // reminder tags
    'rem.payBalance': '交尾款取货', 'rem.pickupReady': '已付清可取',
    'rem.outLoanDue': '外借逾期催还', 'rem.inLoanDue': '借入逾期归还', 'rem.loanDue': '借贷逾期',
    'rem.repairPending': '待维修接单', 'rem.repairReady': '维修到期可取', 'rem.repairing': '维修中',
    'rem.purchaseDue': '{n}天后应到货', 'rem.purchaseToday': '今天应到货',
    // cats
    'cat.all': '全部', 'cat.gold': '黄金', 'cat.diamond': '钻石', 'cat.jade': '翡翠',
    'cat.platinum': '铂金', 'cat.gemstone': '彩宝', 'cat.other': '其他',
    // actions
    'act.add': '新增商品', 'act.edit': '编辑', 'act.del': '删除', 'act.remove': '移除', 'act.print': '打印标签', 'act.importBatch': '批量导入',
    'tip.printed': '已打印 {n} 次 · 最近 {t}',
    'act.void': '冲红', 'act.payBal': '收尾款', 'act.deposit': '收定金',
    'act.clear': '清除', 'act.save': '保存', 'act.cancel': '取消', 'act.confirm': '确认', 'act.reset': '重置',
    'act.submit': '确认提交', 'act.export': '导出CSV', 'act.inbound': '入库', 'act.copy': '复制入库',
    'act.copyNew': '复制新增',
    'act.scan': '盘点', 'act.return': '归还', 'act.receive': '入库', 'act.takeDelivery': '收货',
    'act.close': '关闭', 'act.viewSite': '查看网站', 'act.acceptAppt': '接受预约',
    'act.detail': '详情', 'act.viewDetail': '查看详情',
    // 列表卡片摘要行（维修/采购/委外/借货）
    'rec.receive': '收件', 'rec.promised': '交期', 'rec.done': '完成',
    'rec.order': '下单', 'rec.expected': '预计', 'rec.received': '到货',
    'rec.send': '送出', 'rec.paid': '已付', 'rec.date': '日期', 'rec.due': '应还',
    'rec.loanDate': '借出', 'rec.overdue': '逾期', 'rec.returned': '已归还',
    'rec.progress': '进度', 'rec.transit': '运输中', 'rec.onNow': '进行中',
    'rep.working': '维修中',
    // inv
    'inv.in': '入库', 'inv.copy': '复制', 'inv.mergeByCode': '按货号合并', 'inv.clickExpand': '点击展开', 'inv.count': '件数',
    'inv.tabStock': '在库商品', 'inv.tabCount': '库存盘点',
    'inv.freezeTip': '⚠ 盘点任务进行中，销售与出入库已冻结。请到「库存盘点」页签处理，完成后自动恢复。',
    'inv.frozenBanner': '盘点进行中，销售与出入库已冻结，点击前往处理：',
    'inv.frozenBlock': '盘点任务进行中，该操作已冻结。请先完成盘点核对或强制终止任务。',
    'inv.scan': '盘点', 'inv.stock': '在库', 'inv.reserved': '已定', 'inv.loaned': '借出', 'inv.sold': '已售', 'inv.inTransit': '调拨在途',
    'inv.filteringByStatus': '当前筛选', 'inv.clearFilter': '清除',
    'inv.repairing': '维修在途', 'inv.onHandFormula': '在店库存总数',
    'inv.metricCost': '库存成本', 'inv.metricPrice': '库存售价', 'inv.metricProfit': '预计利润', 'inv.metricRate': '预计利润率',
    'inv.catShare': '分类库存占比', 'inv.ptypeShare': '品类库存占比', 'inv.lockTitle': '已定锁定明细', 'inv.lockReason': '锁定原因', 'inv.lockEmpty': '暂无已定锁定商品',
    'inv.tabPsi': '进销存查询', 'inv.psiStart': '开始日期', 'inv.psiEnd': '结束日期', 'inv.psiQuery': '查询',
    'inv.psiInQty': '进货数量', 'inv.psiIn': '进货金额', 'inv.psiOutQty': '销售数量', 'inv.psiOut': '销售金额',
    'inv.psiEndQty': '期末库存数量', 'inv.psiEndCost': '期末库存成本', 'inv.psiTotal': '合计', 'inv.psiEmpty': '暂无数据，请点击查询',
    'inv.psiEndHint': '注：期末库存为当前时点值（在库+已定锁定）', 'inv.psiDateErr': '请选择起止日期',
    'inv.export': '导出', 'inv.print': '打印', 'inv.pickCols': '选择列', 'inv.pickColsErr': '请至少勾选一列',
    'inv.exportOk': '已导出 CSV', 'inv.printTitle': '库存清单', 'inv.printDate': '打印时间', 'inv.printBlocked': '浏览器拦截了新窗口，请允许弹出窗口',
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
    'sheet.purchase': '新增采购', 'sheet.outsource': '新增委外加工', 'sheet.customer': '会员信息',
    'sheet.rfid': 'RFID 隔空盘点',
    // form labels
    'lbl.code': '编码', 'lbl.huohao': '货号', 'lbl.name': '名称', 'lbl.category': '品类', 'lbl.material': '材质',
    'tbl.cols': '显示列', 'lbl.origin': '产地',
    'price.strategy': '价格策略', 'price.mode': '商品折扣', 'price.percent': '打折', 'price.fixed': '一口价',
    'price.discount': '折扣率 (%)', 'price.discountPrice': '折扣价 (元)', 'price.memberPrice': '会员价',
    'mkt.strategy': '营销策略', 'mkt.joinDiscount': '参与整单打折', 'mkt.memberOnly': '仅会员可见', 'mkt.giftPoints': '购买赠送积分',
    'lbl.weight': '克重', 'lbl.size': '尺寸', 'lbl.cost': '成本', 'lbl.price': '售价', 'lbl.barcode': '条码',
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
    'st.transit': '在途', 'st.partial': '部分完成',
    'st.processing': '加工中', 'st.delivered': '已收货', 'st.loanOut': '借出中', 'st.loanIn': '借入中',
    'st.returned': '已归还', 'st.writeOff': '已核销', 'st.confirmed': '已确认', 'st.cancelled': '已取消',
    // toast
    'toast.saveOk': '保存成功', 'toast.delOk': '已删除', 'toast.voidOk': '已冲红',
    'toast.batchEditHint': '剩余 {n} 件可继续编辑',
    'toast.batchCopyOk': '已复制 {n} 件',
    'toast.batchDelConfirm': '确认删除选中的 {n} 件商品？（仅删除"在库"状态）',
    'toast.batchDelOk': '已删除 {n} 件',
    'toast.batchDelSkipped': '{n} 件非在库已跳过',
    'toast.payOk': '尾款已收，已转正式单', 'toast.loginOk': '登录成功', 'toast.fillForm': '请填写必填项',
    'cfm.payBalWarn': '确认后：尾款记为已收，本单自动转为正式销售单，商品状态变为「已售」。',
    'cfm.voidWarn': '冲红后：定金退回客户，商品解除「已定」锁定并回到在库，此操作不可撤销。',
    'toast.epcWritten': 'RFID EPC 已写入', 'toast.printOk': '标签打印完成',
    'toast.scanOk': '盘点完成', 'toast.apptOk': '预约已确认', 'toast.noProdFile': '该条目无商品档案（盘盈/异常项）',
    'toast.fillFactory': '请填写加工厂', 'toast.fillSupplier': '请填写供应商',
    'toast.fillCustomer': '请填写客户姓名', 'toast.fillProduct': '请填写商品名称',
    'toast.fillCode': '请填写商品编码', 'toast.fillAmount': '请填写金额',
    'toast.saveFirst': '请先保存商品再生成EPC', 'toast.epcGenOk': 'EPC 已生成：', 'toast.epcReused': '已存在EPC：',
    'toast.fillCatCode': '请填写分类编码', 'toast.fillCatName': '请填写分类名称（中文或英文）',
    'toast.returnOk': '已归还，库存已恢复', 'toast.receiveOk': '已收货入库',
    'toast.custSaveOk': '客户已保存', 'toast.profileSaveOk': '店铺信息已保存',
    'toast.exportOk': '已导出CSV', 'toast.apptAcceptOk': '预约已接受',
    // 标签打印/协同盘点补充提示
    'toast.pickLabel': '请先选择要打印的商品',
    'toast.printSent': '已发送到打印机', 'toast.localPrint': '已本地直打：{p}（不经云端）', 'toast.zplDone': 'ZPL 指令已生成',
    'toast.coStarted': '盘点任务已开启，请设备扫码加入',
    'toast.coCancelled': '任务已撤销，销售已恢复',
    'toast.coTerminated': '任务已终止，销售已恢复（无扫描数据）',
    'toast.coTerminatedRpt': '任务已终止，已生成部分盘点报告',
    'toast.coEndReview': '已核对，请查看差异并确认',
    'toast.coDone': '盘点完成，销售已恢复',
    'toast.coAborted': '任务已强制终止，销售已恢复',
    'toast.coUrlCopied': '地址已复制',
    'co.cfStart': '开启盘点任务后，本店销售与出入库将暂停，直到手持机提交完结或发起端撤销/终止任务。确定开启？',
    'co.cfCancel': '【撤销任务】\n\n任务作废且不生成盘点报告，立即解除销售/出入库冻结。已扫描数据仅留档。确定撤销？',
    'co.cfTerminate': '【终止任务】\n\n立即解除销售/出入库冻结；若已有扫描数据，将生成一份部分盘点报告供复盘。确定终止？',
    // print
    'print.fold': '对折标签', 'print.hangtag': '挂绳标签', 'print.rfid': 'RFID芯片标签',
    'print.copies': '打印份数', 'print.preview': '打印预览', 'print.print': '打印',
    'print.close': '关闭', 'print.template': '标签模板', 'print.printer': '打印机',
    // support
    'support.banner': '生产运维穿透模式 · 所有修改将写入审计日志',
    'mode.sandbox': '沙箱试运行环境',
    'mode.sandboxTip': '当前为隔离快照数据，短信、邮件等外部动作均已拦截，不会真实发出',
    'mtip.text': '检测到手机访问，手机网页版体验更佳', 'mtip.go': '前往手机版',
    // misc
    'misc.unit': '元', 'misc.pcs': '件', 'misc.bills': '笔',
    'misc.tenant': '租户', 'misc.operator': '操作人', 'misc.action': '操作', 'misc.target': '目标',
    'misc.time': '时间', 'misc.result': '结果', 'misc.store': '门店',
    'misc.role.admin': '店长', 'misc.role.staff': '店员', 'misc.role.exec': '高管',
    'misc.language': '语言', 'misc.gram': '克',
    // 高管只读
    'role.readonlyBadge': '只读',
    'role.execReadonly': '高管账号仅可查看，不能进行该操作',
    'role.execNeedHq': '总部/系统设置请先切换到总部后再操作',
    'role.costHidden': '无成本查看权限，成本保持不变',
    // remind
    'remind.deposits': '定金尾款到期', 'remind.loansOverdue': '借货逾期',
    'remind.repairsPending': '维修待处理', 'remind.days': '天前',
    // site
    'site.title': '企业网站', 'site.slogan': '懿德 · 臻品 · 云智',
    'site.intro': '面向中高端珠宝门店的数智化经营', 'site.gallery': '门店图集',
    'site.appointment': '到店预约', 'site.products': '商品橱窗',
    'site.contact': '联系我们', 'site.hours': '营业时间', 'site.address': '门店地址',
    'site.name': '店铺名称', 'site.shortName': '简称', 'site.phone': '联系电话',
    'site.wantDate': '期望到店日期', 'site.wantSlot': '期望时段',
    'site.morning': '上午', 'site.afternoon': '下午', 'site.evening': '晚上',
    'site.submitAppt': '提交预约', 'site.apptOk': '预约已提交，我们将尽快与您联系',
    'site.back': '返回工作台',
    // biz 业务说明
    'biz.title': '业务说明',
    'biz.dashboard': '看板是开店后的第一屏，数据全部由业务单据实时汇总，无需手工维护。\n顶部金价栏：🌍 国际金价为伦敦金实时行情（美元/盎司）；📍 本地金价按当前语言区域币种折算为每克价。右侧的时间段下拉统一控制整页口径（今日／本周／本月／近3月／近6月／今年）。\nKPI 卡片按所选时段统计实销金额、开单数与均价，并附环比/同比；同时显示在库数量与成本、区间调拨、待收尾款与会员应收。\n实销总额趋势图随所选时段按天（区间≤45天）或按月聚合，可在「同比／环比」间切换对比线索。\n待办提醒聚合定金尾款到期、借货逾期、维修待处理三类事项，点标题可展开明细。',
    'biz.products': '商品是全店业务的档案基础，一物一码：商品编码唯一，RFID EPC 与商品一一对应。\n【新增商品】= 建档入口：编码需手工填写、EPC 可留空，可设置状态、是否上橱窗、⭐高价值标记，适合单品精细建档。\n【复制新增】= 以现有商品为模板快速建档：品类/材质/克重/成本/售价等全部预填，只需填新编码（EPC 可留空），保存即得新品，适合同款多色/多尺寸的系列录入。\n【入库】在「库存管理」页：收货入账入口，编码与 EPC 留空时系统自动生成，固定「在库」、不上橱窗，适合新货批量快速上柜。\n状态流转：在库 → 已定（收定金锁定）→ 已售；借出归还后自动恢复在库。\n⭐高价值商品：盘点时未扫到会置顶提醒，防止贵重货品漏盘。\n勾选「允许上橱窗」后，商品将同步到企业网站对外展示。',
    'biz.transfers': '门店间实物调拨，两步制：调出店【发起调拨】后商品进入「在途」，自动冻结销售/再调拨/借出/编辑；调入店逐件【验货】，相符则入库本店，不符须登记原因并退回调出店。部分不符时单据为「部分完成」，需线下跟进后通过新调拨更正。EPC 终身不变，只随验货结果变更所属门店。',
    'biz.inventory': '库存概况四个口径：在库（数量+成本）、已定锁定、借出、已售。\n【入库登记】新货快速入账：编码/EPC 留空自动生成，入库即带电子标签。\n【复制入库】参照在库商品一键复制，编码与 EPC 自动换新，适合同款批量录入。\n【盘点任务】全店唯一盘点入口：主管开启任务 → 销售/出入库自动冻结 → 各手持机扫码加入并下载商品快照 → 按住扳机批量扫 EPC 自动上传 → 主管结束扫描并核对差异 → 确认后解冻。\n盘点期间销售与出入库暂停；手持机故障或误开任务时，用【强制终止任务】立即解冻（不生成盘点结果）。\n盘点结果分三类：相符 / 盘亏 / 异常，历史批次与逐条明细可在本页查询。',
    'biz.sales': '开单即售货：选择在库商品或自定义名称，填金额与实收，自动生成单号，商品状态转「已售」。\n实收小于金额时，差额记为该客户欠款，自动累计到客户档案。\n【冲红】用于撤销错单：原单保留并标记「已冲红」，商品恢复在库，金额不再计入销售。\n开单时填写的会员姓名+手机号会自动建档到「会员管理」。',
    'biz.deposits': '定金单用于「先收定金、后取货」的预留/定制业务。\n收定金时可锁定一件在库商品（状态转「已定」，他人无法再售），也可不锁定做无现货定制。\n尾款 = 总价 − 定金，系统自动计算；交期临近会进入看板待办提醒。\n【收尾款】客户付清后一键转正式销售单，锁定商品转「已售」。\n【冲红】取消订单：单据标记已冲红，锁定的商品自动恢复在库。',
    'biz.loans': '管理同行/客户间的借出与借入：借出减少可售库存，借入记录临时货源。\n借出时填在库商品编码，商品状态转「借出」。\n【归还/核销】借出归还后商品自动恢复在库；借入归还仅核销记录。\n超过应还日期未归还的，进入看板「借货逾期」待办提醒。',
    'biz.repairs': '维修单跟踪售后维修全流程：待维修 → 维修中 → 待取件 → 已完成。\n接件时登记客户、物品、问题与预估费，完工后补填实收费。\n待维修/维修中的单据会进入看板待办提醒，防止遗漏。\n点【更新状态】逐步推进流程，每次操作自动留痕。',
    'biz.purchases': '采购单跟踪向供应商进货：下单（待发货）→ 确认入库。\n【确认入库】后系统自动创建商品档案并生成 RFID EPC，直接进入在库，无需二次建档。\n记录成本与已付金额，便于与供应商对账。',
    'biz.outsourcings': '委外加工跟踪从发料到回收：发料（加工中）→ 收货入库。\n成本 = 金价 × 克重 + 工费，系统自动核算。\n【收货入库】后自动生成商品档案与 RFID EPC，进入在库。',
    'biz.customers': '会员档案在销售/定金开单时按「姓名+手机号」自动建档，也可手工新增。\n系统自动累计每位会员的消费总额与欠款（销售单实收不足部分）。\n等级、生日、偏好信息用于会员分层营销与回访。',
    'biz.appointments': '客人在企业网站（/site）自助提交到店预约，在此集中查看与跟进。\n状态流转：已联系 → 已到店 → 已成交，点按钮即更新。\n预约含期望到店日期与时段，便于安排接待。',
    'biz.profile': '「系统设置」维护跨门店共享的基础数据，对所有门店生效：\n1. 店铺资料（名称、口号、简介、电话、地址、营业时间）会同步展示到企业网站，修改保存后客人打开 /site 即可看到；\n2. EPC 编码规则、商品分类、标签打印模板为全平台统一配置，各门店共用。',
    'biz.logs': '全店关键操作自动留痕：谁、在什么时间、对什么做了什么。\n可按时间回溯业务变动，支持一键导出 CSV 备查。',
    'biz.more': '「我的」汇集个人中心入口：客户、借货、维修、采购、委外、日志等管理页，以及系统设置与企业网站预览。\n电脑端这些功能在左侧导航直达。',
    'biz.security': '接入 RFID 防盗通道门、EAS 门禁等防盗设备：设备通过 HTTP 或 WebSocket 上报，布防时段内检测到未放行商品经过即触发告警（界面弹窗+提示音，可配置 Webhook 外发）。\n已售/借出商品自动放行；委外、展览等场景可添加临时放行。\n布防/撤防可手动切换，也可设置每日定时自动布撤防。',
    'biz.report': '使用 BugTracker 缺陷跟踪系统的免登录上报通道：填写类型（缺陷/需求）、标题与详细说明（可附最多 3 张截图）后提交，受理编号即时返回，由质量团队在 BugTracker 待处理箱统一跟进。',
    'report.openNew': '🔗 新窗口打开',
    'report.beautify': '美观输出',
    'report.tip': '上报内容将提交到 BugTracker「外部上报箱」，来源与上报人已自动记录。',

    // 门店切换 / 用户与门店授权
    'store.switch': '切换工作门店',
    'store.switched': '已切换到 {name}',
    'store.noAccess': '无权访问该门店',
    'store.emptyTitle': '暂无可访问的门店',
    'store.emptyDesc': '您的账号还没有被授权任何门店，请联系店长在「系统管理 · 用户与门店权限」中为您开通。',
    'adminUser.guide': '管理登录账号及其可访问的门店。店长自动拥有全部门店；店员只能看到被勾选门店的业务数据，并可在顶栏切换工作门店。调拨单例外：与本店相关的发出、收货单均可看到。',
    'adminUser.tip': '勾选门店后立即生效，无需另存。',
    'adminUser.create': '新增账号',
    'adminUser.name': '姓名',
    'adminUser.login': '登录名',
    'adminUser.role': '角色',
    'adminUser.stores': '可访问门店',
    'adminUser.roleAdmin': '店长',
    'adminUser.roleStaff': '店员',
    'adminUser.roleExec': '高管',
    'adminUser.roleExecHint': '业务属性角色，适用于老板、总监等巡查岗位；可切换查看全部门店；业务数据只读；总部/系统设置仅在总部可修改',
    'adminUser.canViewCost': '成本查看权限',
    'adminUser.costOn': '可看成本', 'adminUser.costOff': '隐藏成本',
    'adminUser.costForceHint': '店长/高管默认拥有成本查看权限',
    'adminUser.allStores': '全部门店（自动）',
    'adminUser.none': '未授权任何门店',
    'adminUser.edit': '编辑',
    'adminUser.del': '删除',
    'adminUser.createTitle': '新增账号',
    'adminUser.editTitle': '编辑账号',
    'adminUser.password': '密码',
    'adminUser.pwdKeep': '留空表示不修改密码',
    'adminUser.fieldsReq': '请填写登录名和初始密码',
    'adminUser.delConfirm': '确定删除账号「{name}」？该操作不可恢复。',
    // 安防中心
    'sec.stArmed': '布防中', 'sec.stDisarmed': '已撤防',
    'sec.arm': '布防', 'sec.disarm': '撤防',
    'sec.online': '在线', 'sec.pending': '未处理',
    'sec.events': '事件流', 'sec.evAlarm': '告警', 'sec.evPass': '放行', 'sec.evInfo': '记录',
    'sec.confirm': '确认', 'sec.falseAlarm': '误报', 'sec.noEvents': '暂无事件',
    'sec.devices': '设备管理', 'sec.rotateKey': '轮换密钥', 'sec.simEpc': '模拟EPC', 'sec.simAlarm': '模拟告警',
    'sec.noDevices': '暂无设备，点击下方按钮新增',
    'sec.addDevice': '新增设备', 'sec.devName': '设备名称', 'sec.devType': '设备类型',
    'sec.devStore': '所属门店', 'sec.devLoc': '安装位置', 'sec.devLocPh': '如：正门通道',
    'sec.keyOnce': '密钥仅显示这一次，请立即复制保存；遗失只能轮换',
    'sec.pass': '临时放行', 'sec.passHint': '已售/借出商品自动放行；此处用于委外、展览等手工临时放行',
    'sec.passNoReason': '未填原因', 'sec.passExp': '至', 'sec.noPass': '暂无临时放行',
    'sec.passReasonPh': '原因（如委外送检）', 'sec.passMin': '分钟', 'sec.passAdd': '添加',
    'sec.settings': '安防设置', 'sec.armTime': '布防时刻', 'sec.disarmTime': '撤防时刻',
    'sec.dedup': '告警去重(秒)', 'sec.secretPh': '留空则不修改',
    'sec.webhookLast': '最近Webhook',
    'sec.armed': '已布防', 'sec.disarmed': '已撤防',
    'sec.rotateConfirm': '轮换后旧密钥立即失效，设备需重新配置，确定轮换？',
    'sec.simOk': '已模拟', 'sec.handleNote': '处置备注（可留空）', 'sec.epcRequired': '请填写EPC',
    'sec.alarmTitle': '防盗告警', 'sec.alarmMute': '静音', 'sec.alarmAck': '确认并关闭',
    'sec.devHbTimeout': '心跳超时(秒)', 'sec.devFieldMap': '字段映射',
    'sec.devFieldMapPh': '原始键→标准键的 JSON，如 {"tags":"epcs"}；留空不映射',
    'sec.guide': '接入指南', 'sec.guideHint': '各设备类型的标准报文字段与接入示例，可发给设备厂商/实施人员',
    'sec.required': '必填', 'sec.example': '示例',
    'sec.guideWsNote': '连接后发送与 HTTP 相同的 JSON 报文；密钥填入 URL 的 key 参数',
    'sec.guideFieldMapHint': '设备字段名与标准不一致时，无需改代码：在设备表单「字段映射」中配置 {"原始键":"标准键"} 即可自动转换',
    'sec.rawLog': '原始报文调试', 'sec.rawLogHint': '查看设备上报的原始报文；解析失败的报文会记录为 parse_error 类型',
    'sec.rawAll': '全部类型', 'sec.rawParseErr': '解析失败',
    // 通用
    'common.yes': '是', 'common.no': '否', 'common.copy': '复制', 'common.refresh': '刷新',
    'common.detail': '明细', 'common.op': '操作', 'common.time': '时间', 'common.device': '设备',
    'common.expected': '期望：', 'common.overdue': '逾期', 'common.cost': '成本',
    'common.loading': '加载中...',
    'sc.count': '已选 {c}/{n} 件', 'sc.unsaved': '有未保存的修改', 'sc.descPh': '橱窗展示文案（留空自动生成）',
    'sc.empty': '橱窗暂无商品，从下方商品池添加', 'sc.pool': '商品池（在库）', 'sc.poolEmpty': '没有可添加的商品',
    'sc.add': '加入橱窗', 'sc.viewSite': '查看对外橱窗页', 'sc.max': '橱窗最多 {n} 件',
    'biz.showcase': '橱窗展示配置企业网站 /site 对外展示的臻品，最多 10 件。\n从下方「商品池」点【加入橱窗】选品，用 ↑↓ 调整展示顺序，可填写自定义展示文案（留空则按产地/材质/金重/参考价自动生成）。\n修改后点【保存】同步到公开页；移出橱窗的商品会清空其排序与文案。',
    // 表头 / 列
    'th.showcase': '橱窗', 'th.highValue': '高价值', 'th.material': '材质',
    'th.device': '设备', 'th.devName': '名称', 'th.lastSeen': '最近在线',
    'th.batchNo': '批次号', 'th.scanBook': '扫描/账面', 'th.matched': '相符', 'th.shortage': '盘亏', 'th.abnormal': '异常',
    'th.result': '结果', 'th.goodsNo': '货号', 'th.goods': '商品', 'th.bookStatus': '账面状态',
    // 看板
    'dash.cost': '成本', 'dash.bills': '笔', 'dash.birthday': '生日', 'dash.due': '待付',
    'dash.mom': '环比', 'dash.yoy': '同比', 'dash.trendCur': '本期',
    'dash.trendUnit': '实销金额（元）',
    'dash.today': '今日', 'dash.week': '本周', 'dash.month': '本月', 'dash.custom': '自定义',
    'dash.query': '查询', 'dash.pickRange': '请选择起止日期', 'dash.avg': '客单价',
    'dash.onhand': '在库', 'dash.depBills': '单待收', 'dash.rangeMove': '区间出入库',
    'dash.rangeSales': '区间销售', 'dash.rangeDue': '区间待收定金', 'dash.rangeCustDue': '区间会员应收',
    'dash.goldIntl': '国际金价', 'dash.goldLocal': '本地金价', 'dash.goldFail': '获取失败，点击重试',
    'dash.tr15d': '近15日', 'dash.tr30d': '近30日', 'dash.tr6m': '近6个月', 'dash.tr12m': '近12个月',
    'ba.title': '经营分析', 'ba.profitGrp': '利润分析', 'ba.realCost': '实销成本', 'ba.profit': '利润', 'ba.profitRate': '利润率',
    'ba.member': '会员', 'ba.newMembers': '新增会员', 'ba.recharge': '充值总额', 'ba.memberPay': '会员卡支付',
    'ba.salesEff': '销售分析', 'ba.avgPerBill': '客单价(元/单)', 'ba.attachment': '连带率(件/单)', 'ba.avgPerItem': '平均单价(元/件)', 'ba.sellThrough': '售罄率',
    'ba.catShare': '分类实销总额占比', 'ba.top5': '销售TOP5', 'ba.catName': '分类名称', 'ba.realQty': '实销数量', 'ba.realAmount': '实销总额',
    'dash.donutTotal': '合计', 'dash.aging': '滞销超180天', 'dash.stocktakeRisk': '最近盘点',
    'dash.pieceUnit': '件', 'dash.anniversary': '纪念日',
    'care.birthday': '生日关怀', 'care.anniversary': '纪念日关怀', 'care.maintain': '保养清洗',
    'lbl.anniversary': '结婚纪念日',
    'q.products': '商品', 'q.inventory': '库存', 'q.sales': '销售', 'q.deposits': '定金',
    'q.loans': '借货', 'q.repairs': '维修', 'q.customers': '会员', 'q.logs': '日志',
    // 商品/库存按钮
    'act.labelPrint': '打印', 'act.printSel': '打印', 'act.labelLayout': '🏷 标签排版', 'act.refresh': '刷新',
    'act.genEpc': '生成EPC', 'act.addNew': '新增', 'act.accept': '接件', 'act.purchase': '采购',
    'act.sendOut': '发料', 'act.addCustomer': '新增会员', 'act.updateStatus': '更新状态',
    'act.returnWriteOff': '归还/核销', 'act.confirmReceive': '确认入库', 'act.receiveStock': '收货入库',
    'act.allowShowcase': '允许上橱窗',
    'hv.hint': '⭐ 高价值商品（盘点时未扫到将置顶提醒）',
    // 库存概况
    'inv.reservedLocked': '已定锁定',
    // 统一工作任务（盘点）+ 扫描设备
    'co.taskTitle': '🧭 盘点任务',
    'co.desc': '主管开启任务后销售/出入库自动暂停并生成任务二维码；「扫描助手」App 或手机扫码领取任务后盲扫上报（设备不显示账面清单）；任一把手持机提交完结即生成差异报告并解除冻结，可在下方盘点批次复盘。',
    'co.hostPh': '主机地址（自动检测；如 192.168.1.20:8002）',
    'co.start': '开启盘点任务', 'co.task': '任务', 'co.joinUrl': '扫描助手 App 领取地址（扫码自动配置）',
    'co.h5Url': '手机网页参与地址（浏览器打开即用，摄像头/手持机网页扫码）',
    'co.deviceNo': '号机', 'co.submitted': '已提交', 'co.scanning': '扫描中', 'co.noDevice': '尚无设备加入',
    'co.scanned': '扫描', 'co.book': '账面',
    'co.cancel': '撤销任务', 'co.terminate': '终止任务',
    'co.endHint': '撤销=作废不出报告；终止=提前结束，有扫描数据时出部分报告；均立即解冻',
    'co.qrAlt': '盘点任务二维码', 'co.qrLoading': '二维码加载中…',
    'co.qrCap': '扫描助手扫码领取任务', 'co.qrCap2': '手机浏览器也可扫码进入协同/自主模式',
    'co.totalScanned': '全局已扫', 'co.recentBatches': '最近盘点批次',
    'co.statusRunning': '进行中', 'co.statusDone': '已完成', 'co.statusCancel': '已撤销', 'co.statusTerminate': '已终止',
    'co.batchTitle': '盘点批次',
    'dev.manage': '扫描设备管理',
    'dev.genAct': '生成设备激活码', 'dev.devNamePh': '设备名称（如 1号手持机，可选）',
    'dev.genBtn': '生成激活码', 'dev.actQrHint': '用「扫描助手」App 的设备激活功能扫码，15 分钟内一次性有效',
    'dev.listTitle': '已激活设备', 'dev.code': '设备码', 'dev.store': '绑定门店',
    'dev.currentTask': '当前任务', 'dev.active': '正常', 'dev.disabled': '已停用',
    'dev.needUpgrade': '待升级', 'dev.version': '版本',
    'dev.disable': '停用', 'dev.enable': '启用', 'dev.unbind': '解绑',
    'dev.empty': '尚无已激活设备', 'dev.online': '在线', 'dev.offline': '离线',
    'dev.source': '来源', 'dev.srcApp': '扫描助手', 'dev.srcH5': '手机网页',
    'dev.actCreated': '激活码已生成', 'dev.cfUnbind': '解绑后该设备需重新扫码激活，确定？',
    'dev.unbound': '设备已解绑',
    'dev.sInStore': '在库', 'dev.sOther': '非在库', 'dev.sUnknown': '未登记',
    // 销售
    'sale.pay': '支付', 'sale.stockItem': '在库商品', 'sale.customName': '自定义名称', 'sale.productName': '商品名称',
    'sale.clerkType': '经办人类别', 'sale.clerkName': '经办人', 'sale.clerkNamePh': '可选，具体人名',
    'sale.clerk': '经办人', 'sale.clerkAll': '全部类别', 'sale.clerkFilter': '按经办人类别筛选',
    'sale.receiptBtn': '小票', 'sale.receiptTitle': '销售小票', 'sale.receiptNo': '单号',
    'sale.dueShort': '欠款', 'sale.receiptThanks': '感谢惠顾，欢迎再次光临！', 'sale.receiptBlocked': '浏览器拦截了小票窗口，请允许弹出窗口',
    // 销售分析页
    'sale.tabAnalysis': '销售分析', 'sale.tabList': '销售流水',
    'dash.yesterday': '昨天', 'dash.last7d': '近7天', 'dash.last3m': '近3个月',
    'sale.bills': '笔数', 'sale.revenue': '实销总额',
    'sale.catRealShare': '分类实销总额占比', 'sale.ptypeRealShare': '品类实销总额占比', 'sale.clerkShare': '销售人员销售占比', 'sale.clerkTotal': '销售总额',
    'sale.hotRank': '单品热销榜', 'sale.hotSold': '热卖', 'sale.detail': '明细',
    // 多件快速开单
    'sale.pickItem': '添加商品', 'sale.pickPh': '选择在库商品',
    'sale.colName': '商品', 'sale.colCode': '货号', 'sale.colPrice': '单价',
    'sale.emptyItems': '暂无商品，请扫码或从下拉选择', 'sale.itemCount': '件数', 'sale.itemsUnit': '件',
    'sale.needItem': '请至少添加一件商品', 'sale.added': '已加入', 'sale.dupItem': '该商品已在本单中，请勿重复添加',
    'sale.crossStore': '一单只能包含同一门店的商品', 'sale.limitReached': '本总部每单最多 {n} 件',
    // 1.0.9 快速开单增强：搜索/计重/优惠/组合支付/会员
    'sale.searchPh': '输入款号 / 条码 / EPC 搜索',
    'sale.suggestEmpty': '没有匹配的在库商品',
    'sale.modePiece': '计件', 'sale.modeWeight': '计重',
    'sale.colWeight': '克重(g)', 'sale.colGold': '金价', 'sale.colLabor': '工费', 'sale.colSubtotal': '小计',
    'sale.receivable': '应收', 'sale.discount': '优惠', 'sale.payable': '应付',
    'sale.discountTooBig': '优惠金额不能大于应收金额',
    'sale.addPay': '添加组合支付', 'sale.payAmountPh': '金额', 'sale.paidSum': '实收合计',
    'sale.payNeed': '请至少填写一笔收款金额', 'sale.paidTooBig': '实收金额不能超过应付金额',
    'sale.dueTip': '欠款 ￥{n}', 'sale.overTip': '超收 ￥{n}', 'sale.pointsUnit': '分',
    'sale.goldToday': '当日金价', 'sale.goldApply': '保存并应用', 'sale.goldSaved': '当日金价已保存并应用到本单',
    'sale.goldNeed': '计重商品需要填写大于 0 的金价', 'sale.memGoldPrice': '会员金价',
    'sale.memPoints': '积分', 'sale.memRate': '金价折扣', 'sale.memCreate': '一键新建会员',
    'sale.memHi': '欢迎，{n}', 'sale.memDefaultName': '会员{n}', 'sale.memCreated': '新会员已建档',
    'pay.cash': '现金', 'pay.wechat': '微信', 'pay.card': '刷卡', 'pay.transfer': '转账',
    // 摄像头扫码
    'scan.camera': '摄像头扫码', 'scan.camStop': '关闭摄像头', 'scan.camStarting': '正在打开摄像头…',
    'scan.camFail': '无法打开摄像头（权限被拒或被占用）', 'scan.camNoEl': '未找到摄像头画面', 'scan.libMissing': '扫码库未加载，请改用下拉选择',
    'scan.mode': '输入模式', 'scan.modeCoop': '协同模式', 'scan.modeSelf': '自主模式',
    'scan.waiting': '等待手持机扫描…', 'scan.newTaskTip': '已通知本店手持机', 'scan.receivedCount': '已接收',
    'scan.recentEpc': '最近扫描', 'scan.taskOffer': '收到新扫码任务', 'scan.taskClosed': '扫描任务已结束',
    'co.name.stocktake': '盘点', 'co.name.sale': '销售开单', 'co.name.loan': '借货', 'co.name.deposit': '收定金',
    'co.name.transferOut': '调拨出库', 'co.name.transferIn': '调拨收货',
    'co.name.epcProduct': '商品EPC', 'co.name.epcInbound': '入库EPC', 'co.name.generic': '扫码',
    'sb.handheld': '手持机', 'sb.handheldMgr': '管理 / 绑定', 'sb.noHandheld': '本店暂无绑定的手持机',
    'sb.bindNew': '绑定新手持机',
    'scan.coopExit': '退出协同',
    // 多模态输入基座（输入框右侧 📱/⤢ 图标）
    'scan.gunReady': '激光扫码枪已就绪，请直接对准条码扫描',
    'anchor.coopTitle': '手持机协同扫描', 'anchor.camTitle': '摄像头 / 扫码枪扫码',
    'anchor.startCoop': '开始手持机协同', 'anchor.coopHint': '发起后同店手持机自动收到任务，扫到的编码实时推送到这里',
    'anchor.otherActive': '已有协同任务进行中，请先退出当前任务',
    'anchor.epcReceived': '手持机已写入 EPC',
    // 总部（上层组织）
    'shop.guide': '总部是唯一的上层虚位，用于管理各门店并设置业务规则（如快速开单每单件数上限）。',
    'shop.title': '总部设置', 'shop.hint': '总部为唯一隐式实体，不可新增/删除，仅可调整每单件数上限',
    'shop.subtitle': '下设门店列表（在总部下可直接开设分店）',
    'shop.itemLimit': '每单件数上限',
    'shop.storeNameReq': '请填写门店名称',
    'shop.inboundAt': '{n} · 商品入库',
    // 门店
    'store.title': '门店管理', 'store.add': '新增门店', 'store.name': '门店名称', 'store.code': '门店编码',
    'store.owner': '负责人', 'store.belongShop': '所属总部', 'store.namePh': '如：旗舰店',
    'store.codePh': '2位字母/数字，如 HQ、A1', 'store.codeRule': '门店编码需为 2 位字母或数字（如 HQ、A1、06）；留空则自动生成',
    'store.manage': '管理', 'store.inbound': '入库', 'store.devices': '扫描设备',
    'store.baseInfo': '基本信息', 'store.editInfo': '修改资料',
    'store.emptyInShop': '该总部下暂无门店', 'store.inboundStore': '入库门店（直接关联，不可更改）',
    'store.bridge': '打印代理', 'store.saleMonth': '本月销售', 'store.saleCount': '累计销售笔数', 'store.saleAmount': '累计销售额',
    // 定金
    'dep.paid': '已付', 'dep.createdAt': '创建于', 'dep.lockHint': '锁定在库商品（可选）', 'dep.noStock': '无现货定制',
    'dep.deliveryTime': '交付时间', 'dep.deliveryTimePh': '如 10月20日 下午2-4点',
    'dep.requirements': '交付要求', 'dep.requirementsPh': '材质/颜色/证书/刻字等特殊要求',
    'dep.scanPh': '扫码/输入货号后回车',
    'dep.remindDays': '提前提醒(天)', 'dep.payBal': '付尾款取货',
    // 借货
    'loan.scanLabel': '手工输入 EPC/条码/货号', 'loan.enterAdd': '回车添加', 'loan.add': '添加',
    'loan.empty': '尚未扫码添加商品', 'loan.partyPh': '借出给 / 借自', 'loan.needScan': '请先扫码添加商品',
    // 客户
    'cust.normal': '普通', 'cust.silver': '银卡', 'cust.gold': '金卡',
    'cust.goldDiscount': '金价折扣', 'cust.goldDiscountHint': '0~1 之间，如 0.98 表示金价按 98% 计',
    'cust.goldDiscountRange': '金价折扣率需在 0~1 之间（如 0.98）', 'cust.points': '积分',
    'cust.empty': '暂无会员，可从销售/定金开单时自动建档', 'cust.emptyShort': '暂无会员',
    'cust.totalSpent': '累计消费', 'cust.lastSale': '最后消费',
    'cust.times': '次', 'cust.noPurchase': '暂无购买记录',
    'cust.searchPh': '搜索会员姓名/手机号...', 'cust.statTotal': '会员总数', 'cust.statToday': '今日新增', 'cust.statMonth': '本月新增',
    'cust.historySales': '历史购买', 'cust.historyDeposits': '历史定金预定', 'cust.noSales': '暂无购买记录',
    // 预约
    'appt.want': '期望：', 'appt.contacted': '已联系', 'appt.arrived': '已到店', 'appt.done': '已成交',
    'appt.pending': '待联系', 'appt.emptyM': '暂无预约，访客可从公开页 /site 自助提交',
    // 店铺管理 / EPC / 分类管理
    'pf.title': '企业资料', 'pf.name': '名称', 'pf.slogan': '口号', 'pf.intro': '简介', 'pf.phone': '电话',
    'pf.hours': '营业时间', 'pf.address': '地址', 'pf.previewSite': '预览企业网站',
    'pf.shTitle': '橱窗标题', 'pf.shTitlePh': '默认：新品橱窗', 'pf.shSub': '橱窗副标题', 'pf.shSubPh': '默认：本周臻品 · 限量发售',
    'pf.siteI18n': '推广页多语言内容', 'pf.siteI18nHint': '按语言录入企业网站展示内容；某字段留空时自动回退中文。',
    'pf.namePhLang': '该语言的企业名称', 'pf.cats': '经营品类',
    // 总部管理五 Tab（总部信息 / 企业推广 / 分店管理 / 品类管理 / 分类管理）
    'shops.tab.info': '总部信息', 'shops.tab.promo': '企业推广', 'shops.tab.branches': '分店管理',
    'shops.tab.types': '品类管理', 'shops.tab.categories': '分类管理',
    'shops.infoHint': '维护总部名称、口号、简介、电话、营业时间、地址与橱窗标题等基础资料。',
    'pf.promoTitle': '企业推广 · 官网多语言', 'pf.promoHint': '按语言维护企业官网展示内容，保存后点「预览企业网站」查看效果；某字段留空自动回退中文。',
    'shops.devShow': '设备清单', 'shops.devHide': '收起设备',
    'shops.devPrint': '打印助手', 'shops.devScan': '扫描助手', 'shops.devSec': '安防设备',
    'shops.devNone': '暂无设备', 'shops.lastSeen': '最后心跳',
    'epc.title': 'EPC 编码规则', 'epc.prefix': '企业前缀', 'epc.seqBits': '序号位数',
    'epc.hint': 'EPC = 企业前缀 + 门店码(2位字母/数字) + 品类码(2位) + 序号(4-6位十六进制)。序号按「门店+品类」独立递增；前缀取企业名称拼音首字母前三位（如 懿臻珠宝→YZZ），留空保存自动生成、可手填修改；门店编码取门店资料中的 2 位字母/数字（如 HQ、A1、06）；含字母的前缀或门店码写入芯片时自动转 ASCII 十六进制（YZZ→595A5A，HQ→4851）', 'epc.save': '保存规则',
    'cat.mgrTitle': '商品分类管理', 'cat.title': '商品分类', 'cat.name': '名称', 'cat.zhName': '中文名', 'cat.enName': '英文名',
    'cat.sort': '排序', 'cat.saveEdit': '保存修改', 'cat.addNew': '新增分类', 'cat.codePh': '如 08',
    'cat.pick': '选择分类', 'cat.addCustom': '自定义',
    // 商品品类（戒指/项链…）与材质
    'type.mgrTitle': '商品品类管理', 'type.title': '商品品类', 'type.addNew': '新增品类',
    'type.namePh': '如：戒指', 'type.codePh': '如 10', 'type.confirmDel': '该品类下仍有商品，不能删除',
    'type.pricingMode': '计价方式', 'type.modePiece': '计件（一口价）', 'type.modeWeight': '计重（克重×金价+工费）',
    'type.noTypes': '暂无品类，请先在总部管理中添加',
    'mat.AU': 'AU', 'mat.PT': 'PT', 'mat.AG': 'AG',
    'mat.DIA': 'DIA', 'mat.JAD': 'JAD', 'mat.CGS': 'CGS',
    'mat.PRL': 'PRL', 'mat.OTH': 'OTH',
    'mat.cn.AU': '黄金', 'mat.cn.PT': '铂金', 'mat.cn.AG': '白银',
    'mat.cn.DIA': '钻石', 'mat.cn.JAD': '翡翠', 'mat.cn.CGS': '彩宝',
    'mat.cn.PRL': '珍珠', 'mat.cn.OTH': '其他',
    // 商品图片裁切
    'img.upload': '上传商品图片', 'img.change': '更换图片', 'img.remove': '删除图片',
    'img.cropTitle': '裁切商品图片', 'img.landscape': '横向 4:3', 'img.portrait': '竖向 3:4',
    'img.hint': '拖动调整位置，滚轮缩放；商品居中后确认，长边 700px，JPG 保存',
    'img.reSelect': '重新选择', 'img.confirm': '确认裁切', 'img.saved': '图片已保存', 'img.removed': '图片已删除',
    'img.saveFirst': '请先保存商品后再上传图片',
    // 标签排版弹窗
    'label.title': 'RFID 标签打印',
    'label.pick': '打印商品（70×35mm / 300dpi · 得实 DL-735RE）',
    'label.spec': '标签规格',
    'label.sheetUnit': '张标签',
    'label.preview': '标签预览（70×35mm 实物等比）',
    'label.epcAuto': 'EPC 打印时自动生成',
    'label.empty': '尚未选择，请到商品列表点「打印」添加',
    'label.add': '＋ 添加在库商品…', 'label.fields': '标签内容字段',
    'label.printer': '打印机', 'label.selPrinter': '— 请选择 —', 'label.noPrinter': '未检测到打印机',
    'label.btSel': '蓝牙打印机', 'label.btNone': '无已配对蓝牙打印机（请先在系统蓝牙中配对）', 'label.btSent': '已发送到蓝牙打印机', 'label.btFail': '蓝牙打印失败',
    'label.bridge': '打印桥',
    'pa.title': '本地打印桥', 'pa.key': '桥接密钥', 'pa.rotate': '重新生成',
    'pa.hint': '在店里连标签机的电脑上运行 scripts/print_agent.py，首次运行按提示填云端地址与该密钥即可；此后全店手机/电脑点打印均由这台电脑出纸。重新生成会使旧桥接失效，需在桥接机更新密钥。',
    // 门店与打印代理（多门店）
    'sb.title': '门店与打印代理',
    'sb.hint': '每家门店一把密钥。代理是通用程序（不绑定环境）：拷到该门店连打印机的电脑上双击运行，回到本页选门店点【连接本机代理】，服务器地址与密钥即推送给它，开始接收任务；打印机不过滤，全部上报，由你在此指派。',
    'sb.getAgent': '下载代理（通用版）',
    'sb.noKeyStore': '（请先在下方为门店生成密钥）',
    'sb.dlHint': '下载的 exe 不绑定环境；门店电脑双击运行后，点【连接本机代理】推送服务器地址与密钥。切换运行模式/地址后重新连接一次即可（本页打开期间每 30 秒自动跟随）。',
    'sb.connectAgent': '连接本机代理',
    'sb.localAgent': '本机代理',
    'sb.agentOn': '已连接门店「{s}」，可接收云端任务',
    'sb.agentIdle': '运行中，已配置但未连上云端',
    'sb.agentWaiting': '运行中，等待推送配置（点【连接本机代理】）',
    'sb.agentDownPc': '未检测到在线打印代理。若门店电脑还没装代理，在下方选门店下载后拷过去双击运行即可。',
    'sb.agentDownMobile': '打印代理未启动。请在电脑端打开本页面，进入【门店管理】下载代理并拷到门店电脑上运行。',
    // 库位主数据 / 商品位置
    'loc.title': '库位管理',
    'loc.hint': '为每家门店维护库位清单；商品的「存放位置」「证书存放位置」从本门店库位中选取。停用后不再出现在商品表单中，已引用的商品仍保留显示。',
    'loc.store': '所属门店',
    'loc.name': '库位名称',
    'loc.state': '状态',
    'loc.active': '启用中',
    'loc.inactive': '已停用',
    'loc.disable': '停用',
    'loc.enable': '启用',
    'loc.empty': '该门店暂无库位，请在下方新增',
    'loc.addNew': '新增库位',
    'loc.codePh': '如 A-01',
    'loc.namePh': '如 1号柜A层',
    'loc.needStore': '请先选择门店',
    'loc.needFields': '库位编号和名称必填',
    'loc.delConfirm': '确认删除该库位？已被商品引用的库位无法删除，请改用停用：',
    'loc.where': '存放位置',
    'loc.certWhere': '证书位置',
    'loc.noCert': '未配证书',
    'loc.allStores': '全部门店',
    'loc.allLoc': '全部库位',
    // 经办人类别
    'clerk.title': '经办人类别', 'clerk.hint': '开单必选类别（默认店员），具体人名可选填；类别改名不影响历史单据（历史单保留下单时名称）。',
    'clerk.name': '类别名称', 'clerk.default': '默认', 'clerk.needName': '请填写类别名称',
    'clerk.namePh': '如：主播 / 代理 / 代销', 'clerk.addNew': '新增类别', 'clerk.defaultLocked': '默认类别不可停用',
    // 门店调拨
    'tr.pick': '调拨选货', 'tr.pickHint': '调拨选择模式：勾选同一门店的在库商品（最多 50 件）；在途、已定等状态不可选。',
    'tr.scanAdd': '扫码加入', 'tr.picked': '已选', 'tr.itemsUnit': '件',
    'tr.pickEmpty': '没有符合条件的在库商品',
    'import.title': '批量导入商品', 'import.downloadTpl': '下载导入模板（xlsx）',
    'import.pickFile': '选择已填写的 xlsx 文件',
    'import.hint': '按模板表头填写；货号、名称必填；货号不可与店内已有商品重复；失败行会在下方列出，不影响其他行导入。',
    'import.importing': '正在导入，请稍候…',
    'import.created': '成功导入 {n} 条', 'import.failed': '{n} 条失败',
    'import.row': '行号', 'import.errMsg': '失败原因',
    'import.submit': '开始导入', 'import.reimport': '重新导入', 'import.fail': '导入失败',
    'tr.clear': '清空', 'tr.send': '发起调拨', 'tr.exit': '退出选择',
    'tr.onlyStock': '仅在库商品可调拨', 'tr.diffStore': '一次调拨只能选择同一门店的商品',
    'tr.alreadyPicked': '该商品已在调拨清单中', 'tr.needToStore': '请选择调入门店',
    'tr.sendTitle': '发起门店调拨', 'tr.fromStore': '调出门店', 'tr.toStore': '调入门店',
    'tr.remark': '备注', 'tr.remarkPh': '可填写调拨说明（选填）',
    'tr.confirmSend': '确认发出', 'tr.cancel': '取消', 'tr.sendOk': '调拨单已发出：',
    'tr.newTransfer': '发起调拨', 'tr.tabOut': '我发出的', 'tr.tabIn': '我接收的',
    'tr.empty': '暂无调拨单', 'tr.total': '总数', 'tr.matched': '相符', 'tr.diff': '不符',
    'tr.more': '等', 'tr.operator': '经办',
    'tr.close': '关闭', 'tr.resultCol': '验收结果', 'tr.decide': '验货结果',
    'tr.markOk': '相符', 'tr.markDiff': '不符', 'tr.startReceive': '开始验货',
    'tr.scanMatch': '扫码标相符', 'tr.recvHint': '逐件核对：扫码自动标为相符；不符项必须填写原因。',
    'tr.reasonPh': '不符原因（必填）', 'tr.qNoArrive': '未到货', 'tr.qBroken': '损坏', 'tr.qMismatch': '实物不符',
    'tr.needAll': '请完成全部商品的验货结果', 'tr.needReason': '不符商品必须填写原因：',
    'tr.confirmReceive': '提交验货', 'tr.receiveDone': '验货完成，相符',
    'tr.sentBy': '发出', 'tr.receivedBy': '验收', 'tr.counts': '件数',
    'tr.locked': '商品调拨在途中，验收完成前不可编辑',
    'hc.title': '系统自检',
    'hc.print_agent': '打印代理在线',
    'hc.anti_theft': '防盗系统运行',
    'hc.sec_pending': '防盗报警已处理',
    'hc.task_stall': '盘点任务正常推进',
    'hc.print_queue': '打印任务执行正常',
    'hc.missing_epc': '在库商品EPC覆盖',
    'hc.stocktake_overdue': '近期已完成盘点',
    'hc.credit_due': '客户欠款可控',
    'hc.ok': '正常', 'hc.bad': '异常', 'hc.na': '未配置',
    'sb.online': '在线', 'sb.offline': '离线',
    'sb.keySet': '已设置', 'sb.keyNone': '未设置', 'sb.genKey': '生成/重置',
    'sb.bindPrinter': '指派打印机', 'sb.waitOnline': '（代理离线，连接后显示打印机列表）',
    'sb.test': '测试页', 'sb.feed': '进纸', 'sb.backfeed': '退纸', 'sb.refresh': '刷新列表',
    'sb.jobQueued': '已写入打印队列（物理出纸请人眼核对）',
    'sb.assignTitle': '按业务指派打印机（多个业务可共用一台）', 'sb.notAssigned': '— 未指派 —',
    'pbizg.label': '标签 · ZPL标签机', 'pbizg.receipt': '票据 · 热敏小票机', 'pbizg.doc': '单据报表 · A4办公机/PDF',
    'pbiz.label_product': '商品RFID标签', 'pbiz.label_shelf': '货架库位标签',
    'pbiz.receipt_sale': '销售小票', 'pbiz.receipt_deposit': '定金收据', 'pbiz.receipt_loan': '借货单',
    'pbiz.receipt_repair': '维修单', 'pbiz.receipt_purchase': '采购入库单',
    'pbiz.receipt_outsourcing': '委外加工单', 'pbiz.receipt_inout': '出入库单',
    'pbiz.cert_warranty': '质保证书', 'pbiz.report_stocktake': '盘点表', 'pbiz.report_business': '经营报表',
    'sb.addStore': '新增门店', 'sb.storeName': '请输入门店名称',
    'sb.secPanel': '安防设备', 'sb.noSecDev': '本店暂无安防设备', 'sb.gotoSec': '前往安防中心',
    'sb.notConnected': '已生成密钥 · 未连接', 'sb.noKey': '未生成密钥',
    'sb.keyGen': '已生成打印代理密钥', 'sb.ctlOk': '指令已下发',
    'sb.revoke': '吊销', 'sb.revokeConfirm': '吊销后该代理 key 立即失效，确定？', 'sb.revoked': '已吊销',
    'sb.noAgent': '暂无打印代理实例，点上方「生成」创建',
    'sb.keyCopyHint': '请复制此密钥填入打印助手（StoreKey），仅显示一次：',
    'sb.genScanKey': '生成 Key', 'sb.scanKeyHint': '请复制此密钥填入扫描助手（device_token），仅显示一次：',
    'sb.offlineToast': '打印代理不在线，请先在该门店电脑上启动 PrintBridge',
    'sb.agentRoute': '标签将由该门店的打印代理出纸',
    'toast.keyCopied': '已复制',
    'toast.agentPushed': '配置已推送到本机代理',
    'toast.agentFail': '推送失败：{e}',
    'label.copies': '份数', 'label.font': '机内中文字体（^A@ 字体名，按打印机实际配置）',
    'label.writeEpc': '同时写入 RFID 芯片 EPC（^RFW）',
    'label.simulate': '仅生成 ZPL 指令（不实际打印，用于预览/调试）',
    'label.sent': '已发送', 'label.sheetsTo': '张到', 'label.genSim': '已生成', 'label.sheetsCmd': '张标签指令（模拟）',
    'label.viewZpl': '查看 ZPL 指令', 'label.sending': '发送中…', 'label.genZpl': '生成 ZPL 指令', 'label.print': '打印标签',
    'label.fld.store': '门店名称', 'label.fld.name': '商品名称', 'label.fld.spec': '材质克重',
    'label.fld.price': '售价', 'label.fld.cert': '证书号', 'label.fld.barcode': '条码', 'label.fld.epcText': 'EPC', 'label.fld.epcBarcode': 'EPC条码',
    'label.fld.code': '货号', 'label.fld.category': '品类', 'label.fld.material': '材质',
    'label.fld.weight': '克重', 'label.fld.size': '尺寸', 'label.fld.cost': '成本', 'label.fld.origin': '产地', 'label.fld.empty': '不可打印区',
    // 标签模板设计器
    'tpl.title': '标签打印模板', 'tpl.new': '＋ 新建模板', 'tpl.design': '设计', 'tpl.empty': '暂无模板，点「新建模板」创建',
    'tpl.designer': '模板设计器', 'tpl.name': '模板名称', 'tpl.namePh': '如：黄金标签 70×35',
    'tpl.size': '标签尺寸(mm)', 'tpl.width': '宽', 'tpl.height': '高',
    'tpl.writeEpc': '支持 RFID 芯片 EPC', 'tpl.rfidEpc': '支持 RFID 芯片 EPC',
    'tpl.fields': '点击字段添加到画布', 'tpl.props': '字段属性',
    'tpl.grp.prod': '商品信息', 'tpl.grp.price': '价格', 'tpl.grp.cert': '证书', 'tpl.grp.code': '条码与识别', 'tpl.grp.misc': '其他',
    'tpl.selSlot': '点击画布中的字段框进行编辑', 'tpl.removeSlot': '移除该字段',
    'tpl.posX': 'X(dots)', 'tpl.posY': 'Y(dots)', 'tpl.slotW': '宽(dots)', 'tpl.slotH': '高(dots)',
    'tpl.fontType': '输出类型', 'tpl.outType': '输出类型', 'tpl.direction': '方向',
    'tpl.font.cn': '中文', 'tpl.font.ascii': '英文/数字', 'tpl.font.barcode': '条码', 'tpl.font.qrcode': '二维码', 'tpl.font.empty': '不可打印区',
    'tpl.fontW': '字宽(dots)', 'tpl.fontH': '字高(dots)', 'tpl.barH': '条码高(dots)', 'tpl.qrSize': '尺寸(1-10)',
    'tpl.hint': '提示：拖动字段框调整位置；坐标单位为打印机 dots（300dpi，70×35mm = 827×413 dots）',
    'tpl.bgUpload': '上传底图', 'tpl.bgRotate': '旋转90°', 'tpl.bgRemove': '移除底图',
    'tpl.bgHint': '可上传 PNG 底图作为排版参考（不打印），底图默认填满模板区域、仅支持旋转不可拖动',
    'tpl.bgOn': '底图已启用', 'tpl.bgNotImg': '请选择图片文件', 'tpl.bgTooBig': '底图不能超过 4MB',
    'tpl.preview': '预览 ZPL（不打印）', 'tpl.previewHint': '用第一件在库商品按当前已保存的排版试生成 ZPL 打印指令，只显示不发送打印机，用于检查字段位置是否正确。修改排版后需先保存再预览。', 'tpl.previewResult': '预览结果', 'tpl.boundTpl': '打印模板', 'tpl.none': '— 未绑定 —',
    'tpl.useTpl': '模板排版', 'tpl.useCustom': '自定义字段', 'tpl.currentTpl': '命中模板',
    'tpl.nameRequired': '请先填写模板名称', 'tpl.saved': '模板已保存',
    'tpl.confirmDel': '确定删除该模板？删除后分类需重新绑定', 'tpl.deleted': '模板已删除',
    'tpl.bindOk': '模板绑定已更新', 'tpl.saveFirst': '请先保存模板再预览', 'tpl.previewOk': '预览已生成',
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
    // 商品标签（多标签 + 按标签分组统计）
    'tag.mgrTitle': '商品标签', 'tag.field': '商品标签', 'tag.name': '标签名称',
    'tag.namePh': '如：主推款', 'tag.color': '标签颜色', 'tag.usedCount': '已关联商品数',
    'tag.addNew': '新增标签', 'tag.nameRequired': '请先填写标签名称',
    'tag.delConfirm': '确认删除该标签？将解除 {n} 件商品的关联',
    'tag.unlinked': '已解除 {n} 件商品关联',
    'tag.noneHint': '暂无标签，请到「总部管理 → 商品标签」添加',
    'tag.salesStatsTitle': '销售额统计', 'tag.dimCategory': '品类', 'tag.dimTag': '标签',
    'rg.3m': '近3月', 'rg.6m': '近6月', 'rg.year': '今年',
    'tag.statsTitle': '标签统计', 'tag.pieceUnit': '件', 'tag.inStock': '在库', 'tag.salesAmt': '销售额',
    'tag.expand': '展开标签', 'tag.collapse': '收起标签',
    'tag.dupNote': '多标签商品在各标签组重复计入，占比分母为各组合计',
    'tag.group': '分组', 'tag.groupPh': '如：古董款', 'tag.ungrouped': '未分组',
    // 分类管理：一级分类=标签类别，二级分类=标签
    'tagGroup.oneTitle': '一级分类（标签类别）', 'tagGroup.twoTitle': '二级分类（标签）',
    'tagGroup.oneHint': '一级分类即标签归类维度（如风格/工艺/场景），可增删改；删除分类后其下标签归入未分组。',
    'tagGroup.addNew': '新增分类', 'tagGroup.name': '分类名称', 'tagGroup.namePh': '如：风格',
    'tagGroup.nameRequired': '请先填写分类名称', 'tagGroup.tagCount': '关联标签数',
    'tagGroup.delConfirm': '确认删除分类「{n}」？该分类下的标签将变为未分组（标签本身不删除）',
    'tagGroup.unlinked': '已解除 {n} 个标签的分类', 'tagGroup.filterAll': '全部',
    'tag.share': '占比', 'inv.tagShare': '标签库存占比', 'sale.tagShare': '标签销售占比',
    'rank.title': '前五排行', 'rank.periodHint': '周转/滞销为库存实时口径，其余按所选时段',
    'rank.turnover': '周转最快', 'rank.profit': '利润率最高', 'rank.qty': '销量最多',
    'rank.customer': '会员消费最多', 'rank.clerk': '店员销售最多', 'rank.slow': '滞销品',
    'rank.slowHint': '当前在库库龄', 'rank.category': '品类销售额最高',
    'rank.days': '天', 'rank.bills': '单', 'rank.empty': '暂无数据',    // 强制改密（运维端重置后）
    'fpwd.title': '强制修改密码', 'fpwd.tip': '密码已被运维端重置，为保障安全请设置新密码后继续使用。',
    'fpwd.new': '新密码', 'fpwd.confirm': '确认新密码', 'fpwd.submit': '修改密码并继续',
    'fpwd.mismatch': '两次输入的新密码不一致', 'fpwd.same': '新密码不能与原密码相同',
    'fpwd.ok': '密码已修改，欢迎继续使用', 'fpwd.need': '请先修改密码再继续操作',
    'fpwd.err': '修改失败，请重试',

  }
};
var currentLang = 'zh';

function dictOf(lang) { return I18N[LANG_MAP[lang]] || I18N.zh; }

function t(key, params) {
  // 优先读响应式状态 ST.lang（app.js 定义后）：
  // 使所有使用 t() 的绑定/计算属性建立对语言的响应式依赖，切换语言全界面即时刷新
  var lang = (typeof ST !== 'undefined' && ST && ST.lang) ? ST.lang : currentLang;
  // 建立对字典加载版本的响应式依赖：动态语言字典异步载入完成后，
  // 即使 ST.lang 值未变（select v-model 已先行改写）也能触发全界面重渲染
  if (typeof ST !== 'undefined' && ST) { void ST.dictVer; }
  var dict = dictOf(lang);
  var s = dict[key] != null ? dict[key] : (I18N.zh[key] != null ? I18N.zh[key] : key);
  // 可选命名占位替换：t('x', {n: 3}) → 文案中的 {n} 替换为 3
  if (params && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
    });
  }
  return s;
}

// 语言键规范化：'zh' 等历史/简写键统一为界面标准键（zh-Hans/en/it），
// 避免状态值与下拉选项(zh-Hans/en/it)不匹配导致语言选择器显示空白
function canonLang(k) {
  k = (k || '').trim();
  if (k === 'zh' || k === 'zh-CN' || k === 'zh-SG') return 'zh-Hans';
  if (LANG_KEYS.indexOf(k) >= 0) return k;
  return '';
}

function detectLang() {
  var saved = null;
  try { saved = localStorage.getItem('yi_lang'); } catch (e) {}
  saved = canonLang(saved);
  if (saved) return saved;
  var nav = (navigator.language || '').toLowerCase();
  if (nav.indexOf('zh-tw') === 0 || nav.indexOf('zh-hk') === 0 || nav.indexOf('zh-hant') === 0) return 'zh-Hant';
  if (nav.indexOf('zh') === 0) return 'zh-Hans';
  if (nav.indexOf('it') === 0) return 'it';
  if (nav.indexOf('ja') === 0) return 'ja';
  if (nav.indexOf('ko') === 0) return 'ko';
  if (nav.indexOf('en') === 0) return 'en';
  return 'zh-Hans';
}

function switchLang(lang) {
  lang = canonLang(lang);
  if (lang) {
    currentLang = lang;
    try { localStorage.setItem('yi_lang', lang); } catch (e) {}
  }
}

currentLang = detectLang();
switchLang(currentLang);   // 回写规范键，清理历史脏值（如 'zh'）

var I18N_VER = '20261013e161';   // 语言字典文件缓存版本（与 index.html 同步升级）
function registerLang(key, dict) { I18N[key] = dict; }
// index.html 启动时调用：返回需在 app.js 前同步加载的字典文件名后缀（中文返回 ''）
function i18nDictFile() { var d = LANG_MAP[currentLang]; return (d && d !== 'zh') ? d : ''; }
// 运行时按需加载语言字典（切换语言未加载时调用）；失败静默回退中文
function ensureLangDict(dictKey, cb) {
  if (!dictKey || dictKey === 'zh' || I18N[dictKey]) { cb(); return; }
  var s = document.createElement('script');
  s.src = './i18n.' + dictKey + '.js?v=' + I18N_VER;
  s.onload = cb; s.onerror = cb;
  document.head.appendChild(s);
}
