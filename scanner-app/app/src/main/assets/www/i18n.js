/* i18n.js — 多语言字典与切换 */
var I18N = {
  zh: {
    appTitle: 'UHF 盘点助手',
    connected: 'RFID 就绪',
    disconnected: 'RFID 未就绪',
    serverUrl: '服务器接口地址',
    saveUrl: '保存',
    urlSaved: '✓ 已保存',
    urlTip: '从盘点页二维码旁复制接口地址粘贴到这里',
    powerLabel: '功率 (dBm)',
    statusIdle: '未开始',
    statusScanning: '扫描中…',
    statusPaused: '已暂停',
    statusIdleSub: '按住扫描键 或 点击【开始盘点】',
    statusScanSub: '正在读取标签，松开扫描键暂停',
    statusPauseSub: '点击【继续】或按住扫描键',
    btnStart: '开始盘点',
    btnPause: '暂停',
    btnResume: '继续',
    btnStop: '结束并上传',
    statScanned: '已扫',
    statUnique: '唯一标签',
    tabList: '扫描明细',
    emptyList: '暂无盘点数据',
    emptyHint: '开始盘点后扫描商品标签',
    colEpc: 'EPC',
    colCount: '次数',
    colTime: '时间',
    uploading: '正在上传盘点结果…',
    uploadOk: '上传完成',
    uploadFail: '上传失败，已存入待传队列',
    resultTitle: '盘点结果',
    resScanned: '扫描',
    resBook: '账面',
    resMatched: '相符',
    resSurplus: '盘盈',
    resShortage: '盘亏',
    resAbnormal: '异常',
    pendingQueue: '待传队列',
    retryNow: '立即重传',
    clearList: '清空列表',
    confirmClear: '确定清空本机扫描记录？',
    noServer: '请先保存服务器接口地址',
    rfidFail: 'RFID 模块初始化失败，请确认在 C27 设备上运行',
    demoMode: '演示模式（无 RFID 硬件）',
    shortageList: '盘亏明细',
    surplusList: '盘盈明细',
    abnormalList: '异常明细',
    close: '关闭',
    deviceLabel: '设备名称',
    deviceDefault: 'PDA-01',
  },
  en: {
    appTitle: 'UHF Stocktake',
    connected: 'RFID Ready',
    disconnected: 'RFID Not Ready',
    serverUrl: 'Server API URL',
    saveUrl: 'Save',
    urlSaved: '✓ Saved',
    urlTip: 'Copy the API URL from the stocktake QR section on the web console',
    powerLabel: 'Power (dBm)',
    statusIdle: 'Idle',
    statusScanning: 'Scanning…',
    statusPaused: 'Paused',
    statusIdleSub: 'Hold trigger or tap [Start]',
    statusScanSub: 'Reading tags, release trigger to pause',
    statusPauseSub: 'Tap [Resume] or hold trigger',
    btnStart: 'Start',
    btnPause: 'Pause',
    btnResume: 'Resume',
    btnStop: 'Stop & Upload',
    statScanned: 'Scanned',
    statUnique: 'Unique',
    tabList: 'Scan Details',
    emptyList: 'No data',
    emptyHint: 'Start inventory to scan tags',
    colEpc: 'EPC',
    colCount: 'Count',
    colTime: 'Time',
    uploading: 'Uploading results…',
    uploadOk: 'Upload complete',
    uploadFail: 'Upload failed, queued for retry',
    resultTitle: 'Stocktake Result',
    resScanned: 'Scanned',
    resBook: 'Book',
    resMatched: 'Matched',
    resSurplus: 'Surplus',
    resShortage: 'Shortage',
    resAbnormal: 'Abnormal',
    pendingQueue: 'Pending Uploads',
    retryNow: 'Retry Now',
    clearList: 'Clear List',
    confirmClear: 'Clear all scanned records on this device?',
    noServer: 'Please save the server API URL first',
    rfidFail: 'RFID module init failed. Please run on a C27 device.',
    demoMode: 'Demo mode (no RFID hardware)',
    shortageList: 'Shortage Details',
    surplusList: 'Surplus Details',
    abnormalList: 'Abnormal Details',
    close: 'Close',
    deviceLabel: 'Device Name',
    deviceDefault: 'PDA-01',
  }
};

var LANG = localStorage.getItem('uhf_lang') || 'zh';

function t(key) {
  var dict = I18N[LANG] || I18N.zh;
  return dict[key] !== undefined ? dict[key] : (I18N.zh[key] || key);
}

function setLang(lang) {
  LANG = lang;
  localStorage.setItem('uhf_lang', lang);
  applyI18n();
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
    el.placeholder = t(el.getAttribute('data-i18n-ph'));
  });
  var btn = document.getElementById('langBtn');
  if (btn) btn.textContent = LANG === 'zh' ? 'EN' : '中文';
  if (typeof renderAll === 'function') renderAll();
}
