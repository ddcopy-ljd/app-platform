// 主框架与各功能 iframe 页面共用：登录令牌、API 调用、格式化
window.Platform = (() => {
  const TOKEN_KEY = 'token';
  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = t => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
  const inFrame = window.parent !== window;

  function onUnauthorized() {
    setToken('');
    if (inFrame) window.parent.postMessage({ type: 'unauthorized' }, location.origin);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      options = { ...options, body: JSON.stringify(options.json) };
    }
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) onUnauthorized();
    if (!res.ok) {
      const e = new Error(typeof data.detail === 'string' ? data.detail : '请求失败');
      e.status = res.status;
      throw e;
    }
    return data;
  }

  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

  return { api, getToken, setToken, fmtSize, inFrame };
})();
