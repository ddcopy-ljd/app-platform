/* ===== 懿臻珠宝云 · Vue3 SPA 主逻辑 ===== */

// 经平台网关访问时，平台会在页面注入 window.__APP_BASE__（如 /app/jewelry/t001/）；
// 直连插件服务时该变量不存在，退化为空串（根路径）。所有 API 均经此拼接。
// 统一去掉结尾斜杠：各调用处的 url 均以 / 开头（如 /api/...），避免拼成双斜杠
// （//api/... 会落到静态服务的 SPA 回退，GET 返回 HTML、POST 报 405）。
var API = (window.__APP_BASE__ || '').replace(/\/+$/, '');

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
  token: '', user: null, mode: 'NORMAL', tenant: '', version: '',
  softName: '懿臻珠宝云',   // 软件名：启动时从 /api/health 拉取（源自 plugin.json），此处仅为兜底
  tab: 'dashboard', subView: '', adminSub: 'epc',
  isPc: isPcLayout(),
  // 列表排序状态：{ 表key: { key: 排序列, dir: 1升/-1降 } }
  tblSort: { products: { key: '', dir: 1 }, stock: { key: '', dir: 1 } },
  lang: currentLang, langKeys: LANG_KEYS, langLabels: LANG_LABELS,
  loginUser: 'admin', loginPwd: '123456',
  // data
  dashData: null, trendData: null, remindData: null, showRemind: true, catSales: null,
  products: [], prodTotal: 0, prodCat: '', prodQ: '', prodHasCert: false, prodLoc: 0,
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
  health: {},            // /api/health/summary 聚合数据（防盗待处理/任务停滞/缺EPC/盘点超期/欠款）
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
  coQrUrl: '',
  // 统一任务复盘报告弹窗
  taskReport: null, reportTaskId: 0,
  // 扫描设备管理
  devModal: false, devices: [],
  activations: [], actStoreId: 0, actName: '', actQrUrl: '', actUrl: '',
  devStoreScope: 0,   // 门店管理内打开设备弹窗时锁定的门店（0=盘点页全部）
  // 手持机扫码登录（网页端弹窗）
  hqShow: false, hqStatus: '', hqDevice: '', hqImg: '', hqKey: '', hqTimer: null,
  yzScanReady: false,   // App WebView 注入 YzApp 桥接后为 true，出单表单显示扫码按钮
  // 摄像头扫码（本地 zxing，无需 App/外网）
  camOpen: false, camBusy: false, camErr: '', _camControls: null,
  // 业务端扫码任务 WS（/ws/scan-page）：连接句柄/重连计时
  _pageWs: null, _pageWsTimer: null,
  // 当前表单协同模式状态（type/任务/已扫数/最近 EPC/新开任务提示）
  scanCoop: { type: '', taskId: 0, taskNo: '', count: 0, recent: [], offer: false, applied: {} },
  // 智能安防
  secSensors: [], secEvents: [], secPending: 0, secSettings: null, secPass: [],
  secDrivers: [], secNew: null, secNewKey: null,
  secAlarm: null, secMuted: false, _secWs: null,
  secSimEpc: '', secPassEpc: '', secPassReason: '', secPassMin: 60,
  secRawFilter: '',
  // 复制入库高亮（flashIds 中的商品 ID 列表，3.5s 后自动移除）
  flashIds: [],
  // 门店精简列表 / 库位主数据 / 经办人类别（基础数据，商品表单与设置页共用）
  stores: [],
  curStoreId: 0,      // 当前工作门店（由后端会话决定，只能在本人授权门店间切换）
  // 店铺（上层组织）/ 门店管理编辑态
  shops: [],
  shopEdit: { id: 0, name: '', code: '', sale_item_limit: 20 }, shopEditMode: 'new',
  storeEdit: { id: 0, name: '', code: '', owner: '', shop_id: 0 }, storeEditMode: 'new',
  inboundStore: null,   // 门店内入库时锁定的门店对象
  locations: [], locStore: 0,
  locEdit: { id: 0, store_id: 0, code: '', name: '', sort_order: 0, active: 1 }, locEditMode: 'new',
  clerkTypes: [],
  clerkEdit: { id: 0, name: '', sort_order: 0 }, clerkEditMode: 'new',
  // 用户与门店授权（系统管理-店长）
  adminUsers: [], adminUserOpen: false,
  adminUserForm: { id: 0, username: '', display_name: '', password: '', role: 'EMPLOYEE' },
  saleClerkType: '',   // 销售列表类别筛选（''=全部）
  // 门店调拨：商品页多选 / 调拨单列表 / 详情与验货
  transferMode: false,           // 商品页调拨选择模式
  transferSel: {},               // {productId: product}
  transferSelStore: 0,           // 已选商品所属门店（首件决定）
  transferSendOpen: false,       // 发起调拨弹窗
  transferToStore: 0, transferRemark: '', transferBusy: false,
  transferTab: 'out',            // 调拨页视角 out=我发出的 / in=我接收的
  transfersOut: [], transfersIn: [],
  transferDetail: null, transferDetailOpen: false,
  transferReceiving: false,      // 验货态
  transferRecv: {},              // {pid: {ok: true|false|null, reason: ''}}
  transferScanHit: 0,            // 验货扫码命中行高亮（product_id）
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
    if (r.status === 401 && ST.token && url !== '/api/auth/login') {
      // 会话失效：断开页面 WS 并清理本地会话，回到登录态
      scanPageWsDisconnect();
      ST.token = ''; ST.user = null;
      syncToken();
    }
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
  { id: 'transfers', icon: '🚚', key: 'nav.transfers' },
  { id: 'sales', icon: '🧾', key: 'nav.sales' },
  { id: 'deposits', icon: '💰', key: 'nav.deposits' },
  { id: 'loans', icon: '🔁', key: 'nav.loans' },
  { id: 'customers', icon: '👥', key: 'nav.customers' },
  { id: 'repairs', icon: '🔧', key: 'nav.repairs' },
  { id: 'purchases', icon: '📥', key: 'nav.purchases' },
  { id: 'outsourcings', icon: '🏭', key: 'nav.outsourcings' },
  { id: 'appointments', icon: '📅', key: 'nav.appointments' },
  { id: 'shops', icon: '🏬', key: 'nav.shops' },
  { id: 'stores', icon: '🏪', key: 'nav.stores' },
  { id: 'showcase', icon: '🪟', key: 'nav.showcase' },
  { id: 'system', icon: '⚙️', key: 'nav.system' },
];
// 系统管理子视图（tab==='system' 下的 adminSub）
// enterprise（企业资料）搬去了 shops section，这里剩 5 个
var ADMIN_SUBS = [
  { key: 'users', icon: '👥', label: '用户与门店权限' },
  { key: 'epc', icon: '🔢', label: 'EPC 编码规则' },
  { key: 'clerk', icon: '🧑‍💼', label: '经办人类别' },
  { key: 'categories', icon: '🏷️', label: '商品品类与标签' },
  { key: 'security', icon: '🛡️', label: '安防中心' },
  { key: 'logs', icon: '📋', label: '操作日志' },
];

