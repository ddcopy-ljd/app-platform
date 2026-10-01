const { createApp, ref, reactive, computed, onMounted } = Vue;
const { api, getToken, setToken } = Platform;

// 每个功能菜单对应一个独立的 iframe 页面
const MENUS = [
  { key: 'plugins', icon: '🧩', label: '应用插件管理', src: '/static/plugins.html' },
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
    let pollTimer = null;

    async function pollMaintenance() {
      clearTimeout(pollTimer);
      if (!user.value) return;
      try { maintenance.value = await api('/api/plugins/maintenance'); } catch (_) { /* 下次重试 */ }
      pollTimer = setTimeout(pollMaintenance, maintenance.value.length ? 1000 : 3000);
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
      clearTimeout(pollTimer);
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
      } catch (_) {
        logoutLocal();
      }
    });

    return {
      user, loginForm, loginError, loggingIn, doLogin, doLogout,
      menus: MENUS, menu, currentMenu, maintenance,
    };
  },
}).mount('#app');
