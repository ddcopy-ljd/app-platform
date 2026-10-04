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
  // 商品品类（戒指/项链…）
  productTypes: [],
  typeEdit: { code: '', names: { zh: '', en: '', it: '' }, sort_order: 0 }, typeEditMode: 'new',
  // 商品图片裁切弹窗
  imgCrop: { show: false, pid: 0, src: '', orient: 'landscape', busy: false,
             iw: 0, ih: 0, zoom: 1, tx: 0, ty: 0 },
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
  // 标签模板设计器
  labelTemplates: [],      // 模板列表
  tplDlg: false,           // 模板设计器弹窗
  tplEdit: null,           // 当前编辑的模板 {id,name,size_width,size_height,definition:{slots:[...]}}
  tplSelIdx: -1,           // 画布中选中的 slot 索引
  tplPreview: null,        // 设计器内 ZPL 预览结果 {product, zpl}
  labelTplId: null,        // 打印时使用的模板 ID
  labelUseTpl: false,      // 是否使用模板模式（true=模板 slots，false=字段复选框）
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

// 业界标准英文简写材质受控词表（库内存简写：Au金/Pt铂/Ag银/DIA钻石/JAD翡翠/CGS彩宝/PRL珍珠/OTH其他）
var MATERIALS = ['AU', 'PT', 'AG', 'DIA', 'JAD', 'CGS', 'PRL', 'OTH'];
// 历史英文长码 → 简写（兼容旧数据渲染）
var MAT_FULL_TO_SHORT = { GOLD: 'AU', PLATINUM: 'PT', SILVER: 'AG', DIAMOND: 'DIA', JADEITE: 'JAD', COLORED_GEMSTONE: 'CGS', PEARL: 'PRL', OTHER: 'OTH' };

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
// 看板品类占比：后端按中文品类名分组，按当前语言显示
function catText(name) {
  var c = (ST.productTypes || []).find(function (x) { return x.names && x.names.zh === name; });
  return c ? catNameOf(c) : (name || '');
}
// 确保商品数据带 category_code（旧数据/中文品类名兜底）
function ensureCatCode(d) {
  if (!d.category_code) d.category_code = catCodeByName(d.category) || '';
  return d.category_code;
}

// ---- 商品品类（戒指/项链…）----
function typeObj(code) {
  return (ST.productTypes || []).find(function (x) { return x.code === code; }) || null;
}
function typeNameByCode(code) {
  var o = typeObj(code);
  return o ? catNameOf(o) : (code || '');
}
// 商品行展示品类：优先 product_type_code 字典名，其次冗余列 product_type
function productTypeName(p) {
  if (!p) return '';
  if (p.product_type_code) {
    var o = typeObj(p.product_type_code);
    if (o) return catNameOf(o);
  }
  return p.product_type || '';
}
// 确保表单数据带 product_type_code（旧数据兜底归 99 其他）
function ensureTypeCode(d) {
  if (!d.product_type_code) {
    var o = (ST.productTypes || []).find(function (x) {
      return (x.names && (x.names.zh === d.product_type || x.names.en === d.product_type));
    });
    d.product_type_code = o ? o.code : ((ST.productTypes[0] && ST.productTypes[0].code) || '99');
  }
  return d.product_type_code;
}
// 材质统一展示业界标准英文简写（AU/PT/AG/DIA/JAD/CGS/PRL/OTH）；历史长码自动收敛
function materialText(code) {
  if (!code) return '';
  var up = String(code).trim().toUpperCase();
  return MAT_FULL_TO_SHORT[up] || up;
}
function productImageUrl(p) {
  if (!p || !p.id) return '';
  return API + '/api/products/' + p.id + '/image' + (p.image_ts ? '?v=' + encodeURIComponent(p.image_ts) : '');
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
    // 按商品品类筛选
    return p.product_type_code === ST.prodCat;
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
  var lang = ST.lang;  // 建立响应式依赖：切换语言后标题随之更新（t() 本身非响应式）
  var item = NAV_ITEMS.find(function (n) { return n.id === ST.tab; });
  return item ? t(item.key) : '';
}

function subTitle() {
  var lang = ST.lang;
  return t(SUB_TITLES[ST.subView] || '');
}

function exportHref() { return API + '/api/logs/export'; }

function statusClass(s) {
  var m = { '在库': 'tag-stock', '已定': 'tag-reserved', '已售': 'tag-sold', '借出': 'tag-blue' };
  return m[s] || 'tag-wine';
}

