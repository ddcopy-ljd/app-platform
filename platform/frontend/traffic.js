// 服务流量统计页：按租户 / 应用，按月 / 日 / 各时段统计上行下行
const { createApp, ref, computed, onMounted } = Vue;
const { api } = Platform;

createApp({
  setup() {
    const summary = ref(null);
    const rows = ref([]);
    const total = ref({ requests: 0, errors: 0, in_bytes: 0, out_bytes: 0 });
    const buckets = ref([]);
    const plugins = ref([]);
    const tenants = ref([]);

    const dim = ref('tenant');
    const granularity = ref('month');
    const rangeMode = ref('months12');
    const startDate = ref('');
    const endDate = ref('');
    const pluginFilter = ref('');
    const tenantFilter = ref('');

    const topRows = ref([]);
    const topTotal = ref({ requests: 0, errors: 0, in_bytes: 0, out_bytes: 0 });
    const topRange = ref('');

    const loading = ref(false);
    const error = ref('');
    const activeId = ref(null);
    const activeRow = ref(null);
    const detailOpen = ref(false);
    const crossRows = ref([]);
    const hourRows = ref([]);
    const detailLabel = ref('');

    // ------------------------------------------------------------ 工具
    const pad = n => String(n).padStart(2, '0');
    const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function fmt(b) {
      if (!b) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0, v = b;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i];
    }
    const num = n => (n || 0).toLocaleString('zh-CN');

    // 压缩统计：out_bytes = gzip 后实际传输，out_raw_bytes = 压缩前
    const rawOut = t => Math.max(t.out_raw_bytes || 0, t.out_bytes || 0);
    const savedPct = t => (rawOut(t) > 0 && t.out_bytes < rawOut(t))
      ? Math.round((1 - t.out_bytes / rawOut(t)) * 100) : 0;

    const SPECIAL = { __platform__: '平台自身', __unknown__: '未归属', '-': '（无租户）' };
    const labelOf = r => SPECIAL[r.id] || r.name || r.id;

    function rangeParams() {
      const today = new Date();
      if (rangeMode.value === 'month') {
        return { start: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, end: dayStr(today) };
      }
      if (rangeMode.value === 'd30') {
        const d = new Date(today.getTime() - 29 * 86400000);
        return { start: dayStr(d), end: dayStr(today) };
      }
      if (rangeMode.value === 'custom') {
        return { start: startDate.value, end: endDate.value || dayStr(today) };
      }
      return {};  // 近 12 个月由后端按月计算
    }

    const baseParams = () => ({
      granularity: granularity.value,
      ...(dim.value === 'tenant' ? { plugin_id: pluginFilter.value || undefined }
                                 : { tenant_id: tenantFilter.value || undefined }),
    });

    // ------------------------------------------------------------ 查询
    // 构造查询串：跳过 undefined/null/空串，避免被 URLSearchParams 序列化成 "undefined"
    function qs(obj) {
      const p = new URLSearchParams();
      Object.entries(obj).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') p.append(k, v);
      });
      return p.toString();
    }

    async function load() {
      loading.value = true;
      error.value = '';
      detailOpen.value = false;
      activeId.value = null;
      const rp = rangeParams();
      try {
        const data = await api('/api/traffic/query?' + qs({
          dim: dim.value, ...baseParams(), ...rp,
        }));
        rows.value = data.rows;
        total.value = data.total;
        buckets.value = data.buckets;
        const top = await api('/api/traffic/top?' + qs({ ...rp, limit: 20 })).catch(() => null);
        if (top) {
          topRows.value = top.rows;
          topTotal.value = top.total;
          topRange.value = `${top.start} ~ ${top.end}`;
        }
      } catch (e) {
        error.value = e.message;
        rows.value = [];
      } finally {
        loading.value = false;
      }
    }

    async function loadSummary() {
      summary.value = await api('/api/traffic/summary').catch(() => null);
    }

    async function loadFilters() {
      plugins.value = await api('/api/plugins').catch(() => []);
      tenants.value = await api('/api/tenants').catch(() => []);
    }

    async function toggleDetail(row) {
      if (activeId.value === row.id) { detailOpen.value = false; activeId.value = null; return; }
      activeId.value = row.id;
      activeRow.value = row;
      detailOpen.value = true;
      const range = rangeParams();
      const crossDim = dim.value === 'tenant' ? 'app' : 'tenant';
      const filter = dim.value === 'tenant'
        ? { tenant_id: row.id, plugin_id: pluginFilter.value || undefined }
        : { plugin_id: row.id, tenant_id: tenantFilter.value || undefined };
      const [cross, hod] = await Promise.all([
        api('/api/traffic/query?' + qs({ dim: crossDim, ...range, ...filter })).catch(() => null),
        api('/api/traffic/query?' + qs({ dim: dim.value, granularity: 'hod', ...range, ...filter })).catch(() => null),
      ]);
      crossRows.value = cross ? cross.rows : [];
      hourRows.value = hod ? hod.rows.filter(r => r.id === row.id).flatMap(r => r.series)
        : granularity.value === 'hod' ? row.series : [];
      if (!hourRows.value.length) hourRows.value = [];
      detailLabel.value = `${range.start || '近 12 个月'} ~ ${range.end || '今天'}`;
    }

    function switchDim(v) { dim.value = v; load(); }
    function switchGranularity(v) {
      granularity.value = v;
      if (v === 'day' && rangeMode.value === 'months12') rangeMode.value = 'd30';
      load();
    }
    function switchRange(v) {
      rangeMode.value = v;
      if (v === 'months12' && granularity.value === 'day') granularity.value = 'month';
      if (v === 'custom' && !startDate.value) {
        const today = new Date();
        startDate.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
        endDate.value = dayStr(today);
      }
      load();
    }

    // ------------------------------------------------------------ 展示辅助
    const topSum = r => (r.in_bytes || 0) + (r.out_bytes || 0);
    function topWidth(r) {
      const max = Math.max(...topRows.value.map(topSum), 1);
      return Math.max(2, (topSum(r) / max) * 100) + '%';
    }
    const sumOf = r => (r.total.out_bytes || 0) + (r.total.in_bytes || 0);
    function barWidth(r) {
      const max = Math.max(...rows.value.map(sumOf), 1);
      return Math.max(2, (sumOf(r) / max) * 100) + '%';
    }
    function hourHeight(h) {
      const max = Math.max(...hourRows.value.map(x => x.out_bytes + x.in_bytes), 1);
      return Math.max(2, ((h.out_bytes + h.in_bytes) / max) * 100) + '%';
    }
    const activeSeries = computed(() => {
      if (!activeRow.value) return [];
      return activeRow.value.series.filter(c => c.requests > 0);
    });
    const bucketTitle = computed(() => (
      granularity.value === 'month' ? '月份' : granularity.value === 'day' ? '日期' : '时段'
    ));

    onMounted(() => { loadSummary(); loadFilters(); load(); });

    return {
      summary, rows, total, plugins, tenants, dim, granularity, rangeMode, startDate, endDate,
      pluginFilter, tenantFilter, loading, error, activeId, activeRow, detailOpen,
      crossRows, hourRows, detailLabel, activeSeries, bucketTitle,
      topRows, topTotal, topRange, topWidth,
      fmt, num, rawOut, savedPct, labelOf, load, toggleDetail, switchDim, switchGranularity, switchRange,
      barWidth, hourHeight, version: Platform.version,
    };
  },
}).mount('#app');
