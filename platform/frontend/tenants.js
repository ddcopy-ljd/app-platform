// 租户管理页：租户新建 / 改名 / 级别 / 停用启用 + 各插件授权概览
const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
  setup() {
    const tenants = ref([]);
    const busy = ref(false);
    const modal = ref(null);
    const toastMsg = ref('');
    let toastTimer = null;

    const form = reactive({ isNew: true, id: '', name: '', level: 'standard', oldName: '' });
    const grantsTenant = reactive({ id: '', name: '' });
    const grantDetail = ref([]);
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

    function openCreate() {
      Object.assign(form, { isNew: true, id: '', name: '', level: 'standard', oldName: '' });
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
          toast(`租户 ${form.name} 已创建，请在各插件中开通授权`);
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

    const PAY_LABELS = { trial: '试用中', free: '免费', paid: '已付费', arrears: '欠费' };
    const payLabel = g => PAY_LABELS[g.pay_status] || g.pay_status;

    async function openGrants(t) {
      Object.assign(grantsTenant, { id: t.id, name: t.name });
      modal.value = 'grants';
      grantDetail.value = [];
      try {
        grantDetail.value = await Platform.api('/api/tenants/' + t.id + '/grants');
      } catch (e) {
        toast(e.message, true);
      }
    }

    onMounted(load);

    return {
      tenants, busy, modal, toastMsg, form, grantsTenant, grantDetail, confirmBox,
      openCreate, openRename, saveTenant, setLevel, toggleStatus, openGrants, payLabel,
      version: Platform.version,
    };
  },
}).mount('#app');