// ---- 业务枚举值 → 当前语言文案（数据层始终存中文/英文码，仅展示层翻译）----
var STATUS_I18N_KEYS = {
  '在库': 'st.inStock', '已定': 'st.reserved', '已售': 'st.sold', '借出': 'st.loaned',
  '已冲红': 'st.voided', '已完成': 'st.done',
  '待维修': 'st.pending', '维修中': 'st.repairing', '待取件': 'st.waitTake',
  '待发货': 'st.shipping', '运输中': 'st.inTransit', '已入库': 'st.received',
  '加工中': 'st.processing', '已收货': 'st.delivered',
  '借出中': 'st.loanOut', '借入中': 'st.loanIn', '已归还': 'st.returned', '已核销': 'st.writeOff',
  '已确认': 'st.confirmed', '已取消': 'st.cancelled',
  // 预约单据后端存英文码
  'pending': 'st.apptPending', 'contacted': 'st.apptContacted', 'arrived': 'st.apptArrived', 'done': 'st.apptDone'
};
function statusText(s) {
  if (!s) return '';
  var k = STATUS_I18N_KEYS[s];
  return k ? t(k) : s;
}
var METHOD_I18N_KEYS = { '现金': 'pay.cash', '微信': 'pay.wechat', '刷卡': 'pay.card', '转账': 'pay.transfer' };
function methodText(m) { return METHOD_I18N_KEYS[m] ? t(METHOD_I18N_KEYS[m]) : (m || ''); }
var LEVEL_I18N_KEYS = { '普通': 'cust.normal', '银卡': 'cust.silver', '金卡': 'cust.gold' };
function levelText(l) { return LEVEL_I18N_KEYS[l] ? t(LEVEL_I18N_KEYS[l]) : (l || ''); }
function directionText(d) { return d === 'out' ? t('lbl.out') : (d === 'in' ? t('lbl.in') : (d || '')); }
function coStatusText(s) {
  if (s === '进行中') return t('co.statusRunning');
  if (s === '待核对') return t('co.statusReview');
  return s || '';
}
// 盘点明细结果文案含「相符/盘亏/异常/盘盈」关键词，按关键词翻译
function resultText(r) {
  if (!r) return '';
  if (r.indexOf('盘亏') >= 0) return r.replace('盘亏', t('th.shortage'));
  if (r.indexOf('盘盈') >= 0) return r.replace('盘盈', t('inv.surplus'));
  if (r.indexOf('异常') >= 0) return r.replace('异常', t('th.abnormal'));
  if (r.indexOf('相符') >= 0) return r.replace('相符', t('th.matched'));
  return r;
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
  if (tab === 'profile') { loadProfile(); loadProductTypes(); }
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
  api('GET', '/api/product-types').then(function (r) { ST.productTypes = r || []; }).catch(function () {});
  api('GET', '/api/biz-config').then(function (r) { ST.bizConfig = r; }).catch(function () {});
  api('GET', '/api/languages').then(function (r) { ST.languages = r || []; }).catch(function () {});
  loadTemplates();
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
  openSheet('inbound', t('sheet.inbound'), { code: '', name: '', category: '', category_code: '', product_type: '', product_type_code: (ST.productTypes[0] && ST.productTypes[0].code) || '99', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, rfid_epc: '', biz_date: new Date().toISOString().slice(0, 10) });
}

function addProduct() {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = { code: '', name: '', name_i18n: '{}',
            category: '', category_code: '',
            product_type_code: (ST.productTypes[0] && ST.productTypes[0].code) || '99', product_type: '',
            material: '', weight: 0, size: '', cert: '', cost: 0, price: 0,
            status: '在库', rfid_epc: '', showcase_public: 0, high_value: 0, origin: '' };
  openSheet('product', t('sheet.product'), d);
}

function editProduct(p) {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = Object.assign({}, p);
  ensureTypeCode(d);
  openSheet('product', t('sheet.product'), d);
}

