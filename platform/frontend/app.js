const { createApp, ref, reactive, computed, onMounted } = Vue;
const { api, getToken, setToken, loadPlatformVersion } = Platform;

// 每个功能菜单对应一个独立的 iframe 页面
// FRAME_VER 取页面加载时刻，拼在 iframe 地址后，确保每次加载都拉取最新页面，
// 避免浏览器对 iframe 内的 html 做启发式缓存导致改动不生效。
const FRAME_VER = Date.now();
const MENUS = [
  { key: 'plugins', icon: '🧩', label: '应用插件管理', src: `/static/plugins.html?v=${FRAME_VER}` },
  { key: 'traffic', icon: '📊', label: '服务流量统计', src: `/static/traffic.html?v=${FRAME_VER}` },
];

createApp({
  setup() {
    const user = ref(null);
    const loginForm = reactive({ username: 'admin', password: '' });
    const loginError = ref('');
    const loggingIn = ref(false);
    const menu = ref(MENUS[0].key);
    const currentMenu = computed(() => MENUS.find(m => m.key === menu.value));
    const maintenance = ref([]);
    const digest = ref(null);
    const platformVersion = ref('');
    let pollTimer = null;
    let digestTimer = null;

    async function pollMaintenance() {
      clearTimeout(pollTimer);
      if (!user.value) return;
      try { maintenance.value = await api('/api/plugins/maintenance'); } catch (_) { /* 下次重试 */ }
      // 页面不可见（切走/最小化）时降频到 30s，减少无谓的后台轮询流量
      pollTimer = setTimeout(pollMaintenance,
        maintenance.value.length ? 1000 : (document.hidden ? 30000 : 10000));
    }

    // 首页每日摘要：昨日 / 今日流量 + 异常告警，5 分钟刷新一次
    const fmtMB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' KB';
    const num = n => (n || 0).toLocaleString('zh-CN');

    async function loadDigest() {
      if (!user.value) return;
      try { digest.value = await api('/api/traffic/digest'); } catch (_) { /* 下次重试 */ }
      clearTimeout(digestTimer);
      digestTimer = setTimeout(loadDigest, 5 * 60 * 1000);
    }

    async function doLogin() {
      loginError.value = '';
      loggingIn.value = true;
      try {
        const data = await api('/api/auth/login', { method: 'POST', json: loginForm });
        setToken(data.token);
        user.value = data.user;
        loginForm.password = '';
        pollMaintenance();
        loadDigest();
        loadPlatformVersion().then(v => platformVersion.value = v);
      } catch (e) {
        loginError.value = e.message;
      } finally {
        loggingIn.value = false;
      }
    }

    function logoutLocal() {
      setToken('');
      user.value = null;
      maintenance.value = [];
      digest.value = null;
      clearTimeout(pollTimer);
      clearTimeout(digestTimer);
    }

    async function doLogout() {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* 忽略 */ }
      logoutLocal();
    }

    window.addEventListener('message', e => {
      if (e.origin === location.origin && e.data && e.data.type === 'unauthorized') {
        logoutLocal();
        loginError.value = '登录已过期，请重新登录';
      }
    });

    onMounted(async () => {
      if (!getToken()) return;
      try {
        user.value = await api('/api/auth/me');
        pollMaintenance();
        loadDigest();
        loadPlatformVersion().then(v => platformVersion.value = v);
      } catch (_) {
        logoutLocal();
      }
    });

    return {
      user, loginForm, loginError, loggingIn, doLogin, doLogout,
      menus: MENUS, menu, currentMenu, maintenance, digest, fmtMB, num, version: Platform.version, platformVersion,
    };
  },
}).mount('#app');
