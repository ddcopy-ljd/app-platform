/* ===== 懿臻珠宝云 · Vue3 SPA 主逻辑 ===== */

// 经平台网关访问时，平台会在页面注入 window.__APP_BASE__（如 /app/jewelry/t001/）；
// 直连插件服务时该变量不存在，退化为空串（根路径）。所有 API 均经此拼接。
var API = (window.__APP_BASE__ || '');

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
  // 列表排序状态：{ 表key: { key: 排序列, dir: 1升/-1降 } }
  tblSort: { products: { key: '', dir: 1 }, stock: { key: '', dir: 1 } },
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
  detailKind: '',        // 详情面板对应的列表类型（repairs/purchases/...）
  rfidResult: null, printItem: null,
  // RFID 标签排版打印
  labelDlg: false,
  labelItems: [],          // 已选商品 [{id,code,name}]
  printSel: {},            // 商品列表勾选待打印：{productId: true}
  printers: [], printerName: '', printSupported: true,
  // 本地打印桥（门店级）：各门店代理状态/上报打印机/绑定信息
  bridges: [],
  // 代理下载下拉框选中的门店（仅列已生成密钥的门店，密钥服务端内嵌，用户不可见）
  agentDlStore: 0,
  // 系统自检铃铛：面板开关 / 被关闭的检查项（localStorage 持久化）/ 轮询定时器
  healthOpen: false,
  healthOff: (function () { try { return JSON.parse(localStorage.getItem('yz_health_off') || '[]'); } catch (e) { return []; } })(),
  healthTimer: null,
  // 打印对话框当前商品所属门店的代理状态（由 bridges 派生）
  agent: { online: false, name: '' },
  // 手机 App 蓝牙打印（安卓 WebView 注入 window.YzApp 时生效）
  btPrinter: { address: '', name: '' }, btPrinters: [],
  labelFields: { store: true, name: true, spec: true, price: true, cert: false, barcode: true, epc_text: false, epc_barcode: false },
  writeEpc: true, labelCopies: 1, labelFont: 'E:SIMSUN.FNT',
  simulatePrint: true, labelBusy: false, labelResult: null,
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
  invMerge: true,               // 在库商品：按货号合并展示
  expandedCodes: [],            // 合并视图中已展开(显示各件)的货号集合
  _coTaskSeen: false,           // 内部标记：任务是否已被自动切换过（防止定时器反复把用户拽回盘点页签）
  coQrUrl: '', _qrFor: 0, _coQrObj: '',
  // 手持机扫码登录（网页端弹窗）
  hqShow: false, hqStatus: '', hqDevice: '', hqImg: '', hqKey: '', hqTimer: null,
  yzScanReady: false,   // App WebView 注入 YzApp 桥接后为 true，出单表单显示扫码按钮
  // 智能安防
  secSensors: [], secEvents: [], secPending: 0, secSettings: null, secPass: [],
  secDrivers: [], secNew: null, secNewKey: null,
  secAlarm: null, secMuted: false, _secWs: null,
  secSimEpc: '', secPassEpc: '', secPassReason: '', secPassMin: 60,
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
  { id: 'security', icon: '🛡️', key: 'nav.security' },
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
  return applyTblSort(list, 'products', prodSortVal);
}

function todoCount() {
  if (!ST.remindData) return 0;
  return (ST.remindData.deposits || []).length +
         (ST.remindData.loansOverdue || []).length +
         (ST.remindData.repairsPending || []).length;
}

function printSelCount() {
  return ST.products.filter(function (p) { return ST.printSel[p.id]; }).length;
}
function printAllChecked() {
  var list = filteredProducts();
  return list.length > 0 && list.every(function (p) { return ST.printSel[p.id]; });
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
  return applyTblSort(list, 'stock', function (p, k) { return k === 'count' ? 1 : prodSortVal(p, k); });
}

