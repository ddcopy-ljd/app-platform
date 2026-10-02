/* app.js — C27 UHF RFID 盘点手持机 App */

var RFID = window.RFID || null;
var isRfidReady = false;
var isScanning = false;
var isPaused = false;
var scanMap = {};       // epc -> { count, time }
var scanOrder = [];     // epc insertion order
var deviceName = '';
var serverUrl = '';
var uploadResult = null;
var scanInterval = null;
var demoTimer = null;

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', function () {
  loadSettings();
  checkRfid();
  applyI18n();
  renderList();
  updateStats();
  updateCtrl();
  scheduleRetry();
});

function loadSettings() {
  serverUrl = localStorage.getItem('uhf_url') || '';
  document.getElementById('urlInput').value = serverUrl;
  deviceName = localStorage.getItem('uhf_device') || '';
  document.getElementById('deviceName').value = deviceName;
}

function saveUrl() {
  serverUrl = document.getElementById('urlInput').value.trim();
  deviceName = document.getElementById('deviceName').value.trim() || 'PDA-01';
  localStorage.setItem('uhf_url', serverUrl);
  localStorage.setItem('uhf_device', deviceName);
  toast(t('urlSaved'));
}

/* ---- RFID Bridge ---- */
function checkRfid() {
  if (RFID && typeof RFID.isReady === 'function' && RFID.isReady()) {
    isRfidReady = true;
    setRfidUi('ok', t('connected'));
    var ver = RFID.getVersion ? RFID.getVersion() : '';
    if (ver) document.getElementById('rfidText').textContent = t('connected') + ' (' + ver + ')';
  } else {
    isRfidReady = false;
    setRfidUi('warn', t('rfidFail'));
  }
}

function setRfidUi(cls, txt) {
  var dot = document.getElementById('rfidDot');
  var text = document.getElementById('rfidText');
  dot.className = 'status-dot ' + cls;
  text.className = 'status-txt ' + cls;
  text.textContent = txt;
}

function setPower() {
  if (!isRfidReady) return;
  var p = parseInt(document.getElementById('powerSelect').value, 10);
  if (RFID.setPower) RFID.setPower(p);
}

/* ---- Scan Callback (from Kotlin) ---- */
window.onRfidScan = function (json) {
  if (!isScanning || isPaused) return;
  var epc = json.epc || '';
  if (!epc) return;
  addScan(epc);
};

function addScan(epc) {
  var now = new Date();
  var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  if (scanMap[epc]) {
    scanMap[epc].count++;
    scanMap[epc].time = time;
  } else {
    scanMap[epc] = { count: 1, time: time };
    scanOrder.push(epc);
  }
  renderList();
  updateStats();
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/* ---- Scan Control ---- */
function startScan() {
  if (isScanning) return;
  isScanning = true;
  isPaused = false;
  updateCtrl();

  if (isRfidReady && RFID.startScan) {
    RFID.startScan();
  } else {
    // Demo mode: simulate periodic scans
    startDemoScan();
  }
}

function pauseScan() {
  if (!isScanning || isPaused) return;
  isPaused = true;
  updateCtrl();
  if (isRfidReady && RFID.stopScan) RFID.stopScan();
  stopDemoScan();
}

function resumeScan() {
  if (!isScanning || !isPaused) return;
  isPaused = false;
  updateCtrl();
  if (isRfidReady && RFID.startScan) RFID.startScan();
  else startDemoScan();
}

function stopScan() {
  if (!isScanning) return;
  isScanning = false;
  isPaused = false;
  updateCtrl();
  if (isRfidReady && RFID.stopScan) RFID.stopScan();
  stopDemoScan();

  if (!serverUrl) {
    toast(t('noServer'));
    return;
  }
  doUpload();
}

function updateCtrl() {
  var state = document.getElementById('ctrlState');
  var sub = document.getElementById('ctrlSub');
  var btnStart = document.getElementById('btnStart');
  var btnPause = document.getElementById('btnPause');
  var btnResume = document.getElementById('btnResume');
  var btnStop = document.getElementById('btnStop');

  btnStart.classList.add('btn-hidden');
  btnPause.classList.add('btn-hidden');
  btnResume.classList.add('btn-hidden');

  if (!isScanning) {
    state.textContent = t('statusIdle');
    sub.textContent = t('statusIdleSub');
    btnStart.classList.remove('btn-hidden');
  } else if (isPaused) {
    state.textContent = t('statusPaused');
    sub.textContent = t('statusPauseSub');
    btnResume.classList.remove('btn-hidden');
  } else {
    state.textContent = t('statusScanning');
    sub.textContent = t('statusScanSub');
    btnPause.classList.remove('btn-hidden');
  }
}

/* ---- Demo Mode ---- */
function startDemoScan() {
  stopDemoScan();
  var demos = [
    'E28011606000020999A1C14501',
    'E28011606000020999A1C14588',
    'E28054BBCD38A0684EE6J008',
    'E280F448322EC03E8AE9J002'
  ];
  var idx = 0;
  demoTimer = setInterval(function () {
    if (Math.random() > 0.3) {
      addScan(demos[idx % demos.length]);
      idx++;
    }
  }, 800);
}

function stopDemoScan() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
}

