// 租户门户：企业自助注册 / 登录、我的应用、申请试用、续费申请
// 独立于管理后台：token 存 portal_token（不与平台 admin 的 token 互串）。
const { createApp, ref, reactive, computed, onMounted } = Vue;

const TOKEN_KEY = 'portal_token';

async function papi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY) || '';
  if (token) headers.Authorization = 'Bearer ' + token;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.json) };
  }
  const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(typeof data.detail === 'string' ? data.detail : '请求失败');
    e.status = res.status;
    throw e;
  }
  return data;
}

const PAY_LABELS = { trial: '试用中', free: '免费', paid: '已付费', arrears: '欠费' };
const LEVEL_LABELS = { vip1: 'VIP1', vip2: 'VIP2', vip3: 'VIP3' };

createApp({
  setup() {
    const user = ref(null);
    const mode = ref('login');
    const submitting = ref(false);
    const busy = ref(false);
    const authError = ref('');
    const ov = reactive({ apps: [], trials: [], renewals: [], catalog: [] });

    const loginForm = reactive({ username: '', password: '' });
    const regForm = reactive({ tenant_id: '', tenant_name: '', username: '', password: '', contact: '', plugin_id: '' });

    const toastMsg = ref('');
    const toastErr = ref(false);
    let toastTimer = null;
    function toast(msg, err = false) {
      toastMsg.value = msg; toastErr.value = err;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastMsg.value = ''), err ? 4200 : 2600);
    }

    // 推广页入口：/portal/?plugin=jewelry 预选来源插件
    const srcPlugin = new URLSearchParams(location.search).get('plugin') || '';
    const regPluginName = computed(() => {
      const c = ov.catalog.find(x => x.id === regForm.plugin_id);
      return c ? c.name : regForm.plugin_id;
    });

    async function loadOverview() {
      try {
        const r = await papi('/api/portal/overview');
        Object.assign(ov, r);
      } catch (e) {
        if (e.status === 401 || e.status === 403) { user.value = null; localStorage.removeItem(TOKEN_KEY); }
        else toast(e.message, true);
      }
    }

    async function init() {
      if (srcPlugin) { regForm.plugin_id = srcPlugin; mode.value = 'register'; }
      try {
        user.value = await papi('/api/portal/me');
        await loadOverview();
      } catch (_) { user.value = null; }
    }

    async function doLogin() {
      if (submitting.value) return;
      submitting.value = true; authError.value = '';
      try {
        const r = await papi('/api/portal/login', { method: 'POST', json: { ...loginForm } });
        localStorage.setItem(TOKEN_KEY, r.token);
        user.value = await papi('/api/portal/me');
        await loadOverview();
      } catch (e) { authError.value = e.message; }
      finally { submitting.value = false; }
    }

    async function doRegister() {
      if (submitting.value) return;
      submitting.value = true; authError.value = '';
      try {
        const r = await papi('/api/portal/register', { method: 'POST', json: { ...regForm } });
        localStorage.setItem(TOKEN_KEY, r.token);
        user.value = await papi('/api/portal/me');
        toast(r.message + (r.note ? ' · ' + r.note : ''));
        await loadOverview();
      } catch (e) { authError.value = e.message; }
      finally { submitting.value = false; }
    }

    async function doLogout() {
      try { await papi('/api/portal/logout', { method: 'POST' }); } catch (_) {}
      localStorage.removeItem(TOKEN_KEY);
      user.value = null;
    }

    // ------------------------------------------------ 状态展示
    function stateMeta(a) {
      switch (a.state) {
        case 'ok':
          if (a.pay_status === 'trial') return { text: '试用中', cls: 'b-doing' };
          if (a.pay_status === 'paid') return { text: '已付费', cls: 'b-ok' };
          return { text: '正常', cls: 'b-ok' };
        case 'trial_expired': return { text: '试用已到期', cls: 'b-err' };
        case 'arrears': return { text: '欠费', cls: 'b-err' };
        case 'suspended': return { text: '已停用', cls: 'b-err' };
        default: return { text: '未开通', cls: 'b-gray' };
      }
    }

    function payText(a) {
      if (!a.pay_status) return '—';
      if (a.pay_status === 'free') return '免费 · 长期有效';
      if (a.pay_status === 'arrears') return '欠费停服';
      return PAY_LABELS[a.pay_status] || a.pay_status;
    }

    function trialStatusText(t) {
      if (t.status === 'pending') return '待管理员审批';
      if (t.status === 'approved') return '已批准' + (t.trial_end ? '（试用至 ' + t.trial_end + '）' : '');
      return '已拒绝';
    }

    function renewalStatusText(r) {
      if (r.status === 'pending') return '待管理员确认';
      if (r.status === 'confirmed') return '已确认' + (r.new_paid_until ? '（至 ' + r.new_paid_until + '）' : '');
      return '已拒绝';
    }

    // ------------------------------------------------ 申请试用 / 续费
    async function applyTrial(c) {
      if (busy.value) return;
      busy.value = true;
      try {
        const r = await papi('/api/portal/trials', { method: 'POST', json: { plugin_id: c.id, contact: '' } });
        toast(r.message || '试用申请已提交');
        await loadOverview();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    const renewOpen = ref(false);
    const renewTarget = ref(null);
    const renewMonths = ref(12);
    const renewNote = ref('');

    function openRenew(a) {
      renewTarget.value = a;
      renewMonths.value = 12;
      renewNote.value = '';
      renewOpen.value = true;
    }

    async function submitRenew() {
      if (busy.value) return;
      busy.value = true;
      try {
        const r = await papi('/api/portal/renewals', { method: 'POST', json: {
          plugin_id: renewTarget.value.plugin_id, months: renewMonths.value, note: renewNote.value } });
        toast(r.message || '续费申请已提交');
        renewOpen.value = false;
        await loadOverview();
      } catch (e) { toast(e.message, true); }
      finally { busy.value = false; }
    }

    const levelLabel = computed(() => (user.value && LEVEL_LABELS[user.value.level]) || user.value?.level || '—');

    onMounted(init);

    return {
      user, mode, submitting, busy, authError, ov, loginForm, regForm,
      regPluginName, toastMsg, toastErr,
      doLogin, doRegister, doLogout, loadOverview,
      stateMeta, payText, trialStatusText, renewalStatusText,
      applyTrial, renewOpen, renewTarget, renewMonths, renewNote, openRenew, submitRenew,
      levelLabel,
    };
  },
}).mount('#app');