var SUB_VIEWS = ['customers', 'loans', 'repairs', 'purchases', 'outsourcings'];
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
  // 一键筛选「未配证书」
  if (ST.prodHasCert) {
    list = list.filter(function (p) { return !p.cert || !String(p.cert).trim(); });
  }
  // 按存放库位筛选
  if (ST.prodLoc) {
    list = list.filter(function (p) { return p.location_id === ST.prodLoc; });
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

// 当前工作门店名（顶部门店切换器/表单只读显示）
function curStoreName() {
  var s = ST.stores.find(function (x) { return x.id === ST.curStoreId; });
  return s ? s.name : '';
}

function subTitle() {
  var lang = ST.lang;
  return t(SUB_TITLES[ST.subView] || '');
}

function exportHref() { return API + '/api/logs/export'; }

function statusClass(s) {
  var m = { '在库': 'tag-stock', '已定': 'tag-reserved', '已售': 'tag-sold', '借出': 'tag-blue',
            '在途': 'tag-transit', '部分完成': 'tag-gold', '已完成': 'tag-green' };
  return m[s] || 'tag-wine';
}

// ---- 业务枚举值 → 当前语言文案（数据层始终存中文/英文码，仅展示层翻译）----
var STATUS_I18N_KEYS = {
  '在库': 'st.inStock', '已定': 'st.reserved', '已售': 'st.sold', '借出': 'st.loaned',
  '在途': 'st.transit', '部分完成': 'st.partial',
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
  if (s === '已完成') return t('co.statusDone');
  if (s === '已撤销') return t('co.statusCancel');
  if (s === '已终止') return t('co.statusTerminate');
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
  // 旧入口兼容：profile/security/logs 全部归到系统管理
  if (tab === 'profile') { ST.tab = 'system'; ST.adminSub = 'epc'; }
  else if (tab === 'security') { ST.tab = 'system'; ST.adminSub = 'security'; }
  else if (tab === 'logs') { ST.tab = 'system'; ST.adminSub = 'logs'; }
  else { ST.tab = tab; }
  ST.subView = '';
  if (ST.tab === 'inventory') { loadInv(); loadStockBatches(); loadCoTask(); }
  if (ST.tab === 'transfers') loadTransfers();
  if (ST.tab === 'appointments') loadAppt();
  if (ST.tab === 'shops') { loadShops(); loadStores(true); loadBridgeList(); loadProfile(); }
  if (ST.tab === 'stores') { loadShops(); loadStores(true); loadBridgeList(); loadLocations(); }
  if (ST.tab === 'system') {
    // 公共数据（企业资料已搬 shops，但品类/经办人类别/EPC 仍在这里）
    loadProfile(); loadBizConfig(); loadClerkTypes(); loadProductTypes(); loadLocations();
    if (ST.adminSub === 'security') loadSecurity();
    if (ST.adminSub === 'logs') loadLogs();
    if (ST.adminSub === 'users' && isAdminRole()) { loadAdminUsers(); loadStores(true); }
  }
  // PC 侧边栏直接进入子列表页（维修/采购/委外/借货/客户）时也要拉数据
  if (SUB_VIEWS.indexOf(ST.tab) >= 0) { ST.subView = ST.tab; ST.subPage = 1; loadSubList(); }
}
function switchAdminSub(key) {
  ST.adminSub = key;
  go('system');  // 统一走 go() 的 system 分支触发数据加载
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
  scanPageWsConnect(); // 扫码任务推送常驻（手持机协同扫描进度回推）
  api('GET', '/api/products?page=1&size=200').then(function (r) { ST.products = r.items; ST.prodTotal = r.total; }).catch(function () {});
  api('GET', '/api/deposits?page=1&size=100').then(function (r) { ST.deposits = r.items; ST.depTotal = r.total; }).catch(function () {});
  loadSales();
  api('GET', '/api/products/options?status=在库').then(function (r) { ST.stockOptions = r.items; }).catch(function () {});
  api('GET', '/api/categories').then(function (r) { ST.cats = r || []; }).catch(function () {});
  api('GET', '/api/product-types').then(function (r) { ST.productTypes = r || []; }).catch(function () {});
  loadBizConfig();
  api('GET', '/api/languages').then(function (r) { ST.languages = r || []; }).catch(function () {});
  api('GET', '/api/stores').then(function (r) { ST.stores = r || []; loadShops(); return loadLocations(); }).catch(function () {});
  loadClerkTypes();
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

function loadBizConfig() {
  api('GET', '/api/biz-config').then(function (r) { ST.bizConfig = r; }).catch(function () {});
}

// ---- login ----
// 运行模式（NORMAL/SANDBOX/PRODUCTION_SUPPORT）由平台网关按「每个请求」注入，
// 随登录/会话恢复接口下发；进程版本号来自启动包 plugin.json。
// 沙箱试运行时同步在标签页标题上加前缀，避免把试运行环境误当成正式营业环境。
function syncDocTitle() {
  var base = ST.softName || '懿臻珠宝云';
  document.title = ST.mode === 'SANDBOX'
    ? '🧪 ' + t('mode.sandbox') + (ST.version ? ' v' + ST.version : '') + ' · ' + base
    : base;
}

function applySession(r) {
  ST.user = r.user;
  ST.mode = r.mode || 'NORMAL';
  ST.tenant = r.tenant || '';
  if (r.version) ST.version = r.version;
  if (typeof r.store_id !== 'undefined') ST.curStoreId = r.store_id || 0;
  // 注意：stores 为空数组时也要覆盖（账号被收权后必须清空旧列表，否则遮罩不显示）
  if (Array.isArray(r.stores)) ST.stores = r.stores;
  syncDocTitle();
}

function switchStore(sid) {
  sid = Number(sid);
  if (!sid || sid === ST.curStoreId) return;
  api('POST', '/api/auth/switch-store', { store_id: sid }).then(function (r) {
    ST.curStoreId = r.store_id;
    ST.stores = r.stores || ST.stores;
    // 切店后当前页所有弹窗/选择态失效，回到列表态并整页重载
    ST.sheet = null; ST.detail = null; ST.subView = '';
    toast(t('store.switched').replace('{name}', curStoreName()));
    refreshAll();
  }).catch(function (e) { toast(e.message || t('store.noAccess'), 'error'); });
}

function doLogin() {
  var u = ST.loginUser.trim();
  var p = ST.loginPwd;
  if (!u || !p) { toast(t('login.userPh'), 'error'); return; }
  api('POST', '/api/auth/login', { username: u, password: p }).then(function (r) {
    ST.token = r.token;
    applySession(r);
    syncToken();
    toast(t('login.success'));
    refreshAll();
  }).catch(function (e) { toast(e.message || t('login.err'), 'error'); });
}

function doLogout() {
  api('POST', '/api/auth/logout').catch(function () {});
  scanPageWsDisconnect();
  ST.token = ''; ST.user = null; ST.mode = 'NORMAL'; ST.tab = 'dashboard'; ST.subView = '';
  syncDocTitle();
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
  // 调拨选择 / 验货中：扫码走各自的分流
  if (ST.transferMode) { applyScanToTransfer(c, type); return; }
  if (ST.transferReceiving) { applyScanToReceive(c, type); return; }
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
    if (ST.sheetMode === 'sale') { addSaleItem(p); return; }
    ST.sheetData.product_id = p.id;
    ST.sheetData.product = p.name;
    if (ST.sheetMode === 'deposit') ST.sheetData.total = p.price;
    toast(t('scan.found') + '：' + p.code + ' ' + p.name);
  } else if (type === 'epc') {
    toast(t('scan.notFound') + ' EPC ' + c, 'error');
  } else {
    if (ST.sheetMode === 'sale') { toast(t('scan.notFound') + ' ' + c, 'error'); return; }
    ST.sheetData.product = c;   // 未知条码：作为自定义商品名填入，可继续手工编辑
    toast(t('scan.notFound'), 'error');
  }
}

// ---------------- 多件快速开单 ----------------
// 在库商品（stockOptions）按 EPC / 条码 / 货号 识别
function matchStockProduct(raw, type) {
  var c = String(raw || '').trim().toUpperCase();
  if (!c) return null;
  var p = null;
  if (type === 'epc') {
    p = ST.stockOptions.find(function (x) { return String(x.rfid_epc || '').toUpperCase() === c; });
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.rfid_epc || '').toUpperCase().endsWith(c); });
  } else {
    p = ST.stockOptions.find(function (x) { return String(x.code || '').toUpperCase() === c; });
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.code || '').toUpperCase() === c.replace(/^0+/, ''); });
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.barcode || '').toUpperCase() === c; });
    if (!p) p = ST.stockOptions.find(function (x) { return String(x.rfid_epc || '').toUpperCase() === c; });
  }
  return p || null;
}
// 当前销售单所属门店（首件决定）与所属店铺的件数上限
function saleStoreId() {
  var f = ST.sheetData.items && ST.sheetData.items[0];
  return f ? f.store_id : 0;
}
function saleItemLimit() {
  var sid = saleStoreId();
  if (!sid) return 0;   // 尚未选商品：不限（由店铺上限在首件后生效）
  var st = ST.stores.find(function (x) { return x.id === sid; });
  var shop = st && ST.shops.find(function (p) { return p.id === st.shop_id; });
  return shop ? (Number(shop.sale_item_limit) || 0) : 0;
}
function saleTotal() {
  return (ST.sheetData.items || []).reduce(function (s, it) { return s + (Number(it.price) || 0); }, 0);
}
// 加一件：去重 / 同店 / 件数上限校验
function addSaleItem(p) {
  if (!p) return;
  var items = ST.sheetData.items || (ST.sheetData.items = []);
  if (items.some(function (it) { return it.product_id === p.id; })) { toast(t('sale.dupItem'), 'error'); return; }
  var sid = saleStoreId();
  if (sid && p.store_id && p.store_id !== sid) { toast(t('sale.crossStore'), 'error'); return; }
  var limit = saleItemLimit();
  if (limit && items.length >= limit) { toast(t('sale.limitReached', { n: limit }), 'error'); return; }
  items.push({ product_id: p.id, name: p.name, code: p.code || '', epc: p.rfid_epc || '', price: Number(p.price) || 0, store_id: p.store_id || 0 });
  toast(t('sale.added') + '：' + p.code + ' ' + p.name);
}
function removeSaleItem(i) { ST.sheetData.items.splice(i, 1); }
// 手工下拉选择在库商品
function onPickSaleProduct() {
  var pid = ST.sheetData._pickId;
  if (!pid) return;
  var p = ST.stockOptions.find(function (x) { return x.id === pid; });
  ST.sheetData._pickId = null;
  if (p) addSaleItem(p);
}