// ---- 在库商品：按货号合并（同货号多件合并成一行，显示件数，可展开看各件）----
function invStockGroups() {
  var list = invStockList();
  var map = {};
  list.forEach(function (p) {
    // 货号为空的商品不并入其他组，各自独立成组（避免全部空货号被错误合并）
    var k = (p.code && String(p.code).trim()) ? p.code : ('__id__' + p.id);
    if (!map[k]) map[k] = { key: k, code: (p.code || ''), items: [] };
    map[k].items.push(p);
  });
  var groups = Object.keys(map).map(function (k) {
    var g = map[k];
    g.count = g.items.length;
    g.first = g.items[0];
    g.name = g.items[0].name || '';
    return g;
  });
  var _sk = ST.tblSort && ST.tblSort.stock && ST.tblSort.stock.key;
  if (_sk) {
    // 用户点了表头排序：按所选列（合并视图取组内首件）升/降序
    var _dir = ST.tblSort.stock.dir || 1;
    groups.sort(function (a, b) {
      var va, vb;
      if (_sk === 'count') { va = a.count; vb = b.count; }
      else { va = prodSortVal(a.first, _sk); vb = prodSortVal(b.first, _sk); }
      var c = (typeof va === 'number' && typeof vb === 'number') ? (va - vb)
              : String(va).localeCompare(String(vb), 'zh');
      return (c || ((a.code || '~').toLowerCase() < (b.code || '~').toLowerCase() ? -1 : 1)) * _dir;
    });
  } else {
    groups.sort(function (a, b) {
      var ca = (a.code || '~').toLowerCase(), cb = (b.code || '~').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }
  return groups;
}
function toggleInvGroup(code) {
  var i = ST.expandedCodes.indexOf(code);
  if (i >= 0) ST.expandedCodes.splice(i, 1);
  else ST.expandedCodes.push(code);
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
// 标签打印记录提示：🖨 图标悬停显示打印次数与最近时间
function printedTip(p) {
  var tm = (p && p.label_printed_at || '').slice(5, 16);  // MM-DD HH:MM
  return t('tip.printed').replace('{n}', p.label_print_count).replace('{t}', tm);
}
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
  switchLang(typeof canonLang === 'function' ? canonLang(lang) : lang);
  ST.lang = currentLang;
}

// ---- navigation ----
function go(tab) {
  ST.tab = tab;
  ST.subView = '';
  if (tab === 'inventory') { loadInv(); loadStockBatches(); loadCoTask(); }
  if (tab === 'security') loadSecurity();
  if (tab === 'appointments') loadAppt();
  if (tab === 'profile') { loadProfile(); loadProductTypes(); }
  // PC 侧边栏直接进入子列表页（维修/采购/委外/借货/客户/日志）时也要拉数据
  if (SUB_VIEWS.indexOf(tab) >= 0) { ST.subView = tab; ST.subPage = 1; loadSubList(); }
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
  secWsConnect(); // 安防告警推送常驻（任意页面收到告警都会弹窗）
  api('GET', '/api/products?page=1&size=200').then(function (r) { ST.products = r.items; ST.prodTotal = r.total; }).catch(function () {});
  api('GET', '/api/deposits?page=1&size=100').then(function (r) { ST.deposits = r.items; ST.depTotal = r.total; }).catch(function () {});
  api('GET', '/api/sales?page=1&size=100').then(function (r) { ST.sales = r.items; ST.saleTotal = r.total; }).catch(function () {});
  api('GET', '/api/products/options?status=在库').then(function (r) { ST.stockOptions = r.items; }).catch(function () {});
  api('GET', '/api/categories').then(function (r) { ST.cats = r || []; }).catch(function () {});
  api('GET', '/api/product-types').then(function (r) { ST.productTypes = r || []; }).catch(function () {});
  api('GET', '/api/biz-config').then(function (r) { ST.bizConfig = r; }).catch(function () {});
  api('GET', '/api/languages').then(function (r) { ST.languages = r || []; }).catch(function () {});
  loadTemplates();
  loadHealth();
  startHealthTimer();
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

// ---------------------------------------------------------------- 列表卡片
// 内容较少的列表（维修/采购/委外/借货/客户/日志/预约）：
// 卡片按字段自适应 1~3 行（空字段自动省略），点击整卡打开详情面板。

// 拼接非空片段为一行，全空则返回空串（由调用方过滤）
function joinLine(parts) {
  return (parts || []).filter(function (x) {
    return x !== null && x !== undefined && String(x).trim() !== '';
  }).join(' · ');
}

function recordLines(kind, d) {
  var L = [];
  if (!d) return L;
  if (kind === 'repairs') {
    L.push(joinLine([d.item, d.issue]));
    L.push(joinLine([d.customer, d.phone, d.technician ? (t('lbl.technician') + ' ' + d.technician) : '']));
    L.push(joinLine([
      d.receive_date ? (t('rec.receive') + ' ' + d.receive_date) : '',
      d.promised_date ? (t('rec.promised') + ' ' + d.promised_date) : '',
      d.done_date ? (t('rec.done') + ' ' + d.done_date) : '',
      (d.est_fee || d.actual_fee) ? (fmtY(d.est_fee || 0) + (d.actual_fee ? ' / ' + fmtY(d.actual_fee) : '')) : '',
      d.remark
    ]));
  } else if (kind === 'purchases') {
    L.push(joinLine([d.product, d.qty ? '×' + d.qty : '']));
    L.push(joinLine([d.supplier, fmtY(d.cost), d.paid != null ? (t('rec.paid') + ' ' + fmtY(d.paid)) : '']));
    L.push(joinLine([
      d.order_date ? (t('rec.order') + ' ' + d.order_date) : '',
      d.expected_date ? (t('rec.expected') + ' ' + d.expected_date) : '',
      d.received_date ? (t('rec.received') + ' ' + d.received_date) : ''
    ]));
  } else if (kind === 'outsourcings') {
    L.push(joinLine([d.product, d.material, d.weight ? d.weight + 'g' : '']));
    L.push(joinLine([d.factory, fmtY((d.gold_price || 0) * (d.weight || 0) + (d.labor_fee || 0))]));
    L.push(joinLine([
      d.send_date ? (t('rec.send') + ' ' + d.send_date) : '',
      d.expected_date ? (t('rec.expected') + ' ' + d.expected_date) : '',
      d.received_date ? (t('rec.received') + ' ' + d.received_date) : ''
    ]));
  } else if (kind === 'loans') {
    L.push(joinLine([d.product, d.code]));
    L.push(joinLine([directionText(d.direction), d.party, d.qty ? '×' + d.qty : '']));
    L.push(joinLine([
      d.loan_date ? (t('rec.date') + ' ' + d.loan_date) : '',
      d.due_date ? (t('rec.due') + ' ' + d.due_date) : ''
    ]));
  } else if (kind === 'customers') {
    L.push(joinLine([d.name, levelText(d.level)]));
    L.push(joinLine([d.phone, d.birthday ? (t('dash.birthday') + ' ' + d.birthday) : '']));
    L.push(joinLine([fmtY(d.total_amount), d.due_amount ? (t('dash.due') + ' ' + fmtY(d.due_amount)) : '', d.preference]));
  } else if (kind === 'logs') {
    L.push(joinLine([d.action, d.result]));
    L.push(joinLine([d.operator, d.store, d.target]));
    L.push(joinLine([d.time]));
  } else if (kind === 'appointments') {
    L.push(joinLine([d.name, catText(d.category)]));
    L.push(joinLine([d.contact, d.product]));
    L.push(joinLine([d.want_date ? (t('appt.want') + ' ' + d.want_date + ' ' + (d.want_slot || '')) : '', d.remark]));
  }
  return L.filter(function (s) { return s && String(s).trim(); });
}

// 当前列表类型（PC 走 tab，手机端子页走 subView）
function recordKind() { return ST.subView || ST.tab; }

// 详情面板：字段表（[显示名, 字段名]，空值自动跳过）
var DETAIL_FIELDS = {
  repairs: [['维修物品', 'item'], ['客户', 'customer'], ['电话', 'phone'], ['问题描述', 'issue'],
            ['预估费用', 'est_fee'], ['实收费用', 'actual_fee'], ['收件日', 'receive_date'],
            ['承诺交期', 'promised_date'], ['完成日', 'done_date'], ['技师', 'technician'],
            ['状态', 'status'], ['备注', 'remark']],
  purchases: [['采购商品', 'product'], ['供应商', 'supplier'], ['数量', 'qty'], ['金额', 'cost'],
              ['已付', 'paid'], ['下单日', 'order_date'], ['预计到货', 'expected_date'],
              ['入库日', 'received_date'], ['状态', 'status']],
  outsourcings: [['加工品', 'product'], ['加工厂', 'factory'], ['材质', 'material'], ['重量(g)', 'weight'],
                 ['金价', 'gold_price'], ['工费', 'labor_fee'], ['送出日', 'send_date'],
                 ['预计回厂', 'expected_date'], ['收货日', 'received_date'], ['状态', 'status']],
  loans: [['商品', 'product'], ['货号', 'code'], ['往来方', 'party'], ['数量', 'qty'],
          ['方向', 'direction'], ['借出日', 'loan_date'], ['应还日', 'due_date'], ['状态', 'status']],
  customers: [['姓名', 'name'], ['电话', 'phone'], ['等级', 'level'], ['累计消费', 'total_amount'],
              ['欠款', 'due_amount'], ['生日', 'birthday'], ['偏好', 'preference']],
  logs: [['时间', 'time'], ['操作人', 'operator'], ['门店', 'store'], ['动作', 'action'],
         ['对象', 'target'], ['结果', 'result']],
  appointments: [['姓名', 'name'], ['联系方式', 'contact'], ['类型', 'category'], ['意向商品', 'product'],
                 ['期望日期', 'want_date'], ['时段', 'want_slot'], ['备注', 'remark'], ['状态', 'status']]
};

// 详情面板里的取值：金额格式化、状态/等级/方向翻译
function detailValue(k, v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  if (k === 'status') return statusText(v);
  if (k === 'level') return levelText(v);
  if (k === 'direction') return directionText(v);
  if (k === 'category') return catText(v);
  if (k === 'cost' || k === 'paid' || k === 'total_amount' || k === 'due_amount' ||
      k === 'est_fee' || k === 'actual_fee' || k === 'labor_fee') return fmtY(v);
  return String(v);
}

function openRecordDetail(kind, d) {
  ST.detailKind = kind || recordKind();
  openSheet('detail', t(SUB_TITLES[ST.detailKind] || '') || t('act.detail'), Object.assign({}, d));
}

function detailRows() {
  var kind = ST.detailKind, d = ST.sheetData || {};
  var map = DETAIL_FIELDS[kind];
  var keys = map || Object.keys(d).filter(function (k) { return k.charAt(0) !== '_'; })
    .map(function (k) { return [k, k]; });
  var out = [];
  keys.forEach(function (f) {
    var v = detailValue(f[1], d[f[1]]);
    if (v) out.push({ k: f[0], v: v });
  });
  return out;
}

// 从详情面板切到编辑表单（沿用各自的编辑面板）
function editFromDetail() {
  var d = ST.sheetData || {}, kind = ST.detailKind;
  if (kind === 'repairs') editRepair(d);
  else if (kind === 'customers') editCustomer(d);
  else if (kind === 'loans') openSheet('loan', t('sheet.loan'), Object.assign({}, d));
  else if (kind === 'purchases') openSheet('purchase', t('sheet.purchase'), Object.assign({}, d));
  else if (kind === 'outsourcings') openSheet('outsource', t('sheet.outsource'), Object.assign({}, d));
  else closeSheet();
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

// ---- 手持机扫码登录（网页端） ----
function openHandheldLogin() {
  if (!ST.token) { toast(t('login.err'), 'error'); return; }
  api('GET', '/api/handheld/login-qr').then(function (r) {
    ST.hqKey = r.hkey;
    ST.hqStatus = 'pending';
    ST.hqDevice = '';
    ST.hqImg = qrSvgDataUrl(r.url, 5);
    ST.hqShow = true;
    clearInterval(ST.hqTimer);
    ST.hqTimer = setInterval(hqPoll, 2000);
  }).catch(function (e) { toast(e.message || t('login.err'), 'error'); });
}

function hqPoll() {
  if (!ST.hqKey || !ST.hqShow) return;
  api('GET', '/api/handheld/login-status?hkey=' + encodeURIComponent(ST.hqKey)).then(function (r) {
    ST.hqStatus = r.status;
    ST.hqDevice = r.name || r.device || '';
    if (r.status === 'confirmed' || r.status === 'denied' || r.status === 'expired') clearInterval(ST.hqTimer);
  }).catch(function () { clearInterval(ST.hqTimer); ST.hqStatus = 'expired'; });
}

function handheldConfirm(ok) {
  api('POST', '/api/handheld/confirm', { hkey: ST.hqKey, approve: ok }).then(function () {
    ST.hqStatus = ok ? 'confirmed' : 'denied';
    clearInterval(ST.hqTimer);
  }).catch(function (e) { toast(e.message || 'error', 'error'); });
}

function closeHandheldLogin() {
  clearInterval(ST.hqTimer);
  ST.hqShow = false; ST.hqKey = ''; ST.hqStatus = ''; ST.hqDevice = ''; ST.hqImg = '';
}

// ---- 手持机 App 扫码桥接 ----
// App 端（C27 WebView）注入 window.YzApp；扫到结果回调 window.YzScanner.onResult(code, type)
window.YzScanner = {
  available: false,
  scan: function (type) {
    if (window.YzApp && window.YzApp.scan) {
      try { window.YzApp.scan(type); return true; } catch (e) {}
    }
    return false;
  },
  onResult: function (code, type) { applyScanToSale(code, type); },
  // App 通知扫码状态（EPC 连续扫描中）
  onState: function (scanning) { if (ST.sheetMode === 'sale') ST.sheetData._scanning = !!scanning; }
};
ST.yzScanReady = !!(window.YzApp && window.YzApp.scan);
window.YzScanner.available = ST.yzScanReady;

function yzScan(type) {
  if (!window.YzScanner.scan(type)) toast(t('scan.unavailable'), 'error');
}

/** 扫码结果 → 出单商品识别：条码/二维码按商品编码匹配，EPC 按 rfid_epc 匹配。 */
function applyScanToSale(code, type) {
  var c = String(code || '').trim().toUpperCase();
  if (!c) return;
  var p = null;
  if (type === 'epc') {
    p = ST.stockOptions.find(function (x) { return String(x.rfid_epc || '').toUpperCase() === c; });
    // 兼容“印刷 EPC 条码（已去前缀）”扫描：按后缀匹配
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.rfid_epc || '').toUpperCase().endsWith(c); });
  } else {
    p = ST.stockOptions.find(function (x) { return String(x.code || '').toUpperCase() === c; });
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.code || '').toUpperCase() === c.replace(/^0+/, ''); });
    // 兼容“门店+品类+序号”印刷条码扫描
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.barcode || '').toUpperCase() === c; });
  }
  if (p) {
    ST.sheetData.product_id = p.id;
    ST.sheetData.product = p.name;
    if (ST.sheetMode === 'sale') ST.sheetData.amount = p.price;
    if (ST.sheetMode === 'deposit') ST.sheetData.total = p.price;
    toast(t('scan.found') + '：' + p.code + ' ' + p.name);
  } else if (type === 'epc') {
    toast(t('scan.notFound') + ' EPC ' + c, 'error');
  } else {
    ST.sheetData.product = c;   // 未知条码：作为自定义商品名填入，可继续手工编辑
    toast(t('scan.notFound'), 'error');
  }
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
  // 新商品尚未保存时，选完图自动先保存商品（在 onProductImageChosen 中处理）
  if (!pid && ST.sheetMode !== 'product') { toast(t('toast.saveFirst'), 'error'); return; }
  if (!_imgFileInput) {
    _imgFileInput = document.createElement('input');
    _imgFileInput.type = 'file';
    _imgFileInput.accept = 'image/*';
    _imgFileInput.style.display = 'none';
    _imgFileInput.addEventListener('change', onProductImageChosen);
    document.body.appendChild(_imgFileInput);
  }
  _imgFileInput.value = '';
  _imgFileInput.dataset.pid = String(pid || 0);
  _imgFileInput.click();
}
function onProductImageChosen(e) {
  var input = e.target;
  var f = input.files && input.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { return; }
  if (f.size > 20 * 1024 * 1024) { toast('图片不能超过 20MB', 'error'); return; }
  var pid = Number(input.dataset.pid) || 0;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var dataUrl = ev.target.result;
    if (pid) { openImgCrop(pid, dataUrl); return; }
    // 未保存的新商品：自动保存成功后再打开裁切
    saveProductForm(ST.sheetData).then(function (r) { openImgCrop(r.id, dataUrl); })
      .catch(function () { /* 校验失败已提示，停留表单让用户修改 */ });
  };
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
  api('PUT', '/api/biz-config', { epc_prefix: (cfg.epc_prefix || '').trim().toUpperCase(), seq_bits: Math.min(6, Math.max(4, Number(cfg.seq_bits) || 6)) }).then(function () {
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

// 保存商品表单（新建/编辑），返回 Promise；opts.closeAfter 保存成功后关闭面板
function saveProductForm(d, opts) {
  opts = opts || {};
  if (!d.code || !d.name) { toast(t('toast.fillCode'), 'error'); return Promise.reject(new Error('fill')); }
  var tc = ensureTypeCode(d);
  var typeZh = typeNameByCode(tc) || d.product_type || '其他';
  var cc2 = ensureCatCode(d);
  var catZh = catNameByCode(cc2) || d.category || typeZh;
  var isNew = !d.id;
  var body2 = { code: d.code || '', name: d.name || '', name_i18n: d.name_i18n || '{}',
    category: catZh, category_code: cc2 || '',
    product_type_code: tc || '99', product_type: typeZh,
    material: materialText(d.material), weight: Number(d.weight) || 0, size: d.size || '',
    cert: d.cert || '', cost: Number(d.cost) || 0, price: Number(d.price) || 0,
    status: d.status || '在库', rfid_epc: d.rfid_epc || '', store_id: d.store_id || 1,
    showcase_public: d.showcase_public || 0, showcase_order: d.showcase_order || 0,
    showcase_desc: d.showcase_desc || '', origin: d.origin || '', high_value: d.high_value || 0 };
  return api(isNew ? 'POST' : 'PUT', isNew ? '/api/products' : '/api/products/' + d.id, body2).then(function (r) {
    d.id = r.id;
    d.rfid_epc = r.rfid_epc || d.rfid_epc;
    toast(t('toast.saveOk') + (isNew && r.rfid_epc ? ' EPC: ' + r.rfid_epc : ''));
    refreshAll();
    if (opts.closeAfter) closeSheet();
    return r;
  }).catch(function (e) { if (e && e.message !== 'fill') toast(e.message, 'error'); throw e; });
}

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
    saveProductForm(d, { closeAfter: true });
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
  price: '售价', cert: '证书号', barcode: '条码', epc_text: 'EPC', epc_barcode: 'EPC条码',
};
var FIELD_LABEL_I18N_KEYS = {
  store: 'label.fld.store', name: 'label.fld.name', spec: 'label.fld.spec',
  price: 'label.fld.price', cert: 'label.fld.cert', barcode: 'label.fld.barcode', epc_text: 'label.fld.epcText', epc_barcode: 'label.fld.epcBarcode',
};
function fieldLabelText(k) { return FIELD_LABEL_I18N_KEYS[k] ? t(FIELD_LABEL_I18N_KEYS[k]) : (FIELD_LABELS[k] || k); }

// ---- 标签模板设计器 ----
// 可用字段定义：key, 分组 grp, 显示名(i18n key), 渲染类型, 默认字体
var LABEL_FIELDS = [
  // 商品信息
  { key: 'name',     grp: 'prod',  i18n: 'label.fld.name',     type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 30, h: 30 } },
  { key: 'code',     grp: 'prod',  i18n: 'label.fld.code',     type: 'ascii', defFont: { type: 'ascii', w: 22, h: 22 } },
  { key: 'category', grp: 'prod',  i18n: 'label.fld.category', type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'material', grp: 'prod',  i18n: 'label.fld.material', type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'weight',   grp: 'prod',  i18n: 'label.fld.weight',   type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
  { key: 'size',     grp: 'prod',  i18n: 'label.fld.size',     type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  { key: 'origin',   grp: 'prod',  i18n: 'label.fld.origin',   type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 18, h: 18 } },
  // 价格
  { key: 'price',    grp: 'price', i18n: 'label.fld.price',    type: 'ascii', defFont: { type: 'ascii', w: 42, h: 42 } },
  { key: 'cost',     grp: 'price', i18n: 'label.fld.cost',     type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
  // 证书
  { key: 'cert',     grp: 'cert',  i18n: 'label.fld.cert',     type: 'ascii', defFont: { type: 'ascii', w: 20, h: 20 } },
  // 条码与识别（是否以条码输出由槽位「输出类型」决定；条码=门店+品类+序号，每件唯一可扫）
  { key: 'barcode',  grp: 'code',  i18n: 'label.fld.barcode',  type: 'barcode', defFont: { type: 'barcode', h: 64 } },
  { key: 'epc_text', grp: 'code',  i18n: 'label.fld.epcText',  type: 'ascii', defFont: { type: 'ascii', w: 18, h: 18 } },
  // 其他
  { key: 'store',    grp: 'misc',  i18n: 'label.fld.store',    type: 'cn',    defFont: { type: 'cn', name: 'E:SIMSUN.FNT', w: 20, h: 20 } },
  { key: 'empty',    grp: 'misc',  i18n: 'label.fld.empty',    type: 'empty', defFont: { type: 'empty' } },
];

function labelFieldText(k) {
  var f = LABEL_FIELDS.find(function (x) { return x.key === k; });
  return f ? t(f.i18n) : k;
}

// 字段按分组整理（保持首次出现顺序），供设计器左侧面板分组渲染
var LABEL_FIELD_GROUPS = (function () {
  var order = [], map = {};
  LABEL_FIELDS.forEach(function (f) {
    if (!map[f.grp]) { map[f.grp] = []; order.push(f.grp); }
    map[f.grp].push(f);
  });
  return order.map(function (g) { return { key: g, fields: map[g] }; });
})();

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
      definition: { slots: [], write_epc: true, bg_image: '', bg_rotate: 0 },
      cols: 1, gap: 0, copies: 1, default_printer: '', is_rfid: 1,
    };
  }
  if (typeof ST.tplEdit.definition.bg_image !== 'string') ST.tplEdit.definition.bg_image = '';
  if (![0, 90, 180, 270].includes(Number(ST.tplEdit.definition.bg_rotate))) ST.tplEdit.definition.bg_rotate = 0;
  ST.tplSelIdx = -1;
  ST.tplPreview = null;
  ST.tplDlg = true;
}