/* ---- List & Stats ---- */
function renderList() {
  var container = document.getElementById('scanList');
  if (scanOrder.length === 0) {
    container.innerHTML = '<div class="empty">' + t('emptyList') + '<br><span style="color:#333;">' + t('emptyHint') + '</span></div>';
    return;
  }
  var html = '';
  for (var i = scanOrder.length - 1; i >= 0; i--) {
    var epc = scanOrder[i];
    var item = scanMap[epc];
    html += '<div class="list-item"><div class="list-epc">' + escapeHtml(epc) + '</div>' +
            '<div class="list-meta"><div class="list-count">×' + item.count + '</div><div>' + item.time + '</div></div></div>';
  }
  container.innerHTML = html;
}

function updateStats() {
  var total = 0;
  for (var k in scanMap) total += scanMap[k].count;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statUnique').textContent = scanOrder.length;
  document.getElementById('statPending').textContent = getPendingCount();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearList() {
  if (!confirm(t('confirmClear'))) return;
  scanMap = {};
  scanOrder = [];
  uploadResult = null;
  document.getElementById('btnResult').style.display = 'none';
  renderList();
  updateStats();
}

/* ---- Upload ---- */
function doUpload() {
  if (!serverUrl) { toast(t('noServer')); return; }
  var epcs = scanOrder.slice();
  if (epcs.length === 0) { toast('No tags to upload'); return; }

  showModal('uploadModal');
  var bar = document.getElementById('progBar');
  var txt = document.getElementById('progTxt');
  bar.style.width = '30%';
  txt.textContent = epcs.length + ' tags';

  var body = JSON.stringify({
    epcs: epcs,
    device: deviceName || 'PDA-01'
  });

  fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body
  }).then(function (res) {
    bar.style.width = '70%';
    return res.json().then(function (data) {
      return { ok: res.ok, status: res.status, data: data };
    });
  }).then(function (r) {
    bar.style.width = '100%';
    if (r.ok) {
      uploadResult = r.data;
      document.getElementById('btnResult').style.display = '';
      toast(t('uploadOk'));
      // Show result modal after short delay
      setTimeout(function () {
        closeModal('uploadModal');
        populateResult(r.data);
        showModal('resultModal');
      }, 500);
    } else {
      queueUpload(epcs);
      closeModal('uploadModal');
      toast(t('uploadFail') + ' (' + r.status + ')');
    }
  }).catch(function (err) {
    queueUpload(epcs);
    closeModal('uploadModal');
    toast(t('uploadFail'));
  });
}

function queueUpload(epcs) {
  var q = JSON.parse(localStorage.getItem('uhf_queue') || '[]');
  q.push({ epcs: epcs, device: deviceName || 'PDA-01', time: Date.now() });
  localStorage.setItem('uhf_queue', JSON.stringify(q));
  updateStats();
}

function getPendingCount() {
  var q = JSON.parse(localStorage.getItem('uhf_queue') || '[]');
  return q.length;
}

function showPending() {
  var q = JSON.parse(localStorage.getItem('uhf_queue') || '[]');
  var list = document.getElementById('pendingList');
  if (q.length === 0) {
    list.innerHTML = '<div class="empty">' + t('emptyList') + '</div>';
  } else {
    var html = '';
    q.forEach(function (item, i) {
      var d = new Date(item.time);
      html += '<div class="result-item">#' + (i + 1) + ' ' + item.epcs.length + ' tags <span style="color:#666;">' + d.toLocaleString() + '</span></div>';
    });
    list.innerHTML = html;
  }
  showModal('pendingModal');
}

