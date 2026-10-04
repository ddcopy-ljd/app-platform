/* ===== 懿臻珠宝云 · Vue3 SPA 主逻辑 ===== */

var API = '';

// ---- 响应式布局判定 ----
// 有鼠标/触控板等精确指针的设备（台式机、笔记本）一律使用 PC 宽屏布局，
// 不受浏览器窗口宽度、系统显示缩放(125%/150%)或 iframe 容器宽度影响；
// 纯触屏设备（手机/手持机）再按屏宽判断。
function isPcLayout() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) return true;
  } catch (e) {}
  return window.innerWidth >= 900;
}

// ---- 响应式状态 ----
var ST = Vue.reactive({
  token: '', user: null, mode: 'NORMAL', tenant: '',
  softName: '懿臻珠宝云',   // 软件名：启动时从 /api/health 拉取（源自 plugin.json），此处仅为兜底
  tab: 'dashboard', subView: '',
  isPc: isPcLayout(),
  lang: currentLang, langKeys: LANG_KEYS, langLabels: LANG_LABELS,
  loginUser: 'admin', loginPwd: '123456',
  // data
  dashData: null, trendData: null, remindData: null, showRemind: true, catSales: null,
  products: [], prodTotal: 0, prodCat: '', prodQ: '',
  cats: [], bizConfig: { epc_prefix: 'E280', seq_bits: 8 }, languages: [],
  catEdit: { code: '', names: { zh: '', en: '' }, sort_order: 0 }, catEditMode: 'new',
  sheetNameLang: currentLang,   // 商品表单当前编辑名称的语言（随全局语言初始化）
  deposits: [], depTotal: 0,
  sales: [], saleTotal: 0,
  subList: [], subTotal: 0, subPage: 1,
  appointments: [], profile: null,
  invSum: null,
  stockOptions: [],
  // 橱窗
  showcase: null,        // { title, subtitle, in_showcase: [], pool: [], count, max }
  showcasePoolQ: '',     // 搜索池
  showcaseDirty: false,  // 是否有未保存修改
  // sheet
  sheetMode: '', sheetTitle: '', sheetData: {},
  rfidResult: null, printItem: null,
  // RFID 标签排版打印
  labelDlg: false,
  labelItems: [],          // 已选商品 [{id,code,name}]
  printers: [], printerName: '', printSupported: true,
  labelFields: { store: true, name: true, spec: true, price: true, cert: false, barcode: true, epc_text: false },
  writeEpc: true, labelCopies: 1, labelFont: 'E:SIMSUN.FNT',
  simulatePrint: false, labelBusy: false, labelResult: null,
  // 盘点批次历史（协同盘点结果）
  stockBatches: [], stockDetail: null, batchProd: null,
  coTask: null, coTaskHost: '', coBusy: false, coTimer: null,
  invSub: 'stock',              // 库存页子页签：stock=在库商品，count=库存盘点
  invQ: '',                     // 在库商品搜索词
  _coTaskSeen: false,           // 内部标记：任务是否已被自动切换过（防止定时器反复把用户拽回盘点页签）
  coQrUrl: '', _qrFor: 0, _coQrObj: '',
  // 复制入库高亮（flashIds 中的商品 ID 列表，3.5s 后自动移除）
  flashIds: [],
  // toast
  toast: { show: false, text: '', type: 'success' },
});

// ---- helpers ----
function fmt(n) { return n == null ? '0' : Number(n).toLocaleString(); }
function fmtY(n) { return '￥' + fmt(n); }
function dateFmt(s) { return s ? String(s).replace(/-/g, '/') : ''; }

// i18n.js 已提供全局 t(key) 翻译函数（先于本文件加载）；
// 切勿在此重新声明同名 function t，否则会覆盖 window.t 导致自递归栈溢出。
// 仅在 i18n.js 缺失时兜底：原样返回 key。
if (typeof window.t !== 'function') { window.t = function (key) { return key; }; }

function api(m, url, body) {
  var h = { 'Content-Type': 'application/json' };
  if (ST.token) h['Authorization'] = 'Bearer ' + ST.token;
  var o = { method: m, headers: h };
  if (body) o.body = JSON.stringify(body);
  return fetch(API + url, o).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || 'error'); });
    return r.json();
  });
}

var _toastTimer = null;
function toast(text, type) {
  ST.toast = { show: true, text: text, type: type || 'success' };
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { ST.toast.show = false; }, 2200);
}

// ---- nav config ----
var NAV_ITEMS = [
  { id: 'dashboard', icon: '📊', key: 'nav.dashboard' },
  { id: 'products', icon: '💎', key: 'nav.products' },
  { id: 'inventory', icon: '📦', key: 'nav.inventory' },
  { id: 'sales', icon: '🧾', key: 'nav.sales' },
  { id: 'deposits', icon: '💰', key: 'nav.deposits' },
  { id: 'loans', icon: '🔁', key: 'nav.loans' },
  { id: 'customers', icon: '👥', key: 'nav.customers' },
  { id: 'repairs', icon: '🔧', key: 'nav.repairs' },
  { id: 'purchases', icon: '📥', key: 'nav.purchases' },
  { id: 'outsourcings', icon: '🏭', key: 'nav.outsourcings' },
  { id: 'appointments', icon: '📅', key: 'nav.appointments' },
  { id: 'showcase', icon: '🪟', key: 'nav.showcase' },
  { id: 'profile', icon: '🏪', key: 'nav.profile' },
  { id: 'logs', icon: '📋', key: 'nav.logs' },
];

