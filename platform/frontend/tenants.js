// 租户管理页：租户 CRUD + 待办申请（试用审批 / 续费确认）+ 授权台账操作 + 门户账号
const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
  setup() {
    const tenants = ref([]);
    const apps = ref({ trials: [], renewals: [] });
    const plugins = ref([]);
    const busy = ref(false);
    const modal = ref(null);
    const toastMsg = ref('');
    let toastTimer = null;

    const form = reactive({ isNew: true, id: '', name: '', level: 'vip1', oldName: '' });
    const grantsTenant = reactive({ id: '', name: '' });
    const ledger = reactive({ grants: [], trials: [], renewals: [], portal_users: [] });
    const newGrantPlugin = ref('');
    const grantForm = reactive({ plugin_id: '', plugin_name: '', pay_status: 'trial', paid_until: '', note: '', isNew: true });
    const renewalItem = ref(null);
    const renewalPaidUntil = ref('');
    const accountTenant = reactive({ id: '', name: '' });
    const accountForm = reactive({ username: '', password: '' });
    const confirmBox = reactive({ title: '', lines: [], okText: '确认', btnClass: 'primary', onOk: null });

    const toast = (msg, isErr = false) => {
      toastMsg.value = (isErr ? '❌ ' : '✅ ') + msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastMsg.value = ''), isErr ? 4200 : 2600);
    };

    const openConfirm = ({ title, lines, okText = '确认', btnClass = 'primary', onOk }) => {
      Object.assign(confirmBox, { title, lines, okText, btnClass, onOk });
      modal.value = 'confirm';
    };

    async function load() {
      try {
        tenants.value = await Platform.api('/api/tenants');
      } catch (e) {
        toast(e.message, true);
      }
    }

    async function loadApps() {
      try {
        apps.value = await Platform.api('/api/tenants/applications');
      } catch (e) { /* 静默，下次刷新重试 */ }
    }

    async function loadPlugins() {
      try { plugins.value = await Platform.api('/api/plugins'); }
      catch (e) { /* 静默 */ }
    }

    const pendingTrials = computed(() => apps.value.trials.filter(t => t.status === 'pending'));
    const pendingRenewals = computed(() => apps.value.renewals.filter(r => r.status === 'pending'));
    const pendingCount = computed(() => pendingTrials.value.length + pendingRenewals.value.length);

    // 台账弹窗「开通新授权」可选插件：排除已授权的
    const openablePlugins = computed(() =>
      plugins.value.filter(p => !ledger.grants.some(g => g.plugin_id === p.id)));

    function openCreate() {
      Object.assign(form, { isNew: true, id: '', name: '', level: 'vip1', oldName: '' });
      modal.value = 'edit';
    }

    function openRename(t) {
      Object.assign(form, { isNew: false, id: t.id, name: t.name, oldName: t.name, level: t.level });
      modal.value = 'edit';
    }

    async function saveTenant() {
      if (busy.value) return;
      busy.value = true;
      try {
        if (form.isNew) {
          await Platform.api('/api/tenants', { method: 'POST', json: { id: form.id, name: form.name, level: form.level } });
          toast(`租户 ${form.name} 已创建，可在「授权台账」中开通插件`);
        } else {
          await Platform.api('/api/tenants/' + form.id, { method: 'PUT', json: { name: form.name } });
          toast('租户名称已更新');
        }
        modal.value = null;
        await load();
      } catch (e) {
        toast(e.message, true);
      } finally {
        busy.value = false;
      }
    }

    async function setLevel(t, ev) {
      try {
        await Platform.api('/api/tenants/' + t.id, { method: 'PUT', json: { level: ev.target.value } });
        toast(`${t.name} 级别已更新`);
      } catch (e) {
        toast(e.message, true);
        await load();
      }
    }

    function toggleStatus(t, status) {
      const suspend = status === 'inactive';
      openConfirm({
        title: suspend ? `⏸ 停用租户 ${t.name}` : `▶ 启用租户 ${t.name}`,
        lines: suspend
          ? [`${t.name}（${t.id}）对所有插件的访问将立即被网关拦截，各插件数据副本保留，随时可重新启用。`]
          : [`${t.name}（${t.id}）将恢复访问；各插件的授权与付费状态不变，欠费/试用过期的插件仍会拦截。`],
        okText: '确认', btnClass: suspend ? 'danger' : 'primary',
        onOk: async () => {
          try {
            await Platform.api('/api/tenants/' + t.id + '/status', { method: 'POST', json: { status } });
            modal.value = null;
            toast(suspend ? '租户已停用' : '租户已启用');
            await load();
          } catch (e) { toast(e.message, true); }
        },
      });
    }

    // ------------------------------------------------ 授权台账
    const PAY_LABELS = { trial: '试用中', free: '免费', paid: '已付费', arrears: '欠费' };
    const payLabel = g => PAY_LABELS[g.pay_status] || g.pay_status;

    async function loadLedger() {
      const data = await Platform.api('/api/tenants/' + grantsTenant.id + '/grants');
      Object.assign(ledger, { grants: data.grants, trials: data.trials, renewals: data.renewals, portal_users: data.portal_users });
    }

    async function openGrants(t) {
      Object.assign(grantsTenant, { id: t.id, name: t.name });
      newGrantPlugin.value = '';
      modal.value = 'grants';
      try {
        await loadLedger();
        if (!plugins.value.length) await loadPlugins();
      } catch (e) {
        toast(e.message, true);
      }
    }

    function openGrant(g) {
      Object.assign(grantForm, {
        plugin_id: g.plugin_id, plugin_name: g.plugin_name, isNew: false,
        pay_status: g.pay_status || 'trial', paid_until: g.paid_until || '', note: g.note || '',
      });
      modal.value = 'grant';
    }

    function openNewGrant() {
      const p = plugins.value.find(x => x.id === newGrantPlugin.value);
      if (!p) return;
      Object.assign(grantForm, {
        plugin_id: p.id, plugin_name: p.name, isNew: true,
        pay_status: 'trial', paid_until: '', note: '',
      });
      modal.value = 'grant';
    }

    async function saveGrant() {
      if (busy.value) return;
      busy.value = true;
      try {
        await Platform.api(`/api/plugins/${grantForm.plugin_id}/grants`, { method: 'POST', json: {
          tenant_id: grantsTenant.id, pay_status: grantForm.pay_status,
          paid_until: grantForm.paid_until || null, note: grantForm.note,
        } });
        modal.value = null;
        toast('授权台账已保存');
        await loadLedger();
        await load();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    function toggleGrant(g, status) {
      const suspend = status === 'suspended';
      openConfirm({
        title: suspend ? `⏸ 停用 ${g.plugin_name} 的授权` : `▶ 恢复 ${g.plugin_name} 的授权`,
        lines: suspend
          ? [`${grantsTenant.name} 对《${g.plugin_name}》的访问将立即被拦截（显示引导门户的拦截页），数据副本保留。`]
          : [`${grantsTenant.name} 将恢复访问《${g.plugin_name}》，按台账付费状态校验（欠费/试用过期仍会拦截）。`],
        okText: '确认', btnClass: suspend ? 'danger' : 'primary',
        onOk: async () => {
          try {
            await Platform.api(`/api/plugins/${g.plugin_id}/grants/${grantsTenant.id}/status`, { method: 'POST', json: { status } });
            modal.value = null; toast('授权状态已更新'); await loadLedger(); await load();
          } catch (e) { toast(e.message, true); }
        },
      });
    }

    function removeGrant(g) {
      openConfirm({
        title: `🗑 删除 ${g.plugin_name} 的授权`,
        lines: [
          `删除后 ${grantsTenant.name} 访问《${g.plugin_name}》将立即被拦截。`,
          '授权台账记录移除，租户数据副本保留；可随时重新开通。',
        ],
        okText: '确认删除', btnClass: 'danger',
        onOk: async () => {
          try {
            await Platform.api(`/api/plugins/${g.plugin_id}/grants/${grantsTenant.id}`, { method: 'DELETE' });
            modal.value = null; toast('授权已删除'); await loadLedger(); await load();
          } catch (e) { toast(e.message, true); }
        },
      });
    }

    function provisionDb(g) {
      openConfirm({
        title: `💾 初始化 ${g.plugin_name} 数据副本`,
        lines: [
          `将按当前正式版本为 ${grantsTenant.name} 创建全新空白数据库（后台执行）。`,
          '适用于已授权但此前未纳入数据任务的租户；已有数据副本的租户不可重复初始化。',
        ],
        okText: '开始初始化', btnClass: 'primary',
        onOk: async () => {
          try {
            const r = await Platform.api(`/api/plugins/${g.plugin_id}/grants/${grantsTenant.id}/provision`, { method: 'POST' });
            modal.value = null; toast(r.note || '已开始初始化');
          } catch (e) { toast(e.message, true); }
        },
      });
    }

    // ------------------------------------------------ 试用审批 / 续费确认
    async function reviewTrial(t, action) {
      if (busy.value) return;
      busy.value = true;
      try {
        const r = await Platform.api(`/api/plugins/${t.plugin_id}/trials/${t.id}/review`, { method: 'POST', json: { action } });
        toast(r.message || '已处理');
        await loadApps();
        if (modal.value === 'grants') await loadLedger();
        await load();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    function openRenewal(r) {
      renewalItem.value = r;
      renewalPaidUntil.value = '';
      modal.value = 'renewal';
    }

    async function confirmRenewal(r, action, paidUntil) {
      if (busy.value) return;
      busy.value = true;
      try {
        const res = await Platform.api(`/api/plugins/${r.plugin_id}/renewals/${r.id}/confirm`,
          { method: 'POST', json: { action, paid_until: paidUntil || null } });
        toast(res.message || '已处理');
        modal.value = null;
        await loadApps();
        if (modal.value !== 'renewal' && grantsTenant.id === r.tenant_id) await loadLedger();
        await load();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    // ------------------------------------------------ 门户账号
    function openAccount(t, username) {
      Object.assign(accountTenant, { id: t.id, name: t.name });
      Object.assign(accountForm, { username: username || '', password: '' });
      modal.value = 'account';
    }

    async function saveAccount() {
      if (busy.value) return;
      busy.value = true;
      try {
        const r = await Platform.api(`/api/tenants/${accountTenant.id}/portal-account`,
          { method: 'POST', json: { username: accountForm.username, password: accountForm.password } });
        modal.value = null;
        toast(r.action === 'reset' ? `账号 ${r.username} 密码已重置` : `门户账号 ${r.username} 已创建`);
        await load();
        if (grantsTenant.id === accountTenant.id) await loadLedger();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    const platformVersion = ref('');

    onMounted(() => {
      load(); loadApps(); loadPlugins();
      Platform.loadPlatformVersion().then(v => (platformVersion.value = v));
    });

    return {
      tenants, apps, plugins, busy, modal, toastMsg, form, grantsTenant, ledger, confirmBox,
      newGrantPlugin, grantForm, renewalItem, renewalPaidUntil, accountTenant, accountForm,
      pendingTrials, pendingRenewals, pendingCount, openablePlugins,
      loadApps, openCreate, openRename, saveTenant, setLevel, toggleStatus,
      openGrants, openGrant, openNewGrant, saveGrant, toggleGrant, removeGrant, provisionDb,
      reviewTrial, openRenewal, confirmRenewal, openAccount, saveAccount,
      payLabel, platformVersion, version: Platform.version,
    };
  },
}).mount('#app');
