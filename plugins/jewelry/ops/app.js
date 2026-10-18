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

  function del(path) {
    return fetch(BASE + path, { method: "DELETE", headers: { Accept: "application/json" } })
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
    Promise.all([api("api/ops/context"), api("api/ops/devices"),
                 api("api/ops/agents"), api("api/ops/audit?limit=100"),
                 api("api/ops/tasks/active"), api("api/ops/users"),
                 api("api/ops/face/status"), api("api/ops/face/templates")])
      .then(function (rs) {
        renderChips(rs[0]);
        renderDevices(rs[1]);
        renderAgents(rs[2]);
        renderAudit(rs[3]);
        renderTasks(rs[4]);
        renderUsers(rs[5]);
        renderFace(rs[6], rs[7]);
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
    var guard = {};
    FaceGuard("任务 " + taskNo + " 将被强制终止并立即解冻库存，请刷脸确认本人操作。")
      .then(function (g) {
        guard = g;
        return post("api/ops/tasks/" + id + "/terminate", g);
      })
      .then(function (j) {
        closeFace();
        window.alert("任务已终止" +
          (j.result ? "\n已生成部分报告：扫描 " + j.result.scannedCount +
            "，匹配 " + j.result.matchedCount + "，短少 " + j.result.shortageCount : "（无扫描数据，直接解冻）"));
        reloadControl();
      })
      .catch(function (e) {
        if (e && e.cancelled) { closeFace(); return; }
        // 人脸不匹配/口令错误时弹窗保留以便重试
        window.alert("终止失败：" + ((e && e.detail) || e));
      });
  }

  function resetPassword(id, name) {
    if (!window.confirm(
      "确认重置账号「" + name + "」的密码？\n" +
      "· 系统生成 8 位随机密码，仅回显一次\n" +
      "· 该账号下次登录将被强制要求修改密码\n" +
      "· 重置不会踢出已登录的会话")) return;
    FaceGuard("即将重置账号「" + name + "」的密码，请刷脸确认本人操作。")
      .then(function (g) { return post("api/ops/users/" + id + "/reset-password", g); })
      .then(function (j) {
        closeFace();
        el("pwd-modal-user").textContent = "账号：" + j.username;
        el("pwd-modal-value").textContent = j.password;
        el("pwd-modal").style.display = "flex";
        reloadControl();
      })
      .catch(function (e) {
        if (e && e.cancelled) { closeFace(); return; }
        window.alert("重置失败：" + ((e && e.detail) || e));
      });
  }

  function reloadControl() {
    api("api/ops/tasks/active").then(renderTasks).catch(function () {});
    api("api/ops/users").then(renderUsers).catch(function () {});
    api("api/ops/audit?limit=100").then(renderAudit).catch(function () {});
    reloadFace();
  }

  // ---------------- 人脸确认（高危写操作本人在场校验） ----------------

  var faceState = { enabled: false, count: 0, has_emergency: false };
  var faceMode = null;
  var faceGuardMode = false;
  var faceResolve = null;
  var faceReject = null;

  function renderFace(s, t) {
    if (s) faceState = s;
    var st = el("face-state");
    if (!faceState.enabled) {
      st.innerHTML = '<span class="badge gray">未启用</span> 尚未录入人脸，高危写操作仅需二次确认；录入第一张人脸后自动启用';
    } else {
      st.innerHTML = '<span class="badge ok">已启用</span> 已录入 <b>' + faceState.count +
        "</b> 人，高危写操作须人脸确认 · 应急口令：" +
        (faceState.has_emergency
          ? '<b style="color:#12b76a">已设置</b>'
          : '<b style="color:#f79009">未设置</b>（摄像头不可用时将无法完成验证）');
    }
    var rows = (t && t.items) || [];
    var tb = el("face-tpl-rows");
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="4" class="loading">暂无已录入人脸</td></tr>';
      return;
    }
    var parts = [];
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i];
      parts.push("<tr><td>" + esc(x.name) + "</td><td class='mono'>" + esc(x.enrolled_at) +
        "</td><td>" + esc(x.enrolled_by || "—") +
        '</td><td><button class="btn-danger btn-sm" data-delface="' + x.id + '">删除</button></td></tr>');
    }
    tb.innerHTML = parts.join("");
  }

  function reloadFace() {
    api("api/ops/face/status").then(function (s) {
      api("api/ops/face/templates").then(function (t) { renderFace(s, t); }).catch(function () {});
    }).catch(function () {});
  }

  function closeFace() {
    if (window.OpsFace) OpsFace.stop();
    el("face-modal").style.display = "none";
  }

  function switchFaceToGuard(msg) {
    if (!faceState.has_emergency) {
      closeFace();
      if (faceReject) { var rj = faceReject; faceResolve = null; faceReject = null; rj({ cancelled: true }); }
      window.alert("摄像头不可用（" + msg + "），且尚未设置应急口令，无法完成验证。\n" +
        "请在具备摄像头的环境操作，或先在本页设置应急口令。");
      return;
    }
    faceGuardMode = true;
    OpsFace.stop();
    el("face-stage").style.display = "none";
    el("face-switch-btn").style.display = "none";
    el("face-guard-row").style.display = "block";
    el("face-detect").textContent = msg + "，请输入应急口令完成验证";
    el("face-ok-btn").disabled = false;
    el("face-ok-btn").textContent = "确认验证";
    el("face-guard-input").focus();
  }

  function showFaceModal(mode, tip) {
    faceMode = mode;
    faceGuardMode = false;
    el("face-name-row").style.display = mode === "enroll" ? "block" : "none";
    el("face-name-input").value = "";
    el("face-guard-input").value = "";
    el("face-modal-title").textContent = mode === "enroll" ? "录入人脸" : "人脸确认";
    el("face-modal-tip").textContent = tip;
    el("face-detect").textContent = "正在加载人脸模型…";
    el("face-guard-row").style.display = "none";
    el("face-stage").style.display = "block";
    el("face-switch-btn").style.display = mode === "verify" ? "" : "none";
    el("face-ok-btn").disabled = true;
    el("face-ok-btn").textContent = mode === "enroll" ? "请正对摄像头" : "请正对摄像头";
    el("face-modal").style.display = "flex";
    OpsFace.start({
      base: BASE,
      video: el("face-video"),
      canvas: el("face-canvas"),
      onUpdate: function (has) {
        if (faceGuardMode) return;
        el("face-detect").textContent = has
          ? "已检测到人脸，确认面部清晰后点击「" + (mode === "enroll" ? "确认录入" : "确认验证") + "」"
          : "未检测到人脸，请正对摄像头";
        el("face-ok-btn").disabled = !has;
        if (has) el("face-ok-btn").textContent = mode === "enroll" ? "确认录入" : "确认验证";
      },
    }).catch(function (err) {
      if (mode === "enroll") {
        closeFace();
        window.alert("人脸录入失败：" + ((err && err.message) || err) +
          "\n浏览器仅允许 HTTPS 或本机地址使用摄像头。");
      } else {
        switchFaceToGuard((err && err.message) || "摄像头不可用");
      }
    });
  }

  function FaceGuard(tip) {
    return new Promise(function (resolve, reject) {
      if (!faceState.enabled) { resolve({}); return; }
      faceResolve = resolve;
      faceReject = reject;
      showFaceModal("verify", tip);
    });
  }

  function faceOk() {
    if (faceGuardMode) {
      var pwd = el("face-guard-input").value;
      if (!pwd) { window.alert("请输入应急口令"); return; }
      if (faceResolve) {
        var r = faceResolve;
        faceResolve = null;
        faceReject = null;
        r({ emergency: pwd });
      }
      return;
    }
    var d = OpsFace.descriptor();
    if (!d) { window.alert("请先正对摄像头，待检测到人脸后再确认"); return; }
    if (faceMode === "enroll") {
      var name = el("face-name-input").value.trim();
      if (!name) { window.alert("请填写录入姓名"); return; }
      el("face-ok-btn").disabled = true;
      post("api/ops/face/enroll", { name: name, descriptor: d }).then(function () {
        closeFace();
        window.alert("人脸「" + name + "」已录入，人脸确认已启用");
        reloadFace();
      }).catch(function (e) {
        el("face-ok-btn").disabled = false;
        window.alert("录入失败：" + ((e && e.detail) || e));
      });
      return;
    }
    if (faceResolve) {
      var r2 = faceResolve;
      faceResolve = null;
      faceReject = null;
      r2({ face: d });
    }
  }

  function faceCancel() {
    closeFace();
    if (faceReject) {
      var rj = faceReject;
      faceResolve = null;
      faceReject = null;
      rj({ cancelled: true });
    }
  }

  function delFace(tid) {
    if (!window.confirm("确认删除该人脸模板？若全部删除，高危写操作的人脸确认将自动停用。")) return;
    del("api/ops/face/templates/" + tid).then(function () {
      window.alert("已删除");
      reloadFace();
    }).catch(function (e) {
      window.alert("删除失败：" + ((e && e.detail) || e));
    });
  }

  function setEmergency() {
    var p = window.prompt(
      "设置应急口令（8-64 位）。\n" +
      "用于摄像头或 HTTPS 环境不可用时完成高危操作验证。\n" +
      "口令以加盐 PBKDF2 哈希保存，可随时在此重新设置。点取消放弃。");
    if (p === null) return;
    if (p.length < 8 || p.length > 64) { window.alert("口令长度需 8-64 位"); return; }
    post("api/ops/face/emergency", { password: p }).then(function () {
      window.alert("应急口令已设置");
      reloadFace();
    }).catch(function (e) {
      window.alert("设置失败：" + ((e && e.detail) || e));
    });
  }

  function bindFace() {
    el("face-enroll-btn").addEventListener("click", function () {
      showFaceModal("enroll",
        "请正对摄像头、光线充足并避免逆光。系统只提取人脸特征向量，不保存照片或视频。");
    });
    el("face-emergency-btn").addEventListener("click", setEmergency);
    el("face-tpl-rows").addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-delface]") : null;
      if (btn) delFace(btn.getAttribute("data-delface"));
    });
    el("face-ok-btn").addEventListener("click", faceOk);
    el("face-cancel-btn").addEventListener("click", faceCancel);
    el("face-switch-btn").addEventListener("click", function () { switchFaceToGuard("手动切换"); });
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
  bindFace();
  boot();
})();