// ---- 摄像头扫码加件（本地 zxing）----
function openSaleCam() {
  if (!window.ZXing) { toast(t('scan.libMissing'), 'error'); return; }
  ST.camOpen = true; ST.camErr = ''; ST.camBusy = true;
  ST._camLast = ''; ST._camLastAt = 0;
  Vue.nextTick(function () {
    var video = document.getElementById('saleCamVideo');
    if (!video) { ST.camErr = t('scan.camNoEl'); ST.camBusy = false; return; }
    try {
      var reader = new ZXing.BrowserMultiFormatReader();
      var pr = reader.decodeFromVideoDevice(undefined, video, function (result) {
        if (!result || !result.getText) return;
        var text = result.getText();
        var now = Date.now();
        if (text === ST._camLast && now - ST._camLastAt < 2500) return;  // 连续画面去抖
        ST._camLast = text; ST._camLastAt = now;
        var p = matchStockProduct(text, 'auto');
        if (p) addSaleItem(p); else toast(t('scan.notFound') + ' ' + text, 'error');
      });
      if (pr && pr.then) pr.then(function (controls) {
        ST._camControls = controls; ST.camBusy = false;
      }, function (err) {
        ST.camBusy = false; ST.camErr = t('scan.camFail') + '：' + ((err && err.message) || '');
      });
      ST._camReader = reader;
    } catch (e) {
      ST.camBusy = false; ST.camErr = t('scan.camFail') + '：' + (e && e.message ? e.message : '');
    }
  });
}
function closeSaleCam() {
  try { if (ST._camControls && ST._camControls.stop) ST._camControls.stop(); } catch (e) {}
  try { if (ST._camReader && ST._camReader.reset) ST._camReader.reset(); } catch (e) {}
  ST._camControls = null; ST._camReader = null;
  ST.camOpen = false; ST.camBusy = false; ST.camErr = '';
}

// ---- sheet ----
function openSheet(mode, title, data) {
  ST.sheetMode = mode; ST.sheetTitle = title; ST.sheetData = Vue.reactive(data || {});
  ST.rfidResult = null;
}
function closeSheet() { if (ST.camOpen) closeSaleCam(); ST.sheetMode = ''; ST.sheetData = {}; exitCoopScan(); }

function openInbound(store) {
  if (checkFrozen()) return;
  var s = store || ST.stores[0] || { id: 1 };
  ST.inboundStore = s;
  openSheet('inbound', t('shop.inboundAt', { n: s.name || '' }), { code: '', name: '', category: '', category_code: '', product_type: '', product_type_code: (ST.productTypes[0] && ST.productTypes[0].code) || '99', material: '', weight: 0, size: '', cert: '', cost: 0, price: 0, rfid_epc: '', store_id: s.id, location_id: 0, cert_location_id: 0, biz_date: new Date().toISOString().slice(0, 10) });
}

function addProduct() {
  if (checkFrozen()) return;
  ST.sheetNameLang = ST.lang;
  var d = { code: '', name: '', name_i18n: '{}',
            category: '', category_code: '',
            product_type_code: (ST.productTypes[0] && ST.productTypes[0].code) || '99', product_type: '',
            material: '', weight: 0, size: '', cert: '', cost: 0, price: 0,
            status: '在库', rfid_epc: '', showcase_public: 0, high_value: 0, origin: '',
            store_id: ST.curStoreId || 1, location_id: 0, cert_location_id: 0 };
  openSheet('product', t('sheet.product'), d);
}