// 底图：上传 PNG / 旋转 90° / 移除（不可拖动，始终填满模板区域）
var _tplBgInput = null;
function uploadTplBg() {
  if (!ST.tplEdit) return;
  if (!_tplBgInput) {
    _tplBgInput = document.createElement('input');
    _tplBgInput.type = 'file';
    _tplBgInput.accept = 'image/png,image/*';
    _tplBgInput.style.display = 'none';
    _tplBgInput.addEventListener('change', onTplBgChosen);
    document.body.appendChild(_tplBgInput);
  }
  _tplBgInput.value = '';
  _tplBgInput.click();
}
function onTplBgChosen(e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { toast(t('tpl.bgNotImg'), 'error'); return; }
  if (f.size > 4 * 1024 * 1024) { toast(t('tpl.bgTooBig'), 'error'); return; }
  var reader = new FileReader();
  reader.onload = function (ev) {
    ST.tplEdit.definition.bg_image = ev.target.result;
    ST.tplEdit.definition.bg_rotate = 0;
  };
  reader.readAsDataURL(f);
}
function rotateTplBg() {
  if (!ST.tplEdit || !ST.tplEdit.definition.bg_image) return;
  ST.tplEdit.definition.bg_rotate = (Number(ST.tplEdit.definition.bg_rotate) + 90) % 360;
}
function removeTplBg() {
  if (!ST.tplEdit) return;
  ST.tplEdit.definition.bg_image = '';
  ST.tplEdit.definition.bg_rotate = 0;
}
// 底图在设计器画布中的样式：旋转 90/270 时交换宽高，使旋转后仍填满模板区域
function tplBgStyle() {
  var t = ST.tplEdit;
  if (!t || !t.definition.bg_image) return { display: 'none' };
  var rot = Number(t.definition.bg_rotate) || 0;
  var w = (t.size_width || 70) * 4;
  var h = (t.size_height || 35) * 4;
  var swap = (rot === 90 || rot === 270);
  return {
    position: 'absolute', left: '50%', top: '50%',
    width: (swap ? h : w) + 'px',
    height: (swap ? w : h) + 'px',
    transform: 'translate(-50%,-50%) rotate(' + rot + 'deg)',
    objectFit: 'fill', pointerEvents: 'none', display: 'block'
  };
}
// 底图在打印预览（70mm×35mm）中的样式
function lpBgStyle(lv) {
  if (!lv || !lv.bg_image) return { display: 'none' };
  var rot = Number(lv.bg_rotate) || 0;
  var swap = (rot === 90 || rot === 270);
  return {
    position: 'absolute', left: '50%', top: '50%',
    width: swap ? '35mm' : '70mm',
    height: swap ? '70mm' : '35mm',
    transform: 'translate(-50%,-50%) rotate(' + rot + 'deg)',
    objectFit: 'fill', pointerEvents: 'none', display: 'block'
  };
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
    w: field.type === 'barcode' ? 300 : (field.type === 'empty' ? 200 : 200),
    h: field.type === 'barcode' ? 80 : (field.type === 'empty' ? 40 : (field.defFont.h || 24) + 8),
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
  if (prop === 'x' || prop === 'y') {
    var dotsW = Math.round((ST.tplEdit.size_width || 70) * 300 / 25.4);
    var dotsH = Math.round((ST.tplEdit.size_height || 35) * 300 / 25.4);
    var maxX = Math.max(0, dotsW - (slot.w || 0));
    var maxY = Math.max(0, dotsH - (slot.h || 0));
    slot[prop] = Math.min(prop === 'x' ? maxX : maxY, Math.max(0, Number(value) || 0));
    return;
  }
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

// dots 转 mm（300dpi，1 inch=25.4mm=300dots），保留两位小数
function dotsToMm(dots) {
  var v = Number(dots) || 0;
  return (v * 25.4 / 300).toFixed(2);
}

// 切换输出类型时给该类型的关键参数设默认值
function onSlotTypeChange(idx, type) {
  if (!ST.tplEdit || !ST.tplEdit.definition.slots[idx]) return;
  var slot = ST.tplEdit.definition.slots[idx];
  slot.font = slot.font || {};
  slot.font.type = type;
  if (type === 'qrcode') {
    if (!slot.font.h || slot.font.h < 1) slot.font.h = 8;
    slot.font.h = Math.max(1, Math.min(10, Number(slot.font.h) || 8));
    slot.w = slot.w || 200; slot.h = slot.h || 200;
  } else if (type === 'barcode') {
    if (!slot.font.h || slot.font.h < 8) slot.font.h = 64;
    slot.w = slot.w || 300; slot.h = Math.max(slot.h || 0, 80);
  } else if (type === 'cn') {
    slot.font.w = slot.font.w || 30; slot.font.h = slot.font.h || 30;
  } else if (type === 'empty') {
    slot.w = slot.w || 200; slot.h = slot.h || 40;
  } else {
    slot.font.w = slot.font.w || 24; slot.font.h = slot.font.h || 24;
  }
}

// 生成二维码 SVG data URL（用于打印预览与设计器预览）
function qrSvgDataUrl(text, size) {
  if (typeof qrcode === 'undefined' || !text) return '';
  try {
    var qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr.createDataURL(size || 4, 0);
  } catch (e) { return ''; }
}

// 拖拽：mousedown 开始，mousemove 移动/缩放，mouseup 结束
var _dragState = null;
function _beginSlotDrag(e, idx, mode) {
  if (!ST.tplEdit || !ST.tplEdit.definition.slots[idx]) return;
  e.preventDefault();
  ST.tplSelIdx = idx;
  var slot = ST.tplEdit.definition.slots[idx];
  _dragState = {
    idx: idx,
    mode: mode || 'move',
    startX: e.clientX, startY: e.clientY,
    origX: slot.x, origY: slot.y,
    origW: slot.w || 200, origH: slot.h || 30,
    scale: _getCanvasScale(),
  };
  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup', _onDragEnd);
}
function startDragSlot(e, idx) { _beginSlotDrag(e, idx, 'move'); }
function startResizeSlot(e, idx) { e.stopPropagation(); _beginSlotDrag(e, idx, 'resize'); }

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
    var dotsW = Math.round((ST.tplEdit.size_width || 70) * 300 / 25.4);
    var dotsH = Math.round((ST.tplEdit.size_height || 35) * 300 / 25.4);
    if (_dragState.mode === 'resize') {
      // 右下角缩放：不改变原点，宽高不超出画布
      slot.w = Math.min(dotsW - slot.x, Math.max(30, Math.round(_dragState.origW + dx)));
      slot.h = Math.min(dotsH - slot.y, Math.max(14, Math.round(_dragState.origH + dy)));
    } else {
      var maxX = Math.max(0, dotsW - (slot.w || 0));
      var maxY = Math.max(0, dotsH - (slot.h || 0));
      slot.x = Math.min(maxX, Math.max(0, Math.round(_dragState.origX + dx)));
      slot.y = Math.min(maxY, Math.max(0, Math.round(_dragState.origY + dy)));
    }
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

// 商品列表勾选待打印
function togglePrintSel(id) {
  var m = Object.assign({}, ST.printSel);
  if (m[id]) delete m[id]; else m[id] = true;
  ST.printSel = m;
}
function togglePrintAll() {
  var list = filteredProducts();
  var allOn = list.length > 0 && list.every(function (p) { return ST.printSel[p.id]; });
  var m = {};
  if (!allOn) list.forEach(function (p) { m[p.id] = true; });
  ST.printSel = m;
}
function openPrintSelected() {
  var list = ST.products.filter(function (p) { return ST.printSel[p.id]; });
  if (!list.length) { toast(t('toast.pickLabel'), 'error'); return; }
  openLabelPrint(list);
}

function _labelItemOf(p) {
  return { id: p.id, code: p.code, name: p.name,
    product_type_code: p.product_type_code, category_code: p.category_code,
    rfid_epc: p.rfid_epc || '' };
}

function openLabelPrint(items) {
  ST.labelDlg = true;
  ST.labelResult = null;
  ST.labelTplId = null;
  ST.labelUseTpl = true;
  if (!ST.labelTemplates.length) loadTemplates();
  var arr = Array.isArray(items) ? items : (items ? [items] : []);
  ST.labelItems = arr.map(_labelItemOf);
  if (appPrintReady()) loadBtPrinters();
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
  // 多门店代理状态 → 派生出本对话框商品所属门店的在线状态
  loadBridgeList().then(updateLabelAgent).catch(function () {});
}

// 根据已选商品第一件的所属门店，更新打印对话框的代理在线状态
function updateLabelAgent() {
  var b = labelStoreBridge();
  ST.agent = b ? { online: !!b.online, name: b.agent_name || '' } : { online: false, name: '' };
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
  updateLabelAgent();
}
function closeLabel() { ST.labelDlg = false; ST.printSel = {}; }

// 按商品品类解析其绑定的标签模板
function _tplOfItem(it) {
  var tc = it.product_type_code;
  if (!tc) return null;
  var o = (ST.productTypes || []).find(function (c) { return c.code === tc; });
  var tid = o && o.label_template_id;
  return tid ? (ST.labelTemplates.find(function (x) { return x.id === tid; }) || null) : null;
}

// ---- 标签打印预览（与后端 rfid_print._field_value / 固定布局保持一致）----
function _labelVal(field, it, store) {
  var p = ST.products.find(function (x) { return x.id === it.id; }) || it;
  if (field === 'store') return store;
  if (field === 'name') return p.name || '';
  if (field === 'code') return p.code || '';
  if (field === 'spec') {
    var a = [];
    if (p.material) a.push(p.material);
    if (p.weight) a.push((+p.weight).toFixed(2) + 'g');
    if (p.size) a.push(p.size);
    return a.join(' ');
  }
  if (field === 'price') return p.price ? 'RMB ' + (+p.price).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
  if (field === 'cert') return p.cert ? 'CERT ' + p.cert : '';
  if (field === 'barcode') return p.barcode || p.code || '';
  if (field === 'epc_barcode') { var eb = (p.rfid_epc || it.rfid_epc || '').toUpperCase(); var pre = ((ST.bizConfig && ST.bizConfig.epc_prefix) || 'E280').toUpperCase(); return eb.indexOf(pre) === 0 ? eb.slice(pre.length) : eb; }
  if (field === 'epc_text') { var e = p.rfid_epc || it.rfid_epc || ''; return e ? 'EPC ' + e : ''; }
  if (field === 'category') return p.product_type || '';
  if (field === 'material') return p.material || '';
  if (field === 'weight') return p.weight ? (+p.weight).toFixed(2) + 'g' : '';
  if (field === 'size') return p.size || '';
  if (field === 'origin') return p.origin || '';
  if (field === 'cost') return p.cost ? '￥' + (+p.cost).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
  return '';
}

// 返回每个已选商品的预览数据：{id, code, epc, slots:[...]}（单位：点 827×413）
function labelPreview() {
  if (!ST.labelItems.length) return [];
  var store = (ST.profile && ST.profile.name) || '';
  return ST.labelItems.map(function (it) {
    var p = ST.products.find(function (x) { return x.id === it.id; }) || it;
    var slots = [];
    var tpl = _tplOfItem(it);
    var def = null;
    if (tpl) {
      try { def = typeof tpl.definition === 'string' ? JSON.parse(tpl.definition) : (tpl.definition || {}); }
      catch (e) { def = null; }
    }
    if (def && def.slots && def.slots.length) {
      def.slots.forEach(function (s0) {
        var f = s0.font || {};
        // 不可打印区：仅占位，不渲染也不打印
        if ((f.type || 'ascii') === 'empty') return;
        var val = _labelVal(s0.field, it, store);
        // EPC 字段以条码输出时，去掉「EPC 」前缀与企业前缀，保证可扫描
        if ((f.type || 'ascii') === 'barcode' && s0.field === 'epc_text') {
          var eb = (p.rfid_epc || it.rfid_epc || '').toUpperCase();
          var pre = ((ST.bizConfig && ST.bizConfig.epc_prefix) || 'E280').toUpperCase();
          val = eb.indexOf(pre) === 0 ? eb.slice(pre.length) : eb;
        }
        if (!val) return;
        slots.push({ x: +s0.x || 0, y: +s0.y || 0, w: +s0.w || 200, h: +s0.h || 30,
          type: (f.type || 'ascii'), val: String(val),
          fw: +f.w || 24, fh: +f.h || 24, bh: +f.h || 64,
          rotate: +f.rotate || 0,
          below: (f.type || 'ascii') === 'barcode',
          qr: (f.type || 'ascii') === 'qrcode' ? qrSvgDataUrl(val, 3) : '' });  // 二维码预览
      });
    } else {
      var F = ST.labelFields, y = 24;
      if (F.name && p.name) { slots.push({ x: 24, y: y, w: 780, h: 30, type: 'cn', val: p.name, fw: 30, fh: 30 }); y += 44; }
      var spec = _labelVal('spec', it, store);
      if (F.spec && spec) { slots.push({ x: 24, y: y, w: 780, h: 22, type: 'cn', val: spec, fw: 22, fh: 22 }); y += 34; }
      if (F.barcode && (p.barcode || p.code)) { slots.push({ x: 24, y: y + 4, w: 320, h: 94, type: 'barcode', val: (p.barcode || p.code), fw: 22, fh: 22, bh: 64 }); }
      if (F.epc_barcode && p.rfid_epc) { slots.push({ x: 420, y: 210, w: 380, h: 70, type: 'barcode', val: (p.rfid_epc || it.rfid_epc || ''), fw: 18, fh: 18, bh: 50 }); }
      if (F.price && p.price) slots.push({ x: 560, y: 24, w: 240, h: 42, type: 'ascii', val: _labelVal('price', it, store), fw: 42, fh: 42 });
      if (F.cert && p.cert) slots.push({ x: 520, y: 108, w: 280, h: 20, type: 'ascii', val: _labelVal('cert', it, store), fw: 20, fh: 20 });
      if (F.epc_text && p.rfid_epc) slots.push({ x: 420, y: 373, w: 380, h: 18, type: 'ascii', val: _labelVal('epc_text', it, store), fw: 18, fh: 18 });
      if (F.store && store) slots.push({ x: 24, y: 377, w: 380, h: 20, type: 'cn', val: store, fw: 20, fh: 20 });
    }
    return { id: it.id, code: it.code, name: it.name, epc: p.rfid_epc || it.rfid_epc || '',
      slots: slots,
      bg_image: (def && def.bg_image) || '',
      bg_rotate: (def && Number(def.bg_rotate)) || 0 };
  });
}

// ---- 手机 App 蓝牙打印桥（安卓手持机 WebView 注入 window.YzApp 时生效）----
function appPrintReady() {
  return !!(window.YzApp && typeof window.YzApp.printZpl === 'function');
}
function loadBtPrinters() {
  if (!appPrintReady()) return;
  try {
    ST.btPrinters = JSON.parse(window.YzApp.printers() || '[]');
    var cur = JSON.parse(window.YzApp.printer() || '{}');
    ST.btPrinter = { address: cur.address || '', name: cur.name || '' };
  } catch (e) {}
}
function pickBtPrinter(addr) {
  if (!appPrintReady()) return;
  window.YzApp.pickPrinter(addr || '');
  try {
    var cur = JSON.parse(window.YzApp.printer() || '{}');
    ST.btPrinter = { address: cur.address || '', name: cur.name || '' };
  } catch (e) {}
}
// App 打印结果回调（安卓侧 evaluateJavascript 调用）
window.YzPrinter = {
  onResult: function (ok, msg) {
    ST.labelBusy = false;
    if (ok) toast(t('label.btSent'));
    else toast(t('label.btFail') + (msg ? '：' + msg : ''), 'error');
  },
  onPrinter: function () { try { var cur = JSON.parse(window.YzApp.printer() || '{}'); ST.btPrinter = { address: cur.address || '', name: cur.name || '' }; } catch (e) {} },
  onPermission: function () { loadBtPrinters(); },
};

function submitLabelPrint() {
  if (!ST.labelItems.length) { toast(t('toast.pickLabel'), 'error'); return; }
  if (appPrintReady()) { submitLabelPrintApp(); return; }
  ST.labelBusy = true;
  var body = {
    product_ids: ST.labelItems.map(function (x) { return x.id; }),
    printer: ST.printerName, copies: ST.labelCopies || 1,
    write_epc: ST.writeEpc, font: ST.labelFont || '',
    simulate: ST.simulatePrint || !ST.printSupported,
  };
  // 云端无打印机：经门店打印桥下发（云端按商品所属门店路由到对应代理）
  if (!ST.printSupported) {
    if (!ST.agent || !ST.agent.online) { toast(t('sb.offlineToast'), 'error'); return; }
    body.simulate = false;
    body.route = 'agent';
    body.printer = '';
  }
  // 仅当每件商品都绑定同一模板时才传 template_id；混打/含无模板商品时由后端逐件解析
  var perTpl = ST.labelItems.map(function (it) { var t0 = _tplOfItem(it); return t0 ? t0.id : 0; });
  var firstTpl = perTpl[0];
  if (firstTpl && perTpl.every(function (id) { return id === firstTpl; })) {
    body.template_id = firstTpl;
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

// 手机 App 蓝牙直打：云端只生成 ZPL，由 App 经蓝牙 SPP 发给便携标签机（结果经 window.YzPrinter.onResult 回调）
function submitLabelPrintApp() {
  if (!ST.btPrinter || !ST.btPrinter.address) { toast(t('label.btNone'), 'error'); return; }
  ST.labelBusy = true;
  var body = {
    product_ids: ST.labelItems.map(function (x) { return x.id; }),
    printer: '', copies: ST.labelCopies || 1,
    write_epc: ST.writeEpc, font: ST.labelFont || '',
    simulate: true,
  };
  var perTpl = ST.labelItems.map(function (it) { var t0 = _tplOfItem(it); return t0 ? t0.id : 0; });
  var firstTpl = perTpl[0];
  if (firstTpl && perTpl.every(function (id) { return id === firstTpl; })) {
    body.template_id = firstTpl;
  } else {
    body.fields = Object.keys(ST.labelFields).filter(function (k) { return ST.labelFields[k]; });
  }
  api('POST', '/api/print/labels', body).then(function (r) {
    ST.labelResult = r;
    if (!r.zpl) { ST.labelBusy = false; toast(t('label.btFail'), 'error'); return; }
    window.YzApp.printZpl(String(r.zpl));
    refreshAll();
  }).catch(function (e) { ST.labelBusy = false; toast(e.message, 'error'); });
}

// ---- 智能安防 ----
function loadSecurity() {
  api('GET', '/api/sensors').then(function (r) { ST.secSensors = r.items || []; }).catch(function () {});
  api('GET', '/api/sensors/drivers').then(function (r) { ST.secDrivers = r.items || []; }).catch(function () {});
  api('GET', '/api/sensors/events?size=50').then(function (r) {
    ST.secEvents = r.items || []; ST.secPending = r.pending || 0;
  }).catch(function () {});
  api('GET', '/api/sensors/settings').then(function (r) { ST.secSettings = r; }).catch(function () {});
  api('GET', '/api/sensors/pass').then(function (r) { ST.secPass = r.items || []; }).catch(function () {});
  if (!ST.bridges.length) {
    api('GET', '/api/print-agent/status').then(function (r) { ST.bridges = r.bridges || []; }).catch(function () {});
  }
  secWsConnect();
}

// 工作区告警推送：断线自动重连
function secWsConnect() {
  if (!ST.token || (ST._secWs && ST._secWs.readyState <= 1)) return;
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var ws = new WebSocket(proto + '://' + location.host + API + '/ws/security?token=' + encodeURIComponent(ST.token));
  ST._secWs = ws;
  ws.onmessage = function (e) {
    try {
      var d = JSON.parse(e.data);
      if (d.type === 'alarm') {
        ST.secAlarm = d;
        if (!ST.secMuted) secBeep();
        loadSecurity();
      }
    } catch (err) {}
  };
  ws.onclose = function () {
    ST._secWs = null;
    setTimeout(secWsConnect, 5000);
  };
}

// 告警提示音（Web Audio 蜂鸣，无需音频文件）
function secBeep() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = secBeep._ctx || (secBeep._ctx = new Ctx());
    var n = 0;
    var timer = setInterval(function () {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3);
      if (++n >= 6) clearInterval(timer);
    }, 350);
  } catch (e) {}
}

