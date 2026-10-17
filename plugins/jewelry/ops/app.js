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

  function post(path, body) {
    return fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
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
  function fmtSize(n) {
    n = Number(n || 0);
    if (!n) return "—";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.round(n / 1024) + " KB";
  }

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
    Promise.all([api("api/ops/context"), api("api/ops/overview"), api("api/ops/devices"),
                 api("api/ops/agents"), api("api/ops/audit?limit=100"),
                 api("api/ops/tasks/active"), api("api/ops/users")])
      .then(function (rs) {
        renderChips(rs[0]);
        renderOverview(rs[1]);
        renderDevices(rs[2]);
        renderAgents(rs[3]);
        renderAudit(rs[4]);
        renderTasks(rs[5]);
        renderUsers(rs[6]);
        el("console").style.display = "block";
      })
      .catch(function (e) {
        if (e && e.status === 403) { showBlocked(e.detail); }
        else { showBlocked("加载巡检数据失败：" + ((e && e.detail) || e)); }
      });
  }

  // ---------------- 助手发布 ----------------

  function pkgMeta(p) {
    if (!p.published) {
      return "未发布 · 当前分发包内兜底产物<br>MD5 <span class='mono'>" + esc(shortMd5(p.md5)) + "</span> · " + fmtSize(p.size);
    }
    return "已发布 " + esc(p.time) + "<br>MD5 <span class='mono'>" + esc(p.md5) + "</span> · " + fmtSize(p.size);
  }

  function renderAgents(a) {
    el("pub-scan-state").className = "badge " + (a.scan.published ? "ok" : "gray");
    el("pub-scan-state").textContent = a.scan.published ? "已发布" : "未发布（包内兜底）";
    el("pub-scan-meta").innerHTML = pkgMeta(a.scan);
    el("pub-print-state").className = "badge " + (a.print.published ? "ok" : "gray");
    el("pub-print-state").textContent = a.print.published ? "已发布" : "未发布（包内兜底）";
    el("pub-print-meta").innerHTML = pkgMeta(a.print);
    el("force-toggle").checked = !!a.scan.force;

    var rows = a.history || [];
    var body;
    if (!rows.length) {
      body = '<tr><td colspan="6" class="loading">暂无发布记录</td></tr>';
    } else {
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        parts.push(
          "<tr>" +
          "<td class='mono'>" + esc(x.time) + "</td>" +
          "<td>" + esc(x.label) + "</td>" +
          "<td>" + esc(x.operator) + "</td>" +
          "<td class='mono'>" + esc(x.md5) + "</td>" +
          "<td>" + fmtSize(x.size) + "</td>" +
          "<td>" + esc(x.note || "—") + "</td>" +
          "</tr>"
        );
      }
      body = parts.join("");
    }
    el("pub-rows").innerHTML = body;
  }

  function publish(kind) {
    var fileInput = el(kind === "scan" ? "file-scan" : "file-print");
    var noteInput = el(kind === "scan" ? "note-scan" : "note-print");
    var btn = el(kind === "scan" ? "btn-scan" : "btn-print");
    if (!fileInput.files || !fileInput.files.length) { alert("请先选择要发布的文件"); return; }
    var f = fileInput.files[0];
    var label = kind === "scan" ? "扫描助手 APK" : "打印助手 EXE";
    if (!window.confirm("确认发布 " + label + "？\n文件：" + f.name + "（" + fmtSize(f.size) + "）\n发布后立即对全部租户的下载链路生效。")) return;
    btn.disabled = true;
    btn.textContent = "发布中…";
    var fd = new FormData();
    fd.append("kind", kind);
    fd.append("note", noteInput.value || "");
    fd.append("file", f);
    fetch(BASE + "api/ops/agents/publish", { method: "POST", body: fd })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw { detail: j && j.detail || ("HTTP " + r.status) };
          return j;
        });
      })
      .then(function (j) {
        window.alert("发布成功\nMD5 " + j.md5 + "\n" + j.time + " by " + j.operator);
        fileInput.value = "";
        noteInput.value = "";
        reloadOps();
      })
      .catch(function (e) {
        window.alert("发布失败：" + ((e && e.detail) || e));
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = kind === "scan" ? "发布 APK" : "发布 EXE";
      });
  }

  function reloadOps() {
    api("api/ops/agents").then(renderAgents).catch(function () {});
    api("api/ops/audit?limit=100").then(renderAudit).catch(function () {});
  }

  function bindPublish() {
    el("btn-scan").addEventListener("click", function () { publish("scan"); });
    el("btn-print").addEventListener("click", function () { publish("print"); });
    el("force-toggle").addEventListener("change", function () {
      var on = el("force-toggle").checked;
      fetch(BASE + "api/ops/agents/scan/force", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: on }),
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw { detail: j && j.detail || ("HTTP " + r.status) };
          return j;
        });
      }).then(function (j) {
        window.alert("扫描助手强制升级已" + (j.force ? "开启" : "关闭"));
        reloadOps();
      }).catch(function (e) {
        window.alert("操作失败：" + ((e && e.detail) || e));
        el("force-toggle").checked = !on;
      });
    });
  }

  // ---------------- 受控写操作 ----------------

  var TASK_TYPES = {
    stocktake: "盘点", sale: "销售开单", transfer_out: "调拨发出", transfer_in: "调拨验收",
    loan: "借还", epc_product: "商品建档", epc_inbound: "入库",
  };

  function renderTasks(d) {
    var rows = d.items || [];
    var body;
    if (!rows.length) {
      body = '<tr><td colspan="8" class="loading">当前无进行中任务</td></tr>';
    } else {
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        parts.push(
          "<tr>" +
          "<td class='mono'>" + esc(x.task_no || ("#" + x.id)) + "</td>" +
          "<td>" + esc(TASK_TYPES[x.type] || x.type) +
          (x.freezes ? ' <span class="badge warn">冻结库存</span>' : "") + "</td>" +
          "<td>" + esc(x.title || "—") + "</td>" +
          "<td>" + esc(x.store) + "</td>" +
          "<td>" + esc(x.initiator || "—") + "</td>" +
          "<td>" + esc(x.scans) + "</td>" +
          "<td class='mono'>" + esc(x.created || "—") + "</td>" +
          "<td><button class='btn-danger btn-sm' data-terminate='" + x.id +
          "' data-no='" + esc(x.task_no || ("#" + x.id)) + "'>强制终止</button></td>" +
          "</tr>"
        );
      }
      body = parts.join("");
    }
    el("task-rows").innerHTML = body;
  }

  function renderUsers(d) {
    var rows = d.items || [];
    var body;
    var ROLE_NAMES = { TENANT_ADMIN: "店长", EXECUTIVE: "高管", EMPLOYEE: "店员" };
    if (!rows.length) {
      body = '<tr><td colspan="5" class="loading">暂无业务账号</td></tr>';
    } else {
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        parts.push(
          "<tr>" +
          "<td class='mono'>" + esc(x.username) + "</td>" +
          "<td>" + esc(x.display_name || "—") + "</td>" +
          "<td>" + esc(ROLE_NAMES[x.role] || x.role) + "</td>" +
          "<td>" + (x.must_change_pwd ? '<span class="badge warn">是</span>' : '<span class="badge gray">否</span>') + "</td>" +
          "<td><button class='btn-danger btn-sm' data-reset='" + x.id +
          "' data-name='" + esc(x.username) + "'>重置密码</button></td>" +
          "</tr>"
        );
      }
      body = parts.join("");
    }
    el("user-rows").innerHTML = body;
  }

  function terminateTask(id, taskNo) {
    if (!window.confirm(
      "确认强制终止任务 " + taskNo + "？\n" +
      "· 立即解冻库存、释放占用设备\n" +
      "· 已有扫描数据将生成部分盘点报告\n" +
      "· 该操作不可撤销，手持机端任务同步关闭")) return;
    post("api/ops/tasks/" + id + "/terminate").then(function (j) {
      window.alert("任务已终止" +
        (j.result ? "\n已生成部分报告：扫描 " + j.result.scannedCount +
          "，匹配 " + j.result.matchedCount + "，短少 " + j.result.shortageCount : "（无扫描数据，直接解冻）"));
      reloadControl();
    }).catch(function (e) {
      window.alert("终止失败：" + ((e && e.detail) || e));
      reloadControl();
    });
  }

  function resetPassword(id, name) {
    if (!window.confirm(
      "确认重置账号「" + name + "」的密码？\n" +
      "· 系统生成 8 位随机密码，仅回显一次\n" +
      "· 该账号下次登录将被强制要求修改密码\n" +
      "· 重置不会踢出已登录的会话")) return;
    post("api/ops/users/" + id + "/reset-password").then(function (j) {
      el("pwd-modal-user").textContent = "账号：" + j.username;
      el("pwd-modal-value").textContent = j.password;
      el("pwd-modal").style.display = "flex";
      reloadControl();
    }).catch(function (e) {
      window.alert("重置失败：" + ((e && e.detail) || e));
    });
  }

  function reloadControl() {
    api("api/ops/tasks/active").then(renderTasks).catch(function () {});
    api("api/ops/users").then(renderUsers).catch(function () {});
    api("api/ops/audit?limit=100").then(renderAudit).catch(function () {});
  }

  function bindControl() {
    el("task-rows").addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-terminate]") : null;
      if (btn) terminateTask(btn.getAttribute("data-terminate"), btn.getAttribute("data-no"));
    });
    el("user-rows").addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-reset]") : null;
      if (btn) resetPassword(btn.getAttribute("data-reset"), btn.getAttribute("data-name"));
    });
    el("pwd-modal-close").addEventListener("click", function () {
      el("pwd-modal").style.display = "none";
    });
  }

  // ---------------- 审计 ----------------

  function renderAudit(a) {
    el("audit-summary").textContent = "共 " + a.total + " 条 · 显示最新 " + a.items.length + " 条";
    var rows = a.items || [];
    var body;
    if (!rows.length) {
      body = '<tr><td colspan="6" class="loading">暂无审计记录</td></tr>';
    } else {
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var x = rows[i];
        var ops = String(x.action || "").indexOf("运维端") === 0;
        parts.push(
          "<tr>" +
          "<td class='mono'>" + esc(x.time) + "</td>" +
          "<td>" + esc(x.operator) + "</td>" +
          "<td>" + esc(x.store || "—") + "</td>" +
          "<td>" + (ops ? '<span class="badge red">' + esc(x.action) + "</span>" : esc(x.action)) + "</td>" +
          "<td>" + esc(x.target || "—") + "</td>" +
          "<td>" + esc(x.result || "—") + "</td>" +
          "</tr>"
        );
      }
      body = parts.join("");
    }
    el("audit-rows").innerHTML = body;
  }

  bindPublish();
  bindControl();
  boot();
})();
