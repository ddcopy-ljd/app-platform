/* BugPulse Pro 前端数据层：原型 DOM 渲染保留，localStorage 全部替换为插件后端 API。
   经平台网关访问时平台注入 window.__APP_BASE__；直连时为空串（根路径）。 */

var API = (window.__APP_BASE__ || '').replace(/\/+$/, '');

var ST = {
  token: localStorage.getItem('bp_token') || '',
  user: null,
  projects: [],
  bugs: [],
  currentProjectId: 0,
  currentBugId: null,
  draggedBugId: null,
  stagedImages: []
};

// ---------------------------------------------------------------- API 封装

function api(method, url, body) {
  var h = {};
  if (ST.token) h['Authorization'] = 'Bearer ' + ST.token;
  var o = { method: method, headers: h };
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    o.body = JSON.stringify(body);
  }
  return fetch(API + url, o).then(function (r) {
    if (r.status === 401 && url !== '/api/auth/login') {
      ST.token = ''; localStorage.removeItem('bp_token');
      showLogin();
      throw new Error('未登录或登录已过期');
    }
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || '请求失败'); });
    return r.json();
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function imgURL(bugId, imgId) {
  return API + '/api/images/' + bugId + '/' + imgId + '?token=' + encodeURIComponent(ST.token);
}

// ---------------------------------------------------------------- 配置字典