function secAckAlarm(note) {
  var d = ST.secAlarm;
  if (!d) return;
  var first = (d.alarms || [])[0];
  if (first && first.id) {
    api('POST', '/api/sensors/events/' + first.id + '/handle', { action: 'confirm', note: note || '' })
      .then(function () { loadSecurity(); }).catch(function () {});
  }
  ST.secAlarm = null;
}

function secToggleArm() {
  if (!ST.secSettings) return;
  var target = !ST.secSettings.armed;
  api('PUT', '/api/sensors/settings', { armed: target }).then(function () {
    ST.secSettings.armed = target;
    toast(target ? t('sec.armed') : t('sec.disarmed'));
  }).catch(function () {});
}

function secSaveSettings() {
  var s = ST.secSettings;
  api('PUT', '/api/sensors/settings', {
    arm_time: s.arm_time, disarm_time: s.disarm_time,
    webhook_url: s.webhook_url,
    webhook_secret: s.webhook_secret === '******' ? null : s.webhook_secret,
    dedup_sec: s.dedup_sec,
  }).then(function () { toast(t('act.save') + ' OK'); loadSecurity(); }).catch(function () {});
}

function secNewOpen() {
  ST.secNewKey = null;
  ST.secNew = { name: '', store_id: 1, location: '',
                driver_code: (ST.secDrivers[0] || {}).code || 'uhf_rfid_gate', enabled: true };
}

