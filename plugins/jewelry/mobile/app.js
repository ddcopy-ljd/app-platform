/* 懿臻珠宝云 · 手机网页版 应用逻辑
 * Vue3 global build + 集中状态 ST + methods。禁止与 i18n.js 重复声明同名全局函数。
 */
(function () {
  "use strict";

  var API = (window.__APP_BASE__ || "").replace(/\/+$/, "");

  function todayStr() {
    var d = new Date();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  function fmtNum(v) {
    var n = num(v);
    var neg = n < 0; n = Math.abs(n);
    var s = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return (neg ? "-" : "") + s;
  }

  var _MCUR = { CNY: '￥', USD: '$', EUR: '€' };
  function _mFindRate(from, to) {
    if (!from || !to || from === to) return 1.0;
    var rates = (ST.bizConfig && ST.bizConfig.rates) || [];
    for (var i = 0; i < rates.length; i++) {
      if (rates[i].from_currency === from && rates[i].to_currency === to) return Number(rates[i].rate) || 1.0;
    }
    for (var j = 0; j < rates.length; j++) {
      if (rates[j].from_currency === to && rates[j].to_currency === from) {
        var r = Number(rates[j].rate); return r > 0 ? 1 / r : 1.0;
      }
    }
    return 1.0;
  }
  function money(n) {
    if (n === null) return "***";
    if (n === undefined || n === "") return "—";
    var base = "CNY";  // 内部记账币种固定人民币
    var target = (ST.bizConfig && (ST.bizConfig.store_currency || ST.bizConfig.currency)) || base;
    var rate = _mFindRate(base.toUpperCase(), target.toUpperCase());
    var val = Number(n) * rate;
    var sym = _MCUR[(target || base).toUpperCase()] || "￥";
    return sym + fmtNum(val);
  }

  function _mEntryCur(sid) {
    var fallback = (ST.bizConfig && ST.bizConfig.currency) || "CNY";
    if (Number(sid) && Number(sid) === Number(ST.storeId)) {
      return ((ST.bizConfig && ST.bizConfig.store_currency) || fallback).toUpperCase();
    }
    var s = null;
    for (var i = 0; i < (ST.stores || []).length; i++) {
      if (ST.stores[i].id === Number(sid)) { s = ST.stores[i]; break; }
    }
    var dc = (s && s.display_currency) || "";
    return (dc || fallback).toUpperCase();
  }
  function _mEntryRate(sid) { return _mFindRate("CNY", _mEntryCur(sid)) || 1; }
  // DB 人民币 → 门店录入币种（打开表单显示用）
  function mCnyToEntry(v, sid) {
    if (v === "" || v == null) return "";
    return Math.round(Number(v) * _mEntryRate(sid) * 100) / 100;
  }
  // 门店录入币种 → DB 人民币（保存前用）
  function mEntryToCny(v, sid) {
    if (v === "" || v == null) return v;
    var r = _mEntryRate(sid);
    return r > 0 ? Math.round(Number(v) / r * 100) / 100 : Number(v);
  }

  var STATUS_KEY = {
    "在库": "st.inStock", "已定": "st.reserved", "借出": "st.loaned", "在途": "st.inTransit", "已售": "st.sold",
    "已完成": "sale.done", "欠款": "sale.owing", "已冲红": "sale.voided",
    "借出中": "loan.out", "借入中": "loan.in", "已归还": "loan.return",
    "待维修": "st.reserved", "维修中": "sale.done", "已取走": "st.sold",
    "待发货": "st.reserved", "已入库": "st.inStock",
    "加工中": "sale.done", "已收货": "st.inStock",
    "部分完成": "tr.stPartial"
  };
  var STATUS_CLASS = {
    "在库": "state-ok", "已定": "state-lock", "借出": "state-loan", "在途": "state-doing", "已售": "state-due",
    "已完成": "state-ok", "欠款": "state-due", "已冲红": "state-loan",
    "借出中": "state-loan", "借入中": "state-doing", "已归还": "state-ok", "已核销": "state-wait",
    "待维修": "state-wait", "维修中": "state-doing", "已取走": "state-ok",
    "待发货": "state-wait", "已入库": "state-ok",
    "加工中": "state-doing", "已收货": "state-ok",
    "待处理": "state-wait", "已确认": "state-doing", "已到店": "state-ok", "已取消": "state-wait",
    "部分完成": "state-lock"
  };

  function statusKey(s) { return STATUS_KEY[s] || "common.status"; }
  function statusClass(s) { return STATUS_CLASS[s] || "state-wait"; }

  var ST = Vue.reactive({
    token: "", user: null, mode: "", tenant: "", version: "", features: [],
    stores: [], storeId: 0,
    lang: window.YZLang.get(),
    tab: "dashboard", sub: "", subId: 0,
    loading: false,
    toast: { show: false, text: "", type: "success" },
    sheet: "",
    loginForm: { username: "admin", password: "123456" },
    logging: false,
    dash: null, trend: null, reminders: null,
    goldData: null, riskData: null, catSales: null, tagStats: null, rankData: null, bizAnalysis: null,
    saleStatsDim: "category", tagSel: [], tagList: [], tagGroupList: [], productTypes: [],
    dashRange: "6m", trendCmp: "yoy",   // 看板全局时间段（today/week/month/3m/6m/year）+ 趋势对比口径（yoy 同比 / mom 环比）
    bizConfig: { currency: "CNY", symbol: "￥" },
    products: { items: [], total: 0, page: 1, size: 30, q: "", status: "" },
    productForm: null, productEdit: false, productView: null,
    inventory: null, lockedItems: [],
    sales: { items: [], total: 0, page: 1, size: 30 },
    saleItems: [], saleForm: { customer: "", phone: "", paid: "", method: "现金", discount: "0", biz_date: todayStr() },
    deposits: { items: [], total: 0, page: 1, size: 30 },
    depForm: { customer: "", phone: "", product_id: 0, product: "", total: "", deposit: "", promised_date: todayStr(), reminder_days: 7 },
    customers: { items: [], total: 0, page: 1, size: 30, q: "" },
    custDetail: null, custForm: null,
    loans: { items: [] }, repairs: { items: [] }, purchases: { items: [] }, outsourcings: { items: [] },
    appointments: [], logs: { items: [], total: 0, page: 1, size: 30 },
    profile: null,
    docs: "",
    // 门店调拨
    transfers: { out: [], in: [], tab: "out" },
    trPick: { items: [], q: "", sel: {}, store: 0 },
    trForm: { to_store_id: 0, remark: "" },
    trDetail: null, trReceiving: false, trRecv: {}, trBusy: false,
    // RFID 盘点任务
    coTask: null, coBusy: false, coHost: "",
    // 盘点批次
    batches: [], batchDetail: null,
    pickOptions: [], pickLoading: false,
    pickMode: "",
    form: {}, formTitle: "", formKind: "",
    auditNote: "",
    // 总部管理（信息/推广/分店/品类/分类）
    hqTab: "info", shops: [], hqStores: [], labelTemplates: [],
    typeEdit: { code: "", names: { zh: "", en: "", it: "" }, sort_order: 0, pricing_mode: "piece" }, typeEditMode: "new",
    tagGroups: [], tagFilter: "",
    tagGroupEdit: { id: 0, name: "", sort_order: 1 }, tagGroupEditMode: "new",
    tagEdit: { id: 0, name: "", color: "#C9A227", sort_order: 1, group_name: "" }, tagEditMode: "new",
    storeEdit: { id: 0, name: "", code: "", owner: "", shop_id: 0 }, storeEditMode: "",
    profI18n: {}, profEdit: {}, profLang: "en",
    // 库位管理
    locations: [], locStore: 0,
    locEdit: { id: 0, store_id: 0, code: "", name: "", sort_order: 0, active: 1 }, locEditMode: "new",
    // 用户与门店授权（仅店长）
    adminUsers: [], adminUserOpen: false,
    adminUserForm: { id: 0, username: "", display_name: "", password: "", role: "EMPLOYEE", can_view_cost: false },
    changePwdForm: { old: "", new: "", confirm: "" },
    // 经办人类别
    clerkTypes: [],
    clerkEdit: { id: 0, name: "", sort_order: 1 }, clerkEditMode: "new",
    // 设备管理（打印助手 / 扫描设备 / 安防设备）
    devices: [], devBridges: [], devSensors: [],
    devActStoreId: 0, devActName: "", devActUrl: "",
    devKey: { kind: "", store: "", key: "" },
    devBizOpen: {},
    // 商品多选 / 批量操作 / 标签打印 / 图片 / 导入
    prodSelMode: false, printSel: {},
    labelItems: [], labelCopies: 1, writeEpc: true, labelBusy: false, labelResult: null, labelAgent: null,
    batchEdit: null,
    imgCrop: { src: "", pid: 0, orient: "landscape", busy: false, iw: 0, ih: 0, base: 1, zoom: 1, tx: 0, ty: 0, _drag: false, _px: 0, _py: 0 },
    importDlg: { file: null, busy: false, result: null }
  });

  function toast(text, type) {
    ST.toast = { show: true, text: text, type: type || "success" };
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { ST.toast.show = false; }, 2200);
  }

  function api(m, url, body) {
    var h = { "Content-Type": "application/json" };
    if (ST.token) h["Authorization"] = "Bearer " + ST.token;
    var o = { method: m, headers: h };
    if (body) o.body = JSON.stringify(body);
    return fetch(API + url, o).then(function (r) {
      if (r.status === 401 && url !== "/api/auth/login") { forceLogout(); }
      if (!r.ok) {
        return r.json().then(function (e) { throw new Error((e && e.detail) || t("msg.netErr")); },
          function () { throw new Error(t("msg.netErr")); });
      }
      if (r.status === 204) return {};
      return r.json().catch(function () { return {}; });
    });
  }

  function forceLogout() {
    ST.token = ""; ST.user = null; ST.stores = [];
    try { localStorage.removeItem("yz_m_token"); } catch (e) {}
  }

  function persistToken() {
    try {
      if (ST.token) localStorage.setItem("yz_m_token", ST.token);
      else localStorage.removeItem("yz_m_token");
    } catch (e) {}
  }

  // ---------------- auth ----------------
  function login() {
    var f = ST.loginForm;
    if (!f.username || !f.password) { toast(t("msg.required"), "error"); return; }
    ST.logging = true;
    api("POST", "/api/auth/login", { username: f.username, password: f.password }).then(function (r) {
      ST.logging = false;
      ST.token = r.token || "";
      ST.user = r.user || null;
      ST.mode = r.mode || ""; ST.tenant = r.tenant || ""; ST.version = r.version || "";
      ST.features = r.features || [];
      ST.stores = r.stores || [];
      ST.storeId = r.store_id || (ST.user && ST.user.store_id) || 0;
      persistToken();
      // 加载币种+汇率+门店币种
      api("GET", "/api/currency").then(function (c) {
        ST.bizConfig.currency = c.hq_currency || "CNY";  // 总部管理视图显示币种
        ST.bizConfig.symbol = c.hq_symbol || c.symbol;
        ST.bizConfig.store_currency = c.store_currency;
        ST.bizConfig.store_symbol = c.store_symbol;
        ST.bizConfig.rates = c.rates || [];
      }).catch(function () {});
      toast(t("msg.loginOk") + (ST.user && ST.user.display_name ? "，" + ST.user.display_name : ""));
      if (ST.user && ST.user.must_change_pwd) {
        ST.changePwdForm = { old: "", new: "", confirm: "" };
        ST.sheet = "pwd";
      } else if (ST.user && ST.user.role === "SYS_ADMIN") {
        go("mine"); // 系统管理员只能做用户管理
      } else {
        go("dashboard");
      }
    }).catch(function (e) {
      ST.logging = false;
      toast(e.message || t("login.err"), "error");
    });
  }

  function logout() {
    api("POST", "/api/auth/logout", {}).catch(function () {});
    forceLogout();
    ST.tab = "dashboard"; ST.sub = "";
  }

  function submitChangePwd() {
    var f = ST.changePwdForm;
    if (!f.old || !f.new) { toast(t("msg.required"), "error"); return; }
    if (f.new !== f.confirm) { toast(t("pf.pwdMismatch"), "error"); return; }
    if (f.new.length < 6) { toast(t("pf.pwdTooShort"), "error"); return; }
    api("POST", "/api/auth/change-password", { old: f.old, new: f.new }).then(function () {
      toast(t("pf.pwdChanged"));
      ST.changePwdForm = { old: "", new: "", confirm: "" };
      ST.sheet = "";
      if (ST.user) ST.user.must_change_pwd = false;
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function switchStore(sid) {
    api("POST", "/api/auth/switch-store", { store_id: sid }).then(function () {
      ST.storeId = sid;
      ST.sheet = "";
      toast(t("pf.switchOk"));
      go(ST.tab, true);
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function setLang(l) { ST.lang = l; window.YZLang.set(l); loadGold(); }

  function curStoreName() {
    for (var i = 0; i < ST.stores.length; i++) {
      if (ST.stores[i].id === ST.storeId) return ST.stores[i].name;
    }
    return (ST.user && ST.user.display_name) || ST.tenant || "";
  }

  // 总部级视图（总部汇总 -1，或总部实体 code=HQ/DEFAULT）：总部不存放商品，不进行入库
  function isHqView() {
    if (ST.storeId === -1) return true;
    for (var i = 0; i < ST.stores.length; i++) {
      if (ST.stores[i].id === ST.storeId) {
        var c = String(ST.stores[i].code || "").toUpperCase();
        return c === "HQ" || c === "DEFAULT";
      }
    }
    return false;
  }

  // ---------------- navigation ----------------
  function go(tab, silent) {
    ST.tab = tab; ST.sub = ""; ST.sheet = "";
    if (tab === "dashboard") loadDash();
    else if (tab === "products") loadProducts(true);
    else if (tab === "customers") loadCustomers(true);
    else if (tab === "mine" && !silent) { /* nothing */ }
    var el = document.querySelector(".page");
    if (el) el.scrollTop = 0;
  }

  function openSub(name, id) {
    ST.sub = name; ST.subId = id || 0;
    if (name === "inventory") loadInventory();
    else if (name === "sales") loadSales();
    else if (name === "sale-new") prepareSale();
    else if (name === "deposits") loadDeposits();
    else if (name === "dep-new") prepareDeposit();
    else if (name === "loans") loadLoans();
    else if (name === "repairs") loadRepairs();
    else if (name === "purchases") loadPurchases();
    else if (name === "outsourcings") loadOutsourcings();
    else if (name === "appointments") loadAppointments();
    else if (name === "logs") loadLogs();
    else if (name === "transfers") loadTransfers();
    else if (name === "count") { loadCoTask(); loadBatches(); }
    else if (name === "batches") loadBatches();
    else if (name === "store-profile") loadProfile();
    else if (name === "hq") { ST.hqTab = "info"; loadHqTab(); }
    else if (name === "devices") loadDevicePage();
    else if (name === "docs") loadDocs();
    var el = document.querySelector(".page");
    if (el) el.scrollTop = 0;
  }

  function closeSub() { ST.sub = ""; ST.subId = 0; }

  // ---------------- dashboard ----------------
  // 看板全局时间段推导（与电脑端一致）：mode=today|week|month|3m|6m|year → {start,end}
  function mobRangeCompute(mode) {
    var now = new Date();
    function iso(d) {
      var m = ("0" + (d.getMonth() + 1)).slice(-2), dd = ("0" + d.getDate()).slice(-2);
      return d.getFullYear() + "-" + m + "-" + dd;
    }
    var t0 = iso(now);
    if (mode === "week") { var day = (now.getDay() + 6) % 7; var mon = new Date(now); mon.setDate(now.getDate() - day); return { start: iso(mon), end: t0 }; }
    if (mode === "month") { var f = new Date(now.getFullYear(), now.getMonth(), 1); return { start: iso(f), end: t0 }; }
    if (mode === "3m") { var d3 = new Date(now); d3.setMonth(d3.getMonth() - 3); return { start: iso(d3), end: t0 }; }
    if (mode === "6m") { var d6 = new Date(now); d6.setMonth(d6.getMonth() - 6); return { start: iso(d6), end: t0 }; }
    if (mode === "year") { return { start: now.getFullYear() + "-01-01", end: t0 }; }
    return { start: t0, end: t0 };
  }
  function setDashRange(mode) { ST.dashRange = mode; loadDash(); }
  function setTrendCmp(c) { ST.trendCmp = (c === "mom") ? "mom" : "yoy"; }

  function loadDash() {
    ST.loading = true;
    var rg = mobRangeCompute(ST.dashRange);
    var q = "?start=" + rg.start + "&end=" + rg.end;
    api("GET", "/api/dashboard/overview" + q).then(function (d) { ST.dash = d; }).catch(function () {})
      .then(function () { ST.loading = false; });
    api("GET", "/api/dashboard/trend" + q).then(function (d) { ST.trend = d; }).catch(function () {});
    api("GET", "/api/dashboard/category-sales" + q).then(function (d) { ST.catSales = d; }).catch(function () {});
    api("GET", "/api/dashboard/biz-analysis" + q).then(function (d) { ST.bizAnalysis = d; }).catch(function () {});
    api("GET", "/api/dashboard/rankings" + q).then(function (d) { ST.rankData = d; }).catch(function () {});
    api("GET", "/api/dashboard/reminders").then(function (d) { ST.reminders = d; }).catch(function () {});
    api("GET", "/api/dashboard/risk").then(function (d) { ST.riskData = d; }).catch(function () {});
    api("GET", "/api/product-types").then(function (d) { ST.productTypes = d || []; }).catch(function () {});
    loadTags();
    loadTagStats();
    loadGold();
  }

  // ------------- 看板扩展块：金价 / 区间KPI / 风控 / 销售额统计 / 品类占比 / 排行 / 经营分析 -------------
  function localeCurrency() {
    var byLang = { "zh": "CNY", "zh-Hans": "CNY", "zhHant": "HKD", "zh-Hant": "HKD", "en": "USD", "it": "EUR", "ja": "JPY", "ko": "KRW" };
    if (byLang[ST.lang]) return byLang[ST.lang];
    try {
      var r = (new Intl.NumberFormat().resolvedOptions().locale || "").split("-")[1];
      if (r === "US") return "USD";
      if (r === "JP") return "JPY";
      if (r === "KR") return "KRW";
      if (r === "IT") return "EUR";
      if (r === "HK" || r === "MO") return "HKD";
    } catch (e) {}
    return "CNY";
  }
  function loadGold() {
    api("GET", "/api/dashboard/gold?ccy=" + encodeURIComponent(localeCurrency())).then(function (r) { ST.goldData = r; })
      .catch(function () { ST.goldData = { intlUsd: null, intlPrice: null }; });
  }
  function pctCls(p) { return num(p) >= 0 ? "pct up" : "pct down"; }
  function pctLabel(p) { var n = num(p); return (n >= 0 ? "+" : "") + fmtNum(n) + "%"; }
  var DONUT_COLORS = ["#C9A227", "#8B2E3B", "#3D6B99", "#4E8A5A", "#B36A2E", "#7A5C9E"];
  function donutColor(i) { return DONUT_COLORS[(i || 0) % DONUT_COLORS.length]; }
  function catText(name) {
    var list = ST.productTypes || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.names && c.names.zh === name) return c.names[ST.lang] || c.names.zh || name;
    }
    return name || "";
  }
  function catDonutSegments() {
    var items = (ST.catSales && ST.catSales.items) || [];
    var acc = 0;
    return items.map(function (c, i) {
      var seg = { pct: c.pct, offset: -acc, color: i % 6, key: c.category };
      acc += c.pct;
      return seg;
    });
  }
  function loadTags() {
    api("GET", "/api/product-tags").then(function (r) {
      ST.tagList = (r && r.list) || [];
      ST.tagGroupList = (r && r.groups) || [];
    }).catch(function () {});
  }
  function loadTagStats() {
    var rg = mobRangeCompute(ST.dashRange);
    var q = "?dim=" + ST.saleStatsDim + "&start=" + rg.start + "&end=" + rg.end;
    if (ST.saleStatsDim === "tag" && ST.tagSel && ST.tagSel.length) q += "&tag_ids=" + ST.tagSel.join(",");
    api("GET", "/api/dashboard/tag-stats" + q).then(function (r) { ST.tagStats = r; }).catch(function () {});
  }
  function setSaleStatsDim(d) { ST.saleStatsDim = d; loadTagStats(); }
  function toggleTagSel(id) {
    var i = ST.tagSel.indexOf(id);
    if (i >= 0) ST.tagSel.splice(i, 1); else ST.tagSel.push(id);
    loadTagStats();
  }
  function clearTagSel() { ST.tagSel = []; loadTagStats(); }
  function tagGrouped() {
    var list = ST.tagList || [], order = (ST.tagGroupList || []).slice(), map = {}, out = [], i, g;
    for (i = 0; i < list.length; i++) {
      g = list[i].group_name || "";
      if (!map[g]) { map[g] = []; if (order.indexOf(g) < 0) order.push(g); }
      map[g].push(list[i]);
    }
    for (i = 0; i < order.length; i++) {
      if (map[order[i]]) out.push({ group: order[i], tags: map[order[i]] });
    }
    return out;
  }
  function tagGroupName(g) { return g || t("tag.ungrouped"); }
  function tagBarStyle(g, i) {
    return { width: Math.max(Number(g.sale_pct) || 0, 2) + "%", background: g.color || donutColor(i % 6) };
  }
  function rankBlocks() {
    var d = ST.rankData;
    if (!d) return [];
    var m = function (v) { return (v == null) ? "***" : (money(v)); };
    return [
      { key: "turnover", title: t("rank.turnover"), rows: (d.turnover || []).map(function (r) {
          return { name: r.name, v: r.days + " " + t("rank.days"), sub: r.sold }; }) },
      { key: "profit", title: t("rank.profit"), rows: (d.profit || []).map(function (r) {
          return { name: r.name, v: r.rate == null ? "***" : (r.rate + "%"), sub: m(r.profit) }; }) },
      { key: "qty", title: t("rank.qty"), rows: (d.qty || []).map(function (r) {
          return { name: r.name, v: r.qty + " " + t("tag.pieceUnit"), sub: money(r.amount) }; }) },
      { key: "customer", title: t("rank.customer"), rows: (d.customer || []).map(function (r) {
          return { name: r.name, v: money(r.amount), sub: r.bills + " " + t("rank.bills") }; }) },
      { key: "clerk", title: t("rank.clerk"), rows: (d.clerk || []).map(function (r) {
          return { name: r.name, v: money(r.amount), sub: r.bills + " " + t("rank.bills") }; }) },
      { key: "slow", title: t("rank.slow"), hint: t("rank.slowHint"), rows: (d.slow || []).map(function (r) {
          return { name: r.name, v: r.age + " " + t("rank.days"), sub: r.cost == null ? "" : (t("kpi.stockCost") + " " + money(r.cost)) }; }) },
      { key: "category", title: t("rank.category"), rows: (d.category || []).map(function (r) {
          return { name: r.name, v: money(r.amount), sub: r.qty + " " + t("tag.pieceUnit") }; }) }
    ];
  }

  // ---------------- products ----------------
  function loadProducts(reset) {
    if (reset) { ST.products.page = 1; ST.products.items = []; }
    ST.loading = true;
    var q = "?page=" + ST.products.page + "&size=" + ST.products.size;
    if (ST.products.q) q += "&q=" + encodeURIComponent(ST.products.q);
    if (ST.products.status) q += "&status=" + encodeURIComponent(ST.products.status);
    api("GET", "/api/products" + q).then(function (d) {
      ST.loading = false;
      ST.products.total = d.total || 0;
      ST.products.items = reset ? (d.items || []) : ST.products.items.concat(d.items || []);
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function loadMoreProducts() {
    if (ST.products.items.length >= ST.products.total) return;
    ST.products.page += 1;
    loadProducts(false);
  }

  function viewProduct(id) {
    api("GET", "/api/products/" + id).then(function (d) {
      ST.productView = d; openSub("product-view");
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function blankProduct() {
    return {
      id: 0, code: "", name: "", category: "", material: "", weight: "", size: "",
      cert: "", cost: "", price: "", status: "在库", rfid_epc: "", location_id: 0,
      high_value: 0, showcase_public: 0, product_type: "", product_type_code: "", category_code: "", image_ts: ""
    };
  }

  function newProduct() {
    if (isHqView()) { toast("总部不直接录入商品，请切换到具体门店后新增商品", "error"); return; }
    ST.productForm = blankProduct(); ST.productEdit = false; openSub("product-edit");
  }

  function editProduct() {
    var p = ST.productView; if (!p) return;
    ST.productForm = {
      id: p.id, code: p.code || "", name: p.name || "", category: p.category || "",
      material: p.material || "", weight: p.weight || "", size: p.size || "", cert: p.cert || "",
      cost: p.cost == null ? "" : mCnyToEntry(p.cost, p.store_id),
      price: p.price == null ? "" : mCnyToEntry(p.price, p.store_id),
      status: p.status || "在库", rfid_epc: p.rfid_epc || "", location_id: p.location_id || 0,
      high_value: p.high_value || 0, showcase_public: p.showcase_public || 0,
      product_type: p.product_type || "", product_type_code: p.product_type_code || "", category_code: p.category_code || "", image_ts: p.image_ts || ""
    };
    ST.productEdit = true; openSub("product-edit");
  }

  function copyProduct() {
    var p = ST.productView; if (!p) return;
    ST.productForm = blankProduct();
    ST.productForm.name = p.name || ""; ST.productForm.category = p.category || "";
    ST.productForm.material = p.material || ""; ST.productForm.weight = p.weight || "";
    ST.productForm.size = p.size || ""; ST.productForm.cert = p.cert || "";
    ST.productForm.cost = p.cost == null ? "" : mCnyToEntry(p.cost, p.store_id);
    ST.productForm.price = p.price == null ? "" : mCnyToEntry(p.price, p.store_id);
    ST.productForm.product_type = p.product_type || ""; ST.productForm.product_type_code = p.product_type_code || "";
    ST.productForm.category_code = p.category_code || "";
    ST.productEdit = false; openSub("product-edit");
  }

  function saveProductRequest(f) {
    var body = {
      code: f.code, name: f.name, category: f.category, material: f.material,
      weight: f.weight === "" ? "" : f.weight, size: f.size, cert: f.cert,
      cost: f.cost === "" ? null : mEntryToCny(f.cost, ST.storeId), price: f.price === "" ? null : mEntryToCny(f.price, ST.storeId),
      status: f.status, rfid_epc: f.rfid_epc, location_id: f.location_id || null,
      high_value: f.high_value ? 1 : 0, showcase_public: f.showcase_public ? 1 : 0,
      product_type: f.product_type, product_type_code: f.product_type_code, category_code: f.category_code
    };
    return f.id ? api("PUT", "/api/products/" + f.id, body) : api("POST", "/api/products", body);
  }

  function saveProduct() {
    var f = ST.productForm;
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    if (!f.id && !f.code) { toast(t("prod.code") + " " + t("common.required"), "error"); return; }
    ST.loading = true;
    saveProductRequest(f).then(function () {
      ST.loading = false; toast(t("prod.saveOk")); closeSub(); loadProducts(true);
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function delProduct() {
    var p = ST.productView; if (!p) return;
    if (!confirm(t("msg.confirmDelete"))) return;
    api("DELETE", "/api/products/" + p.id).then(function () {
      toast(t("prod.delOk")); closeSub(); loadProducts(true);
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- 商品多选 / 批量操作 ----------------
  function toggleProdSelMode() {
    ST.prodSelMode = !ST.prodSelMode;
    if (!ST.prodSelMode) ST.printSel = {};
  }

  function togglePrintSel(id) {
    if (ST.printSel[id]) { delete ST.printSel[id]; } else { ST.printSel[id] = true; }
  }

  function togglePrintAll() {
    var items = ST.products.items;
    var all = items.length > 0;
    for (var i = 0; i < items.length; i++) { if (!ST.printSel[items[i].id]) { all = false; break; } }
    if (all) { ST.printSel = {}; return; }
    var m = {};
    for (var j = 0; j < items.length; j++) m[items[j].id] = true;
    ST.printSel = m;
  }

  function printSelCount() {
    var n = 0;
    for (var k in ST.printSel) { if (ST.printSel[k]) n++; }
    return n;
  }

  function selectedProducts() {
    return ST.products.items.filter(function (p) { return ST.printSel[p.id]; });
  }

  function prodRowTap(p) {
    if (ST.prodSelMode) { togglePrintSel(p.id); return; }
    viewProduct(p.id);
  }

  function _productPutBody(p) {
    return {
      code: p.code, name: p.name, category: p.category || "", material: p.material || "",
      weight: p.weight == null ? "" : p.weight, size: p.size || "", cert: p.cert || "",
      cost: p.cost == null ? 0 : p.cost, price: p.price == null ? 0 : p.price,
      status: p.status || "在库", rfid_epc: p.rfid_epc || "", location_id: p.location_id || null,
      high_value: p.high_value ? 1 : 0, showcase_public: p.showcase_public ? 1 : 0,
      product_type: p.product_type || "", product_type_code: p.product_type_code || "",
      category_code: p.category_code || ""
    };
  }

  function batchEditProducts() {
    if (!printSelCount()) return;
    ST.batchEdit = { category: "", material: "", cost: "", price: "", busy: false };
    ST.sheet = "batch-edit";
  }

  function submitBatchEdit() {
    var b = ST.batchEdit;
    if (!b || b.busy) return;
    var patch = {};
    if (b.category !== "") patch.category = b.category;
    if (b.material !== "") patch.material = b.material;
    if (b.cost !== "") { var c = parseFloat(b.cost); if (!isNaN(c)) patch.cost = mEntryToCny(c, ST.storeId); }
    if (b.price !== "") { var pr = parseFloat(b.price); if (!isNaN(pr)) patch.price = mEntryToCny(pr, ST.storeId); }
    if (!Object.keys(patch).length) { toast(t("prod.batchNoChange"), "error"); return; }
    var items = selectedProducts();
    b.busy = true;
    var ok = 0, fail = 0;
    items.reduce(function (chain, p) {
      return chain.then(function () {
        var body = _productPutBody(p);
        Object.keys(patch).forEach(function (k) { body[k] = patch[k]; });
        return api("PUT", "/api/products/" + p.id, body).then(function () { ok++; }, function () { fail++; });
      });
    }, Promise.resolve()).then(function () {
      b.busy = false; ST.sheet = ""; ST.prodSelMode = false; ST.printSel = {};
      if (fail) toast(t("prod.batchEditFail", { ok: ok, fail: fail }), "error");
      else toast(t("prod.batchEditOk", { n: ok }));
      loadProducts(true);
    });
  }

  function batchCopyProducts() {
    var ids = selectedProducts().map(function (p) { return p.id; });
    if (!ids.length) return;
    ST.loading = true;
    api("POST", "/api/products/batch-copy", { ids: ids }).then(function (r) {
      ST.loading = false; ST.prodSelMode = false; ST.printSel = {};
      toast(t("prod.batchCopyOk", { n: (r && r.count != null ? r.count : ids.length) }));
      loadProducts(true);
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function batchDelProducts() {
    var ids = selectedProducts().map(function (p) { return p.id; });
    if (!ids.length) return;
    if (!confirm(t("prod.batchDelCf", { n: ids.length }))) return;
    ST.loading = true;
    api("POST", "/api/products/batch-delete", { ids: ids }).then(function (r) {
      ST.loading = false; ST.prodSelMode = false; ST.printSel = {};
      var msg = t("prod.batchDelOk", { n: r && r.deleted != null ? r.deleted : 0 });
      if (r && r.skipped) msg += "，" + t("prod.batchDelSkip", { n: r.skipped });
      toast(msg);
      loadProducts(true);
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  // ---------------- 标签打印（云端排版 → 门店打印助手 → PCLE 出纸） ----------------
  function _labelItemOf(p) {
    return { id: p.id, code: p.code || "", name: p.name || "", price: p.price, material: p.material || "" };
  }

  function loadLabelAgent() {
    ST.labelAgent = null;
    api("GET", "/api/print-agent/status").then(function (r) {
      var bs = (r && r.bridges) || [];
      for (var i = 0; i < bs.length; i++) {
        if (bs[i].store_id === ST.storeId) {
          ST.labelAgent = { online: !!bs[i].online, name: bs[i].agent_name || bs[i].store_name || "" };
          return;
        }
      }
      ST.labelAgent = { online: false, name: "" };
    }).catch(function () { ST.labelAgent = { online: false, name: "" }; });
  }

  function openLabelPrint() {
    if (!ST.labelItems.length) { toast(t("label.empty"), "error"); return; }
    ST.labelResult = null; ST.labelBusy = false;
    ST.sheet = "label-print";
    loadLabelAgent();
  }

  function removeLabelItem(idx) { ST.labelItems.splice(idx, 1); }

  function closeLabel() { ST.sheet = ""; ST.labelItems = []; ST.labelResult = null; }

  function printLabel(p) {
    if (!p || !p.id) return;
    ST.labelItems = [_labelItemOf(p)];
    openLabelPrint();
  }

  function printSheetLabel() {
    var f = ST.productForm;
    if (!f) return;
    if (f.id) { printLabel(f); return; }
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    if (!f.code) { toast(t("prod.code") + " " + t("common.required"), "error"); return; }
    ST.loading = true;
    saveProductRequest(f).then(function (r) {
      ST.loading = false;
      if (r && r.id) {
        f.id = r.id;
        if (r.rfid_epc) f.rfid_epc = r.rfid_epc;
        ST.productEdit = true;
        loadProducts(true);
        printLabel(f);
      }
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function onPrintLabelBtn() {
    ST.labelItems = selectedProducts().map(_labelItemOf);
    openLabelPrint();
  }

  function openPrintSelected() { onPrintLabelBtn(); }

  function printTypeProducts(o) {
    if (!o || !o.code) return;
    ST.loading = true;
    api("GET", "/api/products?page=1&size=200").then(function (r) {
      ST.loading = false;
      var items = ((r && r.items) || []).filter(function (p) {
        return p.product_type_code === o.code && p.status !== "已售";
      });
      if (!items.length) { toast(t("label.empty"), "error"); return; }
      ST.labelItems = items.map(_labelItemOf);
      openLabelPrint();
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function submitLabelPrint() {
    if (ST.labelBusy || !ST.labelItems.length) return;
    ST.labelBusy = true; ST.labelResult = null;
    var body = {
      product_ids: ST.labelItems.map(function (x) { return x.id; }),
      copies: ST.labelCopies || 1, write_epc: !!ST.writeEpc,
      fields: ["store", "name", "spec", "price", "barcode"],
      route: "agent"
    };
    api("POST", "/api/print/labels", body).then(function (r) {
      ST.labelBusy = false;
      ST.labelResult = { ok: true, text: t("label.sentOk") + (r && r.printer ? "（" + r.printer + "）" : "") };
      toast(t("label.sentOk"));
      loadLabelAgent();
    }).catch(function (e) {
      ST.labelBusy = false;
      ST.labelResult = { ok: false, text: e.message };
    });
  }
  // ---------------- 商品图片（选择 / 裁切 / 上传） ----------------
  var IMG_LONG_EDGE = 800, IMG_QUALITY = 0.75;

  function productImageUrl(p) {
    if (!p || !p.id) return "";
    return API + "/api/products/" + p.id + "/image" + (p.image_ts ? "?ts=" + p.image_ts : "");
  }

  function _syncImageTs(pid, ts) {
    if (ST.productForm && ST.productForm.id === pid) { ST.productForm.image_ts = ts; ST.productForm._noimg = 0; }
    if (ST.productView && ST.productView.id === pid) { ST.productView.image_ts = ts; ST.productView._noimg = 0; }
    for (var i = 0; i < ST.products.items.length; i++) {
      if (ST.products.items[i].id === pid) { ST.products.items[i].image_ts = ts; }
    }
  }

  function chooseProductImage() {
    var f = ST.productForm;
    if (!f) return;
    if (f.id) { _pickImageFile(); return; }
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    if (!f.code) { toast(t("prod.code") + " " + t("common.required"), "error"); return; }
    ST.loading = true;
    saveProductRequest(f).then(function (r) {
      ST.loading = false;
      if (r && r.id) {
        f.id = r.id;
        if (r.rfid_epc) f.rfid_epc = r.rfid_epc;
        ST.productEdit = true;
        loadProducts(true);
        _pickImageFile();
      }
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function _pickImageFile() {
    var el = document.getElementById("product-image-input");
    if (el) { el.value = ""; el.click(); }
  }

  function onProductImageChosen(ev) {
    var file = ev && ev.target && ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.type && file.type.indexOf("image/") !== 0) { toast(t("img.notImage"), "error"); return; }
    if (file.size > 20 * 1024 * 1024) { toast(t("img.tooBig"), "error"); return; }
    var rd = new FileReader();
    rd.onload = function () { openImgCrop(rd.result); };
    rd.readAsDataURL(file);
  }

  function openImgCrop(src) {
    var c = ST.imgCrop;
    c.src = src; c.pid = ST.productForm.id; c.iw = 0; c.ih = 0; c.busy = false;
    ST.sheet = "img-crop";
    var im = new Image();
    im.onload = function () { c.iw = im.naturalWidth; c.ih = im.naturalHeight; resetImgCrop(); };
    im.src = src;
  }

  function closeImgCrop() { ST.sheet = ""; ST.imgCrop.src = ""; ST.imgCrop._drag = false; }

  function _imgFrameSize() {
    var w = Math.min(window.innerWidth - 56, 320);
    if (ST.imgCrop.orient === "portrait") { w = Math.min(w, 250); return { w: w, h: Math.round(w * 4 / 3) }; }
    return { w: w, h: Math.round(w * 3 / 4) };
  }

  function resetImgCrop() {
    var c = ST.imgCrop, fs = _imgFrameSize();
    if (!c.iw || !c.ih) return;
    c.base = Math.max(fs.w / c.iw, fs.h / c.ih);
    c.zoom = 1; c.tx = 0; c.ty = 0;
  }

  function setImgOrient(o) {
    if (ST.imgCrop.orient === o) return;
    ST.imgCrop.orient = o;
    resetImgCrop();
  }

  function cropImgStyle() {
    var c = ST.imgCrop, s = c.base * c.zoom;
    return {
      position: "absolute", left: "50%", top: "50%",
      width: Math.round(c.iw * s) + "px", height: Math.round(c.ih * s) + "px",
      transform: "translate(-50%,-50%) translate(" + c.tx + "px," + c.ty + "px)"
    };
  }

  function _clampPan() {
    var c = ST.imgCrop, fs = _imgFrameSize(), s = c.base * c.zoom;
    var mx = Math.max(0, (c.iw * s - fs.w) / 2);
    var my = Math.max(0, (c.ih * s - fs.h) / 2);
    if (c.tx > mx) c.tx = mx; if (c.tx < -mx) c.tx = -mx;
    if (c.ty > my) c.ty = my; if (c.ty < -my) c.ty = -my;
  }

  function cropPointerDown(ev) {
    var c = ST.imgCrop;
    if (c.busy) return;
    c._drag = true; c._px = ev.clientX; c._py = ev.clientY;
    if (ev.target && ev.target.setPointerCapture && ev.pointerId != null) {
      try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    }
    if (ev.preventDefault) ev.preventDefault();
  }

  function cropPointerMove(ev) {
    var c = ST.imgCrop;
    if (!c._drag || c.busy) return;
    c.tx += ev.clientX - c._px; c.ty += ev.clientY - c._py;
    c._px = ev.clientX; c._py = ev.clientY;
    _clampPan();
    if (ev.preventDefault) ev.preventDefault();
  }

  function cropPointerUp() { ST.imgCrop._drag = false; }

  function cropZoomInput(ev) {
    var v = parseFloat(ev && ev.target && ev.target.value);
    if (isNaN(v)) return;
    ST.imgCrop.zoom = v;
    _clampPan();
  }
  function confirmImgCrop() {
    var c = ST.imgCrop;
    if (c.busy || !c.iw || !c.pid) return;
    var fs = _imgFrameSize(), s = c.base * c.zoom;
    var outW, outH;
    if (fs.w >= fs.h) { outW = IMG_LONG_EDGE; outH = Math.round(IMG_LONG_EDGE * fs.h / fs.w); }
    else { outH = IMG_LONG_EDGE; outW = Math.round(IMG_LONG_EDGE * fs.w / fs.h); }
    var k = outW / fs.w;
    var im = new Image();
    im.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = outW; cv.height = outH;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, outW, outH);
      var dw = c.iw * s * k, dh = c.ih * s * k;
      var dx = (fs.w / 2 + c.tx) * k - dw / 2, dy = (fs.h / 2 + c.ty) * k - dh / 2;
      ctx.drawImage(im, dx, dy, dw, dh);
      var data = cv.toDataURL("image/jpeg", IMG_QUALITY);
      c.busy = true;
      api("PUT", "/api/products/" + c.pid + "/image", { data: data }).then(function () {
        c.busy = false;
        _syncImageTs(c.pid, Date.now());
        closeImgCrop();
        toast(t("img.saved"));
      }).catch(function (e) { c.busy = false; toast(e.message, "error"); });
    };
    im.onerror = function () { toast(t("img.notImage"), "error"); };
    im.src = c.src;
  }

  function removeProductImage() {
    var f = ST.productForm;
    if (!f || !f.id) return;
    if (!confirm(t("img.removeCf"))) return;
    api("DELETE", "/api/products/" + f.id + "/image").then(function () {
      _syncImageTs(f.id, Date.now());
      if (ST.productForm && ST.productForm.id === f.id) ST.productForm._noimg = 1;
      if (ST.productView && ST.productView.id === f.id) ST.productView._noimg = 1;
      toast(t("img.removed"));
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- Excel 批量导入 ----------------
  function _authHeaders() {
    var h = {};
    if (ST.token) h["Authorization"] = "Bearer " + ST.token;
    return h;
  }

  function openImportDlg() {
    ST.importDlg = { file: null, busy: false, result: null };
    ST.sheet = "import";
  }

  function closeImportDlg() { ST.sheet = ""; ST.importDlg = { file: null, busy: false, result: null }; }

  function onImportFile(ev) {
    var f = ev && ev.target && ev.target.files && ev.target.files[0];
    ST.importDlg.file = f || null; ST.importDlg.result = null;
  }

  function downloadImportTpl() {
    fetch(API + "/api/products/import-template", { headers: _authHeaders() }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "products_template.xlsx";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function submitImportXlsx() {
    var d = ST.importDlg;
    if (!d || d.busy || !d.file) return;
    d.busy = true; d.result = null;
    var fd = new FormData();
    fd.append("file", d.file);
    fetch(API + "/api/products/import-xlsx", { method: "POST", headers: _authHeaders(), body: fd }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error(j && j.detail ? j.detail : ("HTTP " + r.status));
        return j;
      });
    }).then(function (j) {
      d.busy = false; d.result = j; d.file = null;
      var inp = document.getElementById("import-file-input");
      if (inp) inp.value = "";
      if (j && j.created) loadProducts(true);
    }).catch(function (e) { d.busy = false; d.result = { fail: true, message: e.message }; });
  }
  // ---------------- inventory ----------------
  function loadInventory() {
    ST.loading = true;
    api("GET", "/api/inventory/summary").then(function (d) { ST.inventory = d; }).catch(function () {});
    api("GET", "/api/inventory/locked-items").then(function (d) { ST.lockedItems = d.items || []; }).catch(function () {})
      .then(function () { ST.loading = false; });
  }

  function blankInbound() {
    return { code: "", name: "", category: "", material: "", weight: "", size: "", cert: "", cost: "", price: "", rfid_epc: "" };
  }

  function inboundForm() {
    if (isHqView()) { toast("总部视图不进行入库，请切换到具体门店操作", "error"); return; }
    ST.productForm = blankInbound(); ST.productEdit = false; openSub("inbound");
  }

  function submitInbound() {
    var f = ST.productForm;
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    ST.loading = true;
    api("POST", "/api/inventory/inbound", {
      code: f.code, name: f.name, category: f.category, material: f.material,
      weight: f.weight === "" ? "" : f.weight, size: f.size, cert: f.cert,
      cost: f.cost === "" ? null : f.cost, price: f.price === "" ? null : f.price, rfid_epc: f.rfid_epc,
      biz_date: todayStr()
    }).then(function () {
      ST.loading = false; toast(t("inv.inboundOk")); closeSub(); openSub("inventory");
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  // ---------------- sales ----------------
  function loadSales() {
    ST.loading = true;
    api("GET", "/api/sales?page=" + ST.sales.page + "&size=" + ST.sales.size).then(function (d) {
      ST.loading = false; ST.sales.total = d.total || 0; ST.sales.items = d.items || [];
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function prepareSale() {
    ST.saleItems = [];
    ST.saleForm = { customer: "", phone: "", paid: "", method: "现金", discount: "0", biz_date: todayStr() };
  }

  function saleTotal() {
    var s = 0;
    for (var i = 0; i < ST.saleItems.length; i++) s += num(ST.saleItems[i].price);
    return s;
  }

  function saleReceivable() { return Math.max(0, saleTotal() - num(ST.saleForm.discount)); }
  function saleDue() { return Math.max(0, saleReceivable() - num(ST.saleForm.paid)); }

  function openPicker(mode) {
    ST.pickMode = mode; ST.sheet = "pick"; ST.pickLoading = true;
    api("GET", "/api/products/options?status=" + encodeURIComponent(mode === "deposit" ? "在库" : "在库")).then(function (d) {
      ST.pickLoading = false; ST.pickOptions = d.items || [];
    }).catch(function () { ST.pickLoading = false; });
  }

  function pickProduct(p) {
    if (ST.pickMode === "deposit") {
      ST.depForm.product_id = p.id; ST.depForm.product = p.name;
      ST.depForm.total = p.price == null ? "" : p.price;
      ST.sheet = "";
      return;
    }
    for (var i = 0; i < ST.saleItems.length; i++) if (ST.saleItems[i].product_id === p.id) { ST.sheet = ""; return; }
    ST.saleItems.push({ product_id: p.id, code: p.code, name: p.name, price: p.price == null ? 0 : num(p.price), weight: p.weight });
    ST.sheet = "";
  }

  function removeSaleItem(i) { ST.saleItems.splice(i, 1); }

  function createSale() {
    if (!ST.saleItems.length) { toast(t("sale.pickTip"), "error"); return; }
    var f = ST.saleForm;
    var payable = saleReceivable();
    var paid = num(f.paid);
    var body = {
      customer: f.customer, phone: f.phone, discount: num(f.discount), biz_date: f.biz_date,
      items: ST.saleItems.map(function (it) { return { product_id: it.product_id, code: it.code, price: it.price }; }),
      payments: [{ method: f.method, amount: paid }]
    };
    ST.loading = true;
    api("POST", "/api/sales", body).then(function () {
      ST.loading = false; toast(t("sale.ok")); closeSub(); loadSales();
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function voidSale(id) {
    if (!confirm(t("msg.confirmVoid"))) return;
    api("POST", "/api/sales/" + id + "/void", {}).then(function () {
      toast(t("sale.voidOk")); loadSales();
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- deposits ----------------
  function loadDeposits() {
    ST.loading = true;
    api("GET", "/api/deposits?page=" + ST.deposits.page + "&size=" + ST.deposits.size).then(function (d) {
      ST.loading = false; ST.deposits.total = d.total || 0; ST.deposits.items = d.items || [];
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function prepareDeposit() {
    ST.depForm = { customer: "", phone: "", product_id: 0, product: "", total: "", deposit: "", promised_date: todayStr(), reminder_days: 7 };
  }

  function depBalance() { return Math.max(0, num(ST.depForm.total) - num(ST.depForm.deposit)); }

  function createDeposit() {
    var f = ST.depForm;
    if (!f.customer) { toast(t("msg.required"), "error"); return; }
    ST.loading = true;
    api("POST", "/api/deposits", {
      customer: f.customer, phone: f.phone, product_id: f.product_id || null, product: f.product,
      total: num(f.total), deposit: num(f.deposit), balance: depBalance(),
      promised_date: f.promised_date, reminder_days: num(f.reminder_days)
    }).then(function () {
      ST.loading = false; toast(t("dep.ok")); closeSub(); loadDeposits();
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function payDeposit(id) {
    api("POST", "/api/deposits/" + id + "/pay", {}).then(function () {
      toast(t("dep.payOk")); loadDeposits();
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function voidDeposit(id) {
    if (!confirm(t("msg.confirmVoid"))) return;
    api("POST", "/api/deposits/" + id + "/void", {}).then(function () {
      toast(t("dep.voidOk")); loadDeposits();
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- customers ----------------
  function loadCustomers(reset) {
    if (reset) { ST.customers.page = 1; ST.customers.items = []; }
    ST.loading = true;
    var q = "?page=" + ST.customers.page + "&size=" + ST.customers.size;
    if (ST.customers.q) q += "&keyword=" + encodeURIComponent(ST.customers.q);
    api("GET", "/api/customers/list" + q).then(function (d) {
      ST.loading = false; ST.customers.total = d.total || 0;
      ST.customers.items = reset ? (d.items || []) : ST.customers.items.concat(d.items || []);
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  function loadMoreCustomers() {
    if (ST.customers.items.length >= ST.customers.total) return;
    ST.customers.page += 1; loadCustomers(false);
  }

  function viewCustomer(id) {
    api("GET", "/api/customers/" + id + "/detail").then(function (d) {
      ST.custDetail = d; openSub("cust-view");
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function blankCustomer() {
    return { id: 0, name: "", phone: "", email: "", level: "普通", birthday: "", anniversary: "", preference: "",
      address: "", city: "", zip_code: "", country: "", source: "", note: "",
      phones: [{ phone: "", label: "" }] };  // 多手机号：首行为默认号
  }
  function newCustomer() { ST.custForm = blankCustomer(); openSub("cust-edit"); }
  function editCustomer() {
    var c = ST.custDetail; if (!c) return;
    var phones = (c.phones && c.phones.length)
      ? c.phones.map(function (p) { return { phone: p.phone || "", label: p.label || "" }; })
      : [{ phone: c.phone || "", label: "" }];
    ST.custForm = { id: c.id, name: c.name || "", phone: c.phone || "", email: c.email || "", level: c.level || "普通",
      birthday: c.birthday || "", anniversary: c.anniversary || "", preference: c.preference || "",
      address: c.address || "", city: c.city || "", zip_code: c.zip_code || "", country: c.country || "",
      source: c.source || "", note: c.note || "", phones: phones };
    openSub("cust-edit");
  }
  function addCustPhone() { var f = ST.custForm; if (!f.phones) f.phones = []; f.phones.push({ phone: "", label: "" }); }
  function delCustPhone(i) {
    var f = ST.custForm;
    if (f.phones && f.phones.length > 1) f.phones.splice(i, 1);
    else if (f.phones) f.phones[0] = { phone: "", label: "" };
  }
  function saveCustomer() {
    var f = ST.custForm;
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    f.phones = (f.phones || []).filter(function (p) { return (p.phone || "").trim(); })
      .map(function (p) { return { phone: (p.phone || "").trim(), label: (p.label || "").trim() }; });
    f.phone = (f.phone || "").trim() || (f.phones[0] ? f.phones[0].phone : "");
    ST.loading = true;
    var req = f.id ? api("PUT", "/api/customers/" + f.id, f) : api("POST", "/api/customers", f);
    req.then(function () {
      ST.loading = false; toast(t("cust.saveOk")); loadCustomers(true);
      if (f.id) closeSub(); else closeSub();
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  // ---------------- loans ----------------
  function loadLoans() {
    ST.loading = true;
    api("GET", "/api/loans?page=1&size=50").then(function (d) {
      ST.loading = false; ST.loans.items = d.items || [];
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  function newLoan() { ST.form = { direction: "out", product: "", party: "", qty: 1, loan_date: todayStr(), due_date: todayStr() }; openSub("loan-new"); }
  function createLoan() {
    var f = ST.form;
    if (!f.product || !f.party) { toast(t("msg.required"), "error"); return; }
    api("POST", "/api/loans", f).then(function () { toast(t("common.save")); closeSub(); loadLoans(); })
      .catch(function (e) { toast(e.message, "error"); });
  }
  function returnLoan(id) { api("POST", "/api/loans/" + id + "/return", {}).then(function () { toast(t("loan.returnOk")); loadLoans(); }).catch(function (e) { toast(e.message, "error"); }); }

  // ---------------- repairs ----------------
  function loadRepairs() {
    ST.loading = true;
    api("GET", "/api/repairs?page=1&size=50").then(function (d) { ST.loading = false; ST.repairs.items = d.items || []; })
      .catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  function newRepair() { ST.form = { customer: "", phone: "", item: "", issue: "", est_fee: "", promised_date: todayStr(), status: "待维修", technician: "" }; openSub("repair-new"); }
  function createRepair() {
    var f = ST.form;
    if (!f.customer || !f.item) { toast(t("msg.required"), "error"); return; }
    api("POST", "/api/repairs", f).then(function () { toast(t("rep.saveOk")); closeSub(); loadRepairs(); })
      .catch(function (e) { toast(e.message, "error"); });
  }
  function repairEdit(r) { ST.form = Object.assign({}, r); openSub("repair-new"); }
  function saveRepair() {
    var f = ST.form;
    api("PUT", "/api/repairs/" + f.id, f).then(function () { toast(t("rep.saveOk")); closeSub(); loadRepairs(); })
      .catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- purchases ----------------
  function loadPurchases() {
    ST.loading = true;
    api("GET", "/api/purchases?page=1&size=50").then(function (d) { ST.loading = false; ST.purchases.items = d.items || []; })
      .catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  function newPurchase() { ST.form = { supplier: "", product: "", qty: 1, cost: "", order_date: todayStr(), expected_date: todayStr(), status: "待发货", paid: 0 }; openSub("purchase-new"); }
  function createPurchase() {
    var f = ST.form;
    if (!f.supplier || !f.product) { toast(t("msg.required"), "error"); return; }
    api("POST", "/api/purchases", f).then(function () { toast(t("common.save")); closeSub(); loadPurchases(); })
      .catch(function (e) { toast(e.message, "error"); });
  }
  function receivePurchase(id) { api("POST", "/api/purchases/" + id + "/receive", {}).then(function () { toast(t("pur.receiveOk")); loadPurchases(); }).catch(function (e) { toast(e.message, "error"); }); }

  // ---------------- outsourcings ----------------
  function loadOutsourcings() {
    ST.loading = true;
    api("GET", "/api/outsourcings?page=1&size=50").then(function (d) { ST.loading = false; ST.outsourcings.items = d.items || []; })
      .catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  function newOutsourcing() { ST.form = { factory: "", product: "", material: "", weight: "", gold_price: "", labor_fee: "", send_date: todayStr(), expected_date: todayStr(), status: "加工中" }; openSub("outsource-new"); }
  function createOutsourcing() {
    var f = ST.form;
    if (!f.factory || !f.product) { toast(t("msg.required"), "error"); return; }
    api("POST", "/api/outsourcings", f).then(function () { toast(t("common.save")); closeSub(); loadOutsourcings(); })
      .catch(function (e) { toast(e.message, "error"); });
  }
  function receiveOutsourcing(id) { api("POST", "/api/outsourcings/" + id + "/receive", {}).then(function () { toast(t("out.receiveOk")); loadOutsourcings(); }).catch(function (e) { toast(e.message, "error"); }); }

  // ---------------- appointments ----------------
  function loadAppointments() {
    ST.loading = true;
    api("GET", "/api/appointments").then(function (d) { ST.loading = false; ST.appointments = d.items || []; })
      .catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }
  function setAppt(id, status) { api("PUT", "/api/appointments/" + id, { status: status }).then(function () { toast(t("common.save")); loadAppointments(); }).catch(function (e) { toast(e.message, "error"); }); }

  // ---------------- logs ----------------
  function loadLogs() {
    ST.loading = true;
    api("GET", "/api/logs?page=" + ST.logs.page + "&size=" + ST.logs.size).then(function (d) {
      ST.loading = false; ST.logs.total = d.total || 0; ST.logs.items = d.items || [];
    }).catch(function (e) { ST.loading = false; toast(e.message, "error"); });
  }

  // ---------------- profile ----------------
  function loadProfile() {
    api("GET", "/api/profile").then(function (d) { ST.profile = d; }).catch(function (e) { toast(e.message, "error"); });
  }
  // ---------------- 功能介绍（渲染 docs/软件功能介绍.md） ----------------
  function loadDocs() {
    api("GET", "/api/docs/features").then(function (r) {
      ST.docs = renderMd((r && r.content) || "");
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function renderMd(text) {
    var lines = (text || "").split("\n");
    var html = [];
    var inUl = false, inOl = false, inTable = false;
    function closeLists() { if (inUl) { html.push("</ul>"); inUl = false; } if (inOl) { html.push("</ol>"); inOl = false; } }
    function closeTable() { if (inTable) { html.push("</tbody></table>"); inTable = false; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], t = line.replace(/\s+$/, "");
      if (!t.trim()) { closeLists(); closeTable(); continue; }
      var m;
      if ((m = t.match(/^#{1,6}\s+(.*)$/))) {
        closeLists(); closeTable();
        var lv = (t.match(/^#+/)[0]).length;
        html.push("<h" + lv + ">" + escInl(m[1]) + "</h" + lv + ">");
      } else if ((m = t.match(/^>\s?(.*)$/))) {
        closeLists(); closeTable();
        html.push("<blockquote>" + escInl(m[1]) + "</blockquote>");
      } else if (/^\|.*\|$/.test(t)) {
        closeLists();
        if (!inTable) { html.push("<table><tbody>"); inTable = true; }
        var cells = t.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        var isSep = cells.every(function (c) { return /^:?-+:?$/.test(c); });
        if (isSep) continue;
        html.push("<tr>" + cells.map(function (c) { return "<td>" + escInl(c) + "</td>"; }).join("") + "</tr>");
      } else if ((m = t.match(/^[-*]\s+(.*)$/))) {
        closeTable();
        if (!inUl) { html.push("<ul>"); inUl = true; }
        html.push("<li>" + escInl(m[1]) + "</li>");
      } else if ((m = t.match(/^\d+\.\s+(.*)$/))) {
        closeTable();
        if (!inOl) { html.push("<ol>"); inOl = true; }
        html.push("<li>" + escInl(m[1]) + "</li>");
      } else {
        closeLists(); closeTable();
        html.push("<p>" + escInl(t) + "</p>");
      }
    }
    closeLists(); closeTable();
    return html.join("");
  }
  function escInl(s) {
    var d = document.createElement("div"); d.textContent = s;
    return d.innerHTML.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
  function saveProfile() {
    var p = ST.profile; if (!p) return;
    api("PUT", "/api/profile", {
      name: p.name, short_name: p.short_name, slogan: p.slogan, intro: p.intro,
      contact: p.contact, phone: p.phone, address: p.address, hours: p.hours,
      categories: p.categories, published: p.published ? 1 : 0,
      showcase_title: p.showcase_title, showcase_subtitle: p.showcase_subtitle
    }).then(function () { toast(t("store.saveOk")); closeSub(); }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- 总部管理（手机端 5 子页） ----------------
  var HQ_LANGS = ["en", "it", "ja", "ko", "zhHant"];
  var HQ_I18N_FIELDS = ["name", "slogan", "intro", "hours", "address", "showcase_title", "showcase_subtitle", "categories"];

  function siteHref() { return (window.__APP_BASE__ || "") + "/site"; }
  function switchHqTab(k) { ST.hqTab = k; loadHqTab(); }
  function loadHqTab() {
    var k = ST.hqTab;
    if (k === "info" || k === "promo") loadHqProfile();
    else if (k === "branches") { loadShops(); loadHqStores(); }
    else if (k === "types") { loadProductTypes(); loadLabelTemplates(); }
    else if (k === "categories") { loadTagGroups(); loadTags(); }
    else if (k === "locations") { loadHqStores(); loadLocations(); }
    else if (k === "clerk") { loadClerkTypes(); }
    else if (k === "users") { if (!isAdminRole()) return; loadHqStores(); loadAdminUsers(); }
  }
  function loadHqProfile() {
    api("GET", "/api/profile").then(function (d) {
      ST.profile = d || {};
      var m = {};
      try { m = (d && d.i18n) ? JSON.parse(d.i18n) : {}; } catch (e) { m = {}; }
      ST.profI18n = m || {};
      if (!ST.profLang) ST.profLang = "en";
      openProfLang(ST.profLang);
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function hqLangName(l) { return (window.LANG_LABELS || {})[l] || l; }
  function hqLangFilled(lang) {
    var v = (ST.profI18n || {})[lang] || {};
    for (var i = 0; i < HQ_I18N_FIELDS.length; i++) {
      var x = v[HQ_I18N_FIELDS[i]];
      if (x && String(x).trim()) return true;
    }
    return false;
  }
  function flushProfEdit() {
    if (!ST.profLang) return;
    var m = ST.profI18n || {}, one = {}, i, k, v, has = false;
    for (i = 0; i < HQ_I18N_FIELDS.length; i++) {
      k = HQ_I18N_FIELDS[i]; v = (ST.profEdit || {})[k];
      if (v && String(v).trim()) { one[k] = String(v).trim(); has = true; }
    }
    if (has) m[ST.profLang] = one; else delete m[ST.profLang];
    ST.profI18n = m;
  }
  function openProfLang(lang) {
    if (ST.profLang && lang !== ST.profLang) flushProfEdit();
    ST.profLang = lang;
    var src = (ST.profI18n || {})[lang] || {}, ed = {};
    for (var i = 0; i < HQ_I18N_FIELDS.length; i++) { var k = HQ_I18N_FIELDS[i]; ed[k] = src[k] || ""; }
    ST.profEdit = ed;
  }
  function saveHqProfile() {
    var p = ST.profile; if (!p) return;
    flushProfEdit();
    api("PUT", "/api/profile", {
      name: p.name || "", short_name: p.short_name || "", slogan: p.slogan || "",
      intro: p.intro || "", contact: p.contact || "", phone: p.phone || "",
      address: p.address || "", hours: p.hours || "", categories: p.categories || "",
      published: p.published ? 1 : 0, showcase_title: p.showcase_title || "",
      showcase_subtitle: p.showcase_subtitle || "",
      i18n: JSON.stringify(ST.profI18n || {})
    }).then(function () { toast(t("store.saveOk")); }).catch(function (e) { toast(e.message, "error"); });
  }

  // 分店管理
  function loadShops() { api("GET", "/api/shops").then(function (r) { ST.shops = r || []; }).catch(function () {}); }
  function loadHqStores() { api("GET", "/api/stores?all=1&detail=1").then(function (r) { ST.hqStores = r || []; }).catch(function () {}); }
  function storesByShop(shopId) {
    var out = [];
    for (var i = 0; i < ST.hqStores.length; i++) { if ((ST.hqStores[i].shop_id || 0) === shopId) out.push(ST.hqStores[i]); }
    return out;
  }
  function createStore() { ST.storeEditMode = "new"; ST.storeEdit = { id: 0, name: "", code: "", owner: "", shop_id: (ST.shops[0] && ST.shops[0].id) || 0 }; }
  function editStore(s) { ST.storeEditMode = "edit"; ST.storeEdit = { id: s.id, name: s.name, code: s.code || "", owner: s.owner || "", shop_id: s.shop_id || 0 }; }
  function resetStoreEdit() { ST.storeEditMode = ""; ST.storeEdit = { id: 0, name: "", code: "", owner: "", shop_id: 0 }; }
  function saveStore() {
    var d = ST.storeEdit;
    if (!d.name || !d.name.trim()) { toast(t("shop.storeNameReq"), "error"); return; }
    // 门店编号由后端自动生成（0001 起）且不可修改，前端不提交 code
    var payload = { name: d.name.trim(), owner: (d.owner || "").trim(), shop_id: d.shop_id || 0 };
    var req = d.id ? api("PUT", "/api/stores/" + d.id, payload) : api("POST", "/api/stores", payload);
    req.then(function () { toast(t("store.saveOk")); resetStoreEdit(); loadShops(); loadHqStores(); }).catch(function (e) { toast(e.message, "error"); });
  }

  // 品类管理
  function loadProductTypes() { api("GET", "/api/product-types").then(function (r) { ST.productTypes = r || []; }).catch(function () {}); }
  function loadLabelTemplates() { api("GET", "/api/label-templates").then(function (r) { ST.labelTemplates = (r && r.list) || []; }).catch(function () {}); }
  function typeName(o) { var n = (o && o.names) || {}; return n.zh || n.en || (o && o.code) || ""; }
  function typeGroupOptions() {
    var seen = { "主播希川": true, "古董款": true, "专柜款": true }, out = ["主播希川", "古董款", "专柜款"];
    (ST.productTypes || []).forEach(function (o) { var g = o.group_name || ""; if (g && !seen[g]) { seen[g] = true; out.push(g); } });
    return out;
  }
  function resetTypeEdit() { ST.typeEdit = { code: "", names: { zh: "", en: "", it: "" }, sort_order: (ST.productTypes || []).length + 1, pricing_mode: "piece", group_name: "主播希川" }; ST.typeEditMode = "new";
    setTimeout(function () { var el = document.getElementById("type-edit-form"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); }
  function editType(o) { ST.typeEditMode = "edit"; ST.typeEdit = { code: o.code, names: { zh: (o.names && o.names.zh) || "", en: (o.names && o.names.en) || "", it: (o.names && o.names.it) || "" }, sort_order: o.sort_order || 0, pricing_mode: o.pricing_mode === "weight" ? "weight" : "piece", group_name: o.group_name || "主播希川" };
    setTimeout(function () { var el = document.getElementById("type-edit-form"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); }
  function saveType() {
    var e = ST.typeEdit;
    if (!e.code || !e.code.trim()) { toast(t("common.required"), "error"); return; }
    if (!(e.names.zh || e.names.en)) { toast(t("common.required"), "error"); return; }
    var body = { code: e.code.trim(), names: { zh: e.names.zh || "", en: e.names.en || "", it: e.names.it || "" }, sort_order: Number(e.sort_order) || 0, pricing_mode: e.pricing_mode === "weight" ? "weight" : "piece", group_name: (e.group_name || "主播希川").trim() };
    var method = ST.typeEditMode === "edit" ? "PUT" : "POST";
    var url = ST.typeEditMode === "edit" ? "/api/product-types/" + e.code : "/api/product-types";
    api(method, url, body).then(function () { toast(t("store.saveOk")); resetTypeEdit(); loadProductTypes(); }).catch(function (er) { toast(er.message, "error"); });
  }
  function delType(code) {
    if (!confirm(t("msg.confirmDelete") + " " + code)) return;
    api("DELETE", "/api/product-types/" + code).then(function () { toast(t("store.saveOk")); loadProductTypes(); }).catch(function (e) { toast(e.message, "error"); });
  }

  // 分类管理（一级 tag_groups / 二级 product_tags）
  function loadTagGroups() { api("GET", "/api/tag-groups").then(function (r) { ST.tagGroups = (r && r.list) || []; }).catch(function () {}); }
  function filteredTags() {
    var out = [], list = ST.tagList || [], f = ST.tagFilter;
    for (var i = 0; i < list.length; i++) { if (!f || (list[i].group_name || "") === f) out.push(list[i]); }
    return out;
  }
  function setTagFilter(name) { ST.tagFilter = name || ""; }
  function resetTagGroupEdit() { ST.tagGroupEdit = { id: 0, name: "", sort_order: (ST.tagGroups || []).length + 1 }; ST.tagGroupEditMode = "new"; }
  function addTagGroup() { resetTagGroupEdit(); }
  function editTagGroup(g) { ST.tagGroupEditMode = "edit"; ST.tagGroupEdit = { id: g.id, name: g.name || "", sort_order: g.sort_order || 0 }; }
  function saveTagGroup() {
    var g = ST.tagGroupEdit;
    if (!g.name || !g.name.trim()) { toast(t("tagGroup.nameRequired"), "error"); return; }
    var body = { name: g.name.trim(), sort_order: Number(g.sort_order) || 0 };
    var method = ST.tagGroupEditMode === "edit" ? "PUT" : "POST";
    var url = ST.tagGroupEditMode === "edit" ? "/api/tag-groups/" + g.id : "/api/tag-groups";
    api(method, url, body).then(function () { toast(t("store.saveOk")); resetTagGroupEdit(); loadTagGroups(); loadTags(); }).catch(function (e) { toast(e.message, "error"); });
  }
  function delTagGroup(g) {
    if (!confirm(t("tagGroup.delConfirm", { n: g.name }))) return;
    api("DELETE", "/api/tag-groups/" + g.id).then(function (r) {
      toast(t("store.saveOk") + (r && r.unlinked ? " · " + t("tagGroup.unlinked", { n: r.unlinked }) : ""));
      if (ST.tagFilter === g.name) ST.tagFilter = "";
      loadTagGroups(); loadTags();
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function resetTagEdit() { ST.tagEdit = { id: 0, name: "", color: "#C9A227", sort_order: (ST.tagList || []).length + 1, group_name: "" }; ST.tagEditMode = "new"; }
  function editTag(o) { ST.tagEditMode = "edit"; ST.tagEdit = { id: o.id, name: o.name || "", color: o.color || "#C9A227", sort_order: o.sort_order || 0, group_name: o.group_name || "" }; }
  function saveTag() {
    var e = ST.tagEdit;
    if (!e.name || !e.name.trim()) { toast(t("tag.nameRequired"), "error"); return; }
    var body = { name: e.name.trim(), color: e.color || "", sort_order: Number(e.sort_order) || 0, group_name: (e.group_name || "").trim() };
    var method = ST.tagEditMode === "edit" ? "PUT" : "POST";
    var url = ST.tagEditMode === "edit" ? "/api/product-tags/" + e.id : "/api/product-tags";
    api(method, url, body).then(function () { toast(t("store.saveOk")); resetTagEdit(); loadTags(); }).catch(function (er) { toast(er.message, "error"); });
  }
  function delTag(o) {
    if (!confirm(t("tag.delConfirm", { n: o.used_count || 0 }))) return;
    api("DELETE", "/api/product-tags/" + o.id).then(function (r) {
      toast(t("store.saveOk") + (r && r.unlinked ? " · " + t("tag.unlinked", { n: r.unlinked }) : ""));
      loadTags();
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- 库位管理（门店下扁平库位） ----------------
  function loadLocations() {
    api("GET", "/api/locations").then(function (r) { ST.locations = r || []; }).catch(function () {});
  }
  function locsOfStore(sid) {
    var out = [];
    for (var i = 0; i < ST.locations.length; i++) {
      if (ST.locations[i].store_id === sid) out.push(ST.locations[i]);
    }
    out.sort(function (a, b) { return (a.sort_order - b.sort_order) || (a.id - b.id); });
    return out;
  }
  function onLocStoreChange() {
    if (ST.locEditMode === "new") ST.locEdit.store_id = ST.locStore;
  }
  function resetLocEdit() {
    ST.locEditMode = "new";
    ST.locEdit = { id: 0, store_id: ST.locStore || (ST.hqStores[0] && ST.hqStores[0].id) || 0, code: "", name: "", sort_order: 0, active: 1 };
  }
  function addLocForCur() {
    if (!ST.locStore) { toast(t("loc.needStore"), "error"); return; }
    ST.locEditMode = "new";
    ST.locEdit = { id: 0, store_id: ST.locStore, code: "", name: "", sort_order: 0, active: 1 };
  }
  function editLoc(o) {
    ST.locEditMode = "edit";
    ST.locEdit = { id: o.id, store_id: o.store_id, code: o.code, name: o.name, sort_order: o.sort_order || 0, active: o.active ? 1 : 0 };
  }
  function saveLoc() {
    var e = ST.locEdit;
    if (ST.locEditMode === "new") { e.id = 0; if (!e.store_id) e.store_id = ST.locStore; }
    if (!e.store_id) { toast(t("loc.needStore"), "error"); return; }
    if (!e.code.trim() || !e.name.trim()) { toast(t("loc.needFields"), "error"); return; }
    var body = { store_id: e.store_id, code: e.code.trim(), name: e.name.trim(), sort_order: Number(e.sort_order) || 0, active: e.active ? 1 : 0 };
    var req = ST.locEditMode === "edit"
      ? api("PUT", "/api/locations/" + e.id, body)
      : api("POST", "/api/locations", body);
    req.then(function () { toast(t("store.saveOk")); resetLocEdit(); loadLocations(); })
      .catch(function (err) { toast(err.message, "error"); });
  }
  function delLoc(o) {
    if (!confirm(t("loc.delConfirm", { code: o.code }))) return;
    api("DELETE", "/api/locations/" + o.id).then(function () {
      toast(t("store.saveOk")); loadLocations();
    }).catch(function (err) { toast(err.message, "error"); });
  }
  function toggleLoc(o) {
    api("PUT", "/api/locations/" + o.id,
      { store_id: o.store_id, code: o.code, name: o.name, sort_order: o.sort_order || 0, active: o.active ? 0 : 1 })
      .then(function () { toast(t("store.saveOk")); loadLocations(); })
      .catch(function (err) { toast(err.message, "error"); });
  }

  // ---------------- 用户与门店授权（管理员/高管/系统管理员） ----------------
  function isSysAdmin() { return !!(ST.user && ST.user.role === "SYS_ADMIN"); }
  function canManageUsers() {
    var r = ST.user && ST.user.role;
    return r === "SYS_ADMIN" || r === "TENANT_ADMIN" || r === "EXECUTIVE";
  }
  function isAdminRole() { return canManageUsers(); } // 兼容旧调用
  function roleText(role) {
    if (role === "SYS_ADMIN") return t("pf.roleSysAdmin");
    if (role === "TENANT_ADMIN") return t("pf.roleAdmin");
    if (role === "EXECUTIVE") return t("pf.roleExec");
    return t("pf.roleClerk");
  }
  // 当前账号可指派的角色矩阵（与电脑端一致）
  function assignableRoles() {
    var r = ST.user && ST.user.role;
    if (r === "SYS_ADMIN") return ["SYS_ADMIN", "EXECUTIVE", "TENANT_ADMIN", "EMPLOYEE"];
    if (r === "TENANT_ADMIN") return ["EXECUTIVE", "TENANT_ADMIN", "EMPLOYEE"];
    if (r === "EXECUTIVE") return ["TENANT_ADMIN", "EMPLOYEE"];
    return [];
  }
  function loadAdminUsers() {
    api("GET", "/api/admin/users").then(function (r) { ST.adminUsers = r.items || []; })
      .catch(function (e) { toast(e.message, "error"); });
  }
  // 勾选/取消某店员的门店授权（立即全量保存）
  function toggleUserStore(u, sid) {
    var ids = (u.store_ids || []).slice();
    var i = ids.indexOf(sid);
    if (i >= 0) ids.splice(i, 1); else ids.push(sid);
    api("PUT", "/api/admin/users/" + u.id + "/stores", { store_ids: ids }).then(function (r) {
      u.store_ids = r.store_ids;
      toast(t("store.saveOk"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function openUserCreate() {
    ST.adminUserOpen = true;
    ST.adminUserForm = { id: 0, username: "", display_name: "", password: "", role: "EMPLOYEE", can_view_cost: false };
  }
  function openUserEdit(u) {
    ST.adminUserOpen = true;
    ST.adminUserForm = { id: u.id, username: u.username, display_name: u.display_name, password: "", role: u.role, can_view_cost: !!u.can_view_cost };
  }
  function closeUserForm() { ST.adminUserOpen = false; }
  function saveAdminUser() {
    var f = ST.adminUserForm, req;
    if (!f.id) {
      if (!f.username.trim() || !f.password) { toast(t("adminUser.fieldsReq"), "error"); return; }
      req = api("POST", "/api/admin/users", {
        username: f.username.trim(), display_name: f.display_name.trim(),
        password: f.password, role: f.role, can_view_cost: !!f.can_view_cost
      });
    } else {
      req = api("PUT", "/api/admin/users/" + f.id, {
        username: f.username, display_name: f.display_name.trim(),
        password: f.password, role: f.role, can_view_cost: !!f.can_view_cost
      });
    }
    req.then(function () {
      toast(t("store.saveOk")); ST.adminUserOpen = false; loadAdminUsers();
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function delAdminUser(u) {
    if (!confirm(t("adminUser.delConfirm", { name: u.display_name || u.username }))) return;
    api("DELETE", "/api/admin/users/" + u.id).then(function () {
      toast(t("store.saveOk")); loadAdminUsers();
    }).catch(function (e) { toast(e.message, "error"); });
  }

  // ---------------- 经办人类别（店员/主播/代理…） ----------------
  function loadClerkTypes() {
    api("GET", "/api/clerk-types").then(function (r) { ST.clerkTypes = r || []; }).catch(function () {});
  }
  function resetClerkEdit() {
    ST.clerkEditMode = "new";
    ST.clerkEdit = { id: 0, name: "", sort_order: ST.clerkTypes.length ? ST.clerkTypes.length + 1 : 1 };
  }
  function editClerk(o) {
    ST.clerkEditMode = "edit";
    ST.clerkEdit = { id: o.id, name: o.name, sort_order: o.sort_order || 0 };
  }
  function saveClerk() {
    var e = ST.clerkEdit;
    if (!e.name.trim()) { toast(t("clerk.needName"), "error"); return; }
    var body = { name: e.name.trim(), sort_order: Number(e.sort_order) || 0 };
    var req = ST.clerkEditMode === "edit"
      ? api("PUT", "/api/clerk-types/" + e.id, body)
      : api("POST", "/api/clerk-types", body);
    req.then(function () { toast(t("store.saveOk")); resetClerkEdit(); loadClerkTypes(); })
      .catch(function (err) { toast(err.message, "error"); });
  }
  function toggleClerk(o) {
    api("PUT", "/api/clerk-types/" + o.id,
      { name: o.name, sort_order: o.sort_order || 0, active: o.active ? 0 : 1 })
      .then(function () { toast(t("store.saveOk")); loadClerkTypes(); })
      .catch(function (err) { toast(err.message, "error"); });
  }

  // ---------------- 设备管理 ----------------
  // 打印业务固定枚举镜像（与 db.py PRINT_BIZ 一致）：[code, 分组]
  var PRINT_BIZ = [
    ["label_product", "label"], ["label_shelf", "label"],
    ["receipt_sale", "receipt"], ["receipt_deposit", "receipt"], ["receipt_loan", "receipt"],
    ["receipt_repair", "receipt"], ["receipt_purchase", "receipt"],
    ["receipt_outsourcing", "receipt"], ["receipt_inout", "receipt"],
    ["cert_warranty", "doc"], ["report_stocktake", "doc"], ["report_business", "doc"]
  ];
  function devBizGroups() {
    return ["label", "receipt", "doc"].map(function (g) {
      return {
        group: g,
        items: PRINT_BIZ.filter(function (x) { return x[1] === g; }).map(function (x) { return x[0]; })
      };
    });
  }
  // 协同任务类型 → 多语言功能名（与电脑端 COOP_NAME_KEYS 一致）
  var DEV_COOP_KEYS = {
    stocktake: "co.name.stocktake", sale: "co.name.sale", loan: "co.name.loan",
    transfer_out: "co.name.transferOut", transfer_in: "co.name.transferIn",
    epc_product: "co.name.epcProduct", epc_inbound: "co.name.epcInbound",
    generic: "co.name.generic", deposit: "co.name.deposit"
  };
  // 设备当前任务的「功能名 #序号」（与手持机列表一致）
  function devTaskLabel(d) {
    if (!d || !d.current_task_type) return "";
    var name = DEV_COOP_KEYS[d.current_task_type] ? t(DEV_COOP_KEYS[d.current_task_type]) : d.current_task_type;
    return name + (d.current_task_seq ? " #" + d.current_task_seq : "");
  }
  function devAgo(ts) {
    if (!ts) return "—";
    var d = Math.floor(Date.now() / 1000 - Number(ts));
    if (d < 0) d = 0;
    if (d < 60) return d + "s";
    if (d < 3600) return Math.floor(d / 60) + "min";
    if (d < 86400) return Math.floor(d / 3600) + "h";
    return Math.floor(d / 86400) + "d";
  }
  function devStoreName(sid) {
    for (var i = 0; i < ST.stores.length; i++) if (ST.stores[i].id === sid) return ST.stores[i].name;
    return sid ? "#" + sid : "";
  }
  function loadDevicePage() {
    loadDevices(); loadDevBridges(); loadDevSensors();
    if (!ST.devActStoreId) ST.devActStoreId = (ST.stores[0] && ST.stores[0].id) || 0;
  }
  function loadDevices() {
    api("GET", "/api/devices").then(function (r) { ST.devices = r || []; }).catch(function () {});
  }
  function loadDevBridges() {
    api("GET", "/api/print-agent/status").then(function (r) { ST.devBridges = (r && r.bridges) || []; }).catch(function () {});
  }
  function loadDevSensors() {
    api("GET", "/api/sensors").then(function (r) { ST.devSensors = (r && r.items) || []; }).catch(function () {});
  }
  // 生成手持机激活码：地址以浏览器当前主机为准（门店用哪个地址打开系统，手持机就连哪个）
  function genDevActivation() {
    var sid = ST.devActStoreId || (ST.stores[0] && ST.stores[0].id) || 0;
    if (!sid) { toast(t("loc.needStore"), "error"); return; }
    api("POST", "/api/devices/activation", { store_id: sid, name: (ST.devActName || "").trim() }).then(function (r) {
      ST.devActUrl = window.location.origin + API + "/api/device/activate?key=" + encodeURIComponent(r.akey);
      ST.devActName = "";
      toast(t("devm.actCreated"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function copyDevActUrl() { if (ST.devActUrl) copyText(ST.devActUrl); }
  function unbindDevice(d) {
    if (!confirm(t("devm.cfUnbind"))) return;
    api("POST", "/api/devices/" + d.id + "/unbind", {}).then(function () {
      toast(t("devm.unbound")); loadDevices();
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function toggleDevice(d) {
    var path = d.status === "active" ? "disable" : "enable";
    api("POST", "/api/devices/" + d.id + "/" + path, {}).then(function () { loadDevices(); })
      .catch(function (e) { toast(e.message, "error"); });
  }
  // 打印助手 / 扫描设备密钥：生成后页面内展示一次供复制（电脑端为 prompt 弹窗）
  function genDevAgentKey(b) {
    api("POST", "/api/stores/" + b.store_id + "/print-agent-key", {}).then(function (r) {
      ST.devKey = { kind: "agent", store: b.store_name, key: r.agent_key || "" };
      loadDevBridges();
      toast(t("devm.keyGen"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function revokeDevAgent(a) {
    if (!confirm(t("devm.revokeConfirm"))) return;
    api("POST", "/api/print-agents/" + a.id + "/revoke", {}).then(function () {
      loadDevBridges(); toast(t("devm.revoked"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function genDevScanKey() {
    var sid = ST.devActStoreId || (ST.stores[0] && ST.stores[0].id) || 0;
    if (!sid) { toast(t("loc.needStore"), "error"); return; }
    api("POST", "/api/stores/" + sid + "/scan-device-key", {}).then(function (r) {
      ST.devKey = { kind: "scan", store: devStoreName(sid), key: r.device_token || "" };
      loadDevices();
      toast(t("devm.keyGen"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function copyDevKey() { if (ST.devKey.key) copyText(ST.devKey.key); }
  function devKeyHint() { return ST.devKey.kind === "scan" ? t("devm.scanKeyHint") : t("devm.agentKeyHint"); }
  // 某门店某打印业务当前指派的打印机名
  function devBizPrinterOf(b, code) {
    var biz = (b && b.biz) || [];
    for (var i = 0; i < biz.length; i++) if (biz[i].code === code) return biz[i].printer || "";
    return "";
  }
  function bindDevPrinter(b, code, printer) {
    api("POST", "/api/stores/" + b.store_id + "/bind-printer", { biz: code, printer: printer || "" }).then(function (r) {
      var biz = b.biz || [];
      for (var i = 0; i < biz.length; i++) if (biz[i].code === code) biz[i].printer = r.printer || "";
      if (code === "label_product") b.printer_name = r.printer || "";
      toast(t("store.saveOk"));
    }).catch(function (e) { toast(e.message, "error"); });
  }
  // 门店打印控制指令（测试页/进纸/退纸/刷新打印机列表）
  function devStoreControl(b, action) {
    api("POST", "/api/stores/" + b.store_id + "/print-control", { action: action, biz: "label_product" }).then(function () {
      toast(t("devm.ctlOk"));
      if (action === "refresh") loadDevBridges();
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function toggleDevBiz(sid) { ST.devBizOpen[sid] = !ST.devBizOpen[sid]; }

  // ---------------- 门店调拨 ----------------
  function loadTransfers() {
    ST.loading = true;
    api("GET", "/api/transfers?scope=out&size=100").then(function (d) {
      ST.transfers.out = d.items || [];
    }).catch(function (e) { toast(e.message, "error"); });
    api("GET", "/api/transfers?scope=in&size=100").then(function (d) {
      ST.transfers.in = d.items || [];
    }).catch(function (e) { toast(e.message, "error"); })
      .then(function () { ST.loading = false; });
  }
  function transferList() { return ST.transfers.tab === "out" ? ST.transfers.out : ST.transfers.in; }
  function setTrTab(k) { ST.transfers.tab = k; }
  function trStoreName(id) {
    for (var i = 0; i < ST.stores.length; i++) if (ST.stores[i].id === id) return ST.stores[i].name;
    return "#" + id;
  }
  function openTransfer(x) {
    api("GET", "/api/transfers/" + x.id).then(function (d) {
      ST.trDetail = d; ST.trReceiving = false; ST.trRecv = {};
      openSub("transfer-detail");
    }).catch(function (e) { toast(e.message, "error"); });
  }
  // 仅「发往当前工作门店且在途」的单可验收（后端同样校验）
  function trCanReceive() {
    return !!(ST.trDetail && ST.trDetail.status === "在途" && ST.trDetail.to_store_id === ST.storeId);
  }
  function trNew() {
    ST.trPick = { items: [], q: "", sel: {}, store: 0 };
    ST.trForm = { to_store_id: 0, remark: "" };
    openSub("transfer-new");
    trPickSearch();
  }
  function trPickSearch() {
    var q = "/api/products?page=1&size=200&status=" + encodeURIComponent("在库");
    if (ST.trPick.q) q += "&q=" + encodeURIComponent(ST.trPick.q);
    api("GET", q).then(function (d) { ST.trPick.items = d.items || []; })
      .catch(function (e) { toast(e.message, "error"); });
  }
  function trSelCount() { return Object.keys(ST.trPick.sel).length; }
  function trSelList() {
    var out = [];
    for (var k in ST.trPick.sel) {
      if (Object.prototype.hasOwnProperty.call(ST.trPick.sel, k)) out.push(ST.trPick.sel[k]);
    }
    return out;
  }
  function trTogglePick(p) {
    if (ST.trPick.sel[p.id]) {
      delete ST.trPick.sel[p.id];
      if (!trSelCount()) ST.trPick.store = 0;
      return;
    }
    if (p.status !== "在库") { toast(t("tr.onlyStock"), "error"); return; }
    if (ST.trPick.store && p.store_id !== ST.trPick.store) { toast(t("tr.diffStore"), "error"); return; }
    ST.trPick.sel[p.id] = p;
    ST.trPick.store = p.store_id;
  }
  function trClearSel() { ST.trPick.sel = {}; ST.trPick.store = 0; }
  function trStoreOptions() {
    var out = [];
    for (var i = 0; i < ST.stores.length; i++) {
      if (ST.stores[i].id !== ST.trPick.store) out.push(ST.stores[i]);
    }
    return out;
  }
  function submitTransfer() {
    var ids = trSelList().map(function (p) { return p.id; });
    if (!ids.length) { toast(t("tr.pickEmpty"), "error"); return; }
    if (!ST.trForm.to_store_id || ST.trForm.to_store_id === ST.trPick.store) {
      toast(t("tr.needToStore"), "error"); return;
    }
    ST.trBusy = true;
    api("POST", "/api/transfers", { to_store_id: ST.trForm.to_store_id, product_ids: ids, remark: ST.trForm.remark || "" })
      .then(function (r) {
        ST.trBusy = false;
        toast(t("tr.sendOk") + " " + r.transfer_no);
        ST.transfers.tab = "out";
        openSub("transfers");
      })
      .catch(function (e) { ST.trBusy = false; toast(e.message, "error"); });
  }
  // 到店验货：逐件确认相符/不符
  function trStartReceive() {
    var recv = {};
    (ST.trDetail.items || []).forEach(function (i) { recv[i.product_id] = { ok: null, reason: "" }; });
    ST.trRecv = recv;
    ST.trReceiving = true;
  }
  function trCancelReceive() { ST.trReceiving = false; ST.trRecv = {}; }
  function trSetOk(pid, ok) {
    var c = ST.trRecv[pid]; if (!c) return;
    c.ok = ok;
    if (ok) c.reason = "";
  }
  function trQuickReason(pid, txt) {
    var c = ST.trRecv[pid]; if (!c) return;
    c.ok = false;
    c.reason = txt;
  }
  function submitReceive() {
    var d = ST.trDetail;
    if (!d) return;
    var items = d.items || [], payload = [];
    for (var k = 0; k < items.length; k++) {
      var i = items[k], c = ST.trRecv[i.product_id];
      if (!c || c.ok === null) { toast(t("tr.needAll"), "error"); return; }
      if (!c.ok && !String(c.reason || "").trim()) {
        toast(t("tr.needReason") + (i.product_code || i.product_name), "error"); return;
      }
      payload.push({ product_id: i.product_id, ok: !!c.ok, reason: c.ok ? "" : String(c.reason).trim() });
    }
    ST.trBusy = true;
    api("POST", "/api/transfers/" + d.id + "/receive", { items: payload })
      .then(function (r) {
        ST.trBusy = false;
        toast(t("tr.receiveDone") + " " + r.matched + "/" + (r.matched + r.diff));
        openSub("transfers");
      })
      .catch(function (e) { ST.trBusy = false; toast(e.message, "error"); });
  }

  // ---------------- RFID 盘点任务 ----------------
  function loadCoTask() {
    api("GET", "/api/tasks?scope=active").then(function (list) {
      if (list && list.length) {
        return api("GET", "/api/tasks/" + list[0].id).then(function (r) { ST.coTask = r; });
      }
      ST.coTask = null;
    }).catch(function () {});
  }
  function startCoTask() {
    if (!confirm(t("co.cfStart"))) return;
    ST.coBusy = true;
    api("POST", "/api/tasks/start", { type: "stocktake", host: ST.coHost || "" }).then(function (r) {
      ST.coTask = r;
      toast(t("co.started"));
    }).catch(function (e) { toast(e.message, "error"); })
      .then(function () { ST.coBusy = false; });
  }
  function cancelCoTask() {
    if (!ST.coTask) return;
    if (!confirm(t("co.cfCancel"))) return;
    ST.coBusy = true;
    api("POST", "/api/tasks/" + ST.coTask.id + "/cancel", {}).then(function () {
      toast(t("co.cancelled"));
      ST.coTask = null;
    }).catch(function (e) { toast(e.message, "error"); })
      .then(function () { ST.coBusy = false; });
  }
  function terminateCoTask() {
    if (!ST.coTask) return;
    if (!confirm(t("co.cfTerminate"))) return;
    ST.coBusy = true;
    api("POST", "/api/tasks/" + ST.coTask.id + "/terminate", {}).then(function (r) {
      toast(r && r.result ? t("co.terminatedRpt") : t("co.terminated"));
      ST.coTask = null;
      loadBatches();
    }).catch(function (e) { toast(e.message, "error"); })
      .then(function () { ST.coBusy = false; });
  }
  // LAN http 非安全上下文下 clipboard 不可用，execCommand 兜底
  function copyText(txt) {
    function ok() { toast(t("co.copied")); }
    function fail() { toast(t("co.copyFail"), "error"); }
    function legacy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var done = document.execCommand("copy");
        document.body.removeChild(ta);
        if (done) ok(); else fail();
      } catch (e) { fail(); }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(ok).catch(legacy);
    } else {
      legacy();
    }
  }
  function copyCoUrl() { if (ST.coTask && ST.coTask.co_url) copyText(ST.coTask.co_url); }
  function copyH5Url() { if (ST.coTask && ST.coTask.h5_url) copyText(ST.coTask.h5_url); }
  function coStatusText(s) {
    if (s === "进行中") return t("co.stRunning");
    if (s === "已完成") return t("co.stDone");
    if (s === "已撤销") return t("co.stCancel");
    if (s === "已终止") return t("co.stTerminate");
    return s || "";
  }

  // ---------------- 盘点批次 ----------------
  function loadBatches() {
    ST.loading = true;
    api("GET", "/api/stocktake/list?limit=30").then(function (d) {
      ST.batches = d.list || [];
    }).catch(function (e) { toast(e.message, "error"); })
      .then(function () { ST.loading = false; });
  }
  function viewBatch(b) {
    api("GET", "/api/stocktake/" + b.id).then(function (d) {
      ST.batchDetail = d;
      openSub("batch-detail");
    }).catch(function (e) { toast(e.message, "error"); });
  }
  function viewBatchProduct(it) {
    if (!it.product_id) { toast(t("sb.noProd"), "error"); return; }
    viewProduct(it.product_id);
  }
  function sbResultText(r) {
    if (!r) return "";
    if (r.indexOf("盘亏") >= 0) return r.replace("盘亏", t("sb.shortage"));
    if (r.indexOf("盘盈") >= 0) return r.replace("盘盈", t("inv.surplus"));
    if (r.indexOf("异常") >= 0) return r.replace("异常", t("sb.abnormal"));
    if (r.indexOf("相符") >= 0) return r.replace("相符", t("sb.matched"));
    return r;
  }
  function sbResultClass(r) {
    if (!r) return "tag-gray";
    if (r.indexOf("相符") >= 0) return "tag-green";
    if (r.indexOf("盘亏") >= 0) return "tag-red";
    if (r.indexOf("异常") >= 0) return "tag-gold";
    if (r.indexOf("盘盈") >= 0) return "tag-blue";
    return "tag-gray";
  }

  // ---------------- quick ----------------
  function quickGo(kind) {
    ST.sheet = "";
    if (kind === "sale") openSub("sale-new");
    else if (kind === "deposit") openSub("dep-new");
    else if (kind === "inbound") inboundForm();
    else if (kind === "repair") newRepair();
    else if (kind === "purchase") newPurchase();
    else if (kind === "outsource") newOutsourcing();
    else if (kind === "product") newProduct();
    else if (kind === "stocktake") { ST.tab = "products"; toast(t("q.stocktake") + " — " + t("common.optional")); }
  }

  function reminderCount() {
    var r = ST.reminders; if (!r) return 0;
    return (r.deposits || []).length + (r.repairsPending || []).length + (r.loansOverdue || []).length;
  }

  // ---------------- view helpers ----------------
  function dStock() { return (ST.dash && ST.dash.stock) || {}; }
  function dToday() { return (ST.dash && ST.dash.todaySales) || {}; }
  function dMonth() { return (ST.dash && ST.dash.monthSales) || {}; }
  function dDue() { return (ST.dash && ST.dash.customerDue) || {}; }
  function dRecent() { return (ST.dash && ST.dash.recentSales) || []; }
  function dTrendLabels() { return (ST.trend && ST.trend.labels) || []; }
  function dTrendAmounts() { return (ST.trend && ST.trend.amounts) || []; }
  // 对比序列：同比=去年同期（amountsLastYear），环比=紧邻上一等长区间（amountsPrev）
  function dTrendCmpData() {
    var tr = ST.trend;
    if (!tr) return [];
    return ST.trendCmp === "mom" ? (tr.amountsPrev || []) : (tr.amountsLastYear || []);
  }
  function trendCmpKey() { return ST.trendCmp === "mom" ? "dash.mom" : "dash.yoy"; }
  function trendMax() {
    var a = dTrendAmounts(), c = dTrendCmpData(), m = 0;
    for (var i = 0; i < a.length; i++) m = Math.max(m, num(a[i]));
    for (var j = 0; j < c.length; j++) m = Math.max(m, num(c[j]));
    return m || 1;
  }
  function barH(i) {
    var a = dTrendAmounts();
    return Math.max(4, Math.round(num(a[i]) / trendMax() * 100)) + "%";
  }
  function cmpBarH(i) {
    var c = dTrendCmpData();
    if (!c.length) return "0%";
    return Math.max(4, Math.round(num(c[i]) / trendMax() * 100)) + "%";
  }
  // 纵轴刻度（实销金额）：区间最大值均分 4 段（5 条刻度），top% 与柱高百分比一一对齐
  function dTrendYAxis() {
    var mx = trendMax(), zh = (ST.lang || "zh") === "zh";
    function short(n) {
      n = Math.round(n);
      if (zh && n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
      if (!zh && n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
      return fmtNum(n);
    }
    var out = [];
    for (var i = 4; i >= 0; i--) {
      out.push({ top: Math.round((1 - i / 4) * 100) + "%", text: i === 0 ? "0" : short(mx * i / 4) });
    }
    return out;
  }
  function remDeposits() { return (ST.reminders && ST.reminders.deposits) || []; }
  function remRepairs() { return (ST.reminders && ST.reminders.repairsPending) || []; }
  function remLoans() { return (ST.reminders && ST.reminders.loansOverdue) || []; }
  function iStock() { return (ST.inventory && ST.inventory.inStock) || {}; }
  function iReserved() { return (ST.inventory && ST.inventory.reserved) || {}; }
  function iLoaned() { return (ST.inventory && ST.inventory.loaned) || {}; }
  function iMetrics() { return (ST.inventory && ST.inventory.metrics) || {}; }
  function custSales() { return (ST.custDetail && ST.custDetail.sales) || []; }
  function userName() { return (ST.user && (ST.user.display_name || ST.user.username)) || "—"; }
  function userInitial() {
    var n = userName();
    return n && n !== "—" ? n.charAt(0) : "懿";
  }
  function roleName() {
    var r = ST.user && ST.user.role;
    if (r === "SYS_ADMIN") return t("pf.roleSysAdmin");
    if (r === "EXECUTIVE") return t("pf.roleExec");
    if (r === "TENANT_ADMIN" || r === "admin") return t("pf.roleAdmin");
    return t("pf.roleClerk");
  }


  function boot() {
    // 默认先进入登录页：清理可能残留的会话，避免"一键进入后又跳登录"的闪断
    try { localStorage.removeItem("yz_m_token"); } catch (e) {}
    ST.token = "";
    ST.user = null;
  }

  function onScroll(e) {
    var el = e.target;
    if (ST.tab === "products" && ST.sub === "" && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) loadMoreProducts();
    if (ST.tab === "customers" && ST.sub === "" && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) loadMoreCustomers();
  }

  var methods = {
    login: login, logout: logout, submitChangePwd: submitChangePwd,
    switchStore: switchStore, setLang: setLang, curStoreName: curStoreName, isHqView: isHqView,
    go: go, openSub: openSub, closeSub: closeSub, onScroll: onScroll,
    loadDash: loadDash,
    loadGold: loadGold, localeCurrency: localeCurrency, pctCls: pctCls, pctLabel: pctLabel,
    donutColor: donutColor, catText: catText, catDonutSegments: catDonutSegments,
    loadTags: loadTags, loadTagStats: loadTagStats, setSaleStatsDim: setSaleStatsDim,
    toggleTagSel: toggleTagSel, clearTagSel: clearTagSel, tagGrouped: tagGrouped,
    tagGroupName: tagGroupName, tagBarStyle: tagBarStyle, rankBlocks: rankBlocks,
    loadProducts: loadProducts, loadMoreProducts: loadMoreProducts, viewProduct: viewProduct,
    newProduct: newProduct, editProduct: editProduct, copyProduct: copyProduct, saveProduct: saveProduct, delProduct: delProduct,
    saveProductRequest: saveProductRequest, toggleProdSelMode: toggleProdSelMode, prodRowTap: prodRowTap,
    togglePrintSel: togglePrintSel, togglePrintAll: togglePrintAll, printSelCount: printSelCount, selectedProducts: selectedProducts,
    batchEditProducts: batchEditProducts, submitBatchEdit: submitBatchEdit,
    batchCopyProducts: batchCopyProducts, batchDelProducts: batchDelProducts,
    printLabel: printLabel, printSheetLabel: printSheetLabel, onPrintLabelBtn: onPrintLabelBtn,
    openPrintSelected: openPrintSelected, printTypeProducts: printTypeProducts,
    openLabelPrint: openLabelPrint, removeLabelItem: removeLabelItem, closeLabel: closeLabel,
    loadLabelAgent: loadLabelAgent, submitLabelPrint: submitLabelPrint,
    productImageUrl: productImageUrl, chooseProductImage: chooseProductImage, onProductImageChosen: onProductImageChosen,
    openImgCrop: openImgCrop, closeImgCrop: closeImgCrop, setImgOrient: setImgOrient, cropImgStyle: cropImgStyle,
    resetImgCrop: resetImgCrop, cropPointerDown: cropPointerDown, cropPointerMove: cropPointerMove,
    cropPointerUp: cropPointerUp, cropZoomInput: cropZoomInput, confirmImgCrop: confirmImgCrop, removeProductImage: removeProductImage,
    openImportDlg: openImportDlg, closeImportDlg: closeImportDlg, onImportFile: onImportFile,
    downloadImportTpl: downloadImportTpl, submitImportXlsx: submitImportXlsx,
    loadInventory: loadInventory, inboundForm: inboundForm, submitInbound: submitInbound,
    loadSales: loadSales, prepareSale: prepareSale, saleTotal: saleTotal, saleReceivable: saleReceivable, saleDue: saleDue,
    openPicker: openPicker, pickProduct: pickProduct, removeSaleItem: removeSaleItem, createSale: createSale, voidSale: voidSale,
    loadDeposits: loadDeposits, prepareDeposit: prepareDeposit, depBalance: depBalance, createDeposit: createDeposit,
    payDeposit: payDeposit, voidDeposit: voidDeposit,
    loadCustomers: loadCustomers, loadMoreCustomers: loadMoreCustomers, viewCustomer: viewCustomer,
    newCustomer: newCustomer, editCustomer: editCustomer, saveCustomer: saveCustomer, addCustPhone: addCustPhone, delCustPhone: delCustPhone,
    loadLoans: loadLoans, newLoan: newLoan, createLoan: createLoan, returnLoan: returnLoan,
    loadRepairs: loadRepairs, newRepair: newRepair, createRepair: createRepair, repairEdit: repairEdit, saveRepair: saveRepair,
    loadPurchases: loadPurchases, newPurchase: newPurchase, createPurchase: createPurchase, receivePurchase: receivePurchase,
    loadOutsourcings: loadOutsourcings, newOutsourcing: newOutsourcing, createOutsourcing: createOutsourcing, receiveOutsourcing: receiveOutsourcing,
    loadAppointments: loadAppointments, setAppt: setAppt, loadLogs: loadLogs,
    loadTransfers: loadTransfers, transferList: transferList, setTrTab: setTrTab, trStoreName: trStoreName,
    openTransfer: openTransfer, trCanReceive: trCanReceive, trNew: trNew, trPickSearch: trPickSearch,
    trSelCount: trSelCount, trSelList: trSelList, trTogglePick: trTogglePick, trClearSel: trClearSel,
    trStoreOptions: trStoreOptions, submitTransfer: submitTransfer,
    trStartReceive: trStartReceive, trCancelReceive: trCancelReceive, trSetOk: trSetOk,
    trQuickReason: trQuickReason, submitReceive: submitReceive,
    loadCoTask: loadCoTask, startCoTask: startCoTask, cancelCoTask: cancelCoTask, terminateCoTask: terminateCoTask,
    copyCoUrl: copyCoUrl, copyH5Url: copyH5Url, coStatusText: coStatusText,
    loadBatches: loadBatches, viewBatch: viewBatch, viewBatchProduct: viewBatchProduct,
    sbResultText: sbResultText, sbResultClass: sbResultClass,
    loadProfile: loadProfile, saveProfile: saveProfile, loadDocs: loadDocs, quickGo: quickGo, reminderCount: reminderCount,
    switchHqTab: switchHqTab, loadHqTab: loadHqTab, siteHref: siteHref, saveHqProfile: saveHqProfile,
    hqLangName: hqLangName, hqLangFilled: hqLangFilled, openProfLang: openProfLang,
    loadShops: loadShops, loadHqStores: loadHqStores, storesByShop: storesByShop, createStore: createStore,
    editStore: editStore, resetStoreEdit: resetStoreEdit, saveStore: saveStore,
    loadProductTypes: loadProductTypes, loadLabelTemplates: loadLabelTemplates, typeName: typeName, typeGroupOptions: typeGroupOptions,
    resetTypeEdit: resetTypeEdit, editType: editType, saveType: saveType, delType: delType,
    loadTagGroups: loadTagGroups, filteredTags: filteredTags, setTagFilter: setTagFilter,
    resetTagGroupEdit: resetTagGroupEdit, addTagGroup: addTagGroup, editTagGroup: editTagGroup,
    saveTagGroup: saveTagGroup, delTagGroup: delTagGroup,
    resetTagEdit: resetTagEdit, editTag: editTag, saveTag: saveTag, delTag: delTag,
    loadLocations: loadLocations, locsOfStore: locsOfStore, onLocStoreChange: onLocStoreChange,
    resetLocEdit: resetLocEdit, addLocForCur: addLocForCur, editLoc: editLoc, saveLoc: saveLoc,
    delLoc: delLoc, toggleLoc: toggleLoc,
    isAdminRole: isAdminRole, isSysAdmin: isSysAdmin, canManageUsers: canManageUsers,
    assignableRoles: assignableRoles, roleText: roleText, loadAdminUsers: loadAdminUsers,
    toggleUserStore: toggleUserStore, openUserCreate: openUserCreate, openUserEdit: openUserEdit,
    closeUserForm: closeUserForm, saveAdminUser: saveAdminUser, delAdminUser: delAdminUser,
    loadClerkTypes: loadClerkTypes, resetClerkEdit: resetClerkEdit, editClerk: editClerk,
    saveClerk: saveClerk, toggleClerk: toggleClerk,
    loadDevicePage: loadDevicePage, loadDevices: loadDevices, loadDevBridges: loadDevBridges,
    loadDevSensors: loadDevSensors, devStoreName: devStoreName, devTaskLabel: devTaskLabel,
    devAgo: devAgo, devBizGroups: devBizGroups, genDevActivation: genDevActivation,
    copyDevActUrl: copyDevActUrl, unbindDevice: unbindDevice, toggleDevice: toggleDevice,
    genDevAgentKey: genDevAgentKey, revokeDevAgent: revokeDevAgent, genDevScanKey: genDevScanKey,
    copyDevKey: copyDevKey, devKeyHint: devKeyHint, devBizPrinterOf: devBizPrinterOf,
    bindDevPrinter: bindDevPrinter, devStoreControl: devStoreControl, toggleDevBiz: toggleDevBiz,
    dStock: dStock, dToday: dToday, dMonth: dMonth, dDue: dDue, dRecent: dRecent,
    dTrendLabels: dTrendLabels, barH: barH, cmpBarH: cmpBarH, dTrendYAxis: dTrendYAxis, trendCmpKey: trendCmpKey,
    setDashRange: setDashRange, setTrendCmp: setTrendCmp, remDeposits: remDeposits, remRepairs: remRepairs, remLoans: remLoans,
    iStock: iStock, iReserved: iReserved, iLoaned: iLoaned, iMetrics: iMetrics, custSales: custSales,
    userName: userName, userInitial: userInitial, roleName: roleName,
    money: money, fmtNum: fmtNum, num: num, statusKey: statusKey, statusClass: statusClass, today: todayStr
  };

  Vue.createApp({
    setup: function () {
      var out = { ST: ST, t: function (k, p) { return window.t(k, p); }, LANGS: window.LANG_KEYS, LANG_LABELS: window.LANG_LABELS, HQ_LANGS: HQ_LANGS };
      for (var k in methods) { if (Object.prototype.hasOwnProperty.call(methods, k)) out[k] = methods[k]; }
      return out;
    },
    mounted: function () { boot(); }
  }).mount("#app");
})();