function retryAll() {
  var q = JSON.parse(localStorage.getItem('uhf_queue') || '[]');
  if (q.length === 0 || !serverUrl) { closeModal('pendingModal'); return; }

  showModal('uploadModal');
  var bar = document.getElementById('progBar');
  var txt = document.getElementById('progTxt');
  bar.style.width = '10%';
  txt.textContent = 'Retrying ' + q.length + ' batches…';

  var success = [];
  var promises = q.map(function (item) {
    return fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    }).then(function (res) {
      if (res.ok) { success.push(item); }
    }).catch(function () {});
  });

  Promise.all(promises).then(function () {
    var remain = q.filter(function (x) { return success.indexOf(x) === -1; });
    localStorage.setItem('uhf_queue', JSON.stringify(remain));
    bar.style.width = '100%';
    txt.textContent = 'Done — ' + (q.length - remain.length) + ' / ' + q.length + ' sent';
    updateStats();
    setTimeout(function () { closeModal('uploadModal'); }, 800);
  });
}

function scheduleRetry() {
  setInterval(function () {
    var q = JSON.parse(localStorage.getItem('uhf_queue') || '[]');
    if (q.length > 0 && serverUrl && navigator.onLine) {
      retryAll();
    }
  }, 60000); // Retry every 60s if online
}

/* ---- Result Display ---- */
function showResult() {
  if (uploadResult) {
    populateResult(uploadResult);
    showModal('resultModal');
  }
}

function populateResult(data) {
  document.getElementById('resScanned').textContent = data.scanned_count || 0;
  document.getElementById('resBook').textContent = data.book_count || 0;
  document.getElementById('resMatched').textContent = data.matched_count || 0;
  document.getElementById('resSurplus').textContent = data.surplus_count || 0;
  document.getElementById('resShortage').textContent = data.shortage_count || 0;
  document.getElementById('resAbnormal').textContent = data.abnormal_count || 0;

  var detail = document.getElementById('resDetail');
  var html = '';
  var items = data.items || [];

  var surplus = items.filter(function (x) { return x.result === '盘盈' || x.result === 'surplus'; });
  var shortage = items.filter(function (x) { return x.result === '盘亏' || x.result === 'shortage'; });
  var abnormal = items.filter(function (x) { return x.result === '异常' || x.result === 'abnormal'; });

  if (surplus.length > 0) {
    html += '<div class="result-sect"><h4>' + t('surplusList') + '</h4>';
    surplus.forEach(function (x) { html += '<div class="result-item">' + escapeHtml(x.epc) + ' <span class="badge warn">' + x.result + '</span></div>'; });
    html += '</div>';
  }
  if (shortage.length > 0) {
    html += '<div class="result-sect"><h4>' + t('shortageList') + '</h4>';
    shortage.forEach(function (x) { html += '<div class="result-item">' + escapeHtml(x.epc || x.code || '') + ' <span class="badge err">' + x.result + '</span></div>'; });
    html += '</div>';
  }
  if (abnormal.length > 0) {
    html += '<div class="result-sect"><h4>' + t('abnormalList') + '</h4>';
    abnormal.forEach(function (x) { html += '<div class="result-item">' + escapeHtml(x.epc) + ' <span class="badge err">' + x.result + '</span></div>'; });
    html += '</div>';
  }
  detail.innerHTML = html || '<div style="color:#555;font-size:11px;">All matched</div>';
}

/* ---- Modal ---- */
function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ---- Language ---- */
function toggleLang() {
  setLang(LANG === 'zh' ? 'en' : 'zh');
}

/* ---- Toast ---- */
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2500);
}

/* ---- C27 Hardware Trigger Key ---- */
document.addEventListener('keydown', function (e) {
  // C27 common trigger keys: F4 (115), BUTTON_L1 (102), BUTTON_R1 (103)
  var triggerKeys = [102, 103, 115, 139, 280, 281];
  if (triggerKeys.indexOf(e.keyCode) >= 0) {
    e.preventDefault();
    if (!isScanning) startScan();
    else if (isPaused) resumeScan();
  }
});

document.addEventListener('keyup', function (e) {
  var triggerKeys = [102, 103, 115, 139, 280, 281];
  if (triggerKeys.indexOf(e.keyCode) >= 0) {
    e.preventDefault();
    if (isScanning && !isPaused) pauseScan();
  }
});