function secCreate() {
  api('POST', '/api/sensors', ST.secNew).then(function (r) {
    ST.secNewKey = r;   // {id, auth_key, http_url, ws_url} 密钥仅此一次展示
    ST.secNew = null;
    loadSecurity();
  }).catch(function () {});
}

function secRotateKey(s) {
  if (!confirm(t('sec.rotateConfirm'))) return;
  api('POST', '/api/sensors/' + s.id + '/rotate-key').then(function (r) {
    ST.secNewKey = { id: s.id, auth_key: r.auth_key, http_url: '', ws_url: r.ws_url, rotated: true };
  }).catch(function () {});
}

function secDelete(s) {
  if (!confirm(t('act.del') + ' ' + s.name + '?')) return;
  api('DELETE', '/api/sensors/' + s.id).then(function () { loadSecurity(); }).catch(function () {});
}

function secSimulate(s, kind) {
  var body = kind === 'alarm'
    ? { kind: 'signal', alarm: true }
    : { kind: 'epc', epcs: [(ST.secSimEpc || '').trim()] };
  api('POST', '/api/sensors/' + s.id + '/simulate', body).then(function (r) {
    toast(t('sec.simOk') + ': ' + (r.alarms ? '🚨' + r.alarms : '✓'));
    loadSecurity();
  }).catch(function () {});
}