var SEVERITY_CONFIG = {
  blocker: { label: '致命 (Blocker)', bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-600' },
  critical: { label: '严重 (Critical)', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-600' },
  major: { label: '一般 (Major)', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-600' },
  minor: { label: '轻微 (Minor)', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-500' }
};

var PRIORITY_CONFIG = {
  p0: { label: 'P0', full: 'P0 - 紧急', badge: 'bg-red-500 text-white' },
  p1: { label: 'P1', full: 'P1 - 高', badge: 'bg-orange-500 text-white' },
  p2: { label: 'P2', full: 'P2 - 中', badge: 'bg-indigo-100 text-indigo-700' },
  p3: { label: 'P3', full: 'P3 - 低', badge: 'bg-slate-200 text-slate-700' }
};

var STATUS_CONFIG = {
  open: { label: '待处理', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  in_progress: { label: '进行中', badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  testing: { label: '待验证', badge: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  closed: { label: '已关闭', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
};

// ---------------------------------------------------------------- 登录

function showLogin() {
  var ov = document.getElementById('login-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('flex');
  document.getElementById('login-username').focus();
}

function hideLogin() {
  var ov = document.getElementById('login-overlay');
  ov.classList.add('hidden');
  ov.classList.remove('flex');
}

function handleLoginSubmit(e) {
  e.preventDefault();
  var u = document.getElementById('login-username').value.trim();
  var p = document.getElementById('login-password').value;
  var err = document.getElementById('login-error');
  err.textContent = '';
  api('POST', '/api/auth/login', { username: u, password: p }).then(function (d) {
    ST.token = d.token;
    ST.user = d.user;
    localStorage.setItem('bp_token', d.token);
    hideLogin();
    renderUserChip();
    return bootstrap();
  }).catch(function (e2) {
    err.textContent = e2.message || '登录失败';
  });
}

function handleLogout() {
  api('POST', '/api/auth/logout', {}).catch(function () {});
  ST.token = ''; ST.user = null;
  localStorage.removeItem('bp_token');
  showLogin();
}

// ---------------------------------------------------------------- 成员与账号

function openUsersModal() {
  var m = document.getElementById('modal-users');
  m.classList.remove('hidden');
  m.classList.add('flex');
  document.getElementById('pwd-msg').textContent = '';
  // 仅系统管理员可见「新建成员」表单
  var createBox = document.getElementById('create-user-box');
  if (ST.user && ST.user.role === 'TENANT_ADMIN') createBox.classList.remove('hidden');
  else createBox.classList.add('hidden');
  loadUsers();
}

function closeUsersModal() {
  var m = document.getElementById('modal-users');
  m.classList.add('hidden');
  m.classList.remove('flex');
  ['pwd-old', 'pwd-new', 'pwd-confirm'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('pwd-msg').textContent = '';
}

function roleLabel(role) {
  return role === 'TENANT_ADMIN' ? '系统管理员' : '工作组成员';
}

function loadUsers() {
  var box = document.getElementById('users-list');
  api('GET', '/api/users').then(function (list) {
    box.innerHTML = '';
    list.forEach(function (u) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50/60';
      var isMe = ST.user && u.username === ST.user.username;
      row.innerHTML =
        '<div class="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] shrink-0">' +
        esc(u.display_name.slice(0, 2).toUpperCase()) + '</div>' +
        '<div class="flex-1 min-w-0">' +
        '<div class="text-xs font-semibold text-slate-800 truncate">' + esc(u.display_name) +
        (isMe ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-brand-50 text-brand-600 border border-brand-200 text-[10px] font-bold">我</span>' : '') +
        '</div>' +
        '<div class="text-[11px] text-slate-400 font-mono">' + esc(u.username) + ' · ' + esc(u.created) + '</div>' +
        '</div>' +
        '<span class="px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ' +
        (u.role === 'TENANT_ADMIN'
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
          : 'bg-slate-100 text-slate-600 border-slate-200') + '">' +
        esc(roleLabel(u.role)) + '</span>';
      box.appendChild(row);
    });
  }).catch(function (e) {
    box.innerHTML = '<div class="text-xs text-rose-500">加载失败：' + esc(e.message) + '</div>';
  });
}

function handleCreateUserSubmit(e) {
  e.preventDefault();
  var msg = document.getElementById('nu-msg');
  msg.textContent = '';
  var body = {
    username: document.getElementById('nu-username').value.trim(),
    display_name: document.getElementById('nu-display').value.trim(),
    role: document.getElementById('nu-role').value,
    password: document.getElementById('nu-password').value
  };
  api('POST', '/api/users', body).then(function () {
    ['nu-username', 'nu-display', 'nu-password'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    msg.className = 'text-emerald-600 min-h-[16px]';
    msg.textContent = '成员 ' + body.username + ' 已创建';
    showToast('成员 ' + body.username + ' 创建成功（初始密码已生效）');
    loadUsers();
    setTimeout(function () {
      msg.className = 'text-rose-600 min-h-[16px]';
      msg.textContent = '';
    }, 2500);
  }).catch(function (e2) {
    msg.textContent = e2.message || '创建失败';
  });
}

function handleChangePasswordSubmit(e) {
  e.preventDefault();
  var msg = document.getElementById('pwd-msg');
  msg.textContent = '';
  var oldPwd = document.getElementById('pwd-old').value;
  var newPwd = document.getElementById('pwd-new').value;
  var confirmPwd = document.getElementById('pwd-confirm').value;
  if (newPwd !== confirmPwd) {
    msg.textContent = '两次输入的新密码不一致';
    return;
  }
  if (newPwd === oldPwd) {
    msg.textContent = '新密码不能与旧密码相同';
    return;
  }
  api('POST', '/api/auth/password', { old_password: oldPwd, new_password: newPwd }).then(function () {
    document.getElementById('pwd-old').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
    msg.className = 'text-emerald-600 text-xs min-h-[16px]';
    msg.textContent = '密码已修改生效';
    showToast('登录密码已更新');
    setTimeout(function () {
      msg.className = 'text-rose-600 text-xs min-h-[16px]';
      msg.textContent = '';
    }, 2500);
  }).catch(function (e2) {
    msg.textContent = e2.message || '修改失败';
  });
}

function renderUserChip() {
  if (!ST.user) return;
  document.getElementById('header-user-name').textContent = ST.user.display_name;
  document.getElementById('header-user-sub').textContent =
    ST.user.role === 'TENANT_ADMIN' ? '系统管理员' : '工作组成员';
  var initials = ST.user.display_name.slice(0, 2).toUpperCase();
  document.getElementById('header-avatar').textContent = initials;
}

// ---------------------------------------------------------------- 初始化与数据加载

function bootstrap() {
  return Promise.all([loadProjects(), loadBugs()]).then(function () {
    renderProjectHeaderAndSelector();
    renderApp();
  }).catch(function (e) {
    showToast('数据加载失败：' + e.message, 'error');
  });
}

function loadProjects() {
  return api('GET', '/api/projects').then(function (list) {
    ST.projects = list;
    var saved = parseInt(localStorage.getItem('bp_current_proj') || '0', 10);
    if (list.some(function (p) { return p.id === saved; })) ST.currentProjectId = saved;
    else if (list.length) ST.currentProjectId = list[0].id;
    else ST.currentProjectId = 0;
  });
}

function loadBugs() {
  return api('GET', '/api/bugs').then(function (list) {
    ST.bugs = list;
  });
}

function replaceBug(payload) {
  var idx = ST.bugs.findIndex(function (b) { return b.id === payload.id; });
  if (idx >= 0) ST.bugs[idx] = payload; else ST.bugs.unshift(payload);
}

function currentProject() {
  return ST.projects.find(function (p) { return p.id === ST.currentProjectId; }) || null;
}

// ---------------------------------------------------------------- 项目视图

function renderProjectHeaderAndSelector() {
  var select = document.getElementById('project-selector');
  select.innerHTML = '';
  ST.projects.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = '[' + p.key + '] ' + p.name;
    if (p.id === ST.currentProjectId) opt.selected = true;
    select.appendChild(opt);
  });
  var cur = currentProject();
  if (cur) {
    document.getElementById('proj-badge-key').textContent = cur.key;
    document.getElementById('proj-display-name').textContent = cur.name;
    document.getElementById('proj-display-desc').textContent = cur.desc || '暂无项目描述';
    document.getElementById('modal-create-current-proj').textContent = '[' + cur.key + '] ' + cur.name;
  } else {
    document.getElementById('proj-badge-key').textContent = 'NO-KEY';
    document.getElementById('proj-display-name').textContent = '暂无项目，请先新建';
    document.getElementById('proj-display-desc').textContent = '';
  }
}

function handleProjectChange(newProjId) {
  ST.currentProjectId = parseInt(newProjId, 10);
  localStorage.setItem('bp_current_proj', String(ST.currentProjectId));
  renderProjectHeaderAndSelector();
  renderApp();
  var p = currentProject();
  if (p) showToast('已切换至项目：' + p.name);
}

function openCreateProjectModal() {
  document.getElementById('modal-project').classList.remove('hidden');
  document.getElementById('new-proj-name').focus();
}

function closeCreateProjectModal() {
  document.getElementById('modal-project').classList.add('hidden');
  document.getElementById('form-create-project').reset();
  document.getElementById('sample-key-preview').textContent = 'KEY-101';
}

function autoGenerateProjectKey(val) {
  if (!val) return;
  var clean = val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  var keyInput = document.getElementById('new-proj-key');
  if (clean.length >= 2 && !keyInput.dataset.manualEdited) {
    keyInput.value = clean.slice(0, 5);
    document.getElementById('sample-key-preview').textContent = keyInput.value + '-101';
  }
}

function handleCreateProjectSubmit(e) {
  e.preventDefault();
  var name = document.getElementById('new-proj-name').value.trim();
  var key = document.getElementById('new-proj-key').value.trim().toUpperCase();
  var desc = document.getElementById('new-proj-desc').value.trim();
  if (!name || !key) return;
  api('POST', '/api/projects', { key: key, name: name, desc: desc }).then(function (proj) {
    closeCreateProjectModal();
    return loadProjects().then(function () {
      ST.currentProjectId = proj.id;
      localStorage.setItem('bp_current_proj', String(proj.id));
      renderProjectHeaderAndSelector();
      renderApp();
      showToast('项目 [' + key + '] ' + name + ' 已创建并激活！');
    });
  }).catch(function (err) {
    showToast('创建失败：' + err.message, 'error');
  });
}

// ---------------------------------------------------------------- 筛选与渲染

function getCurrentProjectBugs() {
  return ST.bugs.filter(function (b) { return b.projectId === ST.currentProjectId; });
}

function getFilteredBugs() {
  var projectBugs = getCurrentProjectBugs();
  var search = document.getElementById('search-input').value.trim().toLowerCase();
  var statusFilter = document.getElementById('filter-status').value;
  var severityFilter = document.getElementById('filter-severity').value;
  var priorityFilter = document.getElementById('filter-priority').value;

  return projectBugs.filter(function (item) {
    var matchesSearch = !search ||
      item.code.toLowerCase().includes(search) ||
      item.title.toLowerCase().includes(search) ||
      item.assignee.toLowerCase().includes(search) ||
      item.module.toLowerCase().includes(search);
    var matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    var matchesSeverity = severityFilter === 'all' || item.severity === severityFilter;
    var matchesPriority = priorityFilter === 'all' || item.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesSeverity && matchesPriority;
  });
}

function renderApp() {
  updateMetrics();
  renderKanban();
  renderList();
}

function updateMetrics() {
  var projectBugs = getCurrentProjectBugs();
  var counts = { open: 0, in_progress: 0, testing: 0, closed: 0 };
  projectBugs.forEach(function (b) {
    if (counts[b.status] !== undefined) counts[b.status]++;
  });
  document.getElementById('metric-open').textContent = counts.open;
  document.getElementById('metric-in-progress').textContent = counts.in_progress;
  document.getElementById('metric-testing').textContent = counts.testing;
  document.getElementById('metric-closed').textContent = counts.closed;
  document.getElementById('badge-count-open').textContent = counts.open;
  document.getElementById('badge-count-in_progress').textContent = counts.in_progress;
  document.getElementById('badge-count-testing').textContent = counts.testing;
  document.getElementById('badge-count-closed').textContent = counts.closed;
}

function renderKanban() {
  var lanes = {
    open: document.getElementById('lane-open'),
    in_progress: document.getElementById('lane-in_progress'),
    testing: document.getElementById('lane-testing'),
    closed: document.getElementById('lane-closed')
  };
  Object.keys(lanes).forEach(function (k) { lanes[k].innerHTML = ''; });
  var filtered = getFilteredBugs();

  filtered.forEach(function (bug) {
    var sev = SEVERITY_CONFIG[bug.severity] || SEVERITY_CONFIG.major;
    var pri = PRIORITY_CONFIG[bug.priority] || PRIORITY_CONFIG.p2;
    var imageCount = (bug.images && bug.images.length) || 0;

    var card = document.createElement('div');
    card.className = 'bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs hover:shadow-md transition-all cursor-pointer select-none group border-l-4';
    if (bug.severity === 'blocker') card.classList.add('border-l-rose-500');
    else if (bug.severity === 'critical') card.classList.add('border-l-amber-500');
    else if (bug.severity === 'major') card.classList.add('border-l-blue-500');
    else card.classList.add('border-l-slate-300');

    card.draggable = true;
    card.id = 'card-' + bug.id;
    card.ondragstart = function (e) { handleDragStart(e, bug.id); };
    card.onclick = function () { openDetailModal(bug.id); };

    card.innerHTML =
      '<div class="flex items-center justify-between text-xs mb-2">' +
      '<span class="font-mono text-slate-500 font-bold group-hover:text-brand-600 transition">' + esc(bug.code) + '</span>' +
      '<div class="flex items-center space-x-1.5">' +
      '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ' + pri.badge + '">' + pri.label + '</span>' +
      '<span class="px-2 py-0.5 rounded-full text-[10px] font-medium ' + sev.bg + ' ' + sev.text + '">' + sev.label.split(' ')[0] + '</span>' +
      '</div></div>' +
      '<h4 class="text-sm font-semibold text-slate-800 line-clamp-2 mb-2 leading-snug group-hover:text-brand-600 transition">' + esc(bug.title) + '</h4>' +
      (imageCount > 0
        ? '<div class="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">' +
          '<i class="ph-bold ph-image text-xs text-emerald-600"></i>' +
          '<span class="font-medium">含 ' + imageCount + ' 张压缩截图 (长边800)</span></div>'
        : '') +
      '<div class="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">' +
      '<span class="bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-600 font-medium truncate max-w-[110px]">' + esc(bug.module) + '</span>' +
      '<div class="flex items-center space-x-1.5 text-slate-600 font-medium text-xs">' +
      '<i class="ph ph-user-circle text-sm text-slate-400"></i>' +
      '<span>' + esc((bug.assignee || '未指派').split(' ')[0]) + '</span>' +
      '</div></div>';

    if (lanes[bug.status]) lanes[bug.status].appendChild(card);
  });

  Object.keys(lanes).forEach(function (status) {
    if (lanes[status].children.length === 0) {
      lanes[status].innerHTML =
        '<div class="h-28 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 text-xs">' +
        '<i class="ph ph-tray text-xl mb-1 text-slate-300"></i>暂无匹配缺陷</div>';
    }
  });
}

// ---------------------------------------------------------------- 拖拽流转

function handleDragStart(e, bugId) {
  ST.draggedBugId = bugId;
  e.dataTransfer.setData('text/plain', String(bugId));
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e, targetStatus) {
  e.preventDefault();
  if (!ST.draggedBugId) return;
  var bug = ST.bugs.find(function (b) { return b.id === ST.draggedBugId; });
  ST.draggedBugId = null;
  if (!bug || bug.status === targetStatus) return;
  changeBugStatus(bug.id, targetStatus);
}

// ---------------------------------------------------------------- 列表视图

function renderList() {
  var tbody = document.getElementById('list-table-body');
  tbody.innerHTML = '';
  var filtered = getFilteredBugs();
  var currentTotal = getCurrentProjectBugs().length;

  document.getElementById('pagination-visible-count').textContent = filtered.length;
  document.getElementById('pagination-total-count').textContent = currentTotal;

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="11" class="py-12 text-center text-slate-400 text-sm">' +
      '<i class="ph ph-folder-open text-3xl block mx-auto mb-2 text-slate-300"></i>' +
      '当前项目下无符合筛选条件的记录</td></tr>';
    return;
  }

  filtered.forEach(function (bug) {
    var tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/80 transition-colors group cursor-pointer';
    var sev = SEVERITY_CONFIG[bug.severity] || SEVERITY_CONFIG.major;
    var pri = PRIORITY_CONFIG[bug.priority] || PRIORITY_CONFIG.p2;
    var stat = STATUS_CONFIG[bug.status] || STATUS_CONFIG.open;
    var imgCount = (bug.images && bug.images.length) || 0;

    tr.innerHTML =
      '<td class="py-3 px-4 text-center" onclick="event.stopPropagation()">' +
      '<input type="checkbox" class="row-checkbox rounded border-slate-300 text-brand-600 focus:ring-brand-500"></td>' +
      '<td class="py-3 px-3 font-mono text-xs font-bold text-slate-700 group-hover:text-brand-600">' + esc(bug.code) + '</td>' +
      '<td class="py-3 px-4 font-semibold text-slate-800 max-w-xs truncate" title="' + esc(bug.title) + '">' + esc(bug.title) + '</td>' +
      '<td class="py-3 px-3"><span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ' + stat.badge + '">' +
      '<span class="w-1.5 h-1.5 rounded-full ' + stat.dot + '"></span>' + stat.label + '</span></td>' +
      '<td class="py-3 px-3"><span class="inline-flex items-center gap-1 text-xs font-semibold ' + sev.text + '">' +
      '<span class="w-2 h-2 rounded-full ' + sev.dot + '"></span>' + sev.label.split(' ')[0] + '</span></td>' +
      '<td class="py-3 px-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold ' + pri.badge + '">' + pri.label + '</span></td>' +
      '<td class="py-3 px-3">' +
      (imgCount > 0
        ? '<span class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">' +
          '<i class="ph-bold ph-image text-xs"></i> ' + imgCount + ' 张</span>'
        : '<span class="text-slate-300 text-xs">-</span>') +
      '</td>' +
      '<td class="py-3 px-4 text-xs font-medium text-slate-700">' + esc(bug.assignee) + '</td>' +
      '<td class="py-3 px-3 text-xs text-slate-500"><span class="bg-slate-100 px-2 py-0.5 rounded text-slate-600">' + esc(bug.module) + '</span></td>' +
      '<td class="py-3 px-4 text-right" onclick="event.stopPropagation()">' +
      '<div class="inline-flex items-center space-x-1">' +
      '<select onchange="changeBugStatus(' + bug.id + ', this.value)" class="text-xs bg-slate-100 border border-slate-200 rounded px-2 py-1 font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer">' +
      '<option value="open"' + (bug.status === 'open' ? ' selected' : '') + '>待处理</option>' +
      '<option value="in_progress"' + (bug.status === 'in_progress' ? ' selected' : '') + '>进行中</option>' +
      '<option value="testing"' + (bug.status === 'testing' ? ' selected' : '') + '>待验证</option>' +
      '<option value="closed"' + (bug.status === 'closed' ? ' selected' : '') + '>已关闭</option>' +
      '</select>' +
      '<button onclick="deleteBugFromList(' + bug.id + ')" class="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="删除缺陷（含截图）">' +
      '<i class="ph-bold ph-trash text-sm"></i></button>' +
      '</div></td>';

    tr.onclick = function () { openDetailModal(bug.id); };
    tbody.appendChild(tr);
  });
}

function toggleSelectAll(master) {
  document.querySelectorAll('.row-checkbox').forEach(function (cb) { cb.checked = master.checked; });
}

// ---------------------------------------------------------------- 详情抽屉

function openDetailModal(bugId) {
  var bug = ST.bugs.find(function (b) { return b.id === bugId; });
  if (!bug) return;
  ST.currentBugId = bugId;
  renderDetailModalData(bug);
  document.getElementById('modal-detail').classList.remove('hidden');
}

function findCurrentBug() {
  return ST.bugs.find(function (b) { return b.id === ST.currentBugId; }) || null;
}

function renderDetailModalData(bug) {
  document.getElementById('detail-id').textContent = bug.code;
  document.getElementById('detail-title').textContent = bug.title;
  document.getElementById('detail-reporter').textContent = bug.reporter;
  document.getElementById('detail-created-at').textContent = bug.createdAt;
  document.getElementById('detail-module').textContent = bug.module;
  document.getElementById('detail-assignee').innerHTML =
    '<i class="ph-bold ph-user text-slate-400"></i><span>' + esc(bug.assignee) + '</span>';
  document.getElementById('detail-steps').textContent = bug.steps || '无复现步骤';
  document.getElementById('detail-actual').textContent = bug.actual || '未填写';
  document.getElementById('detail-expected').textContent = bug.expected || '未填写';

  var stat = STATUS_CONFIG[bug.status];
  document.getElementById('detail-status-badge').innerHTML =
    '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ' + stat.badge + '">' +
    '<span class="w-2 h-2 rounded-full ' + stat.dot + '"></span>' + stat.label + '</span>';

  var sev = SEVERITY_CONFIG[bug.severity];
  document.getElementById('detail-severity-badge').innerHTML =
    '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ' + sev.bg + ' ' + sev.text + '">' +
    '<span class="w-1.5 h-1.5 rounded-full ' + sev.dot + '"></span>' + sev.label + '</span>';

  var pri = PRIORITY_CONFIG[bug.priority];
  document.getElementById('detail-priority-badge').innerHTML =
    '<span class="px-2 py-0.5 rounded text-xs font-bold ' + pri.badge + '">' + pri.full + '</span>';

  renderDetailTransitions(bug);
  renderDetailScreenshots(bug);
  renderDetailTimeline(bug);
}

function renderDetailTransitions(bug) {
  var container = document.getElementById('detail-transition-buttons');
  container.innerHTML = '';
  function mk(target, cls, icon, label) {
    var btn = document.createElement('button');
    btn.className = cls;
    btn.innerHTML = '<i class="ph-bold ' + icon + '"></i> ' + label;
    btn.onclick = function () { changeBugStatus(bug.id, target); };
    container.appendChild(btn);
  }
  if (bug.status === 'open') {
    mk('in_progress', 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition shadow-2xs flex items-center gap-1', 'ph-play', '开始排查修复');
  } else if (bug.status === 'in_progress') {
    mk('testing', 'px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition shadow-2xs flex items-center gap-1', 'ph-paper-plane-tilt', '提测待验证');
  } else if (bug.status === 'testing') {
    mk('closed', 'px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition shadow-2xs flex items-center gap-1', 'ph-check', '验证通过关闭');
    mk('open', 'px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium transition shadow-2xs flex items-center gap-1', 'ph-arrow-counter-clockwise', '未通过激活');
  } else if (bug.status === 'closed') {
    mk('open', 'px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-medium transition flex items-center gap-1', 'ph-arrow-counter-clockwise', '重新激活缺陷');
  }
}

function renderDetailScreenshots(bug) {
  var container = document.getElementById('detail-attachments-grid');
  var countEl = document.getElementById('detail-attachments-count');
  container.innerHTML = '';
  var images = bug.images || [];
  countEl.textContent = images.length;

  if (images.length === 0) {
    container.innerHTML =
      '<div class="col-span-full py-6 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">' +
      '暂无现场截图，可在此直接按 Ctrl+V 粘贴压缩上传</div>';
    return;
  }

  images.forEach(function (img) {
    var url = imgURL(bug.id, img.id);
    var compSize = (img.width ? img.width + 'x' + img.height : '') + ' (' + Math.max(1, Math.round(img.bytes / 1024)) + 'KB)';
    var card = document.createElement('div');
    card.className = 'group relative bg-white border border-slate-200 rounded-xl overflow-hidden p-1.5 shadow-2xs hover:shadow-md transition flex flex-col';
    card.innerHTML =
      '<div class="relative h-28 w-full bg-slate-900 rounded-lg overflow-hidden cursor-pointer">' +
      '<img src="' + url + '" alt="Screenshot" class="w-full h-full object-cover group-hover:scale-105 transition duration-200">' +
      '<div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">' +
      '<i class="ph-bold ph-magnifying-glass-plus text-xl"></i></div>' +
      '<span class="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">长边800</span></div>' +
      '<div class="mt-2 flex items-center justify-between text-[11px] text-slate-600 px-0.5">' +
      '<span class="font-mono text-[10px] text-slate-500">' + esc(compSize) + '</span>' +
      '<button class="text-slate-400 hover:text-rose-600 p-0.5" title="删除此图">' +
      '<i class="ph-bold ph-trash text-xs"></i></button></div>';
    card.querySelector('div.relative').onclick = function () { openLightbox(url, compSize, img.orig_size || ''); };
    card.querySelector('button').onclick = function () { deleteDetailImage(bug.id, img.id); };
    container.appendChild(card);
  });
}

function renderDetailTimeline(bug) {
  var container = document.getElementById('detail-timeline');
  container.innerHTML = '';
  if (!bug.comments || bug.comments.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 italic">暂无流转历史与讨论</div>';
    return;
  }
  bug.comments.forEach(function (c) {
    var item = document.createElement('div');
    item.className = 'flex items-start space-x-3 text-xs';
    item.innerHTML =
      '<div class="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center shrink-0 text-[10px]">' +
      esc(c.author.slice(0, 1)) + '</div>' +
      '<div class="flex-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200">' +
      '<div class="flex items-center justify-between mb-1">' +
      '<span class="font-bold text-slate-800">' + esc(c.author) + '</span>' +
      '<span class="text-[10px] text-slate-400 font-mono">' + esc(c.created) + '</span></div>' +
      '<p class="text-slate-600 leading-relaxed">' + esc(c.text) + '</p></div>';
    container.appendChild(item);
  });
}

function closeDetailModal() {
  document.getElementById('modal-detail').classList.add('hidden');
  ST.currentBugId = null;
}

// ---------------------------------------------------------------- 缺陷操作

function changeBugStatus(bugId, nextStatus) {
  api('POST', '/api/bugs/' + bugId + '/status', { status: nextStatus }).then(function (payload) {
    replaceBug(payload);
    renderApp();
    if (ST.currentBugId === bugId) renderDetailModalData(payload);
    showToast('缺陷 ' + payload.code + ' 状态已流转为 [' + STATUS_CONFIG[nextStatus].label + ']');
  }).catch(function (e) {
    showToast('状态流转失败：' + e.message, 'error');
  });
}

function submitDetailComment() {
  var bug = findCurrentBug();
  if (!bug) return;
  var input = document.getElementById('input-new-comment');
  var text = input.value.trim();
  if (!text) return;
  api('POST', '/api/bugs/' + bug.id + '/comments', { text: text }).then(function (payload) {
    replaceBug(payload);
    input.value = '';
    renderDetailTimeline(payload);
    showToast('动态已更新');
  }).catch(function (e) {
    showToast('提交失败：' + e.message, 'error');
  });
}

// 删除缺陷（含级联删除关联截图）
function deleteBugConfirm(bugId) {
  var bug = ST.bugs.find(function (b) { return b.id === bugId; });
  if (!bug) return;
  var imgCount = (bug.images || []).length;
  if (!confirm('确认删除缺陷 ' + bug.code + '？\n将同时删除其 ' + imgCount + ' 张截图与全部讨论记录，且不可恢复。')) return;
  api('DELETE', '/api/bugs/' + bugId).then(function (d) {
    ST.bugs = ST.bugs.filter(function (b) { return b.id !== bugId; });
    if (ST.currentBugId === bugId) closeDetailModal();
    renderApp();
    showToast('缺陷 ' + d.code + ' 已删除（含 ' + d.deletedImages + ' 张截图）');
  }).catch(function (e) {
    showToast('删除失败：' + e.message, 'error');
  });
}

function deleteBugFromList(bugId) {
  deleteBugConfirm(bugId);
}

function deleteCurrentBug() {
  if (ST.currentBugId) deleteBugConfirm(ST.currentBugId);
}

function deleteDetailImage(bugId, imgId) {
  api('DELETE', '/api/bugs/' + bugId + '/images/' + imgId).then(function (payload) {
    replaceBug(payload);
    renderDetailScreenshots(payload);
    renderKanban();
    renderList();
    showToast('已删除截图');
  }).catch(function (e) {
    showToast('删除失败：' + e.message, 'error');
  });
}

// ---------------------------------------------------------------- 新建缺陷

function openCreateBugModal(defaultStatus) {
  var cur = currentProject();
  if (!cur) {
    showToast('请先创建项目', 'info');
    openCreateProjectModal();
    return;
  }
  document.getElementById('modal-create-current-proj').textContent = '[' + cur.key + '] ' + cur.name;
  document.getElementById('create-status').value = defaultStatus || 'open';
  ST.stagedImages = [];
  renderCreateStagedImages();
  document.getElementById('modal-create').classList.remove('hidden');
  document.getElementById('create-title').focus();
}

function closeCreateBugModal() {
  document.getElementById('modal-create').classList.add('hidden');
  document.getElementById('form-create-bug').reset();
  ST.stagedImages = [];
  renderCreateStagedImages();
}

function handleCreateBugSubmit(e) {
  e.preventDefault();
  var cur = currentProject();
  if (!cur) return;
  var body = {
    projectId: cur.id,
    title: document.getElementById('create-title').value.trim(),
    module: document.getElementById('create-module').value.trim(),
    status: document.getElementById('create-status').value,
    severity: document.getElementById('create-severity').value,
    priority: document.getElementById('create-priority').value,
    assignee: document.getElementById('create-assignee').value.trim() || '未指派',
    steps: document.getElementById('create-steps').value.trim(),
    actual: document.getElementById('create-actual').value.trim(),
    expected: document.getElementById('create-expected').value.trim(),
    images: ST.stagedImages.map(function (img) {
      return { dataUrl: img.dataUrl, width: img.width, height: img.height, bytes: img.bytes, origSize: img.origSize };
    })
  };
  if (!body.title || !body.module) {
    showToast('标题与模块为必填项', 'error');
    return;
  }
  api('POST', '/api/bugs', body).then(function (payload) {
    closeCreateBugModal();
    ST.bugs.unshift(payload);
    renderApp();
    showToast('已成功录入缺陷 ' + payload.code + ' 并隔离于当前项目');
  }).catch(function (e2) {
    showToast('提交失败：' + e2.message, 'error');
  });
}

function renderCreateStagedImages() {
  var container = document.getElementById('create-attachments-preview');
  container.innerHTML = '';
  ST.stagedImages.forEach(function (imgObj, idx) {
    var div = document.createElement('div');
    div.className = 'relative group bg-slate-100 rounded-xl overflow-hidden border border-slate-200 p-1 flex flex-col';
    div.innerHTML =
      '<div class="relative w-full h-24 overflow-hidden rounded-lg bg-slate-900 cursor-pointer" onclick="openLightbox(\'' + imgObj.dataUrl + '\', \'' + esc(imgObj.compressedSize) + '\', \'' + esc(imgObj.origSize) + '\')">' +
      '<img src="' + imgObj.dataUrl + '" class="w-full h-full object-cover group-hover:scale-105 transition duration-200">' +
      '<span class="absolute bottom-1 right-1 text-[10px] bg-slate-900/80 text-emerald-400 font-mono px-1 rounded">75% JPG</span></div>' +
      '<div class="mt-1 px-1 flex items-center justify-between text-[10px] text-slate-500">' +
      '<span class="truncate font-mono">' + esc(imgObj.compressedSize) + '</span>' +
      '<button type="button" onclick="removeStagedCreateImage(' + idx + ')" class="text-rose-500 hover:text-rose-700 p-0.5" title="移除此图">' +
      '<i class="ph-bold ph-trash text-xs"></i></button></div>';
    container.appendChild(div);
  });
}

function removeStagedCreateImage(idx) {
  ST.stagedImages.splice(idx, 1);
  renderCreateStagedImages();
}

// ---------------------------------------------------------------- 图片压缩与上传

/** 客户端压缩：长边≤800、JPEG 75% 质量（与原型一致），返回 {dataUrl,...} */
function compressImageFile(fileOrBlob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    var originalByteSize = (fileOrBlob.size / 1024).toFixed(1) + ' KB';
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var origWidth = img.width, origHeight = img.height;
        var targetWidth = origWidth, targetHeight = origHeight;
        var MAX_EDGE = 800;
        if (origWidth > origHeight) {
          if (origWidth > MAX_EDGE) { targetWidth = MAX_EDGE; targetHeight = Math.round(origHeight * MAX_EDGE / origWidth); }
        } else {
          if (origHeight > MAX_EDGE) { targetHeight = MAX_EDGE; targetWidth = Math.round(origWidth * MAX_EDGE / origHeight); }
        }
        var canvas = document.createElement('canvas');
        canvas.width = targetWidth; canvas.height = targetHeight;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        var compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
        var head = 'data:image/jpeg;base64,';
        var approxBytes = (compressedDataUrl.length - head.length) * 3 / 4;
        resolve({
          dataUrl: compressedDataUrl,
          origSize: origWidth + 'x' + origHeight + ' (' + originalByteSize + ')',
          compressedSize: targetWidth + 'x' + targetHeight + ' (' + (approxBytes / 1024).toFixed(1) + ' KB)',
          width: targetWidth, height: targetHeight,
          bytes: Math.round(approxBytes)
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });
}

function dataUrlToBlob(dataUrl) {
  var parts = dataUrl.split(',');
  var bin = atob(parts[1]);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

function appendImageToBug(bugId, compressed) {
  var fd = new FormData();
  fd.append('file', dataUrlToBlob(compressed.dataUrl), 'screenshot.jpg');
  return fetch(API + '/api/bugs/' + bugId + '/images', {
    method: 'POST',
    headers: ST.token ? { 'Authorization': 'Bearer ' + ST.token } : {},
    body: fd
  }).then(function (r) {
    if (r.status === 401) { showLogin(); throw new Error('未登录'); }
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.detail || '上传失败'); });
    return r.json();
  }).then(function (payload) {
    replaceBug(payload);
    renderDetailModalData(payload);
    renderKanban();
    renderList();
    showToast('已将压缩截图追加至 ' + payload.code);
  });
}

async function processPastedImage(imageBlob) {
  showToast('正在智能压缩剪贴板截图 (长边≤800, 质量75%)...', 'info');
  try {
    var compressed = await compressImageFile(imageBlob);
    var isCreateModalOpen = !document.getElementById('modal-create').classList.contains('hidden');
    var isDetailModalOpen = !document.getElementById('modal-detail').classList.contains('hidden');
    if (isCreateModalOpen) {
      ST.stagedImages.push(compressed);
      renderCreateStagedImages();
      showToast('已捕获截图并压缩至 ' + compressed.compressedSize);
    } else if (isDetailModalOpen && ST.currentBugId) {
      await appendImageToBug(ST.currentBugId, compressed);
    } else {
      openCreateBugModal('open');
      ST.stagedImages.push(compressed);
      renderCreateStagedImages();
      showToast('检测到截图粘贴，已为您开启新建缺陷窗口并挂载 (' + compressed.compressedSize + ')');
    }
  } catch (err) {
    showToast('图片处理异常，请重试', 'error');
  }
}

function setupClipboardListener() {
  window.addEventListener('paste', function (event) {
    var clipboardItems = event.clipboardData && event.clipboardData.items;
    if (!clipboardItems) return;
    var foundImage = false;
    for (var i = 0; i < clipboardItems.length; i++) {
      var item = clipboardItems[i];
      if (item.type.indexOf('image') !== -1) {
        foundImage = true;
        var blob = item.getAsFile();
        if (blob) processPastedImage(blob);
      }
    }
    if (foundImage) event.preventDefault();
  });
}

async function handleFileInputSelect(e, targetContext) {
  var files = e.target.files;
  if (!files || files.length === 0) return;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.type.startsWith('image/')) {
      var compressed = await compressImageFile(file);
      if (targetContext === 'create') {
        ST.stagedImages.push(compressed);
        renderCreateStagedImages();
      } else if (targetContext === 'detail' && ST.currentBugId) {
        await appendImageToBug(ST.currentBugId, compressed);
      }
    }
  }
  e.target.value = '';
  if (targetContext === 'create') showToast('图片已等比压缩并挂载 (长边800 / 质量75%)');
}

function setupDropzones() {
  var zones = [document.getElementById('create-dropzone'), document.getElementById('detail-paste-dropzone')];
  zones.forEach(function (zone) {
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', async function (e) {
      var files = e.dataTransfer.files;
      if (files && files.length > 0) {
        for (var f of files) {
          if (f.type.startsWith('image/')) await processPastedImage(f);
        }
      }
    });
  });
}

// ---------------------------------------------------------------- 灯箱与提示

function openLightbox(imgUrl, compSize, origSize) {
  var modal = document.getElementById('lightbox-modal');
  document.getElementById('lightbox-image').src = imgUrl;
  var link = document.getElementById('lightbox-download-link');
  link.href = imgUrl;
  document.getElementById('lightbox-meta').textContent =
    '客户端长边800压缩规格: ' + compSize + ' · 原始来源: ' + (origSize || '剪贴板');
  modal.classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox-modal').classList.add('hidden');
  document.getElementById('lightbox-image').src = '';
}

function switchView(viewName) {
  var kanbanView = document.getElementById('view-kanban');
  var listView = document.getElementById('view-list');
  var tabKanban = document.getElementById('tab-kanban');
  var tabList = document.getElementById('tab-list');
  var activeCls = 'flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition bg-white text-slate-800 shadow-2xs';
  var idleCls = 'flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md transition text-slate-600 hover:text-slate-900';
  if (viewName === 'kanban') {
    kanbanView.classList.remove('hidden'); listView.classList.add('hidden');
    tabKanban.className = activeCls; tabList.className = idleCls;
  } else {
    kanbanView.classList.add('hidden'); listView.classList.remove('hidden');
    tabList.className = activeCls; tabKanban.className = idleCls;
  }
}

function filterByQuickStatus(status) {
  document.getElementById('filter-status').value = status;
  renderApp();
}

function showToast(msg, type) {
  type = type || 'success';
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  var icon = 'ph-bold ph-check-circle text-emerald-400';
  if (type === 'info') icon = 'ph-bold ph-info text-blue-400';
  if (type === 'error') icon = 'ph-bold ph-warning-circle text-rose-400';
  toast.className = 'bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2.5 border border-slate-700/80 pointer-events-auto max-w-sm';
  toast.innerHTML = '<i class="' + icon + ' text-base shrink-0"></i><span class="leading-snug">' + esc(msg) + '</span>';
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(function () { toast.remove(); }, 250);
  }, 3000);
}

// ---------------------------------------------------------------- AI 修复弹窗

function openAiFixModal() {
  var modal = document.getElementById('modal-ai-fix');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  loadAiFixList();
}

function closeAiFixModal() {
  var modal = document.getElementById('modal-ai-fix');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function loadAiFixList() {
  var box = document.getElementById('ai-fix-list');
  box.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">加载中…</p>';
  fetch(API + '/api/bugs/open-list')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok || !j.items.length) {
        box.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">没有待处理的缺陷</p>';
        return;
      }
      var SEV = { blocker: '致命', critical: '严重', major: '一般', minor: '轻微' };
      box.innerHTML = j.items.map(function (b) {
        var sev = SEV[b.severity] || b.severity;
        var plugin = b.source_plugin || '未知';
        return '<div class="border border-slate-200 rounded-lg p-3 hover:border-violet-300 transition">' +
          '<div class="flex items-center justify-between mb-1">' +
            '<span class="font-mono text-xs text-slate-400">' + esc(b.code) + '</span>' +
            '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">' + esc(sev) + '</span>' +
          '</div>' +
          '<p class="text-sm font-medium text-slate-800 mb-1">' + esc(b.title) + '</p>' +
          '<p class="text-xs text-slate-500 mb-2">来源：' + esc(plugin) + ' · ' + esc(b.created || '') + '</p>' +
          '<button onclick="copyBugForAi(' + b.id + ')" class="text-xs px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded transition">复制给 Trae</button>' +
        '</div>';
      }).join('');
      // 缓存供复制用
      ST._aiFixBugs = {};
      j.items.forEach(function (b) { ST._aiFixBugs[b.id] = b; });
    })
    .catch(function () {
      box.innerHTML = '<p class="text-sm text-rose-500 text-center py-8">加载失败</p>';
    });
}