var SUB_VIEWS = ['customers', 'loans', 'repairs', 'purchases', 'outsourcings', 'logs'];
var SUB_KEYS = {
  customers: '/api/customers/list', loans: '/api/loans',
  repairs: '/api/repairs', purchases: '/api/purchases',
  outsourcings: '/api/outsourcings', logs: '/api/logs'
};
var SUB_TITLES = {
  customers: 'nav.customers', loans: 'nav.loans', repairs: 'nav.repairs',
  purchases: 'nav.purchases', outsourcings: 'nav.outsourcings', logs: 'nav.logs'
};
var CATS = ['黄金', '钻石', '铂金', '翡翠', '彩宝', '其他'];

// 根据分类中文名取 code
function catCodeByName(name) {
  var c = (ST.cats || []).find(function (x) { return (x.names && x.names.zh) === name; });
  return c ? c.code : '';
}
function catObj(code) {
  return (ST.cats || []).find(function (x) { return x.code === code; }) || null;
}
// 根据 code 取中文名（兼容旧列 category）
function catNameByCode(code) {
  var c = (ST.cats || []).find(function (x) { return x.code === code; });
  return c && c.names ? (c.names.zh || c.code) : (code || '');
}
// 界面语言码(zh-Hans/en)归一化为分类名 JSON 的键(zh/en)
function normLang(k) { return (typeof LANG_MAP === 'object' && LANG_MAP[k]) || k || 'zh'; }
// 分类对象按指定（或全局）语言显示名称：当前语言 → 中文 → 英文 → 编码
function catNameOf(c, langKey) {
  if (!c) return '';
  var n = c.names || {};
  return n[normLang(langKey || ST.lang)] || n.zh || n.en || c.code;
}
// 商品行展示用：优先 category_code 对应语言名，旧数据回退 category 文本
function productCatName(p) {
  if (!p) return '';
  if (p.category_code) {
    var c = (ST.cats || []).find(function (x) { return x.code === p.category_code; });
    if (c) return catNameOf(c);
  }
  return p.category || '';
}
// 确保商品数据带 category_code（旧数据/中文品类名兜底）
function ensureCatCode(d) {
  if (!d.category_code) d.category_code = catCodeByName(d.category) || '';
  return d.category_code;
}

// ---- 商品名称多语言编辑（主名称列为中文，其它语言存 name_i18n JSON 串）----
function parseNameI18n() {
  try { return JSON.parse((ST.sheetData && ST.sheetData.name_i18n) || '{}') || {}; }
  catch (e) { return {}; }
}
// 名称输入框当前值：中文编辑主列 name，其它语言读写 name_i18n
function sheetNameGet() {
  var d = ST.sheetData || {};
  if (normLang(ST.sheetNameLang) === 'zh') return d.name || '';
  return parseNameI18n()[normLang(ST.sheetNameLang)] || '';
}
function sheetNameSet(v) {
  var d = ST.sheetData;
  if (normLang(ST.sheetNameLang) === 'zh') { d.name = v; return; }
  var m = parseNameI18n(), key = normLang(ST.sheetNameLang);
  if (v) m[key] = v; else delete m[key];
  d.name_i18n = JSON.stringify(m);
}
// 语言下拉项颜色：已录入绿色，未录入红色
function langNameFilled(langKey) {
  var d = ST.sheetData || {};
  if (normLang(langKey) === 'zh') return !!(d.name && String(d.name).trim());
  var v = parseNameI18n()[normLang(langKey)];
  return !!(v && String(v).trim());
}

// ---- computed-like getters ----
function filteredProducts() {
  var list = ST.products || [];
  if (ST.prodCat) list = list.filter(function (p) {
    // 按分类编号筛选；旧数据无 code 时用其中文品类名映射
    return p.category_code === ST.prodCat ||
           (!p.category_code && catCodeByName(p.category) === ST.prodCat);
  });
  if (ST.prodQ) {
    var q = ST.prodQ.toLowerCase();
    list = list.filter(function (p) {
      return (p.name && p.name.toLowerCase().indexOf(q) >= 0) ||
             (p.code && p.code.toLowerCase().indexOf(q) >= 0) ||
             (p.rfid_epc && p.rfid_epc.toLowerCase().indexOf(q) >= 0);
    });
  }
  return list;
}

function todoCount() {
  if (!ST.remindData) return 0;
  return (ST.remindData.deposits || []).length +
         (ST.remindData.loansOverdue || []).length +
         (ST.remindData.repairsPending || []).length;
}

// 库存页「在库商品」列表：在库 + 名称/编码/EPC 过滤
function invStockList() {
  var list = (ST.products || []).filter(function (p) { return p.status === '在库'; });
  if (ST.invQ) {
    var q = ST.invQ.toLowerCase();
    list = list.filter(function (p) {
      return (p.name && p.name.toLowerCase().indexOf(q) >= 0) ||
             (p.code && p.code.toLowerCase().indexOf(q) >= 0) ||
             (p.rfid_epc && p.rfid_epc.toLowerCase().indexOf(q) >= 0);
    });
  }
  return list;
}

