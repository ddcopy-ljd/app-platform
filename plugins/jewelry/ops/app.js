/* 懿臻珠宝云 · 运维端（只读巡检）。经平台网关进入时基址由注入的 __APP_BASE__ 提供。 */
(function () {
  "use strict";

  var BASE = window.__APP_BASE__ || "";

  function api(path) {
    return fetch(BASE + path, { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) { throw { status: r.status, detail: j && j.detail || ("HTTP " + r.status) }; }
          return j;
        });
      });
  }

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(n) {
    n = Number(n || 0);
    return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function ago(ts) {
    if (!ts) return "从未";
    var d = Date.now() / 1000 - ts;
    if (d <= 60) return "刚刚";
    if (d < 3600) return Math.floor(d / 60) + " 分钟前";
    if (d < 86400) return Math.floor(d / 3600) + " 小时前";
    return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
  }
  function shortMd5(s) { return s ? s.slice(0, 8) : "—"; }

  function showBlocked(detail) {
    el("blocked-reason").textContent = detail || "运维端仅允许平台「生产运维穿透」模式进入。";
    el("blocked").style.display = "flex";
  }

  function renderChips(c) {
    var html = "";
    html += '<span class="chip">租户 <b>' + esc(c.tenant) + "</b></span>";
    html += '<span class="chip">操作者 <b>' + esc(c.operator) + "</b></span>";
    html += '<span class="chip">版本 <b>' + esc(c.software_version) + "</b></span>";
    html += '<span class="chip">' + esc(c.server_time) + "</span>";
    el("ctx-chips").innerHTML = html;
  }

  function card(k, v, unit, cls) {
    return '<div class="card' + (cls ? " " + cls : "") + '">' +
      '<div class="k">' + k + "</div>" +
      '<div class="v">' + esc(v) + (unit ? "<small>" + unit + "</small>" : "") + "</div></div>";
  }

  function renderOverview(o) {
    var c = o.counts;
    var h = "";
    h += card("门店", c.stores);
    h += card("系统用户", c.users);
    h += card("会员", c.customers);
    h += card("商品总数", c.products, "件");
    h += card("在库商品", c.products_in_stock, "件", "accent");
    h += card("在库成本", money(c.stock_cost), "元");
    h += card("在库吊牌额", money(c.stock_price), "元");
    h += card("今日成交", o.sales_today.bills, "单", "accent");
    h += card("今日实收", money(o.sales_today.paid), "元", "accent");
    h += card("近7日成交", o.sales_7d.bills, "单");
    h += card("近7日实收", money(o.sales_7d.paid), "元");
    h += card("扫描助手在线", c.devices_online + " / " + c.devices, "台",
      c.devices_online ? "danger" : "");
    el("cards").innerHTML = h;
  }

  function renderDevices(d) {
    var rows = d.items || [];
    var onCount = 0, outdatedCount = 0;
    var bodyHtml;
    if (!rows.length) {
      bodyHtml = '<tr><td colspan="8" class="loading">暂无设备</td></tr>';
    } else {
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        if (x.online) onCount++;
        var outdated = x.status === "active" && d.server_md5 && x.apk_md5 && x.apk_md5 !== d.server_md5;
        if (outdated) outdatedCount++;
        var dot = x.online ? '<span class="dot on"></span>在线' : '<span class="dot off"></span>离线';
        var statusBadge = x.status === "active"
          ? '<span class="badge ok">启用</span>'
          : '<span class="badge red">停用</span>';
        var ver = x.app_version
          ? esc(x.app_version) + (outdated ? ' <span class="badge warn">待升级</span>' : "")
          : '<span class="badge gray">未上报</span>';
        parts.push(
          "<tr>" +
          "<td>" + dot + "</td>" +
          "<td class='mono'>" + esc(x.code) + " " + statusBadge + "</td>" +
          "<td>" + esc(x.name || "—") + "</td>" +
          "<td>" + esc(x.store_name) + "</td>" +
          "<td>" + ver + "</td>" +
          "<td class='mono'>" + shortMd5(x.apk_md5) + "</td>" +
          "<td>" + ago(x.last_seen) + "</td>" +
          "<td>" + (x.busy ? '<span class="badge warn">占用中</span>' : '<span class="badge gray">空闲</span>') + "</td>" +
          "</tr>"
        );
      }
      bodyHtml = parts.join("");
    }
    el("dev-rows").innerHTML = bodyHtml;
    el("dev-summary").textContent =
      "共 " + rows.length + " 台 · 在线 " + onCount + " 台" +
      (outdatedCount ? " · " + outdatedCount + " 台待升级" : "") +
      (d.force ? " · 已开启强制升级" : "");
  }

  function boot() {
    Promise.all([api("api/ops/context"), api("api/ops/overview"), api("api/ops/devices")])
      .then(function (rs) {
        renderChips(rs[0]);
        renderOverview(rs[1]);
        renderDevices(rs[2]);
        el("console").style.display = "block";
      })
      .catch(function (e) {
        if (e && e.status === 403) { showBlocked(e.detail); }
        else { showBlocked("加载巡检数据失败：" + ((e && e.detail) || e)); }
      });
  }

  boot();
})();