function secHandleEvent(ev, action) {
  var note = action === 'confirm' ? (prompt(t('sec.handleNote')) || '') : '';
  api('POST', '/api/sensors/events/' + ev.id + '/handle', { action: action, note: note })
    .then(function () { loadSecurity(); }).catch(function () {});
}

function secAddPass() {
  var epc = (ST.secPassEpc || '').trim();
  if (!epc) { toast(t('sec.epcRequired'), 'error'); return; }
  api('POST', '/api/sensors/pass', { epc: epc, reason: ST.secPassReason || '', minutes: ST.secPassMin || 60 })
    .then(function () { ST.secPassEpc = ''; ST.secPassReason = ''; loadSecurity(); }).catch(function () {});
}

function secDelPass(p) {
  api('DELETE', '/api/sensors/pass/' + p.id).then(function () { loadSecurity(); }).catch(function () {});
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

// ---- 本地打印桥（门店级）----
// 打印业务固定枚举镜像（须与 db.py PRINT_BIZ 一致）：[code, 分组]
var PRINT_BIZ = [
  ['label_product', 'label'], ['label_shelf', 'label'],
  ['receipt_sale', 'receipt'], ['receipt_deposit', 'receipt'], ['receipt_loan', 'receipt'],
  ['receipt_repair', 'receipt'], ['receipt_purchase', 'receipt'],
  ['receipt_outsourcing', 'receipt'], ['receipt_inout', 'receipt'],
  ['cert_warranty', 'doc'], ['report_stocktake', 'doc'], ['report_business', 'doc'],
];

function bizGroups() {
  return ['label', 'receipt', 'doc'].map(function (g) {
    return {group: g, items: PRINT_BIZ.filter(function (x) { return x[1] === g; })
      .map(function (x) { return x[0]; })};
  });
}

// 某门店某打印业务当前指派的打印机名
function bizPrinterOf(b, code) {
  var row = (b.biz || []).find(function (x) { return x.code === code; });
  return row ? (row.printer || '') : '';
}

function loadBridgeList() {
  return api('GET', '/api/print-agent/status').then(function (r) {
    ST.bridges = r.bridges || [];
    // 下载下拉框默认选中第一个已生成密钥的门店；已选门店失效时回退
    var keyed = ST.bridges.filter(function (b) { return b.has_key; });
    if (!keyed.some(function (b) { return b.store_id === ST.agentDlStore; })) {
      ST.agentDlStore = keyed.length ? keyed[0].store_id : 0;
    }
  }).catch(function () {});
}

// ---------------------------------------------------------------- 系统自检铃铛
// 健康检查注册表：run() 返回 'ok' | 'bad' | 'na'（未配置不计异常）。
// 新增检查项只需在此加一行，i18n 补 hc.<id> 文案，铃铛/面板/摇动自动生效。
var HEALTH_CHECKS = [
  { id: 'print_agent', run: function () {
      if (!ST.bridges.length) return 'na';
      return ST.bridges.some(function (b) { return b.online; }) ? 'ok' : 'bad';
  }},
  { id: 'anti_theft', run: function () {
      if (!ST.secSensors.length) return 'na';
      var armed = !!(ST.secSettings && ST.secSettings.armed);
      var anyOn = ST.secSensors.some(function (s) { return s.enabled && s.online; });
      return (armed && anyOn) ? 'ok' : 'bad';
  }},
];

function healthItems() {
  return HEALTH_CHECKS.map(function (c) {
    return { id: c.id, enabled: ST.healthOff.indexOf(c.id) < 0, state: c.run() };
  });
}
function healthBad() {
  return HEALTH_CHECKS.some(function (c) {
    return ST.healthOff.indexOf(c.id) < 0 && c.run() === 'bad';
  });
}
function toggleHealth(id) {
  var i = ST.healthOff.indexOf(id);
  if (i >= 0) ST.healthOff.splice(i, 1); else ST.healthOff.push(id);
  localStorage.setItem('yz_health_off', JSON.stringify(ST.healthOff));
}

// 轻量轮询：登录后拉一次，此后每 30s（页面隐藏时跳过），铃铛状态全局实时
function loadHealth() {
  loadBridgeList();
  api('GET', '/api/sensors').then(function (r) { ST.secSensors = r.items || []; }).catch(function () {});
  api('GET', '/api/sensors/settings').then(function (r) { ST.secSettings = r; }).catch(function () {});
}
function startHealthTimer() {
  if (ST.healthTimer) return;
  ST.healthTimer = setInterval(function () { if (!document.hidden) loadHealth(); }, 30000);
}
function createStore() {
  var name = prompt(t('sb.storeName'));
  if (!name || !name.trim()) return;
  api('POST', '/api/stores', { name: name.trim() }).then(function () {
    toast(t('toast.saveOk'));
    loadBridgeList();
  }).catch(function (e) { toast(e.message, 'error'); });
}
function rotateStoreKey(sid) {
  api('POST', '/api/stores/' + sid + '/bridge-key', {}).then(function (r) {
    var b = ST.bridges.find(function (x) { return x.store_id === sid; });
    if (b) b.newKey = r.key || '';
    toast(t('sb.keyGen'));
  }).catch(function (e) { toast(e.message, 'error'); });
}
function copyStoreKey(sid) {
  var b = ST.bridges.find(function (x) { return x.store_id === sid; });
  if (b && b.newKey && navigator.clipboard) navigator.clipboard.writeText(b.newKey).then(function () { toast(t('toast.keyCopied')); });
}
function bindBizPrinter(sid, code, printer) {
  api('POST', '/api/stores/' + sid + '/bind-printer',
      { biz: code, printer: printer || '' }).then(function (r) {
    var b = ST.bridges.find(function (x) { return x.store_id === sid; });
    if (b) {
      var row = (b.biz || []).find(function (x) { return x.code === code; });
      if (row) row.printer = r.printer || '';
      if (code === 'label_product') b.printer_name = r.printer || '';
    }
    toast(t('toast.saveOk'));
  }).catch(function (e) { toast(e.message, 'error'); });
}
function storeControl(sid, action, biz) {
  api('POST', '/api/stores/' + sid + '/print-control',
      { action: action, biz: biz || 'label_product' }).then(function () {
    toast(t('sb.ctlOk'));
    if (action === 'refresh') loadBridgeList();
  }).catch(function (e) { toast(e.message, 'error'); });
}
// 打印对话框：取第一批商品的门店桥状态
function labelStoreBridge() {
  var it = ST.labelItems[0];
  if (!it) return null;
  var p = ST.products.find(function (x) { return x.id === it.id; }) || it;
  var sid = p.store_id || 1;
  return ST.bridges.find(function (b) { return b.store_id === sid; }) || null;
}

// ---- resize ----
window.addEventListener('resize', function () { ST.isPc = isPcLayout(); });

// ---- 软件名称（源自 plugin.json，经 /api/health 下发）----
(function loadSoftName() {
  fetch(API + '/api/health').then(function (r) { return r.json(); }).then(function (r) {
    if (r && r.name) { ST.softName = r.name; document.title = r.name; }
  }).catch(function () {});
})();

// ---------------- 列表排序（Vue 数据层，表头点击升/降/恢复默认） ----------------
function prodSortVal(p, k) {
  switch (k) {
    case 'code': return (p.code || '').toLowerCase();
    case 'name': return (p.name || '').toLowerCase();
    case 'type': return (productTypeName(p) || '').toLowerCase();
    case 'mat': return (materialText(p.material) || '').toLowerCase();
    case 'weight': return Number(p.weight) || 0;
    case 'price': return Number(p.price) || 0;
    case 'cost': return Number(p.cost) || 0;
    case 'status': return p.status || '';
    case 'epc': return (p.rfid_epc || '').toLowerCase();
    case 'size': return p.size || '';
    case 'showcase': return p.showcase_public ? 1 : 0;
    case 'hv': return p.high_value ? 1 : 0;
    default: return '';
  }
}
function applyTblSort(list, tbl, valFn) {
  var s = ST.tblSort[tbl];
  if (!s || !s.key) return list;
  var dir = s.dir || 1;
  return list.slice().sort(function (a, b) {
    var va = valFn(a, s.key), vb = valFn(b, s.key);
    var c = (typeof va === 'number' && typeof vb === 'number') ? (va - vb)
            : String(va).localeCompare(String(vb), 'zh');
    return (c || ((a.id || 0) - (b.id || 0))) * dir;
  });
}
function sortTbl(tbl, key) {
  var s = ST.tblSort[tbl];
  if (s.key !== key) { s.key = key; s.dir = 1; }
  else if (s.dir === 1) s.dir = -1;
  else { s.key = ''; s.dir = 1; }
}
function sortCls(tbl, key) {
  var s = ST.tblSort[tbl];
  if (!s || s.key !== key) return 'mt-sortable';
  return 'mt-sortable ' + (s.dir === 1 ? 'mt-asc' : 'mt-desc');
}

// ---------------- 列表现代化：列宽拖拽（初始自适应）+ 列显隐 ----------------
// 通过 colgroup + table-layout:fixed + visibility:collapse 实现，
// Vue 重渲染 tbody 不影响；配置存 localStorage（按表区分）。
var MT_TABLES = [
  { sel: 'table.table-products', key: 'products' },
  { sel: 'table.table-stock', key: 'stock' }
];
function mtLoad(key) {
  try { return JSON.parse(localStorage.getItem('jw_tbl_' + key) || 'null'); } catch (e) { return null; }
}
function mtStore(key, data) {
  try { localStorage.setItem('jw_tbl_' + key, JSON.stringify(data)); } catch (e) {}
}
function mtEnhance(table, key) {
  if (!table || !table.tHead || !table.tHead.rows.length || table.dataset.mt) return;
  table.dataset.mt = '1';
  var headRow = table.tHead.rows[0];
  var ncol = headRow.cells.length;
  var wrap = table.closest('.table-wrap') || table.parentElement;
  var saved = mtLoad(key) || {};
  var hiddenIdx = (saved.hiddenIdx || []).filter(function (i) { return i >= 0 && i < ncol; });
  var pct = (saved.pct && saved.pct.length === ncol) ? saved.pct.slice() : null;

  table.classList.add('mt-fixed');
  var cg = document.createElement('colgroup');
  for (var i = 0; i < ncol; i++) cg.appendChild(document.createElement('col'));
  table.insertBefore(cg, table.tHead);
  var cols = cg.children;

  function applyCols() {
    for (var i = 0; i < ncol; i++) {
      var hid = hiddenIdx.indexOf(i) >= 0;
      cols[i].style.visibility = hid ? 'collapse' : '';
      cols[i].style.width = pct ? pct[i] + '%' : '';
      headRow.cells[i].classList.toggle('mt-hide', hid);
    }
  }

  // 初始自适应：按表头+前30行内容测量列宽，按比例铺满容器宽
  function autofit() {
    if (pct) { applyCols(); return; }
    table.classList.remove('mt-fixed');
    for (var i = 0; i < ncol; i++) { cols[i].style.width = ''; cols[i].style.visibility = ''; }
    var wrapW = wrap.clientWidth - 2;
    var rows = table.tBodies.length ? table.tBodies[0].rows : [];
    var sample = Math.min(rows.length, 30);
    var ws = [];
    for (var c = 0; c < ncol; c++) {
      var w = headRow.cells[c].getBoundingClientRect().width;
      for (var r = 0; r < sample; r++) {
        var td = rows[r].cells[c];
        if (td) w = Math.max(w, td.getBoundingClientRect().width);
      }
      ws.push(Math.max(52, Math.ceil(w) + 14));
    }
    table.classList.add('mt-fixed');
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    var total = Math.max(sum, wrapW, 1);
    pct = ws.map(function (w) { return w / total * 100; });
    var s2 = pct.reduce(function (a, b) { return a + b; }, 0) || 1;
    pct = pct.map(function (v) { return v / s2 * 100; });
    applyCols();
    mtStore(key, { hiddenIdx: hiddenIdx, pct: pct });
  }

  // 拖拽调宽：拖第 i 列右缘，与相邻列互补；最后一列独立伸缩
  function bindGrip(th, i) {
    var grip = document.createElement('span');
    grip.className = 'mt-grip';
    th.appendChild(grip);
    grip.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var startX = ev.clientX, wrapW = wrap.clientWidth || 1;
      var w0 = pct[i], w1 = (i + 1 < ncol) ? pct[i + 1] : null;
      document.body.classList.add('mt-dragging');
      function mv(e) {
        var d = (e.clientX - startX) / wrapW * 100;
        var nw0 = Math.max(3, w0 + d);
        pct[i] = nw0;
        if (w1 !== null) pct[i + 1] = Math.max(3, w1 - (nw0 - w0));
        applyCols();
      }
      function up() {
        window.removeEventListener('pointermove', mv);
        document.body.classList.remove('mt-dragging');
        mtStore(key, { hiddenIdx: hiddenIdx, pct: pct });
      }
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up, { once: true });
    });
    grip.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  for (var g = 0; g < ncol; g++) bindGrip(headRow.cells[g], g);

  // 列显隐菜单（fixed 定位，避免被 wrap 裁剪）
  var bar = document.createElement('div'); bar.className = 'mt-bar';
  var gear = document.createElement('button'); gear.type = 'button';
  gear.className = 'mt-gear'; gear.title = t('tbl.cols'); gear.textContent = '⚙';
  var menu = document.createElement('div'); menu.className = 'mt-menu';
  for (var m = 0; m < ncol; m++) {
    (function (idx) {
      var th = headRow.cells[idx];
      var label = (th.textContent || '').trim() || th.title || ('#' + (idx + 1));
      var item = document.createElement('label'); item.className = 'mt-item';
      var cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = hiddenIdx.indexOf(idx) < 0;
      cb.addEventListener('change', function () {
        var at = hiddenIdx.indexOf(idx);
        if (cb.checked) { if (at >= 0) hiddenIdx.splice(at, 1); }
        else if (at < 0) hiddenIdx.push(idx);
        applyCols();
        mtStore(key, { hiddenIdx: hiddenIdx, pct: pct });
      });
      item.appendChild(cb);
      item.appendChild(document.createTextNode(' ' + label));
      menu.appendChild(item);
    })(m);
  }
  gear.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var open = menu.classList.toggle('open');
    if (open) {
      var r = gear.getBoundingClientRect();
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      menu.style.left = 'auto';
    }
  });
  document.addEventListener('click', function (ev) {
    if (!menu.contains(ev.target) && !gear.contains(ev.target)) menu.classList.remove('open');
  });
  bar.appendChild(gear);
  wrap.appendChild(bar);
  wrap.appendChild(menu);
  wrap.classList.add('mt-wrap');

  autofit();
}
function mtScan() {
  if (!ST.isPc) return;
  MT_TABLES.forEach(function (cfg) {
    var tb = document.querySelector(cfg.sel);
    if (tb) mtEnhance(tb, cfg.key);
  });
}
// 表格随页签 v-if 挂载/卸载，用轻量观察器在渲染后增强（去抖，避免与 Vue 渲染互相触发）
(function mtSetup() {
  var pending = false;
  var scan = function () { pending = false; try { mtScan(); } catch (e) {} };
  var ob = new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(scan, 120);
  });
  if (document.body) ob.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', function () { ob.observe(document.body, { childList: true, subtree: true }); });
})();

