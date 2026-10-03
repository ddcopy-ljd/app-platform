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
    'kpi.recent': '最近销售', 'kpi.quick': '快捷入口',
    'kpi.stockCost': '成本', 'kpi.todayCount': '笔', 'kpi.unit': '元',
    // cats
    'cat.all': '全部', 'cat.gold': '黄金', 'cat.diamond': '钻石', 'cat.jade': '翡翠',
    'cat.platinum': '铂金', 'cat.gemstone': '彩宝', 'cat.other': '其他',
    // actions
    'act.add': '新增', 'act.edit': '编辑', 'act.del': '删除', 'act.print': '打印标签',
    'act.void': '冲红', 'act.payBal': '收尾款', 'act.deposit': '收定金',
    'act.clear': '清除', 'act.save': '保存', 'act.cancel': '取消', 'act.confirm': '确认',
    'act.submit': '确认提交', 'act.export': '导出CSV', 'act.inbound': '入库', 'act.copy': '复制入库',
    'act.scan': '盘点', 'act.return': '归还', 'act.receive': '入库', 'act.takeDelivery': '收货',
    'act.close': '关闭', 'act.viewSite': '查看网站', 'act.acceptAppt': '接受预约',
    // inv
    'inv.in': '入库', 'inv.copy': '复制', 'inv.copyHint': '在库商品（可复制快速入库）',
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
    'lbl.out': '借出', 'lbl.in': '借入', 'lbl.remark': '备注',
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
    'toast.scanOk': '盘点完成', 'toast.apptOk': '预约已确认',
    'toast.fillFactory': '请填写加工厂', 'toast.fillSupplier': '请填写供应商',
    'toast.fillCustomer': '请填写客户姓名', 'toast.fillProduct': '请填写商品名称',
    'toast.fillCode': '请填写商品编码', 'toast.fillAmount': '请填写金额',
    'toast.returnOk': '已归还，库存已恢复', 'toast.receiveOk': '已收货入库',
    'toast.custSaveOk': '客户已保存', 'toast.profileSaveOk': '店铺资料已保存',
    'toast.exportOk': '已导出CSV', 'toast.apptAcceptOk': '预约已接受',
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
    'kpi.recent': 'Recent Sales', 'kpi.quick': 'Quick Access',
    'kpi.stockCost': 'Cost', 'kpi.todayCount': 'bills', 'kpi.unit': '',
    // cats
    'cat.all': 'All', 'cat.gold': 'Gold', 'cat.diamond': 'Diamond', 'cat.jade': 'Jade',
    'cat.platinum': 'Platinum', 'cat.gemstone': 'Gemstone', 'cat.other': 'Other',
    // actions
    'act.add': 'Add', 'act.edit': 'Edit', 'act.del': 'Delete', 'act.print': 'Print Label',
    'act.void': 'Void', 'act.payBal': 'Pay Balance', 'act.deposit': 'Take Deposit',
    'act.clear': 'Clear', 'act.save': 'Save', 'act.cancel': 'Cancel', 'act.confirm': 'Confirm',
    'act.submit': 'Submit', 'act.export': 'Export CSV', 'act.inbound': 'Inbound', 'act.copy': 'Copy',
    'act.scan': 'Count', 'act.return': 'Return', 'act.receive': 'Receive', 'act.takeDelivery': 'Take Delivery',
    'act.close': 'Close', 'act.viewSite': 'View Site', 'act.acceptAppt': 'Accept',
    // inv
    'inv.in': 'Inbound', 'inv.copy': 'Copy', 'inv.copyHint': 'In-stock items (copy to quick inbound)',
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
    'lbl.out': 'Out', 'lbl.in': 'In', 'lbl.remark': 'Remark',
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
    'toast.scanOk': 'Count completed', 'toast.apptOk': 'Appointment confirmed',
    'toast.fillFactory': 'Please enter factory', 'toast.fillSupplier': 'Please enter supplier',
    'toast.fillCustomer': 'Please enter customer name', 'toast.fillProduct': 'Please enter product name',
    'toast.fillCode': 'Please enter product code', 'toast.fillAmount': 'Please enter amount',
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
