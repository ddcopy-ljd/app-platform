const { createApp, ref, reactive, computed, nextTick, onMounted } = Vue;
const { api, fmtSize } = Platform;

const STATUS = {
  uploaded: ['📦 已上传 · 待处理', 'b-gray'],
  preparing: ['🔄 数据准备中', 'b-doing'],
  trial: ['🧪 试运行中', 'b-warn'],
  trial_passed: ['✅ 试运行通过 · 待切换', 'b-ok'],
  switching: ['⏸ 切换中 · 全量重迁', 'b-err'],
  ready: ['💾 数据已就绪', 'b-ok'],
  failed: ['❌ 失败', 'b-err'],
};

const cmpVer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

createApp({
  setup() {
    const plugins = ref([]);
    const activeId = ref(null);
    const detail = ref(null);
    const guideOpen = ref(false);
    const dragging = ref(false);
    const fileInput = ref(null);
    const svcBusy = ref(null);

    const modal = ref(null);
    const modalVer = ref(null);
    const prepareTenants = ref([]);
    const confirmBox = reactive({ title: '', lines: [], okText: '', btnClass: '', onOk: null });
    const logData = ref({ title: '', log: '' });
    const logSource = ref(null);
    const logBox = ref(null);

    const gw = reactive({ mode: 'NORMAL', tenant_id: '', version: '' });

    const toastMsg = ref('');
    const toastErr = ref(false);
    let toastTimer = null;
    let pollTimer = null;

    function toast(msg, err = false) {
      toastMsg.value = msg;
      toastErr.value = err;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastMsg.value = ''), 3000);
    }

    // ------------------------------------------------ 数据刷新
    async function refresh() {
      plugins.value = await api('/api/plugins');
      if (activeId.value) {
        try {
          detail.value = await api('/api/plugins/' + activeId.value);
        } catch (e) {
          if (e.status === 404) { activeId.value = null; detail.value = null; } else throw e;
        }
      }
      if (modal.value === 'log' && logSource.value) await loadLog();
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      const active = plugins.value.some(p => p.busy || p.gateway_state === 'MAINTENANCE');
      pollTimer = setTimeout(async () => {
        try { await refresh(); } catch (_) { /* 下次重试 */ }
        schedulePoll();
      }, active ? 1000 : 5000);
    }

    async function reload() {
      await refresh();
      schedulePoll();
    }

    async function openPlugin(id) {
      activeId.value = id;
      gw.tenant_id = '';
      gw.version = '';
      detail.value = await api('/api/plugins/' + id);
    }

    const currentVer = computed(() =>
      detail.value ? detail.value.versions.find(v => v.is_current) || null : null);
    const busy = computed(() =>
      !!detail.value && detail.value.versions.some(v => v.status === 'preparing' || v.status === 'switching'));
    const realTenants = computed(() =>
      detail.value ? detail.value.tenants.filter(t => !t.is_sandbox && t.app_status === 'active') : []);
    const canStart = v => ['ready', 'trial', 'trial_passed'].includes(v.status);
    const svcRunning = computed(() => !!currentVer.value && currentVer.value.service.state === 'running');

    // ------------------------------------------------ 上传
    function pickFile() { fileInput.value.click(); }

    function onFilePicked(e) {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) upload(f);
    }

    function onDrop(e) {
      dragging.value = false;
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      if (files.length > 1) toast('一次只能上传一个插件包，已取第一个');
      upload(files[0]);
    }

    async function upload(file) {
      if (!file.name.toLowerCase().endsWith('.zip')) return toast('请上传 .zip 格式的插件包', true);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await api('/api/plugins/upload', { method: 'POST', body: fd });
        toast(`已登记 ${r.plugin_id} v${r.software_version}（数据版本 v${r.data_version}）`);
        activeId.value = r.plugin_id;
        await reload();
      } catch (e) {
        toast(e.message, true);
      }
    }

    // ------------------------------------------------ 运行控制
    async function setAppStatus(status) {
      if (detail.value.app_status === status) return;
      try {
        await api(`/api/plugins/${detail.value.id}/app-status`, { method: 'POST', json: { status } });
        toast(status === 'OPEN' ? '应用已开放' : '应用已进入维护状态');
        await reload();
      } catch (e) { toast(e.message, true); }
    }

    async function serviceAction(v, action) {
      svcBusy.value = v.id;
      try {
        await api(`/api/plugins/${detail.value.id}/versions/${v.id}/service/${action}`, { method: 'POST' });
        modal.value = null;
        toast(`v${v.software_version} 服务已${action === 'start' ? '启动' : '停止'}`);
      } catch (e) {
        toast(e.message, true);
      } finally {
        svcBusy.value = null;
        await reload();
      }
    }

    function confirmStopService(v) {
      openConfirm({
        title: `■ 停止 v${v.software_version} 服务`,
        lines: [
          `将终止 v${v.software_version} 的服务进程（PID ${v.service.pid}）。`,
          v.is_current ? '该版本是正式版本，停止后所有企业的业务访问将失败。' : '该版本非正式版本，不影响企业业务访问。',
        ],
        okText: '确认停止', btnClass: 'danger',
        onOk: () => serviceAction(v, 'stop'),
      });
    }

    // ------------------------------------------------ 版本操作
    async function act(v, action, body) {
      try {
        await api(`/api/plugins/${detail.value.id}/versions/${v.id}/${action}`, { method: 'POST', json: body || {} });
        modal.value = null;
        await reload();
        return true;
      } catch (e) {
        toast(e.message, true);
        return false;
      }
    }

    function openPrepare(v) {
      modalVer.value = v;
      prepareTenants.value = [];
      modal.value = 'prepare';
    }

    async function doPrepare() {
      if (await act(modalVer.value, 'prepare', { tenants: prepareTenants.value }))
        toast(`v${modalVer.value.software_version} 开始试运行准备`);
    }

    function openConfirm(opts) {
      Object.assign(confirmBox, opts);
      modal.value = 'confirm';
    }

    function confirmSwitch(v) {
      const same = currentVer.value && currentVer.value.data_version === v.data_version;
      openConfirm({
        title: `⚠️ 正式切换至 v${v.software_version}`,
        lines: [
          '⏸ 网关将进入 MAINTENANCE，拦截全部业务请求并展示暂停横幅。',
          `平台将基于正式版本 v${detail.value.current_version} 的最新数据，对全部活跃租户重新执行${same ? '全量复制' : '迁移脚本'}。`,
          '完成后该版本成为正式版本，运行中的服务自动在新版本重启；失败则保持旧版本。',
        ],
        okText: '确认切换并暂停业务', btnClass: 'warn',
        onOk: () => act(v, 'switch'),
      });
    }

    function confirmFormal(v) {
      openConfirm({
        title: `⭐ 将 v${v.software_version} 设为正式版本`,
        lines: [
          `仅修改主路由指向，使用 v${v.software_version} 的独立数据快照（切换于 ${v.switched_at || '—'}），秒级生效。`,
          `注意：v${detail.value.current_version} 期间产生的新数据不会带回该版本。`,
          svcRunning.value ? `v${detail.value.current_version} 服务正在运行，将自动启动 v${v.software_version} 服务并停止原版本服务。` : '原正式版本服务未运行，设置后需在版本链中手动启动。',
        ],
        okText: '确认设为正式版本', btnClass: 'danger',
        onOk: () => act(v, 'set-current'),
      });
    }

    function confirmDelete(v) {
      openConfirm({
        title: `删除版本 v${v.software_version}`,
        lines: ['将删除该版本的程序目录及所有租户的数据快照（db_*_v' + v.software_version + '），不可恢复。'],
        okText: '确认删除', btnClass: 'danger',
        onOk: async () => {
          try {
            await api(`/api/plugins/${detail.value.id}/versions/${v.id}`, { method: 'DELETE' });
            modal.value = null;
            toast(`v${v.software_version} 已删除`);
            await reload();
          } catch (e) { toast(e.message, true); }
        },
      });
    }

    // ------------------------------------------------ 日志
    async function loadLog() {
      const src = logSource.value;
      if (src.type === 'version') {
        const d = await api(`/api/plugins/${activeId.value}/versions/${src.id}/log`);
        logData.value = { title: `任务日志 v${d.software_version} · ${(STATUS[d.status] || [d.status])[0]}`, log: d.log };
      } else {
        const d = await api(`/api/plugins/${activeId.value}/versions/${src.id}/service/log`);
        logData.value = { title: `服务日志 v${d.software_version}`, log: d.log };
      }
      await nextTick();
      if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
    }

    async function showLog(source, title) {
      logSource.value = source;
      logData.value = { title, log: '' };
      modal.value = 'log';
      try { await loadLog(); } catch (e) { toast(e.message, true); }
    }

    const openLog = v => showLog({ type: 'version', id: v.id }, `任务日志 v${v.software_version}`);
    const openServiceLog = v => showLog({ type: 'service', id: v.id }, `服务日志 v${v.software_version}`);

    const logLines = computed(() => (logData.value.log || '').split('\n').filter(Boolean).map(text => {
      const m = text.match(/\] \[(\w+)\]/);
      return { text, level: m ? m[1] : 'info' };
    }));

    // ------------------------------------------------ 网关
    const gwBody = () => ({ mode: gw.mode, tenant_id: gw.tenant_id || null, version: gw.version || null });

    const fixedUrl = computed(() =>
      detail.value && gw.mode === 'NORMAL' && !gw.version && gw.tenant_id
        ? `/app/${detail.value.id}/${gw.tenant_id}/` : '');

    async function openEntry() {
      if (gw.mode !== 'SANDBOX' && !gw.tenant_id) return toast('请先选择企业租户', true);
      if (fixedUrl.value) return window.open(fixedUrl.value, '_blank');
      // 先同步打开窗口，避免异步后被浏览器拦截弹窗
      const win = window.open('about:blank', '_blank');
      try {
        const r = await api(`/api/plugins/${detail.value.id}/gateway/ticket`, { method: 'POST', json: gwBody() });
        if (win) win.location.href = r.url; else toast('浏览器拦截了新窗口，请允许弹出窗口后重试', true);
        if (gw.mode === 'PRODUCTION_SUPPORT') await refresh();
      } catch (e) {
        if (win) win.close();
        toast((e.status ? `HTTP ${e.status} · ` : '') + e.message, true);
      }
    }

    // ------------------------------------------------ 展示辅助
    const statusMeta = v => {
      const [text, cls] = STATUS[v.status] || [v.status, 'b-gray'];
      return { text, cls };
    };
    const rowClass = v => ({
      current: v.is_current,
      trial: v.status === 'trial' || v.status === 'trial_passed',
      switching: v.status === 'switching',
    });
    const isNewer = v => !detail.value.current_version || cmpVer(v.software_version, detail.value.current_version) > 0;

    onMounted(() => reload().catch(e => toast(e.message, true)));

    return {
      plugins, activeId, detail, guideOpen, dragging, fileInput, svcBusy,
      openPlugin, currentVer, busy, realTenants, canStart, pickFile, onFilePicked, onDrop,
      setAppStatus, serviceAction, confirmStopService,
      modal, modalVer, prepareTenants, confirmBox, logData, logBox, logLines,
      act, openPrepare, doPrepare, confirmSwitch, confirmFormal, confirmDelete, openLog, openServiceLog,
      gw, openEntry, fixedUrl,
      statusMeta, rowClass, isNewer, fmtSize, toastMsg, toastErr,
    };
  },
}).mount('#app');