// ---- 全局盘点冻结状态 ----
// 协同盘点任务存在（进行中/待核对）时，全店销售与出入库冻结。
// 后端在接口层强制拦截（400），前端读取 ST.coTask 统一屏蔽相关入口。
function isFrozen() { return !!ST.coTask; }

// 拦截守卫：返回 true 表示已冻结，调用方应直接 return
function checkFrozen() {
  if (!ST.coTask) return false;
  toast(t('inv.frozenBlock'), 'error');
  ST.tab = 'inventory'; ST.subView = ''; ST.invSub = 'count';
  loadInv(); loadStockBatches();
  return true;
}

function currentTitle() {
  var item = NAV_ITEMS.find(function (n) { return n.id === ST.tab; });
  return item ? t(item.key) : '';
}

function subTitle() {
  return t(SUB_TITLES[ST.subView] || '');
}

function exportHref() { return API + '/api/logs/export'; }

function statusClass(s) {
  var m = { '在库': 'tag-stock', '已定': 'tag-reserved', '已售': 'tag-sold', '借出': 'tag-blue' };
  return m[s] || 'tag-wine';
}

// ---- language ----
function setLang(lang) {
  switchLang(lang);
  ST.lang = currentLang;
}

// ---- navigation ----
function go(tab) {
  ST.tab = tab;
  ST.subView = '';
  if (tab === 'inventory') { loadInv(); loadStockBatches(); loadCoTask(); }
  if (tab === 'appointments') loadAppt();
  if (tab === 'profile') loadProfile();
}

function openSubView(name) {
  ST.subView = name;
  ST.subPage = 1;
  loadSubList();
}

// ---- data loading ----
function loadDash() {
  api('GET', '/api/dashboard/overview').then(function (r) { ST.dashData = r; }).catch(function () {});
  api('GET', '/api/dashboard/trend').then(function (r) { ST.trendData = r; }).catch(function () {});
  api('GET', '/api/dashboard/category-sales').then(function (r) { ST.catSales = r; }).catch(function () {});
  api('GET', '/api/dashboard/reminders').then(function (r) { ST.remindData = r; }).catch(function () {});
}

function refreshAll() {
  loadDash();
  loadCoTask();   // 全局同步盘点冻结状态，各页面据此屏蔽出入库操作
  api('GET', '/api/products?page=1&size=200').then(function (r) { ST.products = r.items; ST.prodTotal = r.total; }).catch(function () {});
  api('GET', '/api/deposits?page=1&size=100').then(function (r) { ST.deposits = r.items; ST.depTotal = r.total; }).catch(function () {});
  api('GET', '/api/sales?page=1&size=100').then(function (r) { ST.sales = r.items; ST.saleTotal = r.total; }).catch(function () {});
  api('GET', '/api/products/options?status=在库').then(function (r) { ST.stockOptions = r.items; }).catch(function () {});
  api('GET', '/api/categories').then(function (r) { ST.cats = r || []; }).catch(function () {});
  api('GET', '/api/biz-config').then(function (r) { ST.bizConfig = r; }).catch(function () {});
  api('GET', '/api/languages').then(function (r) { ST.languages = r || []; }).catch(function () {});
}

function loadSubList() {
  var u = SUB_KEYS[ST.subView];
  if (!u) return;
  api('GET', u + '?page=' + ST.subPage + '&size=100').then(function (r) {
    ST.subList = r.items; ST.subTotal = r.total;
  }).catch(function (e) { toast(e.message, 'error'); });
}

function loadInv() {
  api('GET', '/api/inventory/summary').then(function (r) { ST.invSum = r; }).catch(function () {});
}

function loadAppt() {
  api('GET', '/api/appointments').then(function (r) { ST.appointments = r.items; }).catch(function () {});
}

function loadProfile() {
  api('GET', '/api/profile').then(function (r) { ST.profile = r; }).catch(function () {});
}

// ---- login ----
function doLogin() {
  var u = ST.loginUser.trim();
  var p = ST.loginPwd;
  if (!u || !p) { toast(t('login.userPh'), 'error'); return; }
  api('POST', '/api/auth/login', { username: u, password: p }).then(function (r) {
    ST.token = r.token; ST.user = r.user; ST.mode = r.mode || 'NORMAL'; ST.tenant = r.tenant || '';
    syncToken();
    toast(t('login.success'));
    refreshAll();
  }).catch(function (e) { toast(e.message || t('login.err'), 'error'); });
}

function doLogout() {
  api('POST', '/api/auth/logout').catch(function () {});
  ST.token = ''; ST.user = null; ST.tab = 'dashboard'; ST.subView = '';
  syncToken();
}

// ---- sheet ----
function openSheet(mode, title, data) {
  ST.sheetMode = mode; ST.sheetTitle = title; ST.sheetData = Vue.reactive(data || {});
  ST.rfidResult = null;
}
function closeSheet() { ST.sheetMode = ''; ST.sheetData = {}; }

function openInbound() {
  if (checkFrozen()) return;
  openSheet('inbound', t('sheet.inbound'), { code: '', name: '', category: '黄金', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, rfid_epc: '', biz_date: new Date().toISOString().slice(0, 10) });
}

