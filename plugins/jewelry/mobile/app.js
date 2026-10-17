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

  function money(n) {
    if (n === null) return "***";
    if (n === undefined || n === "") return "—";
    return "¥" + fmtNum(n);
  }

  var STATUS_KEY = {
    "在库": "st.inStock", "已定": "st.reserved", "借出": "st.loaned", "在途": "st.inTransit", "已售": "st.sold",
    "已完成": "sale.done", "欠款": "sale.owing", "已冲红": "sale.voided",
    "借出中": "loan.out", "借入中": "loan.in", "已归还": "loan.return",
    "待维修": "st.reserved", "维修中": "sale.done", "已取走": "st.sold",
    "待发货": "st.reserved", "已入库": "st.inStock",
    "加工中": "sale.done", "已收货": "st.inStock"
  };
  var STATUS_CLASS = {
    "在库": "state-ok", "已定": "state-lock", "借出": "state-loan", "在途": "state-doing", "已售": "state-due",
    "已完成": "state-ok", "欠款": "state-due", "已冲红": "state-loan",
    "借出中": "state-loan", "借入中": "state-doing", "已归还": "state-ok", "已核销": "state-wait",
    "待维修": "state-wait", "维修中": "state-doing", "已取走": "state-ok",
    "待发货": "state-wait", "已入库": "state-ok",
    "加工中": "state-doing", "已收货": "state-ok",
    "待处理": "state-wait", "已确认": "state-doing", "已到店": "state-ok", "已取消": "state-wait"
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
    pickOptions: [], pickLoading: false,
    pickMode: "",
    form: {}, formTitle: "", formKind: "",
    auditNote: ""
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
      toast(t("msg.loginOk") + (ST.user && ST.user.display_name ? "，" + ST.user.display_name : ""));
      go("dashboard");
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

  function switchStore(sid) {
    api("POST", "/api/auth/switch-store", { store_id: sid }).then(function () {
      ST.storeId = sid;
      ST.sheet = "";
      toast(t("pf.switchOk"));
      go(ST.tab, true);
    }).catch(function (e) { toast(e.message, "error"); });
  }

  function setLang(l) { ST.lang = l; window.YZLang.set(l); }

  function curStoreName() {
    for (var i = 0; i < ST.stores.length; i++) {
      if (ST.stores[i].id === ST.storeId) return ST.stores[i].name;
    }
    return (ST.user && ST.user.display_name) || ST.tenant || "";
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
    else if (name === "store-profile") loadProfile();
    var el = document.querySelector(".page");
    if (el) el.scrollTop = 0;
  }

  function closeSub() { ST.sub = ""; ST.subId = 0; }

  // ---------------- dashboard ----------------
  function loadDash() {
    ST.loading = true;
    api("GET", "/api/dashboard/overview").then(function (d) { ST.dash = d; }).catch(function () {});
    api("GET", "/api/dashboard/trend?range=6m").then(function (d) { ST.trend = d; }).catch(function () {});
    api("GET", "/api/dashboard/reminders").then(function (d) { ST.reminders = d; }).catch(function () {})
      .then(function () { ST.loading = false; });
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
      high_value: 0, showcase_public: 0, product_type: "", product_type_code: "", category_code: ""
    };
  }

  function newProduct() { ST.productForm = blankProduct(); ST.productEdit = false; openSub("product-edit"); }

  function editProduct() {
    var p = ST.productView; if (!p) return;
    ST.productForm = {
      id: p.id, code: p.code || "", name: p.name || "", category: p.category || "",
      material: p.material || "", weight: p.weight || "", size: p.size || "", cert: p.cert || "",
      cost: p.cost == null ? "" : p.cost, price: p.price == null ? "" : p.price,
      status: p.status || "在库", rfid_epc: p.rfid_epc || "", location_id: p.location_id || 0,
      high_value: p.high_value || 0, showcase_public: p.showcase_public || 0,
      product_type: p.product_type || "", product_type_code: p.product_type_code || "", category_code: p.category_code || ""
    };
    ST.productEdit = true; openSub("product-edit");
  }

  function copyProduct() {
    var p = ST.productView; if (!p) return;
    ST.productForm = blankProduct();
    ST.productForm.name = p.name || ""; ST.productForm.category = p.category || "";
    ST.productForm.material = p.material || ""; ST.productForm.weight = p.weight || "";
    ST.productForm.size = p.size || ""; ST.productForm.cert = p.cert || "";
    ST.productForm.cost = p.cost == null ? "" : p.cost; ST.productForm.price = p.price == null ? "" : p.price;
    ST.productForm.product_type = p.product_type || ""; ST.productForm.product_type_code = p.product_type_code || "";
    ST.productForm.category_code = p.category_code || "";
    ST.productEdit = false; openSub("product-edit");
  }

  function saveProduct() {
    var f = ST.productForm;
    if (!f.name) { toast(t("msg.required"), "error"); return; }
    if (!f.id && !f.code) { toast(t("prod.code") + " " + t("common.required"), "error"); return; }
    var body = {
      code: f.code, name: f.name, category: f.category, material: f.material,
      weight: f.weight === "" ? "" : f.weight, size: f.size, cert: f.cert,
      cost: f.cost === "" ? null : f.cost, price: f.price === "" ? null : f.price,
      status: f.status, rfid_epc: f.rfid_epc, location_id: f.location_id || null,
      high_value: f.high_value ? 1 : 0, showcase_public: f.showcase_public ? 1 : 0,
      product_type: f.product_type, product_type_code: f.product_type_code, category_code: f.category_code
    };
    ST.loading = true;
    var req = f.id ? api("PUT", "/api/products/" + f.id, body) : api("POST", "/api/products", body);
    req.then(function () {
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

  function inboundForm() { ST.productForm = blankInbound(); ST.productEdit = false; openSub("inbound"); }

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

  function blankCustomer() { return { id: 0, name: "", phone: "", level: "普通", birthday: "", preference: "" }; }
  function newCustomer() { ST.custForm = blankCustomer(); openSub("cust-edit"); }
  function editCustomer() {
    var c = ST.custDetail; if (!c) return;
    ST.custForm = { id: c.id, name: c.name || "", phone: c.phone || "", level: c.level || "普通", birthday: c.birthday || "", preference: c.preference || "" };
    openSub("cust-edit");
  }
  function saveCustomer() {
    var f = ST.custForm;
    if (!f.name) { toast(t("msg.required"), "error"); return; }
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
  function saveProfile() {
    var p = ST.profile; if (!p) return;
    api("PUT", "/api/profile", {
      name: p.name, short_name: p.short_name, slogan: p.slogan, intro: p.intro,
      contact: p.contact, phone: p.phone, address: p.address, hours: p.hours,
      categories: p.categories, published: p.published ? 1 : 0,
      showcase_title: p.showcase_title, showcase_subtitle: p.showcase_subtitle
    }).then(function () { toast(t("store.saveOk")); closeSub(); }).catch(function (e) { toast(e.message, "error"); });
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
  function trendMax() {
    var a = dTrendAmounts(), m = 0;
    for (var i = 0; i < a.length; i++) m = Math.max(m, num(a[i]));
    return m || 1;
  }
  function barH(i) {
    var a = dTrendAmounts();
    return Math.max(4, Math.round(num(a[i]) / trendMax() * 100)) + "%";
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
    if (r === "EXECUTIVE") return t("pf.roleExec");
    if (r === "TENANT_ADMIN" || r === "admin") return t("pf.roleAdmin");
    return r || t("pf.roleClerk");
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
    login: login, logout: logout, switchStore: switchStore, setLang: setLang, curStoreName: curStoreName,
    go: go, openSub: openSub, closeSub: closeSub, onScroll: onScroll,
    loadDash: loadDash,
    loadProducts: loadProducts, loadMoreProducts: loadMoreProducts, viewProduct: viewProduct,
    newProduct: newProduct, editProduct: editProduct, copyProduct: copyProduct, saveProduct: saveProduct, delProduct: delProduct,
    loadInventory: loadInventory, inboundForm: inboundForm, submitInbound: submitInbound,
    loadSales: loadSales, prepareSale: prepareSale, saleTotal: saleTotal, saleReceivable: saleReceivable, saleDue: saleDue,
    openPicker: openPicker, pickProduct: pickProduct, removeSaleItem: removeSaleItem, createSale: createSale, voidSale: voidSale,
    loadDeposits: loadDeposits, prepareDeposit: prepareDeposit, depBalance: depBalance, createDeposit: createDeposit,
    payDeposit: payDeposit, voidDeposit: voidDeposit,
    loadCustomers: loadCustomers, loadMoreCustomers: loadMoreCustomers, viewCustomer: viewCustomer,
    newCustomer: newCustomer, editCustomer: editCustomer, saveCustomer: saveCustomer,
    loadLoans: loadLoans, newLoan: newLoan, createLoan: createLoan, returnLoan: returnLoan,
    loadRepairs: loadRepairs, newRepair: newRepair, createRepair: createRepair, repairEdit: repairEdit, saveRepair: saveRepair,
    loadPurchases: loadPurchases, newPurchase: newPurchase, createPurchase: createPurchase, receivePurchase: receivePurchase,
    loadOutsourcings: loadOutsourcings, newOutsourcing: newOutsourcing, createOutsourcing: createOutsourcing, receiveOutsourcing: receiveOutsourcing,
    loadAppointments: loadAppointments, setAppt: setAppt, loadLogs: loadLogs,
    loadProfile: loadProfile, saveProfile: saveProfile, quickGo: quickGo, reminderCount: reminderCount,
    dStock: dStock, dToday: dToday, dMonth: dMonth, dDue: dDue, dRecent: dRecent,
    dTrendLabels: dTrendLabels, barH: barH, remDeposits: remDeposits, remRepairs: remRepairs, remLoans: remLoans,
    iStock: iStock, iReserved: iReserved, iLoaned: iLoaned, iMetrics: iMetrics, custSales: custSales,
    userName: userName, userInitial: userInitial, roleName: roleName,
    money: money, fmtNum: fmtNum, num: num, statusKey: statusKey, statusClass: statusClass, today: todayStr
  };

  Vue.createApp({
    setup: function () {
      var out = { ST: ST, t: function (k, p) { return window.t(k, p); }, LANGS: window.LANG_KEYS, LANG_LABELS: window.LANG_LABELS };
      for (var k in methods) { if (Object.prototype.hasOwnProperty.call(methods, k)) out[k] = methods[k]; }
      return out;
    },
    mounted: function () { boot(); }
  }).mount("#app");
})();