function editProduct(p) {
  if (checkFrozen()) return;
  if (p && p.status === '在途') { toast(t('tr.locked'), 'error'); return; }
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

// ---------------- 库位主数据（门店下扁平库位） ----------------
function loadLocations() {
  return api('GET', '/api/locations').then(function (r) {
    ST.locations = r || [];
    if (!ST.locStore && ST.stores.length) ST.locStore = ST.stores[0].id;
    if (ST.locStore && (!ST.stores.length || !ST.stores.some(function (s) { return s.id === ST.locStore; }))) {
      ST.locStore = ST.stores.length ? ST.stores[0].id : 0;
    }
  }).catch(function () {});
}
function storeNameOf(sid) {
  var s = ST.stores.find(function (x) { return x.id === sid; });
  return s ? s.name : '#' + sid;
}
function locNameOf(id) {
  if (!id) return '';
  var l = ST.locations.find(function (x) { return x.id === id; });
  return l ? (l.code + ' ' + l.name) : '#' + id;
}
// 商品表单用：某门店的启用库位
function activeLocationsOf(sid) {
  return ST.locations.filter(function (l) { return l.store_id === sid && l.active; })
    .sort(function (a, b) { return (a.sort_order - b.sort_order) || a.id - b.id; });
}
function resetLocEdit() {
  ST.locEditMode = 'new';
  ST.locEdit = { id: 0, store_id: ST.locStore || (ST.stores[0] && ST.stores[0].id) || 0,
                 code: '', name: '', sort_order: 0, active: 1 };
}
function onLocStoreChange() {
  if (ST.locEditMode === 'new') ST.locEdit.store_id = ST.locStore;
}
// 门店管理：在当前选中门店下新增库位（重置编辑态并绑定门店）
function addLocForCur() {
  if (!ST.locStore) { toast(t('loc.needStore'), 'error'); return; }
  ST.locEditMode = 'new';
  ST.locEdit = { id: 0, store_id: ST.locStore, code: '', name: '', sort_order: 0, active: 1 };
}
// 门店管理：库位保存（新增时强制绑定当前门店）
function saveLocForCur() {
  if (ST.locEditMode === 'new') { ST.locEdit.id = 0; ST.locEdit.store_id = ST.locStore; }
  saveLoc();
}
function editLoc(o) {
  ST.locEditMode = 'edit';
  ST.locEdit = { id: o.id, store_id: o.store_id, code: o.code, name: o.name,
                 sort_order: o.sort_order || 0, active: o.active ? 1 : 0 };
  setTimeout(function () {
    var el = document.getElementById('loc-edit-form');
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, 60);
}
function saveLoc() {
  var e = ST.locEdit;
  if (!e.store_id) { toast(t('loc.needStore'), 'error'); return; }
  if (!e.code.trim() || !e.name.trim()) { toast(t('loc.needFields'), 'error'); return; }
  var body = { store_id: e.store_id, code: e.code.trim(), name: e.name.trim(),
               sort_order: Number(e.sort_order) || 0, active: e.active ? 1 : 0 };
  var req = ST.locEditMode === 'edit'
    ? api('PUT', '/api/locations/' + e.id, body)
    : api('POST', '/api/locations', body);
  req.then(function () {
    toast(t('toast.saveOk'));
    resetLocEdit();
    loadLocations();
  }).catch(function (err) { toast(err.message, 'error'); });
}
function delLoc(o) {
  if (!confirm(t('loc.delConfirm') + ' ' + o.code + ' ?')) return;
  api('DELETE', '/api/locations/' + o.id).then(function () {
    toast(t('toast.delOk'));
    loadLocations();
  }).catch(function (err) { toast(err.message, 'error'); });
}
function toggleLoc(o) {
  api('PUT', '/api/locations/' + o.id,
     { store_id: o.store_id, code: o.code, name: o.name,
       sort_order: o.sort_order || 0, active: o.active ? 0 : 1 })
    .then(function () { toast(t('toast.saveOk')); loadLocations(); })
    .catch(function (err) { toast(err.message, 'error'); });
}

// ---------------- 经办人类别（店员/主播/代理/代销…） ----------------
function loadClerkTypes() {
  return api('GET', '/api/clerk-types').then(function (r) {
    ST.clerkTypes = r || [];
  }).catch(function () {});
}

// ---- 用户与门店授权（仅店长）----
function isAdminRole() { return !!(ST.user && ST.user.role === 'TENANT_ADMIN'); }
function loadAdminUsers() {
  api('GET', '/api/admin/users').then(function (r) { ST.adminUsers = r.items || []; })
    .catch(function (e) { toast(e.message, 'error'); });
}
// 勾选/取消某店员的门店授权（立即全量保存）
function toggleUserStore(u, sid) {
  var ids = (u.store_ids || []).slice();
  var i = ids.indexOf(sid);
  if (i >= 0) ids.splice(i, 1); else ids.push(sid);
  api('PUT', '/api/admin/users/' + u.id + '/stores', { store_ids: ids }).then(function (r) {
    u.store_ids = r.store_ids;
    toast(t('toast.saveOk'));
  }).catch(function (e) { toast(e.message, 'error'); });
}
function openUserCreate() {
  ST.adminUserOpen = true;
  ST.adminUserForm = { id: 0, username: '', display_name: '', password: '', role: 'EMPLOYEE' };
}
function openUserEdit(u) {
  ST.adminUserOpen = true;
  ST.adminUserForm = { id: u.id, username: u.username, display_name: u.display_name, password: '', role: u.role };
}
function closeUserForm() { ST.adminUserOpen = false; }
function saveAdminUser() {
  var f = ST.adminUserForm;
  var req;
  if (!f.id) {
    if (!f.username.trim() || !f.password) { toast(t('adminUser.fieldsReq'), 'error'); return; }
    req = api('POST', '/api/admin/users', {
      username: f.username.trim(), display_name: f.display_name.trim(),
      password: f.password, role: f.role,
    });
  } else {
    req = api('PUT', '/api/admin/users/' + f.id, {
      username: f.username, display_name: f.display_name.trim(),
      password: f.password, role: f.role,
    });
  }
  req.then(function () {
    toast(t('toast.saveOk')); ST.adminUserOpen = false; loadAdminUsers();
  }).catch(function (e) { toast(e.message, 'error'); });
}
function delAdminUser(u) {
  if (!confirm(t('adminUser.delConfirm').replace('{name}', u.display_name || u.username))) return;
  api('DELETE', '/api/admin/users/' + u.id).then(function () {
    toast(t('toast.saveOk')); loadAdminUsers();
  }).catch(function (e) { toast(e.message, 'error'); });
}
function resetClerkEdit() {
  ST.clerkEditMode = 'new';
  ST.clerkEdit = { id: 0, name: '', sort_order: (ST.clerkTypes.length ? ST.clerkTypes.length + 1 : 1) };
}
function editClerk(o) {
  ST.clerkEditMode = 'edit';
  ST.clerkEdit = { id: o.id, name: o.name, sort_order: o.sort_order || 0 };
  setTimeout(function () {
    var el = document.getElementById('clerk-edit-form');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}
function saveClerk() {
  var e = ST.clerkEdit;
  if (!e.name.trim()) { toast(t('clerk.needName'), 'error'); return; }
  var body = { name: e.name.trim(), sort_order: Number(e.sort_order) || 0 };
  var req = ST.clerkEditMode === 'edit'
    ? api('PUT', '/api/clerk-types/' + e.id, body)
    : api('POST', '/api/clerk-types', body);
  req.then(function () {
    toast(t('toast.saveOk'));
    resetClerkEdit();
    loadClerkTypes();
  }).catch(function (err) { toast(err.message, 'error'); });
}
function toggleClerk(o) {
  api('PUT', '/api/clerk-types/' + o.id,
     { name: o.name, sort_order: o.sort_order || 0, active: o.active ? 0 : 1 })
    .then(function () { toast(t('toast.saveOk')); loadClerkTypes(); })
    .catch(function (err) { toast(err.message, 'error'); });
}
function activeClerkTypes() {
  return (ST.clerkTypes || []).filter(function (o) { return o.active; });
}
function defaultClerkTypeName() {
  var d = (ST.clerkTypes || []).find(function (o) { return o.is_default && o.active; })
    || (ST.clerkTypes || []).find(function (o) { return o.active; });
  return d ? d.name : '店员';
}
// 销售单加载（支持按经办人类别筛选）
function loadSales() {
  var q = ST.saleClerkType ? ('&clerk_type=' + encodeURIComponent(ST.saleClerkType)) : '';
  return api('GET', '/api/sales?page=1&size=100' + q).then(function (r) {
    ST.sales = r.items; ST.saleTotal = r.total;
  }).catch(function () {});
}
function clerkText(s) {
  // 列表「类别 人名」：人名空时只显示类别
  if (!s) return '';
  return (s.clerk_type || '') + (s.clerk_name ? ' · ' + s.clerk_name : '');
}
// 销售小票：浏览器打印 58mm HTML 收据（热敏机装系统驱动即可出纸；含业务日期与经办人快照）
function printReceipt(s) {
  var shop = (ST.profile && (ST.profile.name || ST.profile.shop_name)) || '';
  var esc = function (x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var due = Number(s.amount) - Number(s.paid);
  var rows = [
    ['<td>' + esc(s.product) + '</td><td style="text-align:right">￥' + fmt(s.amount) + '</td>'],
  ];
  var html =
'<!doctype html><html><head><meta charset="utf-8"><title>' + esc(s.bill_no) + '</title>' +
'<style>@page{size:58mm auto;margin:0}body{font-family:"Microsoft YaHei",sans-serif;width:58mm;margin:0;padding:6px 4px;color:#000;font-size:12px;line-height:1.55}' +
'.c{text-align:center}.b{font-weight:700}.t1{font-size:15px}.sep{border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}' +
'.r{text-align:right}.g{margin-top:4px}</style></head><body>' +
'<div class="c b t1">' + esc(shop) + '</div>' +
'<div class="c">' + t('sale.receiptTitle') + '</div>' +
'<div class="sep"></div>' +
'<table>' +
'<tr><td>' + t('sale.receiptNo') + '</td><td class="r">' + esc(s.bill_no) + '</td></tr>' +
'<tr><td>' + t('lbl.date') + '</td><td class="r">' + esc(s.biz_date) + '</td></tr>' +
'<tr><td>' + t('sale.clerk') + '</td><td class="r">' + esc(clerkText(s)) + '</td></tr>' +
(s.customer ? '<tr><td>' + t('lbl.customer') + '</td><td class="r">' + esc(s.customer) + '</td></tr>' : '') +
(s.phone ? '<tr><td>' + t('lbl.mobile') + '</td><td class="r">' + esc(s.phone) + '</td></tr>' : '') +
'</table>' +
'<div class="sep"></div>' +
'<table>' + rows.map(function (r) { return '<tr>' + r[0] + r[1] + '</tr>'; }).join('') + '</table>' +
'<div class="sep"></div>' +
'<table>' +
'<tr><td>' + t('lbl.amount') + '</td><td class="r b">￥' + fmt(s.amount) + '</td></tr>' +
'<tr><td>' + t('lbl.paid') + '</td><td class="r">￥' + fmt(s.paid) + '</td></tr>' +
(due > 0 ? '<tr><td>' + t('sale.dueShort') + '</td><td class="r">￥' + fmt(due) + '</td></tr>' : '') +
'<tr><td>' + t('sale.pay') + '</td><td class="r">' + esc(methodText(s.method)) + '</td></tr>' +
'</table>' +
'<div class="sep"></div>' +
'<div class="c g">' + t('sale.receiptThanks') + '</div>' +
'</body></html>';
  var w = window.open('', '_blank', 'width=360,height=600');
  if (!w) { toast(t('sale.receiptBlocked'), 'error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(function () { try { w.print(); } catch (e) {} }, 250);
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

// ---------------- 门店调拨 ----------------
function reloadProducts() {
  return api('GET', '/api/products?page=1&size=200')
    .then(function (r) { ST.products = r.items; ST.prodTotal = r.total; })
    .catch(function () {});
}

// 商品页：调拨多选模式
function transferSelList() {
  return Object.keys(ST.transferSel).map(function (k) { return ST.transferSel[k]; });
}
function transferSelCount() { return Object.keys(ST.transferSel).length; }
function canTransferPick(p) { return p.status === '在库'; }
function toggleTransferMode() {
  ST.transferMode = !ST.transferMode;
  clearTransferSel();
  if (!ST.transferMode) exitCoopScan(); else resetScanCoop();
}
function clearTransferSel() {
  ST.transferSel = {};
  ST.transferSelStore = 0;
}
function toggleTransferPick(p) {
  if (ST.transferSel[p.id]) {
    delete ST.transferSel[p.id];
    if (!transferSelCount()) ST.transferSelStore = 0;
    return;
  }
  if (!canTransferPick(p)) { toast(t('tr.onlyStock'), 'error'); return; }
  if (ST.transferSelStore && p.store_id !== ST.transferSelStore) { toast(t('tr.diffStore'), 'error'); return; }
  ST.transferSel[p.id] = p;
  ST.transferSelStore = p.store_id;
}
// 调拨选择模式扫码：EPC/条码 → 自动勾选（仍受同店、在库约束）
function applyScanToTransfer(c, type) {
  var p = ST.products.find(function (x) {
    if (type === 'epc') {
      var e = String(x.rfid_epc || '').toUpperCase();
      return e === c || (e && e.endsWith(c));
    }
    var cd = String(x.code || '').toUpperCase();
    return cd === c || cd === c.replace(/^0+/, '');
  });
  if (!p) { toast(t('scan.notFound') + ' ' + c, 'error'); return; }
  if (ST.transferSel[p.id]) { toast(t('tr.alreadyPicked')); return; }
  if (!canTransferPick(p)) { toast(t('tr.onlyStock'), 'error'); return; }
  if (ST.transferSelStore && p.store_id !== ST.transferSelStore) { toast(t('tr.diffStore'), 'error'); return; }
  ST.transferSel[p.id] = p;
  ST.transferSelStore = p.store_id;
  toast('✓ ' + p.code + ' ' + p.name);
}
function transferStoreOptions() {
  return ST.stores.filter(function (s) { return s.id !== ST.transferSelStore; });
}
function openTransferSend() {
  if (!transferSelCount()) return;
  var others = transferStoreOptions();
  ST.transferToStore = others.length ? others[0].id : 0;
  ST.transferRemark = '';
  ST.transferSendOpen = true;
}
function closeTransferSend() { ST.transferSendOpen = false; exitCoopScan(); }
function submitTransfer() {
  if (!ST.transferToStore || ST.transferToStore === ST.transferSelStore) { toast(t('tr.needToStore'), 'error'); return; }
  var sel = transferSelList();
  var ids = sel.map(function (p) { return p.id; });
  var scanCodes = sel.map(function (p) { return (p.rfid_epc || p.code || '').toUpperCase(); }).filter(function (s) { return s; });
  ST.transferBusy = true;
  api('POST', '/api/transfers', { to_store_id: ST.transferToStore, product_ids: ids, scan_codes: scanCodes, remark: ST.transferRemark || '' })
    .then(function (r) {
      ST.transferBusy = false;
      toast(t('tr.sendOk') + r.transfer_no);
      ST.transferSendOpen = false;
      clearTransferSel();
      ST.transferMode = false;
      exitCoopScan();
      reloadProducts();
      ST.transferTab = 'out';
      go('transfers');
    })
    .catch(function (e) {
      ST.transferBusy = false;
      toast(e.message, 'error');
    });
}

// 调拨单列表 / 详情
function loadTransfers() {
  return Promise.all([
    api('GET', '/api/transfers?scope=out&size=100'),
    api('GET', '/api/transfers?scope=in&size=100')
  ]).then(function (rs) {
    ST.transfersOut = rs[0].items || [];
    ST.transfersIn = rs[1].items || [];
  }).catch(function (e) { toast(e.message, 'error'); });
}
function transferList() { return ST.transferTab === 'out' ? ST.transfersOut : ST.transfersIn; }
function openTransfer(x) {
  api('GET', '/api/transfers/' + x.id).then(function (d) {
    ST.transferDetail = d;
    ST.transferDetailOpen = true;
    ST.transferReceiving = false;
    ST.transferRecv = {};
  }).catch(function (e) { toast(e.message, 'error'); });
}
function closeTransferDetail() {
  ST.transferDetailOpen = false;
  ST.transferDetail = null;
  ST.transferReceiving = false;
  ST.transferRecv = {};
  ST.transferScanHit = 0;
  exitCoopScan();
}

// 到店验货
function startReceive() {
  var recv = {};
  (ST.transferDetail.items || []).forEach(function (i) {
    recv[i.product_id] = { ok: null, reason: '' };
  });
  ST.transferRecv = recv;
  ST.transferReceiving = true;
}
function cancelReceive() {
  ST.transferReceiving = false;
  ST.transferRecv = {};
  ST.transferScanHit = 0;
  exitCoopScan();
}
function setRecvOk(pid, ok) {
  var cell = ST.transferRecv[pid];
  if (!cell) return;
  cell.ok = ok;
  if (ok) cell.reason = '';
}
function quickReason(pid, txt) {
  var cell = ST.transferRecv[pid];
  if (!cell) return;
  cell.ok = false;
  cell.reason = txt;
}
function applyScanToReceive(c, type) {
  var items = (ST.transferDetail && ST.transferDetail.items) || [];
  var hit = items.find(function (i) {
    if (type === 'epc') {
      var e = String(i.epc || '').toUpperCase();
      return e === c || (e && e.endsWith(c));
    }
    return String(i.product_code || '').toUpperCase() === c;
  });
  if (!hit) { toast(t('scan.notFound') + ' ' + c, 'error'); return; }
  var cell = ST.transferRecv[hit.product_id];
  if (!cell) return;
  cell.ok = true;
  cell.reason = '';
  ST.transferScanHit = hit.product_id;
  setTimeout(function () { if (ST.transferScanHit === hit.product_id) ST.transferScanHit = 0; }, 1200);
  toast('✓ ' + (hit.product_code || hit.epc || ''));
}
function submitReceive() {
  var d = ST.transferDetail;
  if (!d) return;
  var items = d.items || [];
  var payload = [];
  for (var k = 0; k < items.length; k++) {
    var i = items[k];
    var cell = ST.transferRecv[i.product_id];
    if (!cell || cell.ok === null) { toast(t('tr.needAll'), 'error'); return; }
    if (!cell.ok && !String(cell.reason || '').trim()) {
      toast(t('tr.needReason') + (i.product_code || i.product_name), 'error');
      return;
    }
    payload.push({ product_id: i.product_id, ok: !!cell.ok, reason: cell.ok ? '' : String(cell.reason).trim() });
  }
  ST.transferBusy = true;
  api('POST', '/api/transfers/' + d.id + '/receive', { items: payload })
    .then(function (r) {
      ST.transferBusy = false;
      toast(t('tr.receiveDone') + ' ' + r.matched + '/' + (r.matched + r.diff));
      closeTransferDetail();
      loadTransfers();
      reloadProducts();
      loadInv();
    })
    .catch(function (e) {
      ST.transferBusy = false;
      toast(e.message, 'error');
    });
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
  openSheet('sale', t('sheet.sale'), { customer: '', phone: '', items: [], paid: 0, method: '现金', biz_date: new Date().toISOString().slice(0, 10), clerk_type: defaultClerkTypeName(), clerk_name: '', _scanning: false, _pickId: null });
}

function openDeposit() {
  if (checkFrozen()) return;
  openSheet('deposit', t('sheet.deposit'), { customer: '', phone: '', product: '', product_id: null, total: 0, deposit: 0, balance: 0, promised_date: '', reminder_days: 7 });
}

function openLoan() {
  if (checkFrozen()) return;
  openSheet('loan', t('sheet.loan'), { direction: 'out', codes: [], party: '', loan_date: new Date().toISOString().slice(0, 10), due_date: '', _rawInput: '' });
}

// ---- 借货 sheet：扫码加件 ----
function loanCodes() { return (ST.sheetData.codes || []).filter(function (c) { return c && c.pid; }); }
function addLoanRawCode(raw) {
  var c = String(raw || '').trim();
  if (!c) return;
  // 先在本地 products 缓存里匹配（EPC/条码/货号）
  var p = matchStockProduct(c, 'auto');
  if (!p) { toast(t('scan.notFound') + ' ' + c, 'error'); return; }
  var codes = ST.sheetData.codes || (ST.sheetData.codes = []);
  if (codes.some(function (x) { return x.pid === p.id; })) { toast(t('tr.alreadyPicked')); return; }
  codes.push({ pid: p.id, code: p.code || '', epc: p.rfid_epc || '', name: p.name });
  ST.sheetData._rawInput = '';
  toast('✓ ' + p.code + ' ' + p.name);
}
function removeLoanCode(i) { ST.sheetData.codes.splice(i, 1); }
function openLoanCam() {
  if (!window.ZXing) { toast(t('scan.libMissing'), 'error'); return; }
  ST.camOpen = true; ST.camErr = ''; ST.camBusy = true;
  ST._camLast = ''; ST._camLastAt = 0;
  Vue.nextTick(function () {
    var video = document.getElementById('loanCamVideo');
    if (!video) { ST.camErr = t('scan.camNoEl'); ST.camBusy = false; return; }
    try {
      var reader = new ZXing.BrowserMultiFormatReader();
      var pr = reader.decodeFromVideoDevice(undefined, video, function (result) {
        if (!result || !result.getText) return;
        var text = result.getText();
        var now = Date.now();
        if (text === ST._camLast && now - ST._camLastAt < 2500) return;
        ST._camLast = text; ST._camLastAt = now;
        addLoanRawCode(text);
      });
      if (pr && pr.then) pr.then(function (controls) {
        ST._camControls = controls; ST.camBusy = false;
      }, function (err) {
        ST.camBusy = false; ST.camErr = t('scan.camFail') + '：' + ((err && err.message) || '');
      });
      ST._camReader = reader;
    } catch (e) {
      ST.camBusy = false; ST.camErr = t('scan.camFail') + '：' + (e && e.message ? e.message : '');
    }
  });
}
function closeLoanCam() {
  try { if (ST._camControls && ST._camControls.stop) ST._camControls.stop(); } catch (e) {}
  try { if (ST._camReader && ST._camReader.reset) ST._camReader.reset(); } catch (e) {}
  ST._camControls = null; ST._camReader = null;
  ST.camOpen = false; ST.camBusy = false; ST.camErr = '';
}

// ---- 业务端扫码任务 WS（/ws/scan-page）----
// 登录成功后由 refreshAll 建立；断线指数退避重连（1s→30s 封顶）；
// 服务端 4401/4403 关闭表示会话/权限失效，不再重连。
function scanPageWsConnect() {
  if (!ST.token) return;
  if (ST._pageWs && ST._pageWs.readyState <= 1) return;
  clearTimeout(ST._pageWsTimer); ST._pageWsTimer = null;
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  var ws = new WebSocket(proto + '://' + location.host + API + '/ws/scan-page?token=' + encodeURIComponent(ST.token));
  ST._pageWs = ws;
  ws.onopen = function () { ws._retries = 0; };
  ws.onmessage = function (e) {
    try { scanPageWsDispatch(JSON.parse(e.data)); } catch (err) {}
  };
  ws.onclose = function (ev) {
    if (ST._pageWs !== ws) return;
    ST._pageWs = null;
    if (!ST.token || (ev && (ev.code === 4401 || ev.code === 4403))) return;
    var n = (ws._retries || 0) + 1;
    var delay = Math.min(30000, 1000 * Math.pow(2, n - 1));
    ST._pageWsTimer = setTimeout(function () {
      ST._pageWsTimer = null;
      if (ST.token) { ws._retries = n; scanPageWsConnect(); }
    }, delay);
  };
  ws.onerror = function () { try { ws.close(); } catch (e) {} };
}
function scanPageWsDisconnect() {
  clearTimeout(ST._pageWsTimer); ST._pageWsTimer = null;
  if (ST._pageWs) { try { ST._pageWs.close(); } catch (e) {} ST._pageWs = null; }
  resetScanCoop();
}

// ---- 表单输入模式：协同（手持机推送）/ 自主（摄像头扫码）----
// 各扫码表单共享 ST.scanCoop；进入协同模式即创建对应类型扫码任务，
// 服务端同店广播 task_offer 给在线手持机，进度经 scan_progress 实时回推。
var COOP_TYPES = { sale: 1, transfer_out: 1, transfer_in: 1, loan: 1, generic: 1 };
function resetScanCoop() {
  ST.scanCoop = { type: '', taskId: 0, taskNo: '', count: 0, recent: [], offer: false, applied: {} };
}
function setScanMode(mode) {
  if (mode === 'coop') {
    startCoopScan();
  } else {
    exitCoopScan();
  }
}
// 退出协同模式：撤销服务端任务（手持机收到 task_closed 自动停扫），已加入单据的商品保留
function exitCoopScan() {
  var tid = ST.scanCoop && ST.scanCoop.taskId;
  ST.scanCoop.type = ''; ST.scanCoop.taskId = 0; ST.scanCoop.taskNo = '';
  ST.scanCoop.count = 0; ST.scanCoop.recent = []; ST.scanCoop.offer = false; ST.scanCoop.applied = {};
  if (tid) { api('POST', '/api/tasks/' + tid + '/cancel', {}).catch(function () {}); }
}
// 协同任务类型 ← 当前表单（开单/借货 sheet、调拨选货、调拨收货）
function currentCoopType() {
  if (ST.transferMode) return 'transfer_out';
  if (ST.transferReceiving) return 'transfer_in';
  if (ST.sheetMode === 'sale') return 'sale';
  if (ST.sheetMode === 'loan') return 'loan';
  return '';
}
function startCoopScan() {
  var tp = currentCoopType();
  if (!tp) return;
  api('POST', '/api/tasks/start', { type: tp, title: currentTitle() || sheetTitleText() }).then(function (r) {
    ST.scanCoop.type = tp;
    ST.scanCoop.taskId = r.id || 0;
    ST.scanCoop.taskNo = r.task_no || '';
    ST.scanCoop.count = (r.stats && r.stats.total) || 0;
    ST.scanCoop.recent = []; ST.scanCoop.offer = false; ST.scanCoop.applied = {};
  }).catch(function (e) { toast(e.message, 'error'); });
}
function sheetTitleText() { return ST.sheetTitle || ''; }
function scanPageWsDispatch(d) {
  if (!d || !d.type) return;
  if (d.type === 'task_offer') {
    var tk = d.task || {};
    var tid = tk.task_id || tk.id || 0;
    if (tid === ST.scanCoop.taskId) return;  // 本页面自己创建的任务，无需提示
    if (COOP_TYPES[tk.type] && !ST.scanCoop.type) {
      // 其他端发起的本店任务：仅提示，不抢当前表单
      toast(t('scan.taskOffer') + (tk.task_no ? ' ' + tk.task_no : ''));
    }
    ST.scanCoop.offer = true;
  } else if (d.type === 'scan_progress') {
    if (!ST.scanCoop.type || d.task_id !== ST.scanCoop.taskId) return;
    var stats = d.stats || (d.result && d.result.stats) || {};
    if (typeof stats.total === 'number') ST.scanCoop.count = stats.total;
    var acc = d.accepted || (d.result && d.result.accepted) || [];
    var dev = d.device || d.device_code || '';
    (acc || []).forEach(function (epcRaw) {
      var epc = String(epcRaw || '').toUpperCase();
      if (!epc || ST.scanCoop.applied[epc]) return;  // 跨帧/重连去重
      ST.scanCoop.applied[epc] = 1;
      ST.scanCoop.recent.unshift({ epc: epc, device: dev });
      applyCoopEpc(epc);
    });
    if (ST.scanCoop.recent.length > 20) ST.scanCoop.recent.length = 20;
  } else if (d.type === 'task_closed') {
    if (d.task_id && d.task_id === ST.scanCoop.taskId) {
      toast(t('scan.taskClosed'));
      ST.scanCoop.taskId = 0; ST.scanCoop.taskNo = '';
      ST.scanCoop.count = 0; ST.scanCoop.recent = []; ST.scanCoop.offer = false; ST.scanCoop.applied = {};
      ST.scanCoop.type = '';  // 手持机首发提交终结：回到自主模式，已入单商品保留
    }
  }
}

// 协同模式收到手持机 EPC：复用各业务表单既有的扫码入单/校验逻辑
function applyCoopEpc(epc) {
  var tp = ST.scanCoop.type;
  if (tp === 'sale') {
    var p = matchStockProduct(epc, 'epc');
    if (p) addSaleItem(p); else toast(t('scan.notFound') + ' EPC ' + epc, 'error');
  } else if (tp === 'loan') {
    addLoanRawCode(epc);
  } else if (tp === 'transfer_out') {
    applyScanToTransfer(epc, 'epc');
  } else if (tp === 'transfer_in') {
    applyScanToReceive(epc, 'epc');
  }
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
    showcase_desc: d.showcase_desc || '', origin: d.origin || '', high_value: d.high_value || 0,
    location_id: d.location_id || 0, cert_location_id: d.cert_location_id || 0 };
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
    var saleItems = (d.items || []).map(function (it) { return { product_id: it.product_id, epc: it.epc || '', code: it.code || '', price: Number(it.price) || 0 }; });
    if (!saleItems.length) { toast(t('sale.needItem'), 'error'); return; }
    api('POST', '/api/sales', { customer: d.customer || '', phone: d.phone || '', paid: Number(d.paid) || 0, method: d.method || '现金', biz_date: d.biz_date || '', clerk_type: d.clerk_type || '', clerk_name: d.clerk_name || '', items: saleItems }).then(function (r) {
      toast(t('toast.saveOk') + ' ' + r.bill_no + ' · ' + (r.count || saleItems.length) + t('sale.itemsUnit') + ' ￥' + r.amount); closeSheet(); refreshAll();
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
      rfid_epc: d.rfid_epc || '', biz_date: d.biz_date || '',
      store_id: d.store_id || 0,
      location_id: d.location_id || 0, cert_location_id: d.cert_location_id || 0 }).then(function (r) {
      toast(t('toast.saveOk') + ' ' + r.code + ' EPC:' + r.rfid_epc); ST.inboundStore = null; closeSheet(); refreshAll(); loadInv();
    }).catch(function (e) { toast(e.message, 'error'); });
  } else if (ST.sheetMode === 'loan') {
    var loanCodesArr = (d.codes || []).map(function (x) { return x.code || x.epc || ''; }).filter(function (c) { return c; });
    if (!loanCodesArr.length) { toast(t('loan.needScan'), 'error'); return; }
    api('POST', '/api/loans', { direction: d.direction || 'out', codes: loanCodesArr, party: d.party || '', loan_date: d.loan_date || '', due_date: d.due_date || '' }).then(function (r) {
      toast(t('toast.saveOk') + (r && r.count ? ' · ' + r.count + t('sale.itemsUnit') : '')); closeSheet(); loadSubList(); refreshAll();
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
                driver_code: (ST.secDrivers[0] || {}).code || 'uhf_rfid_gate', enabled: true,
                heartbeat_timeout: 15, field_map: '' };
}

function secEdit(s) {
  ST.secNewKey = null;
  ST.secNew = { id: s.id, name: s.name, store_id: s.store_id, location: s.location || '',
                driver_code: s.driver_code, enabled: !!s.enabled,
                heartbeat_timeout: s.heartbeat_timeout || 15, field_map: s.field_map || '' };
}

function secCreate() {
  var editing = !!ST.secNew.id;
  var req = editing
    ? api('PUT', '/api/sensors/' + ST.secNew.id, ST.secNew)
    : api('POST', '/api/sensors', ST.secNew);
  req.then(function (r) {
    if (!editing) ST.secNewKey = r;   // {id, auth_key, http_url, ws_url} 密钥仅此一次展示
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

// ---- 安防接入指南（给设备厂商/实施人员看的报文格式） ----
function guideHttpUrl(code) { return location.origin + API + '/api/sensors/ingest'; }
function guideWsUrl() {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + location.host + API + '/ws/sensor?key=<auth_key>';
}
function guideExample(code) {
  if (code === 'uhf_rfid_gate') return '{"epcs":["E280699500005014F3A10001"]}';
  if (code === 'eas_gate') return '{"alarm":true}';
  if (code === 'contact_sensor') return '{"state":"alarm"}';
  return '{"kind":"epc","epcs":["E280699500005014F3A10001"]}';
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

// ---- 统一工作任务（盘点）+ 扫描设备管理 ----
function startCoTask() {
  if (!confirm(t('co.cfStart'))) return;
  ST.coBusy = true;
  api('POST', '/api/tasks/start', { type: 'stocktake', host: ST.coTaskHost || '' }).then(function (r) {
    ST.coTask = r;
    buildCoQr(r.co_url);
    toast(t('toast.coStarted'));
    ensureCoTimer();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
function loadCoTask() {
  api('GET', '/api/tasks?scope=active').then(function (list) {
    if (list && list.length) {
      return api('GET', '/api/tasks/' + list[0].id).then(function (r) {
        ST.coTask = r;
        buildCoQr(r.co_url);
        ensureCoTimer();
        if (!ST._coTaskSeen && ST.tab === 'inventory') { ST.invSub = 'count'; }
        ST._coTaskSeen = true;
      });
    }
    clearCoTask();
  }).catch(function () {});
}
function clearCoTask() {
  ST.coTask = null; ST._coTaskSeen = false; clearCoTimer();
}
// 二维码不再走后端 SVG 接口，直接用本地 qrcode 库由 join url 生成
function buildCoQr(url) {
  if (!url) return;
  ST.coQrUrl = qrSvgDataUrl(url, 6);
}
// 发起端撤销任务：作废不生成报告
function cancelCoTask() {
  if (!ST.coTask) return;
  if (!confirm(t('co.cfCancel'))) return;
  ST.coBusy = true;
  api('POST', '/api/tasks/' + ST.coTask.id + '/cancel', {}).then(function () {
    toast(t('toast.coCancelled')); clearCoTask();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
// 发起端终止任务：有扫描数据时生成部分盘点报告
function terminateCoTask() {
  if (!ST.coTask) return;
  if (!confirm(t('co.cfTerminate'))) return;
  ST.coBusy = true;
  api('POST', '/api/tasks/' + ST.coTask.id + '/terminate', {}).then(function (r) {
    toast(r.result ? t('toast.coTerminatedRpt') : t('toast.coTerminated'));
    clearCoTask(); loadStockBatches();
  }).catch(function (e) { toast(e.message, 'error'); })
   .finally(function () { ST.coBusy = false; });
}
// 查看已完成/已终止任务的复盘差异报告
function openCoReport() {
  if (!ST.coTask || !ST.coTask.result) return;
  ST.reportTaskId = ST.coTask.id;
  api('GET', '/api/tasks/' + ST.coTask.id + '/report').then(function (r) {
    ST.taskReport = r;
  }).catch(function (e) { toast(e.message, 'error'); });
}
function closeTaskReport() { ST.taskReport = null; ST.reportTaskId = 0; }
// 复制到剪贴板：LAN http 非安全上下文下 navigator.clipboard 为 undefined，用 execCommand 兜底
function copyText(txt) {
  function ok() { toast(t('toast.coUrlCopied')); }
  function fail() { toast('复制失败，请手动选择地址复制', 'error'); }
  function legacy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var done = document.execCommand('copy');
      document.body.removeChild(ta);
      (done ? ok : fail)();
    } catch (e) { fail(); }
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(ok).catch(legacy);
  } else {
    legacy();
  }
}
function copyCoUrl() {
  if (ST.coTask && ST.coTask.co_url) copyText(ST.coTask.co_url);
}
function copyH5Url() {
  if (ST.coTask && ST.coTask.h5_url) copyText(ST.coTask.h5_url);
}
function ensureCoTimer() {
  if (ST.coTimer) return;
  ST.coTimer = setInterval(function () { if (ST.coTask && ST.coTask.status === '进行中') loadCoTask(); else clearCoTimer(); }, 5000);
}
function clearCoTimer() {
  if (ST.coTimer) { clearInterval(ST.coTimer); ST.coTimer = null; }
}

// ---- 扫描设备（扫描助手）管理 ----
function openDevices(storeId) {
  ST.devStoreScope = storeId || 0;
  ST.devModal = true;
  if (ST.devStoreScope) ST.actStoreId = ST.devStoreScope;
  loadDevices();
  loadActivations();
}
function closeDevices() { ST.devModal = false; ST.devStoreScope = 0; }
function loadDevices() {
  var q = ST.devStoreScope ? ('?store_id=' + ST.devStoreScope) : '';
  api('GET', '/api/devices' + q).then(function (r) { ST.devices = r || []; }).catch(function () {});
}
function genActivation() {
  var sid = ST.actStoreId || (ST.stores[0] && ST.stores[0].id) || 1;
  ST.actStoreId = sid;
  api('POST', '/api/devices/activation', { store_id: sid, name: (ST.actName || '').trim() }).then(function (r) {
    ST.actQrUrl = qrSvgDataUrl(r.url, 6);
    ST.actUrl = r.url;
    ST.actName = '';
    loadActivations();
    toast(t('dev.actCreated'));
  }).catch(function (e) { toast(e.message, 'error'); });
}
function loadActivations() {
  api('GET', '/api/devices/activations').then(function (r) { ST.activations = r || []; }).catch(function () {});
}
function copyActUrl() {
  if (ST.actUrl) copyText(ST.actUrl);
}
function unbindDevice(id) {
  if (!confirm(t('dev.cfUnbind'))) return;
  api('POST', '/api/devices/' + id + '/unbind', {}).then(function () { toast(t('dev.unbound')); loadDevices(); })
    .catch(function (e) { toast(e.message, 'error'); });
}
function toggleDeviceStatus(d) {
  var path = d.status === 'active' ? 'disable' : 'enable';
  api('POST', '/api/devices/' + d.id + '/' + path, {}).then(function () { loadDevices(); })
    .catch(function (e) { toast(e.message, 'error'); });
}
// 设备在线状态由后端 online 字段给出；前端仅格式化
function devOnlineText(d) { return d.online ? t('dev.online') : t('dev.offline'); }

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
  { id: 'sec_pending', run: function () {
      if (!ST.secSensors.length) return 'na';
      return (ST.health.pending_events || 0) > 0 ? 'bad' : 'ok';
  }},
  { id: 'task_stall', run: function () {
      if (ST.health.task_stall == null) return 'na';
      return ST.health.task_stall ? 'bad' : 'ok';
  }},
  { id: 'print_queue', run: function () {
      var on = ST.bridges.filter(function (b) { return b.online; });
      if (!on.length) return 'na';
      return on.some(function (b) { return b.last_job && b.last_job.ok === false; }) ? 'bad' : 'ok';
  }},
  { id: 'missing_epc', run: function () {
      var h = ST.health;
      if (!h.in_stock) return 'na';
      return (h.missing_epc / h.in_stock) > 0.2 ? 'bad' : 'ok';
  }},
  { id: 'stocktake_overdue', run: function () {
      var h = ST.health;
      if (!h.in_stock || h.last_stocktake_days == null) return 'na';
      return h.last_stocktake_days > 30 ? 'bad' : 'ok';
  }},
  { id: 'credit_due', run: function () {
      if (ST.health.credit_due == null) return 'na';
      return ST.health.credit_due > 50000 ? 'bad' : 'ok';
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
  api('GET', '/api/health/summary').then(function (r) { ST.health = r || {}; }).catch(function () {});
}
function startHealthTimer() {
  if (ST.healthTimer) return;
  ST.healthTimer = setInterval(function () { if (!document.hidden) loadHealth(); }, 30000);
}
function createStore() {
  ST.storeEditMode = 'new';
  ST.storeEdit = { id: 0, name: '', code: '', owner: '', shop_id: (ST.shops[0] && ST.shops[0].id) || 0 };
}
function editStore(s) {
  ST.storeEditMode = 'edit';
  ST.storeEdit = { id: s.id, name: s.name, code: s.code || '', owner: s.owner || '', shop_id: s.shop_id || 0 };
}
function resetStoreEdit() { ST.storeEditMode = 'new'; ST.storeEdit = { id: 0, name: '', code: '', owner: '', shop_id: 0 }; }
function saveStore() {
  var d = ST.storeEdit;
  if (!d.name || !d.name.trim()) { toast(t('shop.storeNameReq'), 'error'); return; }
  var code = (d.code || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9]{2}$/.test(code)) { toast(t('store.codeRule'), 'error'); return; }
  d.code = code;
  var payload = { name: d.name.trim(), code: code, owner: (d.owner || '').trim(), shop_id: d.shop_id || 0 };
  var req = d.id ? api('PUT', '/api/stores/' + d.id, payload) : api('POST', '/api/stores', payload);
  req.then(function () {
    toast(t('toast.saveOk')); resetStoreEdit(); loadShops(); loadStores(true); loadBridgeList();
  }).catch(function (e) { toast(e.message, 'error'); });
}

// ---- 店铺（上层组织）----
function loadStores(all) {
  var url = '/api/stores' + (all ? '?all=1' : '');
  return api('GET', url).then(function (r) {
    ST.stores = r || [];
    if (ST.locStore && !ST.stores.some(function (s) { return s.id === ST.locStore; })) ST.locStore = 0;
    loadLocations();
  }).catch(function () {});
}
function loadShops() {
  api('GET', '/api/shops').then(function (r) { ST.shops = r || []; }).catch(function () {});
}
function editShop(s) {
  ST.shopEditMode = 'edit';
  ST.shopEdit = { id: s.id, name: s.name, code: s.code || '', sale_item_limit: s.sale_item_limit || 20 };
}
function resetShopEdit() { ST.shopEditMode = ''; ST.shopEdit = { id: 0, name: '', code: '', sale_item_limit: 20 }; }
function saveShop() {
  var d = ST.shopEdit;
  if (!d.id && (!d.name || !d.name.trim())) { toast(t('shop.nameReq'), 'error'); return; }
  var payload = { name: (d.name || '').trim(), code: (d.code || '').trim(), sale_item_limit: Number(d.sale_item_limit) || 20 };
  var req = d.id ? api('PUT', '/api/shops/' + d.id, payload) : api('POST', '/api/shops', payload);
  req.then(function () { toast(t('toast.saveOk')); resetShopEdit(); loadShops(); })
    .catch(function (e) { toast(e.message, 'error'); });
}
function delShop(s) {
  if (!confirm(t('shop.cfDel', { n: s.name }))) return;
  api('DELETE', '/api/shops/' + s.id).then(function () { toast(t('toast.saveOk')); loadShops(); })
    .catch(function (e) { toast(e.message, 'error'); });
}
// 门店管理：按店铺分组
function storesByShop(shopId) { return ST.stores.filter(function (s) { return (s.shop_id || 0) === shopId; }); }
// 门店管理：当前选中门店（复用 locStore 作为选中态）及其桥状态/库位/所属店铺
function selectStore(id) { ST.locStore = id || 0; }
function bridgeOfStore(sid) { return ST.bridges.find(function (b) { return b.store_id === sid; }) || null; }
function shopOfStore(s) { return ST.shops.find(function (p) { return p.id === (s && s.shop_id); }) || null; }
// 门店内入库：固定门店打开入库面板
function inboundForStore(s) { openInbound(s); }
function rotateStoreKey(sid) {
  api('POST', '/api/stores/' + sid + '/bridge-key', {}).then(function (r) {
    var b = ST.bridges.find(function (x) { return x.store_id === sid; });
    if (b) b.newKey = r.key || '';
    toast(t('sb.keyGen'));
  }).catch(function (e) { toast(e.message, 'error'); });
}
function copyStoreKey(sid) {
  var b = ST.bridges.find(function (x) { return x.store_id === sid; });
  if (b && b.newKey) copyText(b.newKey);
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
    if (r && r.name) { ST.softName = r.name; }
    if (r && r.version && !ST.version) { ST.version = r.version; }
    syncDocTitle();
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
    curStoreName: curStoreName,
    subTitle: subTitle,
    exportHref: exportHref,
    nav: function () { return NAV_ITEMS; },
    adminSubs: function () {
      // 「用户与门店权限」仅店长可见
      return ADMIN_SUBS.filter(function (s) {
        return s.key !== 'users' || isAdminRole();
      });
    },
    cats: function () {
      var list = (ST.cats || []).map(function (c) { return (c.names && c.names.zh) || c.code; });
      return list.length ? list : CATS;
    },
    // 原始分类对象（带 code/names），供商品表单与筛选chips使用
    catList: function () { return ST.cats || []; },
    // 商品品类（戒指/项链…）
    typeList: function () { return ST.productTypes || []; },
    // 当前工作门店的启用库位（商品页库位筛选下拉，数据严格按门店隔离）
    activeLocations: function () {
      var sid = ST.curStoreId;
      return (ST.locations || []).filter(function (l) { return l.active && l.store_id === sid; })
        .sort(function (a, b) { return (a.sort_order - b.sort_order) || a.id - b.id; });
    },
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
    // 门店管理：当前选中门店 / 其打印桥 / 其库位 / 所属店铺
    curStore: function () { return ST.stores.find(function (s) { return s.id === ST.locStore; }) || null; },
    curBridge: function () { return ST.bridges.find(function (b) { return b.store_id === ST.locStore; }) || null; },
    curLocations: function () { return ST.locations.filter(function (l) { return l.store_id === ST.locStore; }); },
    curShop: function () { var s = ST.stores.find(function (x) { return x.id === ST.locStore; }); return s ? (ST.shops.find(function (p) { return p.id === s.shop_id; }) || null) : null; },
    // 多件开单：件数上限 / 实时合计（模板按属性使用 sItemLimit / sTotal）
    sItemLimit: function () { return saleItemLimit(); },
    sTotal: function () { return saleTotal(); },
    // 系统自检铃铛：检查项列表 / 是否有启用项异常
    healthItems: healthItems,
    healthBad: healthBad,
    // 安防中心：原始报文筛选
    secFilteredEvents: function () {
      if (!ST.secRawFilter) return ST.secEvents || [];
      return (ST.secEvents || []).filter(function (e) { return e.event_type === ST.secRawFilter; });
    },
  },
  methods: {
    go: go, switchAdminSub: switchAdminSub,
    switchStore: switchStore,
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
    // 库位主数据 / 经办人类别
    loadLocations: loadLocations, storeNameOf: storeNameOf, locNameOf: locNameOf,
    activeLocationsOf: activeLocationsOf,
    resetLocEdit: resetLocEdit, onLocStoreChange: onLocStoreChange,
    addLocForCur: addLocForCur, saveLocForCur: saveLocForCur,
    editLoc: editLoc, saveLoc: saveLoc, delLoc: delLoc, toggleLoc: toggleLoc,
    loadClerkTypes: loadClerkTypes, resetClerkEdit: resetClerkEdit,
    // 用户与门店授权
    isAdminRole: isAdminRole, loadAdminUsers: loadAdminUsers, toggleUserStore: toggleUserStore,
    openUserCreate: openUserCreate, openUserEdit: openUserEdit, closeUserForm: closeUserForm,
    saveAdminUser: saveAdminUser, delAdminUser: delAdminUser,
    editClerk: editClerk, saveClerk: saveClerk, toggleClerk: toggleClerk,
    activeClerkTypes: activeClerkTypes, defaultClerkTypeName: defaultClerkTypeName,
    loadSales: loadSales, clerkText: clerkText, printReceipt: printReceipt,
    // 门店调拨
    reloadProducts: reloadProducts,
    toggleTransferMode: toggleTransferMode, clearTransferSel: clearTransferSel,
    transferSelList: transferSelList, transferSelCount: transferSelCount,
    canTransferPick: canTransferPick, toggleTransferPick: toggleTransferPick,
    transferStoreOptions: transferStoreOptions,
    openTransferSend: openTransferSend, closeTransferSend: closeTransferSend,
    submitTransfer: submitTransfer,
    loadTransfers: loadTransfers, transferList: transferList,
    openTransfer: openTransfer, closeTransferDetail: closeTransferDetail,
    startReceive: startReceive, cancelReceive: cancelReceive,
    setRecvOk: setRecvOk, quickReason: quickReason, submitReceive: submitReceive,
    loadBridgeList: loadBridgeList, createStore: createStore, rotateStoreKey: rotateStoreKey,
    copyStoreKey: copyStoreKey, bindBizPrinter: bindBizPrinter, bizPrinterOf: bizPrinterOf,
    storeControl: storeControl,
    loadShops: loadShops, loadStores: loadStores, storesByShop: storesByShop,
    selectStore: selectStore, bridgeOfStore: bridgeOfStore, shopOfStore: shopOfStore,
    editShop: editShop, resetShopEdit: resetShopEdit, saveShop: saveShop, delShop: delShop,
    editStore: editStore, resetStoreEdit: resetStoreEdit, saveStore: saveStore, inboundForStore: inboundForStore,
    labelStoreBridge: labelStoreBridge,
    openInbound: openInbound, copyInbound: copyInbound, openRfid: openRfid, doRfid: doRfid, toggleInvGroup: toggleInvGroup,
    openLabelPrint: openLabelPrint, removeLabelItem: removeLabelItem, closeLabel: closeLabel,
    togglePrintSel: togglePrintSel, togglePrintAll: togglePrintAll, openPrintSelected: openPrintSelected,
    submitLabelPrint: submitLabelPrint, labelPreview: labelPreview,
    appPrintReady: appPrintReady, loadBtPrinters: loadBtPrinters, pickBtPrinter: pickBtPrinter,
    loadStockBatches: loadStockBatches,
    viewStockBatch: viewStockBatch, viewBatchProduct: viewBatchProduct,
    startCoTask: startCoTask, loadCoTask: loadCoTask, cancelCoTask: cancelCoTask,
    terminateCoTask: terminateCoTask, openCoReport: openCoReport, closeTaskReport: closeTaskReport,
    copyCoUrl: copyCoUrl,
    copyH5Url: copyH5Url,
    openDevices: openDevices, closeDevices: closeDevices, loadDevices: loadDevices,
    genActivation: genActivation, loadActivations: loadActivations, copyActUrl: copyActUrl,
    unbindDevice: unbindDevice, toggleDeviceStatus: toggleDeviceStatus, devOnlineText: devOnlineText,
    quickSale: quickSale, openDeposit: openDeposit,
    addSaleItem: addSaleItem, removeSaleItem: removeSaleItem, onPickSaleProduct: onPickSaleProduct,
    matchStockProduct: matchStockProduct,
    openSaleCam: openSaleCam, closeSaleCam: closeSaleCam,
    setScanMode: setScanMode,
    exitCoopScan: exitCoopScan,
    voidSale: voidSale, payDeposit: payDeposit, voidDeposit: voidDeposit,
    openLoan: openLoan, returnLoan: returnLoan,
    addLoanRawCode: addLoanRawCode, removeLoanCode: removeLoanCode, openLoanCam: openLoanCam, closeLoanCam: closeLoanCam, loanCodes: loanCodes,
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
    secNewOpen: secNewOpen, secEdit: secEdit, secCreate: secCreate, secRotateKey: secRotateKey,
    secDelete: secDelete, secSimulate: secSimulate, secHandleEvent: secHandleEvent,
    secAddPass: secAddPass, secDelPass: secDelPass, secAckAlarm: secAckAlarm,
    guideHttpUrl: guideHttpUrl, guideWsUrl: guideWsUrl, guideExample: guideExample,
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
      applySession(r);
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
      applySession(r);
      window.__yzLoginOk = true;
      refreshAll();
    }).catch(function () { ST.token = ''; sessionStorage.removeItem('jewelry_token'); });
  }
} catch (e) {}

// ---- 全局冻结状态慢速轮询 ----
// 任务可能由另一台电脑开启/确认/终止；即使不在库存页也要能感知冻结与解冻。
// 进行中任务的 5s 快速轮询由 ensureCoTimer 负责，这里是全局面兜底。
setInterval(function () { if (ST.token) loadCoTask(); }, 15000);