function addProduct() {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = { code: '', name: '', name_i18n: '{}', category: catNameByCode('01') || '黄金', category_code: '01', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, status: '在库', rfid_epc: '', showcase_public: 0, high_value: 0 };
  if (!catObj('01')) d.category_code = (ST.cats[0] && ST.cats[0].code) || '';
  openSheet('product', t('sheet.product'), d);
}

function editProduct(p) {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = Object.assign({}, p);
  ensureCatCode(d);
  openSheet('product', t('sheet.product'), d);
}

// 复制新增：以现有商品为模板预填表单，编码/EPC 留空，保存即建档新品
function copyProduct(p) {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = Object.assign({}, p);
  delete d.id;
  d.code = '';
  d.rfid_epc = '';
  ensureCatCode(d);
  openSheet('product', t('act.copyNew') + ' - ' + (p.name || ''), d);
  toast(t('act.copyNew') + ': ' + t('toast.fillCode'), 'info');
}

function delProduct(pid) {
  if (checkFrozen()) return;
  if (!confirm('Delete?')) return;
  api('DELETE', '/api/products/' + pid).then(function () { toast(t('toast.delOk')); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function printLabel(p) {
  api('POST', '/api/products/' + p.id + '/print-label', { template: 'fold', copies: 1 }).then(function (r) {
    ST.printItem = Object.assign({}, p, { rfid_epc: r.rfid_epc });
    toast(t('toast.printOk'));
    refreshAll();
  }).catch(function (e) { toast(e.message, 'error'); });
}

// 为已有商品按「前缀+分类码+序号」生成 EPC（编辑态使用）
function generateEpc() {
  var d = ST.sheetData;
  if (!d || !d.id) { toast(t('toast.saveFirst'), 'error'); return; }
  api('POST', '/api/products/' + d.id + '/generate-epc').then(function (r) {
    d.rfid_epc = r.epc;
    toast((r.reused ? t('toast.epcReused') : t('toast.epcGenOk')) + ' ' + r.epc);
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---------------- 店铺资料：分类管理 ----------------
function resetCatEdit() {
  ST.catEdit = { code: '', names: { zh: '', en: '' }, sort_order: (ST.cats || []).length + 1 };
  ST.catEditMode = 'new';
}
function editCat(c) {
  ST.catEditMode = 'edit';
  ST.catEdit = { code: c.code, names: Object.assign({}, c.names || { zh: '', en: '' }), sort_order: c.sort_order || 0 };
}
function saveCat() {
  var ce = ST.catEdit;
  if (!ce.code.trim()) { toast(t('toast.fillCatCode'), 'error'); return; }
  if (!(ce.names.zh || ce.names.en)) { toast(t('toast.fillCatName'), 'error'); return; }
  var body = { code: ce.code.trim(), names: { zh: ce.names.zh || '', en: ce.names.en || '' }, sort_order: Number(ce.sort_order) || 0 };
  var method = ST.catEditMode === 'edit' ? 'PUT' : 'POST';
  var url = ST.catEditMode === 'edit' ? '/api/categories/' + ce.code : '/api/categories';
  api(method, url, body).then(function () {
    toast(t('toast.saveOk'));
    resetCatEdit();
    api('GET', '/api/categories').then(function (r) { ST.cats = r || []; });
  }).catch(function (e) { toast(e.message, 'error'); });
}
function delCat(code) {
  if (!confirm('Delete category ' + code + '?')) return;
  api('DELETE', '/api/categories/' + code).then(function () {
    toast(t('toast.delOk'));
    api('GET', '/api/categories').then(function (r) { ST.cats = r || []; });
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---------------- 店铺资料：EPC 规则 ----------------
function saveBizConfig() {
  var cfg = ST.bizConfig;
  api('PUT', '/api/biz-config', { epc_prefix: (cfg.epc_prefix || '').trim().toUpperCase(), seq_bits: Number(cfg.seq_bits) || 8 }).then(function () {
    toast(t('toast.saveOk'));
    api('GET', '/api/biz-config').then(function (r) { ST.bizConfig = r; });
  }).catch(function (e) { toast(e.message, 'error'); });
}

function quickSale() {
  if (checkFrozen()) return;
  openSheet('sale', t('sheet.sale'), { customer: '', phone: '', product: '', product_id: null, amount: '', paid: 0, method: '现金', biz_date: new Date().toISOString().slice(0, 10) });
}

function openDeposit() {
  if (checkFrozen()) return;
  openSheet('deposit', t('sheet.deposit'), { customer: '', phone: '', product: '', product_id: null, total: 0, deposit: 0, balance: 0, promised_date: '', reminder_days: 7 });
}

function openLoan() {
  if (checkFrozen()) return;
  openSheet('loan', t('sheet.loan'), { direction: 'out', product: '', code: '', party: '', qty: 1, loan_date: new Date().toISOString().slice(0, 10), due_date: '' });
}

function openRepair() {
  openSheet('repair', t('sheet.repair'), { customer: '', phone: '', item: '', issue: '', est_fee: 0, actual_fee: 0, receive_date: new Date().toISOString().slice(0, 10), promised_date: '', status: '待维修', technician: '', remark: '' });
}

function editRepair(d) {
  openSheet('repair', t('sheet.repair'), Object.assign({}, d));
}

function openPurchase() {
  openSheet('purchase', t('sheet.purchase'), { supplier: '', product: '', qty: 1, cost: 0, order_date: new Date().toISOString().slice(0, 10), expected_date: '', received_date: '', status: '待发货', paid: 0 });
}

function openOutsource() {
  openSheet('outsource', t('sheet.outsource'), { factory: '', product: '', material: '', weight: 0, gold_price: 0, labor_fee: 0, send_date: new Date().toISOString().slice(0, 10), expected_date: '', received_date: '' });
}

function openCustomer() {
  openSheet('customer', t('sheet.customer'), { name: '', phone: '', level: '普通', birthday: '', preference: '' });
}

function openRfid() {
  openSheet('rfid', t('sheet.rfid'), { epcText: '' });
}

function onPickProduct() {
  var pid = ST.sheetData.product_id;
  if (!pid) return;
  var p = ST.stockOptions.find(function (x) { return x.id === pid; });
  if (p) {
    ST.sheetData.product = p.name;
    if (ST.sheetMode === 'sale') ST.sheetData.amount = p.price;
  }
}

// ---- submit ----
// 盘点冻结期间禁止提交的表单类型（开单/收定金/建档/入库/借货）
var FROZEN_SHEETS = { sale: 1, deposit: 1, product: 1, inbound: 1, loan: 1 };

function submitSheet() {
  var d = ST.sheetData;
  if (FROZEN_SHEETS[ST.sheetMode] && checkFrozen()) { closeSheet(); return; }
  if (ST.sheetMode === 'sale') {
    if (!d.customer && !d.phone) { toast(t('toast.fillCustomer'), 'error'); return; }
    if (!d.product && !d.product_id) { toast(t('toast.fillProduct'), 'error'); return; }
    if (!d.amount) { toast(t('toast.fillAmount'), 'error'); return; }
    api('POST', '/api/sales', { customer: d.customer || '', phone: d.phone || '', product: d.product || '', product_id: d.product_id || null, amount: Number(d.amount) || 0, paid: Number(d.paid) || 0, method: d.method || '现金', biz_date: d.biz_date || '' }).then(function (r) {
      toast(t('toast.saveOk') + ' ' + r.bill_no); closeSheet(); refreshAll();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'deposit') {
    if (!d.customer) { toast(t('toast.fillCustomer'), 'error'); return; }
    api('POST', '/api/deposits', { customer: d.customer || '', phone: d.phone || '', product_id: d.product_id || null, product: d.product || '', total: Number(d.total) || 0, deposit: Number(d.deposit) || 0, balance: Number(d.balance) || 0, promised_date: d.promised_date || '', reminder_days: Number(d.reminder_days) || 7 }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); refreshAll();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'product') {
    if (!d.code || !d.name) { toast(t('toast.fillCode'), 'error'); return; }
    var cc2 = ensureCatCode(d);
    var catZh = catNameByCode(cc2) || d.category || '其他';
    var m2 = d.id ? 'PUT' : 'POST';
    var u2 = d.id ? '/api/products/' + d.id : '/api/products';
    api(m2, u2, { code: d.code || '', name: d.name || '', category: catZh, category_code: cc2 || '', name_i18n: d.name_i18n || '{}', material: d.material || '', weight: Number(d.weight) || 0, size: d.size || '', cert: d.cert || '', cost: Number(d.cost) || 0, price: Number(d.price) || 0, status: d.status || '在库', rfid_epc: d.rfid_epc || '', showcase_public: d.showcase_public || 0, high_value: d.high_value || 0 }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); refreshAll();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'inbound') {
    if (!d.name) { toast(t('toast.fillProduct'), 'error'); return; }
    api('POST', '/api/inventory/inbound', { code: d.code || '', name: d.name, category: d.category || '黄金', material: d.material || '', weight: Number(d.weight) || 0, size: d.size || '', cert: d.cert || '', cost: Number(d.cost) || 0, price: Number(d.price) || 0, rfid_epc: d.rfid_epc || '', biz_date: d.biz_date || '' }).then(function (r) {
      toast(t('toast.saveOk') + ' ' + r.code + ' EPC:' + r.rfid_epc); closeSheet(); refreshAll(); loadInv();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'loan') {
    if (!d.product) { toast(t('toast.fillProduct'), 'error'); return; }
    api('POST', '/api/loans', { direction: d.direction || 'out', product: d.product || '', code: d.code || '', party: d.party || '', qty: Number(d.qty) || 1, loan_date: d.loan_date || '', due_date: d.due_date || '' }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); loadSubList(); refreshAll();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'repair') {
    if (!d.customer) { toast(t('toast.fillCustomer'), 'error'); return; }
    var rm = d.id ? 'PUT' : 'POST';
    var ru = d.id ? '/api/repairs/' + d.id : '/api/repairs';
    api(rm, ru, { customer: d.customer || '', phone: d.phone || '', item: d.item || '', issue: d.issue || '', est_fee: Number(d.est_fee) || 0, actual_fee: Number(d.actual_fee) || 0, receive_date: d.receive_date || '', promised_date: d.promised_date || '', status: d.status || '待维修', technician: d.technician || '', remark: d.remark || '' }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); loadSubList();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'purchase') {
    if (!d.supplier) { toast(t('toast.fillSupplier'), 'error'); return; }
    api('POST', '/api/purchases', { supplier: d.supplier || '', product: d.product || '', qty: Number(d.qty) || 1, cost: Number(d.cost) || 0, order_date: d.order_date || '', expected_date: d.expected_date || '', received_date: d.received_date || '', status: d.status || '待发货', paid: Number(d.paid) || 0 }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); loadSubList();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'outsource') {
    if (!d.factory) { toast(t('toast.fillFactory'), 'error'); return; }
    api('POST', '/api/outsourcings', { factory: d.factory || '', product: d.product || '', material: d.material || '', weight: Number(d.weight) || 0, gold_price: Number(d.gold_price) || 0, labor_fee: Number(d.labor_fee) || 0, send_date: d.send_date || '', expected_date: d.expected_date || '', received_date: d.received_date || '', status: '加工中' }).then(function () {
      toast(t('toast.saveOk')); closeSheet(); loadSubList();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'customer') {
    if (!d.name) { toast(t('toast.fillCustomer'), 'error'); return; }
    var cm = d.id ? 'PUT' : 'POST';
    var cu = d.id ? '/api/customers/' + d.id : '/api/customers';
    api(cm, cu, { name: d.name, phone: d.phone || '', level: d.level || '普通', birthday: d.birthday || '', preference: d.preference || '' }).then(function () {
      toast(t('toast.custSaveOk')); closeSheet(); loadSubList();
    }).catch(function (e) { toast(e.message, 'error'); });
  }
}

// ---- actions ----
function voidSale(s) {
  if (checkFrozen()) return;
  if (!confirm(t('act.void') + '?')) return;
  api('POST', '/api/sales/' + s.id + '/void').then(function () { toast(t('toast.voidOk')); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function payDeposit(d) {
  if (checkFrozen()) return;
  if (!confirm(t('act.payBal') + '?')) return;
  api('POST', '/api/deposits/' + d.id + '/pay').then(function (r) { toast(t('toast.payOk') + ' ' + r.bill_no); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function voidDeposit(d) {
  if (checkFrozen()) return;
  if (!confirm(t('act.void') + '?')) return;
  api('POST', '/api/deposits/' + d.id + '/void').then(function () { toast(t('toast.voidOk')); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function returnLoan(d) {
  if (checkFrozen()) return;
  api('POST', '/api/loans/' + d.id + '/return').then(function () { toast(t('toast.returnOk')); loadSubList(); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function copyInbound(pid) {
  if (checkFrozen()) return;
  api('POST', '/api/inventory/copy/' + pid).then(function (r) {
    ST.flashIds.push(r.id);
    setTimeout(function () {
      var i = ST.flashIds.indexOf(r.id);
      if (i >= 0) ST.flashIds.splice(i, 1);
    }, 3500);
    toast(t('toast.saveOk') + ' ' + r.code); refreshAll(); loadInv();
  }).catch(function (e) { toast(e.message, 'error'); });
}

function receivePurchase(d) {
  if (checkFrozen()) return;
  api('POST', '/api/purchases/' + d.id + '/receive').then(function (r) { toast(t('toast.receiveOk') + ' ' + r.code); refreshAll(); loadSubList(); }).catch(function (e) { toast(e.message, 'error'); });
}

function receiveOut(d) {
  if (checkFrozen()) return;
  api('POST', '/api/outsourcings/' + d.id + '/receive').then(function (r) { toast(t('toast.receiveOk') + ' ' + r.code + ' ￥' + fmt(r.cost)); refreshAll(); loadSubList(); }).catch(function (e) { toast(e.message, 'error'); });
}

function setAppt(d, status) {
  api('PUT', '/api/appointments/' + d.id, { status: status }).then(function () { toast(t('toast.apptAcceptOk')); loadAppt(); }).catch(function (e) { toast(e.message, 'error'); });
}

function saveProfile() {
  var p = ST.profile;
  api('PUT', '/api/profile', p).then(function () { toast(t('toast.profileSaveOk')); }).catch(function (e) { toast(e.message, 'error'); });
}

function exportLogs() {
  window.open(API + '/api/logs/export', '_blank');
  toast(t('toast.exportOk'));
}

// ---- RFID ----
function doRfid(simulate) {
  var d = ST.sheetData;
  var epcs = [];
  if (d.epcText) epcs = d.epcText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  api('POST', '/api/inventory/rfid-scan', { epcs: epcs, simulate: simulate }).then(function (r) {
    ST.rfidResult = r;
    toast(t('toast.scanOk') + ': ' + r.scannedCount + '/' + r.bookCount);
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---- RFID 标签排版打印 ----
var FIELD_LABELS = {
  store: '门店名称', name: '商品名称', spec: '材质克重',
  price: '售价', cert: '证书号', barcode: '货号条码', epc_text: 'EPC明文',
};

function openLabelPrint(p) {
  ST.labelDlg = true;
  ST.labelResult = null;
  if (p && !ST.labelItems.some(function (x) { return x.id === p.id; })) {
    ST.labelItems.push({ id: p.id, code: p.code, name: p.name });
  }
  api('GET', '/api/print/printers').then(function (r) {
    var list = r.printers || [];
    ST.printSupported = r.supported;
    if (r.supported) {
      // 先定值、后赋选项列表，避免 select options 未渲染时 v-model 落空
      if (!ST.printerName) {
        ST.printerName = list.find(function (n) { return /735|DASCOM/i.test(n); }) || list[0] || '';
      }
      ST.printers = list;
    } else {
      ST.simulatePrint = true;
      ST.printers = [];
    }
  }).catch(function () {});
}
function removeLabelItem(id) {
  ST.labelItems = ST.labelItems.filter(function (x) { return x.id !== id; });
}
function closeLabel() { ST.labelDlg = false; }
function submitLabelPrint() {
  if (!ST.labelItems.length) { toast('请先选择要打印的商品', 'error'); return; }
  ST.labelBusy = true;
  var fields = Object.keys(ST.labelFields).filter(function (k) { return ST.labelFields[k]; });
  api('POST', '/api/print/labels', {
    product_ids: ST.labelItems.map(function (x) { return x.id; }),
    printer: ST.printerName, copies: ST.labelCopies || 1, fields: fields,
    write_epc: ST.writeEpc, font: ST.labelFont || '', simulate: ST.simulatePrint || !ST.printSupported,
  }).then(function (r) {
    ST.labelResult = r;
    toast(r.sent ? '已发送到打印机' : 'ZPL 指令已生成');
    refreshAll();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.labelBusy = false; });
}

// ---- 盘点批次历史 ----
function loadStockBatches() {
  api('GET', '/api/stocktake/list?limit=8').then(function (r) { ST.stockBatches = r.list || []; }).catch(function () {});
}
function viewStockBatch(b) {
  api('GET', '/api/stocktake/' + b.id).then(function (r) { ST.stockDetail = r; }).catch(function (e) { toast(e.message, 'error'); });
}
// 批次明细中点击商品：拉取商品档案查看详情（盘盈/异常项可能无档案）
function viewBatchProduct(it) {
  if (!it.product_id) { toast(t('toast.noProdFile'), 'error'); return; }
  api('GET', '/api/products/' + it.product_id).then(function (p) { ST.batchProd = p; })
    .catch(function () { toast(t('toast.noProdFile'), 'error'); });
}

// ---- 多终端协同盘点 ----
function startCoTask() {
  if (!confirm('开启盘点任务后，本店销售与出入库将暂停，直到主管核对确认。确定开启？')) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/start', { host: ST.coTaskHost || '' }).then(function (r) {
    ST.coTask = r;
    loadCoQr(r.id);
    toast('盘点任务已开启，请手持机扫码加入');
    ensureCoTimer();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function loadCoTask() {
  api('GET', '/api/stocktake/task/active').then(function (r) {
    if (r && r.active) {
      ST.coTask = r; ensureCoTimer(); loadCoQr(r.id);
      // 任务刚出现（从无到有）时自动切到盘点页签一次，用户手动切走则不再打扰
      if (!ST._coTaskSeen && ST.tab === 'inventory') { ST.invSub = 'count'; }
      ST._coTaskSeen = true;
    }
    else { clearCoTask(); }
  }).catch(function () {});
}
function clearCoTask() {
  if (ST._coQrObj) { try { URL.revokeObjectURL(ST._coQrObj); } catch (e) {} }
  ST._coQrObj = ''; ST._qrFor = 0; ST.coQrUrl = '';
  ST.coTask = null; ST._coTaskSeen = false; clearCoTimer();
}
// 二维码接口需要登录态，<img> 无法带 Authorization 头，故用带 token 的 fetch 取 SVG 再转 blob 显示。
function loadCoQr(id) {
  if (ST._qrFor === id || !ST.token) return;
  ST._qrFor = id;
  fetch(API + '/api/stocktake/task/' + id + '/qr', { headers: { 'Authorization': 'Bearer ' + ST.token } })
    .then(function (r) {
      if (!r.ok) throw new Error('qr ' + r.status);
      return r.blob();
    })
    .then(function (b) {
      if (ST._coQrObj) { try { URL.revokeObjectURL(ST._coQrObj); } catch (e) {} }
      ST._coQrObj = URL.createObjectURL(b);
      ST.coQrUrl = ST._coQrObj;
    })
    .catch(function () { ST.coQrUrl = ''; });
}
function endCoTask() {
  if (!ST.coTask) return;
  if (!confirm('确定结束扫描？\n\n结束后：手持机停止上传，系统合并各设备扫描结果并生成差异（相符/盘亏/异常）供你核对。\n注意：销售与出入库仍然冻结，核对无误后需再点【核对确认，解除销售冻结】才会恢复营业。')) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/end', {}).then(function () {
    toast('已核对，请查看差异并确认'); loadCoTask();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function confirmCoTask() {
  if (!ST.coTask) return;
  if (!confirm('差异核对无误？确认后解除销售/出入库冻结，任务完成。')) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/confirm', {}).then(function () {
    toast('盘点完成，销售已恢复'); clearCoTask(); loadStockBatches();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
// 强制终止：手持机故障/无法加入/误开任务时立即解冻，不生成盘点结果
function abortCoTask() {
  if (!ST.coTask) return;
  if (!confirm('【强制终止任务】\n\n立即解除销售/出入库冻结，本次盘点不生成核对结果，已扫描数据仅作记录。确定终止？')) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/abort', {}).then(function () {
    toast('任务已强制终止，销售已恢复'); clearCoTask(); loadStockBatches();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function copyCoUrl() {
  if (ST.coTask && navigator.clipboard) navigator.clipboard.writeText(ST.coTask.co_url).then(function () { toast('加入地址已复制'); });
}
function ensureCoTimer() {
  if (ST.coTimer) return;
  ST.coTimer = setInterval(function () { if (ST.coTask && ST.coTask.status === '进行中') loadCoTask(); else clearCoTimer(); }, 5000);
}
function clearCoTimer() {
  if (ST.coTimer) { clearInterval(ST.coTimer); ST.coTimer = null; }
}

// ---- resize ----
window.addEventListener('resize', function () { ST.isPc = isPcLayout(); });

// ---- 软件名称（源自 plugin.json，经 /api/health 下发）----
(function loadSoftName() {
  fetch(API + '/api/health').then(function (r) { return r.json(); }).then(function (r) {
    if (r && r.name) { ST.softName = r.name; document.title = r.name; }
  }).catch(function () {});
})();

// ---- Vue app ----
var app = Vue.createApp({
  data: function () { return ST; },
  computed: {
    filteredProducts: filteredProducts,
    invStockList: invStockList,
    todoCount: todoCount,
    frozen: isFrozen,
    currentTitle: currentTitle,
    subTitle: subTitle,
    exportHref: exportHref,
    nav: function () { return NAV_ITEMS; },
    cats: function () {
      var list = (ST.cats || []).map(function (c) { return (c.names && c.names.zh) || c.code; });
      return list.length ? list : CATS;
    },
    // 原始分类对象（带 code/names），供商品表单与筛选chips使用
    catList: function () { return ST.cats || []; },
    FIELD_LABELS: function () { return FIELD_LABELS; },
  },
  methods: {
    t: t, fmt: fmt, fmtY: fmtY, dateFmt: dateFmt,
    statusClass: statusClass,
    doLogin: doLogin, doLogout: doLogout,
    go: go, openSubView: openSubView, setLang: setLang,
    openSheet: openSheet, closeSheet: closeSheet, submitSheet: submitSheet,
    onPickProduct: onPickProduct,
    addProduct: addProduct, editProduct: editProduct, delProduct: delProduct, printLabel: printLabel,
    copyProduct: copyProduct, generateEpc: generateEpc,
    catNameByCode: catNameByCode, catCodeByName: catCodeByName,
    catNameOf: catNameOf, productCatName: productCatName,
    sheetNameGet: sheetNameGet, sheetNameSet: sheetNameSet, langNameFilled: langNameFilled,
    resetCatEdit: resetCatEdit, editCat: editCat, saveCat: saveCat, delCat: delCat,
    saveBizConfig: saveBizConfig,
    openInbound: openInbound, copyInbound: copyInbound, openRfid: openRfid, doRfid: doRfid,
    openLabelPrint: openLabelPrint, removeLabelItem: removeLabelItem, closeLabel: closeLabel,
    submitLabelPrint: submitLabelPrint,
    loadStockBatches: loadStockBatches,
    viewStockBatch: viewStockBatch, viewBatchProduct: viewBatchProduct,
    startCoTask: startCoTask, loadCoTask: loadCoTask, endCoTask: endCoTask,
    confirmCoTask: confirmCoTask, abortCoTask: abortCoTask, copyCoUrl: copyCoUrl,
    quickSale: quickSale, openDeposit: openDeposit,
    voidSale: voidSale, payDeposit: payDeposit, voidDeposit: voidDeposit,
    openLoan: openLoan, returnLoan: returnLoan,
    openRepair: openRepair, editRepair: editRepair,
    openPurchase: openPurchase, receivePurchase: receivePurchase,
    openOutsource: openOutsource, receiveOut: receiveOut,
    openCustomer: openCustomer,
    setAppt: setAppt, saveProfile: saveProfile, exportLogs: exportLogs,
    loadAppt: loadAppt, loadProfile: loadProfile,
  }
});

app.mount('#app');

// token persistence
function syncToken() {
  try {
    if (ST.token) sessionStorage.setItem('jewelry_token', ST.token);
    else sessionStorage.removeItem('jewelry_token');
  } catch (e) {}
}

// auto-init if token exists (e.g. from sessionStorage)
try {
  var saved = sessionStorage.getItem('jewelry_token');
  if (saved) {
    ST.token = saved;
    api('GET', '/api/auth/me').then(function (r) {
      ST.user = r.user; ST.mode = r.mode || 'NORMAL'; ST.tenant = r.tenant || '';
      refreshAll();
    }).catch(function () { ST.token = ''; sessionStorage.removeItem('jewelry_token'); });
  }
} catch (e) {}

// ---- 全局冻结状态慢速轮询 ----
// 任务可能由另一台电脑开启/确认/终止；即使不在库存页也要能感知冻结与解冻。
// 进行中任务的 5s 快速轮询由 ensureCoTimer 负责，这里是全局面兜底。
setInterval(function () { if (ST.token) loadCoTask(); }, 15000);

