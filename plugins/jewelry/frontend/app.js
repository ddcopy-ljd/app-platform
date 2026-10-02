/* ===== 懿臻珠宝云 · Vue3 SPA 主逻辑 ===== */

var API = '';

// ---- 响应式状态 ----
var ST = Vue.reactive({
  token: '', user: null, mode: 'NORMAL', tenant: '',
  tab: 'dashboard', subView: '',
  isPc: window.innerWidth >= 900,
  lang: currentLang, langKeys: LANG_KEYS, langLabels: LANG_LABELS,
  loginUser: 'admin', loginPwd: '123456',
  // data
  dashData: null, trendData: null, remindData: null, showRemind: true,
  products: [], prodTotal: 0, prodCat: '', prodQ: '',
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
  // 手持机盘点
  stockQr: null, stockHost: '', stockBatches: [], stockDetail: null, stockBusy: false,
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

// ---- computed-like getters ----
function filteredProducts() {
  var list = ST.products || [];
  if (ST.prodCat) list = list.filter(function (p) { return p.category === ST.prodCat; });
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
  if (tab === 'inventory') { loadInv(); loadStockBatches(); }
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
  api('GET', '/api/dashboard/reminders').then(function (r) { ST.remindData = r; }).catch(function () {});
}

function refreshAll() {
  loadDash();
  api('GET', '/api/products?page=1&size=200').then(function (r) { ST.products = r.items; ST.prodTotal = r.total; }).catch(function () {});
  api('GET', '/api/deposits?page=1&size=100').then(function (r) { ST.deposits = r.items; ST.depTotal = r.total; }).catch(function () {});
  api('GET', '/api/sales?page=1&size=100').then(function (r) { ST.sales = r.items; ST.saleTotal = r.total; }).catch(function () {});
  api('GET', '/api/products/options?status=在库').then(function (r) { ST.stockOptions = r.items; }).catch(function () {});
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
  openSheet('inbound', t('sheet.inbound'), { code: '', name: '', category: '黄金', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, rfid_epc: '', biz_date: new Date().toISOString().slice(0, 10) });
}

function addProduct() {
  openSheet('product', t('sheet.product'), { code: '', name: '', category: '黄金', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, status: '在库', rfid_epc: '', showcase_public: 0 });
}

function editProduct(p) {
  openSheet('product', t('sheet.product'), Object.assign({}, p));
}

function delProduct(pid) {
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

function quickSale() {
  openSheet('sale', t('sheet.sale'), { customer: '', phone: '', product: '', product_id: null, amount: '', paid: 0, method: '现金', biz_date: new Date().toISOString().slice(0, 10) });
}

function openDeposit() {
  openSheet('deposit', t('sheet.deposit'), { customer: '', phone: '', product: '', product_id: null, total: 0, deposit: 0, balance: 0, promised_date: '', reminder_days: 7 });
}

function openLoan() {
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
function submitSheet() {
  var d = ST.sheetData;
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
    var m2 = d.id ? 'PUT' : 'POST';
    var u2 = d.id ? '/api/products/' + d.id : '/api/products';
    api(m2, u2, { code: d.code || '', name: d.name || '', category: d.category || '黄金', material: d.material || '', weight: Number(d.weight) || 0, size: d.size || '', cert: d.cert || '', cost: Number(d.cost) || 0, price: Number(d.price) || 0, status: d.status || '在库', rfid_epc: d.rfid_epc || '', showcase_public: d.showcase_public || 0 }).then(function () {
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
  if (!confirm(t('act.void') + '?')) return;
  api('POST', '/api/sales/' + s.id + '/void').then(function () { toast(t('toast.voidOk')); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function payDeposit(d) {
  if (!confirm(t('act.payBal') + '?')) return;
  api('POST', '/api/deposits/' + d.id + '/pay').then(function (r) { toast(t('toast.payOk') + ' ' + r.bill_no); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function voidDeposit(d) {
  if (!confirm(t('act.void') + '?')) return;
  api('POST', '/api/deposits/' + d.id + '/void').then(function () { toast(t('toast.voidOk')); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function returnLoan(d) {
  api('POST', '/api/loans/' + d.id + '/return').then(function () { toast(t('toast.returnOk')); loadSubList(); refreshAll(); }).catch(function (e) { toast(e.message, 'error'); });
}

function copyInbound(pid) {
  api('POST', '/api/inventory/copy/' + pid).then(function (r) { toast(t('toast.saveOk') + ' ' + r.code); refreshAll(); loadInv(); }).catch(function (e) { toast(e.message, 'error'); });
}

function receivePurchase(d) {
  api('POST', '/api/purchases/' + d.id + '/receive').then(function (r) { toast(t('toast.receiveOk') + ' ' + r.code); refreshAll(); loadSubList(); }).catch(function (e) { toast(e.message, 'error'); });
}

function receiveOut(d) {
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

// ---- 手持机批量盘点 ----
function genStockQr() {
  ST.stockBusy = true;
  api('POST', '/api/stocktake/setup', { host: ST.stockHost || '' }).then(function (r) {
    ST.stockQr = r;
    loadStockBatches();
    toast('盘点二维码已生成，有效期 12 小时');
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.stockBusy = false; });
}
function loadStockBatches() {
  api('GET', '/api/stocktake/list?limit=8').then(function (r) { ST.stockBatches = r.list || []; }).catch(function () {});
}
function viewStockBatch(b) {
  api('GET', '/api/stocktake/' + b.id).then(function (r) { ST.stockDetail = r; }).catch(function (e) { toast(e.message, 'error'); });
}
function copyStockUrl() {
  if (!ST.stockQr) return;
  var u = ST.stockQr.url;
  if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { toast('接口地址已复制'); });
}

// ---- resize ----
window.addEventListener('resize', function () { ST.isPc = window.innerWidth >= 900; });

// ---- Vue app ----
var app = Vue.createApp({
  data: function () { return ST; },
  computed: {
    filteredProducts: filteredProducts,
    todoCount: todoCount,
    currentTitle: currentTitle,
    subTitle: subTitle,
    exportHref: exportHref,
    nav: function () { return NAV_ITEMS; },
    cats: function () { return CATS; },
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
    openInbound: openInbound, copyInbound: copyInbound, openRfid: openRfid, doRfid: doRfid,
    openLabelPrint: openLabelPrint, removeLabelItem: removeLabelItem, closeLabel: closeLabel,
    submitLabelPrint: submitLabelPrint,
    genStockQr: genStockQr, loadStockBatches: loadStockBatches,
    viewStockBatch: viewStockBatch, copyStockUrl: copyStockUrl,
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