function copyBugForAi(bugId) {
  var b = (ST._aiFixBugs || {})[bugId];
  if (!b) return showToast('缺陷信息不存在', 'error');
  var text = '请修复以下缺陷：\n\n' +
    '缺陷编号：' + b.code + '\n' +
    '标题：' + b.title + '\n' +
    '严重度：' + b.severity + '\n' +
    '来源插件：' + (b.source_plugin || '未知') + '\n' +
    '模块：' + (b.module || '未指定') + '\n' +
    '复现步骤：\n' + (b.steps || '未提供') + '\n\n' +
    '实际结果：\n' + (b.actual || '未提供') + '\n\n' +
    '期望结果：\n' + (b.expected || '未提供') + '\n\n' +
    '修复后请调用以下 API 将缺陷状态改为 testing：\n' +
    'POST /api/bugs/' + b.id + '/status  body: {"status":"testing"}';
  navigator.clipboard.writeText(text).then(function () {
    showToast('已复制，请粘贴给 Trae');
  }).catch(function () {
    // 降级：textarea 复制
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('已复制，请粘贴给 Trae');
  });
}

// ---------------------------------------------------------------- 生命周期

document.getElementById('new-proj-key').addEventListener('input', function () {
  this.dataset.manualEdited = 'true';
  this.value = this.value.toUpperCase();
  document.getElementById('sample-key-preview').textContent = (this.value || 'KEY') + '-101';
});

window.addEventListener('DOMContentLoaded', function () {
  setupClipboardListener();
  setupDropzones();

  document.getElementById('search-input').addEventListener('input', renderApp);
  document.getElementById('filter-status').addEventListener('change', renderApp);
  document.getElementById('filter-severity').addEventListener('change', renderApp);
  document.getElementById('filter-priority').addEventListener('change', renderApp);

  document.getElementById('btn-reset-filters').addEventListener('click', function () {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-status').value = 'all';
    document.getElementById('filter-severity').value = 'all';
    document.getElementById('filter-priority').value = 'all';
    renderApp();
    showToast('已重置所有过滤条件');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeLightbox();
      closeDetailModal();
      closeCreateBugModal();
      closeCreateProjectModal();
      closeUsersModal();
      closeAiFixModal();
    }
  });

  // 鉴权入口：有 token 先试 /api/auth/me，失败回登录页
  if (ST.token) {
    api('GET', '/api/auth/me').then(function (d) {
      ST.user = d.user;
      renderUserChip();
      return bootstrap();
    }).catch(function () {
      showLogin();
    });
  } else {
    showLogin();
  }
});