// ---- Vue app ----
var app = Vue.createApp({
  data: function () { return ST; },
  computed: {
    filteredProducts: filteredProducts,
    printSelCount: printSelCount, printAllChecked: printAllChecked,
    invStockList: invStockList,
    invStockGroups: invStockGroups,
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
    labelFieldGroups: function () { return LABEL_FIELD_GROUPS; },
    // 已生成密钥的门店（代理下载下拉框数据源）
    keyedStores: function () { return ST.bridges.filter(function (b) { return b.has_key; }); },
    // 是否有任一门店代理在线（PC 端据此提示下载，移动端仅提示）
    anyAgentOnline: function () { return ST.bridges.some(function (b) { return b.online; }); },
    // 代理下载地址：按所选门店服务端内嵌密钥后下发 exe
    agentDlUrl: function () {
      return ST.agentDlStore ? API + '/api/stores/' + ST.agentDlStore + '/agent-download' : '';
    },
    // 打印业务分组（标签 / 票据 / 单据报表）
    bizGroups: bizGroups,
    // 系统自检铃铛：检查项列表 / 是否有启用项异常
    healthItems: healthItems,
    healthBad: healthBad,
  },
  methods: {
    t: t, fmt: fmt, fmtY: fmtY, dateFmt: dateFmt,
    toggleHealth: toggleHealth,
    statusClass: statusClass,
    statusText: statusText, methodText: methodText, levelText: levelText,
    directionText: directionText, printedTip: printedTip, coStatusText: coStatusText, resultText: resultText,
    fieldLabelText: fieldLabelText, labelFieldText: labelFieldText,
    doLogin: doLogin, doLogout: doLogout,
    openHandheldLogin: openHandheldLogin, closeHandheldLogin: closeHandheldLogin,
    handheldConfirm: handheldConfirm, yzScan: yzScan,
    go: go, openSubView: openSubView, setLang: setLang,
    sortTbl: sortTbl, sortCls: sortCls,
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
    loadBridgeList: loadBridgeList, createStore: createStore, rotateStoreKey: rotateStoreKey,
    copyStoreKey: copyStoreKey, bindBizPrinter: bindBizPrinter, bizPrinterOf: bizPrinterOf,
    storeControl: storeControl,
    labelStoreBridge: labelStoreBridge,
    openInbound: openInbound, copyInbound: copyInbound, openRfid: openRfid, doRfid: doRfid, toggleInvGroup: toggleInvGroup,
    openLabelPrint: openLabelPrint, removeLabelItem: removeLabelItem, closeLabel: closeLabel,
    togglePrintSel: togglePrintSel, togglePrintAll: togglePrintAll, openPrintSelected: openPrintSelected,
    submitLabelPrint: submitLabelPrint, labelPreview: labelPreview,
    appPrintReady: appPrintReady, loadBtPrinters: loadBtPrinters, pickBtPrinter: pickBtPrinter,
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
    recordLines: recordLines, recordKind: recordKind, statusClass: statusClass,
    openRecordDetail: openRecordDetail, detailRows: detailRows, editFromDetail: editFromDetail,
    loadAppt: loadAppt, loadProfile: loadProfile,
    // 标签模板设计器
    openTplDesigner: openTplDesigner, closeTplDesigner: closeTplDesigner,
    saveTemplate: saveTemplate, delTemplate: delTemplate, bindCatTemplate: bindCatTemplate,
    addSlotToCanvas: addSlotToCanvas, removeSlot: removeSlot, updateSlot: updateSlot,
    onSlotTypeChange: onSlotTypeChange, qrSvgDataUrl: qrSvgDataUrl, dotsToMm: dotsToMm,
    startDragSlot: startDragSlot, startResizeSlot: startResizeSlot, previewTemplate: previewTemplate, loadTemplates: loadTemplates,
    tplDotScale: tplDotScale,
    uploadTplBg: uploadTplBg, rotateTplBg: rotateTplBg, removeTplBg: removeTplBg,
    tplBgStyle: tplBgStyle, lpBgStyle: lpBgStyle,
    // 智能安防
    loadSecurity: loadSecurity, secToggleArm: secToggleArm, secSaveSettings: secSaveSettings,
    secNewOpen: secNewOpen, secCreate: secCreate, secRotateKey: secRotateKey,
    secDelete: secDelete, secSimulate: secSimulate, secHandleEvent: secHandleEvent,
    secAddPass: secAddPass, secDelPass: secDelPass, secAckAlarm: secAckAlarm,
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
      window.__yzLoginOk = true;
      refreshAll();
    }).catch(function () { ST.token = ''; sessionStorage.removeItem('jewelry_token'); });
  }
} catch (e) {}

// ---- 手持机 App WebView：URL 携带 token 直接进入 ----
// SaleActivity 加载 /?token=xxx 时免登录进入；__yzLoginOk 供 App 检测会话是否有效
try {
  var _yzTok = new URLSearchParams(location.search).get('token');
  if (_yzTok && !ST.token) {
    ST.token = _yzTok;
    sessionStorage.setItem('jewelry_token', _yzTok);
    api('GET', '/api/auth/me').then(function (r) {
      ST.user = r.user; ST.mode = r.mode || 'NORMAL'; ST.tenant = r.tenant || '';
      window.__yzLoginOk = true;
      refreshAll();
    }).catch(function () { ST.token = ''; sessionStorage.removeItem('jewelry_token'); });
  }
} catch (e) {}

// ---- 全局冻结状态慢速轮询 ----
// 任务可能由另一台电脑开启/确认/终止；即使不在库存页也要能感知冻结与解冻。
// 进行中任务的 5s 快速轮询由 ensureCoTimer 负责，这里是全局面兜底。
setInterval(function () { if (ST.token) loadCoTask(); }, 15000);