// 复制新增：以现有商品为模板预填表单，编码/EPC/图片留空，保存即建档新品
function copyProduct(p) {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = Object.assign({}, p);
  delete d.id;
  delete d.image_ts;
  d.code = '';
  d.rfid_epc = '';
  ensureTypeCode(d);
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

// ---------------- 店铺管理：分类管理 ----------------
function resetCatEdit() {
  ST.catEdit = { code: '', names: { zh: '', en: '' }, sort_order: (ST.cats || []).length + 1 };
  ST.catEditMode = 'new';
}
function editCat(c) {
  ST.catEditMode = 'edit';
  ST.catEdit = { code: c.code, names: Object.assign({}, c.names || { zh: '', en: '' }), sort_order: c.sort_order || 0 };
  // 编辑表单位于分类卡片底部，点击后自动滚动过去并高亮，避免"点了没反应"
  setTimeout(function () {
    var el = document.getElementById('cat-edit-form');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('cat-edit-flash');
      // 触发重绘以重启动画
      void el.offsetWidth;
      el.classList.add('cat-edit-flash');
    }
  }, 60);
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

// ---------------- 店铺管理：商品品类（戒指/项链…） ----------------
function loadProductTypes() {
  api('GET', '/api/product-types').then(function (r) { ST.productTypes = r || []; }).catch(function () {});
}
function resetTypeEdit() {
  ST.typeEdit = { code: '', names: { zh: '', en: '', it: '' }, sort_order: (ST.productTypes || []).length + 1 };
  ST.typeEditMode = 'new';
}
function editType(o) {
  ST.typeEditMode = 'edit';
  ST.typeEdit = { code: o.code, names: Object.assign({ zh: '', en: '', it: '' }, o.names || {}), sort_order: o.sort_order || 0 };
  setTimeout(function () {
    var el = document.getElementById('type-edit-form');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('cat-edit-flash');
      void el.offsetWidth;
      el.classList.add('cat-edit-flash');
    }
  }, 60);
}
function saveType() {
  var te = ST.typeEdit;
  if (!te.code.trim()) { toast(t('toast.fillCatCode'), 'error'); return; }
  if (!(te.names.zh || te.names.en)) { toast(t('toast.fillCatName'), 'error'); return; }
  var body = { code: te.code.trim(),
    names: { zh: te.names.zh || '', en: te.names.en || '', it: te.names.it || '' },
    sort_order: Number(te.sort_order) || 0 };
  var method = ST.typeEditMode === 'edit' ? 'PUT' : 'POST';
  var url = ST.typeEditMode === 'edit' ? '/api/product-types/' + te.code : '/api/product-types';
  api(method, url, body).then(function () {
    toast(t('toast.saveOk'));
    resetTypeEdit();
    loadProductTypes();
  }).catch(function (e) { toast(e.message, 'error'); });
}
function delType(code) {
  if (!confirm('Delete product type ' + code + '?')) return;
  api('DELETE', '/api/product-types/' + code).then(function () {
    toast(t('toast.delOk'));
    loadProductTypes();
  }).catch(function (e) { toast(e.message, 'error'); });
}
function bindTypeTemplate(code, tplId) {
  api('PUT', '/api/product-types/' + code + '/template', { label_template_id: tplId || null }).then(function () {
    toast(t('tpl.bindOk'));
    loadProductTypes();
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---------------- 商品图片：4:3 裁切（可横/竖，长边 700px，商品居中可人工调整，JPG q75） ----------------
var IMG_LONG_EDGE = 700;
var IMG_QUALITY = 0.75;
var _imgFileInput = null;
var _cropImg = null;      // 已加载的原图 Image
var _cropDrag = null;     // 拖拽状态

function chooseProductImage(pid) {
  if (!pid) { toast(t('toast.saveFirst'), 'error'); return; }
  if (!_imgFileInput) {
    _imgFileInput = document.createElement('input');
    _imgFileInput.type = 'file';
    _imgFileInput.accept = 'image/*';
    _imgFileInput.style.display = 'none';
    _imgFileInput.addEventListener('change', onProductImageChosen);
    document.body.appendChild(_imgFileInput);
  }
  _imgFileInput.value = '';
  _imgFileInput.dataset.pid = String(pid);
  _imgFileInput.click();
}
function onProductImageChosen(e) {
  var input = e.target;
  var f = input.files && input.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { return; }
  if (f.size > 20 * 1024 * 1024) { toast('图片不能超过 20MB', 'error'); return; }
  var reader = new FileReader();
  reader.onload = function (ev) { openImgCrop(Number(input.dataset.pid), ev.target.result); };
  reader.readAsDataURL(f);
}
function openImgCrop(pid, src) {
  var ic = ST.imgCrop;
  ic.pid = pid; ic.src = src; ic.orient = ic.orient || 'landscape';
  ic.zoom = 1; ic.tx = 0; ic.ty = 0; ic.busy = false;
  ic.iw = 0; ic.ih = 0;
  ic.show = true;
  _cropImg = new Image();
  _cropImg.onload = function () {
    ic.iw = _cropImg.naturalWidth;
    ic.ih = _cropImg.naturalHeight;
    Vue.nextTick(resetImgCrop);
  };
  _cropImg.src = src;
}
function closeImgCrop() { ST.imgCrop.show = false; ST.imgCrop.src = ''; ST.imgCrop.busy = false; _cropImg = null; }
function imgFrameSize() {
  var el = document.getElementById('img-crop-frame');
  return { w: el ? el.clientWidth : 480, h: el ? el.clientHeight : 360 };
}
// 按 cover 方式铺满裁切框并居中
function resetImgCrop() {
  var ic = ST.imgCrop;
  if (!ic.iw) return;
  var f = imgFrameSize();
  ic.base = Math.max(f.w / ic.iw, f.h / ic.ih);
  ic.zoom = 1;
  var dw = ic.iw * ic.base, dh = ic.ih * ic.base;
  ic.tx = (f.w - dw) / 2;
  ic.ty = (f.h - dh) / 2;
}
function setImgOrient(o) {
  ST.imgCrop.orient = o;
  Vue.nextTick(resetImgCrop);
}
function cropImgStyle() {
  var ic = ST.imgCrop;
  if (!ic.base) return {};
  var dw = ic.iw * ic.base * ic.zoom;
  var dh = ic.ih * ic.base * ic.zoom;
  return { width: dw + 'px', height: dh + 'px', transform: 'translate(' + ic.tx + 'px,' + ic.ty + 'px)' };
}
function _clampPan() {
  var ic = ST.imgCrop, f = imgFrameSize();
  var dw = ic.iw * ic.base * ic.zoom, dh = ic.ih * ic.base * ic.zoom;
  // 图片必须始终覆盖裁切框：可拖动范围 [框-图, 0]
  ic.tx = Math.min(0, Math.max(f.w - dw, ic.tx));
  ic.ty = Math.min(0, Math.max(f.h - dh, ic.ty));
}
function cropPointerDown(e) {
  if (!_cropImg) return;
  e.preventDefault();
  _cropDrag = { x: e.clientX, y: e.clientY, tx: ST.imgCrop.tx, ty: ST.imgCrop.ty };
  window.addEventListener('pointermove', cropPointerMove);
  window.addEventListener('pointerup', cropPointerUp);
}
function cropPointerMove(e) {
  if (!_cropDrag) return;
  var ic = ST.imgCrop;
  ic.tx = _cropDrag.tx + (e.clientX - _cropDrag.x);
  ic.ty = _cropDrag.ty + (e.clientY - _cropDrag.y);
  _clampPan();
}
function cropPointerUp() {
  _cropDrag = null;
  window.removeEventListener('pointermove', cropPointerMove);
  window.removeEventListener('pointerup', cropPointerUp);
}
function cropWheel(e) {
  if (!_cropImg) return;
  e.preventDefault();
  var ic = ST.imgCrop, f = imgFrameSize();
  var old = ic.zoom;
  var nz = old * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
  nz = Math.max(1, Math.min(5, nz));
  if (nz === old) return;
  // 以画面中心为锚点缩放
  var cx = f.w / 2, cy = f.h / 2;
  ic.tx = cx - (cx - ic.tx) * (nz / old);
  ic.ty = cy - (cy - ic.ty) * (nz / old);
  ic.zoom = nz;
  _clampPan();
}
function confirmImgCrop() {
  var ic = ST.imgCrop;
  if (!_cropImg || ic.busy) return;
  var landscape = ic.orient === 'landscape';
  var outW = landscape ? IMG_LONG_EDGE : Math.round(IMG_LONG_EDGE * 3 / 4);
  var outH = landscape ? Math.round(IMG_LONG_EDGE * 3 / 4) : IMG_LONG_EDGE;
  var scale = ic.base * ic.zoom;
  var sx = -ic.tx / scale, sy = -ic.ty / scale;
  var sw = imgFrameSize().w / scale, sh = imgFrameSize().h / scale;
  var canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(_cropImg, sx, sy, sw, sh, 0, 0, outW, outH);
  ic.busy = true;
  var done = function (dataUrl) {
    api('PUT', '/api/products/' + ic.pid + '/image', { data: dataUrl }).then(function (r) {
      var ts = r.image_ts;
      var p = (ST.products || []).find(function (x) { return x.id === ic.pid; });
      if (p) p.image_ts = ts;
      if (ST.sheetData && ST.sheetData.id === ic.pid) ST.sheetData.image_ts = ts;
      toast(t('img.saved'));
      closeImgCrop();
    }).catch(function (e) { toast(e.message, 'error'); ST.imgCrop.busy = false; });
  };
  if (canvas.toBlob) {
    canvas.toBlob(function (blob) {
      var fr = new FileReader();
      fr.onload = function () { done(fr.result); };
      fr.readAsDataURL(blob);
    }, 'image/jpeg', IMG_QUALITY);
  } else {
    done(canvas.toDataURL('image/jpeg', IMG_QUALITY));
  }
}
function removeProductImage(pid) {
  if (!confirm(t('img.remove') + '?')) return;
  api('DELETE', '/api/products/' + pid + '/image').then(function () {
    var p = (ST.products || []).find(function (x) { return x.id === pid; });
    if (p) p.image_ts = '';
    if (ST.sheetData && ST.sheetData.id === pid) ST.sheetData.image_ts = '';
    toast(t('img.removed'));
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---------------- 店铺管理：EPC 规则 ----------------
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
    var tc = ensureTypeCode(d);
    var typeZh = typeNameByCode(tc) || d.product_type || '其他';
    var cc2 = ensureCatCode(d);
    var catZh = catNameByCode(cc2) || d.category || typeZh;
    var m2 = d.id ? 'PUT' : 'POST';
    var u2 = d.id ? '/api/products/' + d.id : '/api/products';
    var body2 = { code: d.code || '', name: d.name || '', name_i18n: d.name_i18n || '{}',
      category: catZh, category_code: cc2 || '',
      product_type_code: tc || '99', product_type: typeZh,
      material: materialText(d.material), weight: Number(d.weight) || 0, size: d.size || '',
      cert: d.cert || '', cost: Number(d.cost) || 0, price: Number(d.price) || 0,
      status: d.status || '在库', rfid_epc: d.rfid_epc || '', store_id: d.store_id || 1,
      showcase_public: d.showcase_public || 0, showcase_order: d.showcase_order || 0,
      showcase_desc: d.showcase_desc || '', origin: d.origin || '', high_value: d.high_value || 0 };
    api(m2, u2, body2).then(function (r) {
      // 新建后保留表单并带出 id/EPC，可立即上传商品图片；再次保存按编辑处理
      if (!d.id) {
        d.id = r.id;
        d.rfid_epc = r.rfid_epc || d.rfid_epc;
        toast(t('toast.saveOk') + (r.rfid_epc ? ' EPC: ' + r.rfid_epc : ''));
        refreshAll();
      } else {
        d.rfid_epc = r.rfid_epc || d.rfid_epc;
        toast(t('toast.saveOk'));
        closeSheet(); refreshAll();
      }
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'inbound') {
    if (!d.name) { toast(t('toast.fillProduct'), 'error'); return; }
    var itc = ensureTypeCode(d);
    api('POST', '/api/inventory/inbound', { code: d.code || '', name: d.name,
      category: d.category || '', category_code: d.category_code || '',
      product_type_code: itc, product_type: typeNameByCode(itc),
      material: materialText(d.material),
      weight: Number(d.weight) || 0, size: d.size || '', cert: d.cert || '',
      cost: Number(d.cost) || 0, price: Number(d.price) || 0,
      rfid_epc: d.rfid_epc || '', biz_date: d.biz_date || '' }).then(function (r) {
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
var FIELD_LABEL_I18N_KEYS = {
  store: 'label.fld.store', name: 'label.fld.name', spec: 'label.fld.spec',
  price: 'label.fld.price', cert: 'label.fld.cert', barcode: 'label.fld.barcode', epc_text: 'label.fld.epcText',
};
function fieldLabelText(k) { return FIELD_LABEL_I18N_KEYS[k] ? t(FIELD_LABEL_I18N_KEYS[k]) : (FIELD_LABELS[k] || k); }

// ---- 标签模板设计器 ----
// 可用字段定义：key, 显示名(i18n key), 渲染类型, 默认字体
var LABEL_FIELDS = [
  { key: 'name',     i18n: 'label.fld.name',     type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 30, h: 30 } },
  { key: 'spec',     i18n: 'label.fld.spec',     type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 22, h: 22 } },
  { key: 'price',    i18n: 'label.fld.price',    type: 'ascii', defFont: { type: 'ascii', w: 42, h: 42 } },
  { key: 'barcode',  i18n: 'label.fld.barcode',  type: 'barcode', defFont: { type: 'barcode', h: 64 } },
  { key: 'code',     i18n: 'label.fld.code',     type: 'ascii', defFont: { type: 'ascii', w: 22, h: 22 } },
  { key: 'cert',     i18n: 'label.fld.cert',     type: 'ascii', defFont: { type: 'ascii', w: 20, h: 20 } },
  { key: 'epc_text', i18n: 'label.fld.epcText',  type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
  { key: 'store',    i18n: 'label.fld.store',    type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 20, h: 20 } },
  { key: 'category', i18n: 'label.fld.category', type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'material', i18n: 'label.fld.material', type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'weight',   i18n: 'label.fld.weight',   type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
  { key: 'size',     i18n: 'label.fld.size',     type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'cost',     i18n: 'label.fld.cost',     type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
];

function labelFieldText(k) {
  var f = LABEL_FIELDS.find(function (x) { return x.key === k; });
  return f ? t(f.i18n) : k;
}

// 模板 CRUD
function loadTemplates() {
  api('GET', '/api/label-templates').then(function (r) {
    ST.labelTemplates = r.list || [];
  }).catch(function () {});
}

function openTplDesigner(tpl) {
  if (tpl) {
    ST.tplEdit = JSON.parse(JSON.stringify(tpl));
    if (typeof ST.tplEdit.definition === 'string') {
      try { ST.tplEdit.definition = JSON.parse(ST.tplEdit.definition); } catch (e) { ST.tplEdit.definition = {}; }
    }
    if (!ST.tplEdit.definition || typeof ST.tplEdit.definition !== 'object') ST.tplEdit.definition = {};
    if (!ST.tplEdit.definition.slots) ST.tplEdit.definition.slots = [];
  } else {
    ST.tplEdit = {
      id: null, name: '', size_width: 70, size_height: 35,
      definition: { slots: [], write_epc: true },
      cols: 1, gap: 0, copies: 1, default_printer: '', is_rfid: 1,
    };
  }
  ST.tplSelIdx = -1;
  ST.tplPreview = null;
  ST.tplDlg = true;
}

function closeTplDesigner() { ST.tplDlg = false; ST.tplEdit = null; ST.tplSelIdx = -1; ST.tplPreview = null; }

function saveTemplate() {
  var tpl = ST.tplEdit;
  if (!tpl || !tpl.name) { toast(t('tpl.nameRequired'), 'error'); return; }
  var body = {
    name: tpl.name, size_width: tpl.size_width, size_height: tpl.size_height,
    definition: JSON.stringify(tpl.definition), cols: tpl.cols, gap: tpl.gap,
    copies: tpl.copies, default_printer: tpl.default_printer, is_rfid: tpl.is_rfid,
  };
  if (tpl.id) {
    api('PUT', '/api/label-templates/' + tpl.id, body).then(function () {
      toast(t('tpl.saved')); closeTplDesigner(); loadTemplates(); loadProfile();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else {
    api('POST', '/api/label-templates', body).then(function (r) {
      toast(t('tpl.saved')); closeTplDesigner(); loadTemplates(); loadProfile();
    }).catch(function (e) { toast(e.message, 'error'); });
  }
}

function delTemplate(id) {
  if (!confirm(t('tpl.confirmDel'))) return;
  api('DELETE', '/api/label-templates/' + id).then(function () {
    toast(t('tpl.deleted')); loadTemplates(); loadProfile();
  }).catch(function (e) { toast(e.message, 'error'); });
}

// 分类绑定模板
function bindCatTemplate(code, tplId) {
  api('PUT', '/api/categories/' + code + '/template', { label_template_id: tplId || null }).then(function () {
    toast(t('tpl.bindOk'));
    api('GET', '/api/categories').then(function (r) { ST.cats = r || []; }).catch(function () {});
  }).catch(function (e) { toast(e.message, 'error'); });
}

// 画布 slot 操作
function addSlotToCanvas(fieldKey) {
  if (!ST.tplEdit) return;
  var field = LABEL_FIELDS.find(function (f) { return f.key === fieldKey; });
  if (!field) return;
  var slots = ST.tplEdit.definition.slots;
  // 默认放在画布左上角附近，依次错开
  var baseX = 24 + (slots.length % 5) * 40;
  var baseY = 24 + Math.floor(slots.length / 5) * 40;
  slots.push({
    field: fieldKey,
    x: baseX, y: baseY,
    w: field.type === 'barcode' ? 300 : 200,
    h: field.type === 'barcode' ? 80 : (field.defFont.h || 24) + 8,
    font: JSON.parse(JSON.stringify(field.defFont)),
  });
  ST.tplSelIdx = slots.length - 1;
}

function removeSlot(idx) {
  if (!ST.tplEdit) return;
  ST.tplEdit.definition.slots.splice(idx, 1);
  if (ST.tplSelIdx >= idx) ST.tplSelIdx = Math.max(-1, ST.tplSelIdx - 1);
}

function updateSlot(idx, prop, value) {
  if (!ST.tplEdit || !ST.tplEdit.definition.slots[idx]) return;
  var slot = ST.tplEdit.definition.slots[idx];
  if (prop.indexOf('.') > 0) {
    var parts = prop.split('.');
    var obj = slot;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  } else {
    slot[prop] = value;
  }
}

// 拖拽：mousedown 开始，mousemove 移动，mouseup 结束
var _dragState = null;
function startDragSlot(e, idx) {
  if (!ST.tplEdit || !ST.tplEdit.definition.slots[idx]) return;
  e.preventDefault();
  ST.tplSelIdx = idx;
  var slot = ST.tplEdit.definition.slots[idx];
  _dragState = {
    idx: idx,
    startX: e.clientX, startY: e.clientY,
    origX: slot.x, origY: slot.y,
    scale: _getCanvasScale(),
  };
  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup', _onDragEnd);
}

function _getCanvasScale() {
  var el = document.querySelector('.tpl-canvas');
  if (!el || !ST.tplEdit) return 1;
  var w = ST.tplEdit.size_width || 70;
  var dotsW = Math.round(w * 300 / 25.4); // mm → 300dpi dots
  return el.clientWidth / dotsW;
}

// 画布像素比例：画布 CSS 宽度固定为 mm*4 px，1 dot = 4*25.4/300 px
function tplDotScale() { return 4 * 25.4 / 300; }

function _onDragMove(e) {
  if (!_dragState || !ST.tplEdit) return;
  var dx = (e.clientX - _dragState.startX) / _dragState.scale;
  var dy = (e.clientY - _dragState.startY) / _dragState.scale;
  var slot = ST.tplEdit.definition.slots[_dragState.idx];
  if (slot) {
    slot.x = Math.max(0, Math.round(_dragState.origX + dx));
    slot.y = Math.max(0, Math.round(_dragState.origY + dy));
  }
}

function _onDragEnd() {
  _dragState = null;
  document.removeEventListener('mousemove', _onDragMove);
  document.removeEventListener('mouseup', _onDragEnd);
}

// 模板预览（生成 ZPL）
function previewTemplate() {
  if (!ST.tplEdit || !ST.tplEdit.id) { toast(t('tpl.saveFirst'), 'error'); return; }
  var pid = ST.products.length ? ST.products[0].id : 1;
  api('POST', '/api/label-templates/' + ST.tplEdit.id + '/preview?product_id=' + pid, {}).then(function (r) {
    ST.tplPreview = { product: r.product, zpl: r.zpl };
    toast(t('tpl.previewOk'));
  }).catch(function (e) { toast(e.message, 'error'); });
}

function openLabelPrint(p) {
  ST.labelDlg = true;
  ST.labelResult = null;
  ST.labelTplId = null;
  ST.labelUseTpl = false;
  if (p && !ST.labelItems.some(function (x) { return x.id === p.id; })) {
    ST.labelItems.push({ id: p.id, code: p.code, name: p.name,
      product_type_code: p.product_type_code, category_code: p.category_code });
  }
  // 若已选商品属于同一品类且该品类绑定了模板，自动加载模板
  _autoPickTemplate();
  api('GET', '/api/print/printers').then(function (r) {
    var list = r.printers || [];
    ST.printSupported = r.supported;
    if (r.supported) {
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

function _autoPickTemplate() {
  if (!ST.labelItems.length) return;
  var codes = new Set(ST.labelItems.map(function (x) { return x.product_type_code; }).filter(Boolean));
  if (codes.size !== 1) return;
  var code = codes.values().next().value;
  var o = (ST.productTypes || []).find(function (c) { return c.code === code; });
  if (o && o.label_template_id) {
    ST.labelTplId = o.label_template_id;
    ST.labelUseTpl = true;
  }
}

function removeLabelItem(id) {
  ST.labelItems = ST.labelItems.filter(function (x) { return x.id !== id; });
  _autoPickTemplate();
}
function closeLabel() { ST.labelDlg = false; }
function submitLabelPrint() {
  if (!ST.labelItems.length) { toast(t('toast.pickLabel'), 'error'); return; }
  ST.labelBusy = true;
  var body = {
    product_ids: ST.labelItems.map(function (x) { return x.id; }),
    printer: ST.printerName, copies: ST.labelCopies || 1,
    write_epc: ST.writeEpc, font: ST.labelFont || '',
    simulate: ST.simulatePrint || !ST.printSupported,
  };
  if (ST.labelUseTpl && ST.labelTplId) {
    body.template_id = ST.labelTplId;
  } else {
    body.fields = Object.keys(ST.labelFields).filter(function (k) { return ST.labelFields[k]; });
  }
  api('POST', '/api/print/labels', body).then(function (r) {
    ST.labelResult = r;
    toast(r.sent ? t('toast.printSent') : t('toast.zplDone'));
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
  if (!confirm(t('co.cfStart'))) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/start', { host: ST.coTaskHost || '' }).then(function (r) {
    ST.coTask = r;
    loadCoQr(r.id);
    toast(t('toast.coStarted'));
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
  if (!confirm(t('co.cfEnd'))) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/end', {}).then(function () {
    toast(t('toast.coEndReview')); loadCoTask();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function confirmCoTask() {
  if (!ST.coTask) return;
  if (!confirm(t('co.cfReview'))) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/confirm', {}).then(function () {
    toast(t('toast.coDone')); clearCoTask(); loadStockBatches();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
// 强制终止：手持机故障/无法加入/误开任务时立即解冻，不生成盘点结果
function abortCoTask() {
  if (!ST.coTask) return;
  if (!confirm(t('co.cfAbort'))) return;
  ST.coBusy = true;
  api('POST', '/api/stocktake/task/' + ST.coTask.id + '/abort', {}).then(function () {
    toast(t('toast.coAborted')); clearCoTask(); loadStockBatches();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function copyCoUrl() {
  if (ST.coTask && navigator.clipboard) navigator.clipboard.writeText(ST.coTask.co_url).then(function () { toast(t('toast.coUrlCopied')); });
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
    // 商品品类（戒指/项链…）
    typeList: function () { return ST.productTypes || []; },
    materials: function () { return MATERIALS; },
    FIELD_LABELS: function () { return FIELD_LABELS; },
    LABEL_FIELDS: function () { return LABEL_FIELDS; },
  },
  methods: {
    t: t, fmt: fmt, fmtY: fmtY, dateFmt: dateFmt,
    statusClass: statusClass,
    statusText: statusText, methodText: methodText, levelText: levelText,
    directionText: directionText, coStatusText: coStatusText, resultText: resultText,
    fieldLabelText: fieldLabelText, labelFieldText: labelFieldText,
    doLogin: doLogin, doLogout: doLogout,
    go: go, openSubView: openSubView, setLang: setLang,
    openSheet: openSheet, closeSheet: closeSheet, submitSheet: submitSheet,
    onPickProduct: onPickProduct,
    addProduct: addProduct, editProduct: editProduct, delProduct: delProduct, printLabel: printLabel,
    copyProduct: copyProduct, generateEpc: generateEpc,
    catNameByCode: catNameByCode, catCodeByName: catCodeByName,
    catNameOf: catNameOf, productCatName: productCatName, catText: catText,
    typeNameByCode: typeNameByCode, productTypeName: productTypeName,
    materialText: materialText, productImageUrl: productImageUrl,
    normLang: normLang,
    sheetNameGet: sheetNameGet, sheetNameSet: sheetNameSet, langNameFilled: langNameFilled,
    resetCatEdit: resetCatEdit, editCat: editCat, saveCat: saveCat, delCat: delCat,
    resetTypeEdit: resetTypeEdit, editType: editType, saveType: saveType, delType: delType,
    bindTypeTemplate: bindTypeTemplate,
    // 商品图片裁切上传
    chooseProductImage: chooseProductImage, closeImgCrop: closeImgCrop,
    setImgOrient: setImgOrient, cropImgStyle: cropImgStyle,
    cropPointerDown: cropPointerDown, cropWheel: cropWheel,
    confirmImgCrop: confirmImgCrop, removeProductImage: removeProductImage,
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
    // 标签模板设计器
    openTplDesigner: openTplDesigner, closeTplDesigner: closeTplDesigner,
    saveTemplate: saveTemplate, delTemplate: delTemplate, bindCatTemplate: bindCatTemplate,
    addSlotToCanvas: addSlotToCanvas, removeSlot: removeSlot, updateSlot: updateSlot,
    startDragSlot: startDragSlot, previewTemplate: previewTemplate, loadTemplates: loadTemplates,
    tplDotScale: tplDotScale,
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

