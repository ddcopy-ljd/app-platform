"""插件-租户授权与试用付费体系：授权台账、租户级别、试用申请审批、到期计算。

数据流：
- 授权(plugin_grants)是插件访问的唯一依据，resolve_gateway 常规模式据此放行；
- 试用(plugin_trials)由租户在门户注册/登录后申请：推广页来源免审批直接开通 30 天试用，
  其余插件申请由平台管理员在「租户管理」审批后生成试用授权；
- 续费(plugin_renewals)由租户在门户发起申请，管理员确认并手动填写新到期日；
- 付费为手动台账（试用/免费/已付费/欠费 + 到期日），不做在线支付。
"""

import html
from datetime import date, timedelta

from .db import audit, get_conn, now_str
from .plugin_service import PluginError, db_path

PAY_STATUSES = ("trial", "free", "paid", "arrears")
TENANT_LEVELS = ("vip1", "vip2", "vip3")
TRIAL_DAYS = 30       # 试用时长（天）
WARN_DAYS = 10        # 到期前提示阈值（天）
PAY_LABELS = {"trial": "试用中", "free": "免费", "paid": "已付费", "arrears": "欠费"}
LEVEL_LABELS = {"vip1": "VIP1", "vip2": "VIP2", "vip3": "VIP3"}


def days_left(paid_until: str | None) -> int | None:
    if not paid_until:
        return None
    try:
        return (date.fromisoformat(paid_until) - date.today()).days
    except ValueError:
        return None


def grant_state(conn, plugin_id: str, tenant_id: str) -> dict:
    """拦截页/横幅用的授权状态视图。"""
    g = conn.execute(
        "SELECT * FROM plugin_grants WHERE plugin_id=? AND tenant_id=?", (plugin_id, tenant_id)
    ).fetchone()
    pending = conn.execute(
        "SELECT id, requested_at FROM plugin_trials WHERE plugin_id=? AND tenant_id=? AND status='pending' "
        "ORDER BY id DESC LIMIT 1", (plugin_id, tenant_id),
    ).fetchone()
    if g is None:
        state = "none"
    elif g["status"] != "active":
        state = "suspended"
    elif g["pay_status"] == "arrears":
        state = "arrears"
    elif g["pay_status"] == "trial" and (
        not g["paid_until"] or g["paid_until"] < date.today().isoformat()
    ):
        state = "trial_expired"
    else:
        state = "ok"
    return {"grant": dict(g) if g else None, "state": state,
            "days_left": days_left(g["paid_until"]) if g else None,
            "pending_trial": dict(pending) if pending else None}


# ---------------------------------------------------------------- 管理端

def plugin_grants_overview(plugin_id: str) -> dict:
    """授权管理区块数据：全部租户（含未授权）+ 本插件试用申请记录。"""
    with get_conn() as conn:
        p = conn.execute("SELECT current_version FROM plugins WHERE id=?", (plugin_id,)).fetchone()
        if not p:
            raise PluginError("插件不存在", 404)
        rows = conn.execute(
            "SELECT t.id, t.name, t.is_sandbox, COALESCE(t.level,'vip1') AS level, "
            "g.pay_status, g.status AS grant_status, g.paid_until, g.note, g.granted_at, g.updated_at "
            "FROM tenants t LEFT JOIN plugin_grants g ON g.tenant_id=t.id AND g.plugin_id=? "
            "ORDER BY t.is_sandbox, t.id", (plugin_id,),
        ).fetchall()
        grants = []
        for r in rows:
            d = dict(r)
            d["days_left"] = days_left(r["paid_until"]) if r["grant_status"] else None
            d["db_ready"] = bool(p["current_version"]) and db_path(
                plugin_id, r["id"], p["current_version"]).exists()
            grants.append(d)
        trials = conn.execute(
            "SELECT pt.*, t.name AS tenant_name FROM plugin_trials pt "
            "JOIN tenants t ON t.id=pt.tenant_id WHERE pt.plugin_id=? "
            "ORDER BY pt.status='pending' DESC, pt.id DESC LIMIT 50", (plugin_id,),
        ).fetchall()
        return {"grants": grants, "trials": [dict(t) for t in trials]}


def upsert_grant(plugin_id: str, tenant_id: str, pay_status: str,
                 paid_until: str | None, note: str, operator: str) -> None:
    """开通/修改授权台账；trial 缺省到期日时自动按今天起 TRIAL_DAYS 天。"""
    if pay_status not in PAY_STATUSES:
        raise PluginError(f"未知付费状态：{pay_status}", 400)
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM plugins WHERE id=?", (plugin_id,)).fetchone():
            raise PluginError("插件不存在", 404)
        if not conn.execute("SELECT 1 FROM tenants WHERE id=? AND is_sandbox=0", (tenant_id,)).fetchone():
            raise PluginError("仅可对真实企业租户授权", 404)
        if pay_status in ("trial", "paid") and paid_until:
            try:
                paid_until = date.fromisoformat(paid_until).isoformat()
            except ValueError:
                raise PluginError("到期日格式应为 YYYY-MM-DD", 400)
        else:
            paid_until = None
        if pay_status == "trial" and not paid_until:
            paid_until = (date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
        ts = now_str()
        conn.execute(
            "INSERT INTO plugin_grants (plugin_id, tenant_id, pay_status, status, paid_until, note, "
            "granted_at, updated_at) VALUES (?,?,?,'active',?,?,?,?) "
            "ON CONFLICT(plugin_id, tenant_id) DO UPDATE SET pay_status=excluded.pay_status, "
            "status='active', paid_until=excluded.paid_until, note=excluded.note, updated_at=excluded.updated_at",
            (plugin_id, tenant_id, pay_status, paid_until, note, ts, ts),
        )
        detail = f"租户 {tenant_id} · {PAY_LABELS[pay_status]}"
        if paid_until:
            detail += f"（至 {paid_until}）"
        audit(conn, operator, "开通/更新授权", plugin_id, detail)


def set_grant_status(plugin_id: str, tenant_id: str, status: str, operator: str) -> None:
    if status not in ("active", "suspended"):
        raise PluginError("状态仅支持 active / suspended", 400)
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM plugin_grants WHERE plugin_id=? AND tenant_id=?", (plugin_id, tenant_id)
        ).fetchone():
            raise PluginError("授权不存在", 404)
        conn.execute(
            "UPDATE plugin_grants SET status=?, updated_at=? WHERE plugin_id=? AND tenant_id=?",
            (status, now_str(), plugin_id, tenant_id),
        )
        audit(conn, operator, "停用授权" if status == "suspended" else "恢复授权",
              plugin_id, f"租户 {tenant_id}")


def delete_grant(plugin_id: str, tenant_id: str, operator: str) -> None:
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM plugin_grants WHERE plugin_id=? AND tenant_id=?", (plugin_id, tenant_id)
        ).fetchone():
            raise PluginError("授权不存在", 404)
        conn.execute("DELETE FROM plugin_grants WHERE plugin_id=? AND tenant_id=?",
                     (plugin_id, tenant_id))
        audit(conn, operator, "删除授权", plugin_id, f"租户 {tenant_id}（访问立即被拦截）")


def provision(plugin_id: str, tenant_id: str, operator: str) -> dict:
    from .plugin_service import provision_tenant_db
    return provision_tenant_db(plugin_id, tenant_id, operator)


# ---------------------------------------------------------------- 试用申请

def apply_trial(plugin_id: str, tenant_id: str, contact: str) -> dict:
    """租户在门户申请试用其他插件（需平台登录态），生成待审批记录。"""
    contact = contact.strip()[:120]
    with get_conn() as conn:
        p = conn.execute("SELECT name FROM plugins WHERE id=?", (plugin_id,)).fetchone()
        if not p:
            raise PluginError("应用不存在", 404)
        t = conn.execute("SELECT name FROM tenants WHERE id=? AND is_sandbox=0 AND status='active'",
                         (tenant_id,)).fetchone()
        if not t:
            raise PluginError("企业租户不存在", 404)
        state = grant_state(conn, plugin_id, tenant_id)
        if state["state"] == "ok":
            raise PluginError("该租户已开通此应用，无需申请", 409)
        if state["pending_trial"]:
            raise PluginError("试用申请已提交，请等待管理员审核", 409)
        conn.execute(
            "INSERT INTO plugin_trials (plugin_id, tenant_id, contact, status, requested_at) "
            "VALUES (?,?,?,'pending',?)", (plugin_id, tenant_id, contact, now_str()),
        )
    return {"ok": True, "message": "试用申请已提交，请等待平台管理员审核"}


def review_trial(plugin_id: str, trial_id: int, action: str, operator: str) -> dict:
    """审批试用申请：批准即生成 TRIAL_DAYS 天试用授权。"""
    if action not in ("approve", "reject"):
        raise PluginError("操作仅支持 approve / reject", 400)
    with get_conn() as conn:
        t = conn.execute("SELECT * FROM plugin_trials WHERE id=? AND plugin_id=?",
                         (trial_id, plugin_id)).fetchone()
        if not t:
            raise PluginError("申请记录不存在", 404)
        if t["status"] != "pending":
            raise PluginError("该申请已处理过", 409)
        ts = now_str()
        if action == "approve":
            trial_end = (date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
            conn.execute(
                "INSERT INTO plugin_grants (plugin_id, tenant_id, pay_status, status, paid_until, note, "
                "granted_at, updated_at) VALUES (?,?,'trial','active',?,?,?,?) "
                "ON CONFLICT(plugin_id, tenant_id) DO UPDATE SET pay_status='trial', status='active', "
                "paid_until=excluded.paid_until, updated_at=excluded.updated_at",
                (plugin_id, t["tenant_id"], trial_end,
                 f"试用申请批准（申请人：{t['contact'] or '未留联系方式'}）", ts, ts),
            )
            conn.execute(
                "UPDATE plugin_trials SET status='approved', reviewed_at=?, reviewer=?, trial_end=? WHERE id=?",
                (ts, operator, trial_end, trial_id),
            )
            audit(conn, operator, "批准试用申请", plugin_id,
                  f"租户 {t['tenant_id']} 试用至 {trial_end}")
            return {"ok": True, "message": f"已开通试用（至 {trial_end}）"}
        conn.execute(
            "UPDATE plugin_trials SET status='rejected', reviewed_at=?, reviewer=? WHERE id=?",
            (ts, operator, trial_id),
        )
        audit(conn, operator, "拒绝试用申请", plugin_id, f"租户 {t['tenant_id']}")
        return {"ok": True, "message": "已拒绝该申请"}


# ---------------------------------------------------------------- 续费申请

def apply_renewal(plugin_id: str, tenant_id: str, months: int, note: str) -> dict:
    """租户在门户发起续费申请（同一插件仅允许一条待处理申请）。"""
    months = max(1, min(int(months or 12), 60))
    note = (note or "").strip()[:200]
    with get_conn() as conn:
        p = conn.execute("SELECT name FROM plugins WHERE id=?", (plugin_id,)).fetchone()
        if not p:
            raise PluginError("应用不存在", 404)
        g = conn.execute(
            "SELECT plugin_id FROM plugin_grants WHERE plugin_id=? AND tenant_id=? AND status='active'",
            (plugin_id, tenant_id),
        ).fetchone()
        if not g:
            raise PluginError("当前无生效授权，无法申请续费", 409)
        pending = conn.execute(
            "SELECT id FROM plugin_renewals WHERE plugin_id=? AND tenant_id=? AND status='pending' LIMIT 1",
            (plugin_id, tenant_id),
        ).fetchone()
        if pending:
            raise PluginError("续费申请已提交，请等待管理员处理", 409)
        conn.execute(
            "INSERT INTO plugin_renewals (plugin_id, tenant_id, months, note, status, requested_at) "
            "VALUES (?,?,?,?,'pending',?)", (plugin_id, tenant_id, months, note, now_str()),
        )
    return {"ok": True, "message": "续费申请已提交，请等待平台管理员确认"}


def confirm_renewal(plugin_id: str, renewal_id: int, action: str,
                    paid_until: str | None, operator: str) -> dict:
    """管理员确认续费：confirm 时按新到期日更新授权台账（pay_status=paid）。"""
    if action not in ("confirm", "reject"):
        raise PluginError("操作仅支持 confirm / reject", 400)
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM plugin_renewals WHERE id=? AND plugin_id=?",
                         (renewal_id, plugin_id)).fetchone()
        if not r:
            raise PluginError("续费申请不存在", 404)
        if r["status"] != "pending":
            raise PluginError("该申请已处理过", 409)
        ts = now_str()
        if action == "reject":
            conn.execute(
                "UPDATE plugin_renewals SET status='rejected', reviewed_at=?, reviewer=? WHERE id=?",
                (ts, operator, renewal_id),
            )
            audit(conn, operator, "拒绝续费申请", plugin_id, f"租户 {r['tenant_id']}")
            return {"ok": True, "message": "已拒绝该续费申请"}
        if not paid_until:
            raise PluginError("请填写新的到期日（YYYY-MM-DD）", 400)
        try:
            paid_until = date.fromisoformat(paid_until).isoformat()
        except ValueError:
            raise PluginError("到期日格式应为 YYYY-MM-DD", 400)
        conn.execute(
            "UPDATE plugin_renewals SET status='confirmed', reviewed_at=?, reviewer=?, new_paid_until=? WHERE id=?",
            (ts, operator, paid_until, renewal_id),
        )
        conn.execute(
            "INSERT INTO plugin_grants (plugin_id, tenant_id, pay_status, status, paid_until, note, "
            "granted_at, updated_at) VALUES (?,?,'paid','active',?,?,?,?) "
            "ON CONFLICT(plugin_id, tenant_id) DO UPDATE SET pay_status='paid', status='active', "
            "paid_until=excluded.paid_until, updated_at=excluded.updated_at",
            (plugin_id, r["tenant_id"], paid_until,
             f"续费确认（申请 {r['months']} 个月）", ts, ts),
        )
        audit(conn, operator, "确认续费", plugin_id,
              f"租户 {r['tenant_id']} 付费至 {paid_until}")
        return {"ok": True, "message": f"已确认续费（付费至 {paid_until}）"}


# ---------------------------------------------------------------- 拦截页与到期横幅

def tenant_banner(plugin_id: str, tenant_id: str) -> str | None:
    """/app/ 页面注入的到期提示条：试用/付费距到期日 ≤ WARN_DAYS 天（或付费已过期）时返回 HTML。"""
    with get_conn() as conn:
        g = conn.execute(
            "SELECT pay_status, paid_until FROM plugin_grants WHERE plugin_id=? AND tenant_id=?",
            (plugin_id, tenant_id),
        ).fetchone()
    if not g or g["pay_status"] not in ("trial", "paid") or not g["paid_until"]:
        return None
    left = days_left(g["paid_until"])
    return banner_html(g["pay_status"], g["paid_until"], left)


def intercept_page(plugin_id: str, tenant_id: str, reason: str) -> str:
    """未授权访问 /app/ 的内置拦截页：说明原因并引导前往租户门户注册/申请。"""
    with get_conn() as conn:
        p = conn.execute("SELECT name FROM plugins WHERE id=?", (plugin_id,)).fetchone()
        t = conn.execute("SELECT name FROM tenants WHERE id=?", (tenant_id,)).fetchone()
        state = grant_state(conn, plugin_id, tenant_id) if p and t else {"pending_trial": None}
    plugin_name = p["name"] if p else plugin_id
    tenant_name = t["name"] if t else tenant_id
    g = state.get("grant") or {}
    left = state.get("days_left")
    rows = ""
    if g.get("pay_status"):
        rows += f'<div class="row"><span>付费状态</span><b>{html.escape(PAY_LABELS.get(g["pay_status"], g["pay_status"]))}</b></div>'
    if g.get("paid_until"):
        extra = f"（剩 {left} 天）" if left is not None and left >= 0 else ""
        rows += f'<div class="row"><span>到期日</span><b>{html.escape(g["paid_until"])}</b>{extra}</div>'
    pending_tip = ('<div class="pending-tip">✅ 已有试用申请待审核，请耐心等待管理员处理，无需重复提交。</div>'
                   if state.get("pending_trial") else "")
    portal_url = f"/portal/?plugin={html.escape(plugin_id, quote=True)}"
    form_block = f"""
    <div class="apply-box">
      <h3>开通方式</h3>
      <p class="tip">请前往<b>租户门户</b>注册企业账号并登录：通过应用推广页注册可直接开始
      {TRIAL_DAYS} 天免费试用；已注册租户登录后可查看申请进度、使用情况并自助申请续费。</p>
      <a class="apply-btn" href="{portal_url}">前往租户门户</a>
    </div>""" if not state.get("pending_trial") else ""
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>暂无法访问 · {html.escape(plugin_name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;min-height:100vh;
  display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#eef2ff,#fdf2f8);padding:24px}}
.card{{background:#fff;border-radius:20px;box-shadow:0 18px 50px rgba(15,23,42,.12);max-width:460px;width:100%;padding:34px 32px}}
.icon{{font-size:44px;text-align:center}}
h1{{font-size:19px;text-align:center;margin:12px 0 6px;color:#0f172a}}
.app{{text-align:center;color:#6366f1;font-weight:600;font-size:14px}}
.reason{{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;border-radius:12px;
  padding:12px 14px;font-size:14px;line-height:1.7;margin:16px 0}}
.meta{{font-size:13px;color:#64748b;line-height:1.9;background:#f8fafc;border-radius:12px;padding:12px 14px}}
.meta .row{{display:flex;justify-content:space-between;gap:12px}}
.pending-tip{{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:12px;
  padding:12px 14px;font-size:13.5px;line-height:1.7;margin:14px 0}}
.apply-box h3{{font-size:14.5px;margin:18px 0 10px;color:#0f172a}}
.apply-box .tip{{font-size:13.5px;color:#475569;line-height:1.8}}
.apply-btn{{display:block;width:100%;margin-top:14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;
  border:0;border-radius:10px;padding:11px;font-size:14.5px;font-weight:600;text-align:center;text-decoration:none}}
.foot{{text-align:center;font-size:12px;color:#94a3b8;margin-top:18px}}
</style></head><body><div class="card">
  <div class="icon">🔒</div>
  <h1>暂无法访问该应用</h1>
  <div class="app">{html.escape(plugin_name)}</div>
  <div class="reason">{html.escape(reason)}</div>
  <div class="meta">
    <div class="row"><span>企业</span><b>{html.escape(tenant_name)}</b></div>
    <div class="row"><span>租户ID</span><b>{html.escape(tenant_id)}</b></div>{rows}
  </div>
  {pending_tip}{form_block}
  <div class="foot">如需购买正式服务，请联系平台服务商</div>
</div></body></html>"""


def banner_html(pay_status: str, paid_until: str | None, left: int | None) -> str | None:
    """到期前 WARN_DAYS 天（或付费已过期）时注入插件页面的顶部提示条；无需提示返回 None。"""
    if left is None:
        return None
    if pay_status == "trial" and 0 <= left <= WARN_DAYS:
        text = f"⏰ 试用即将到期：剩余 {left} 天，到期后将无法访问，请联系服务商开通正式服务。"
        color, bg, border = "#92400e", "#fffbeb", "#fcd34d"
    elif pay_status == "paid" and 0 <= left <= WARN_DAYS:
        text = f"⏰ 服务费将于 {paid_until} 到期（剩 {left} 天），请及时续费以免影响使用。"
        color, bg, border = "#92400e", "#fffbeb", "#fcd34d"
    elif pay_status == "paid" and left < 0:
        text = f"⚠ 服务费已于 {paid_until} 到期，为避免服务暂停，请尽快联系服务商续费。"
        color, bg, border = "#991b1b", "#fef2f2", "#fca5a5"
    else:
        return None
    safe = html.escape(text)
    return (f"<script>(function(){{var d=document.createElement('div');"
            f"d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483000;"
            f"background:{bg};color:{color};border-bottom:1px solid {border};"
            f"padding:8px 14px;font-size:14px;text-align:center;font-family:inherit';"
            f"d.textContent={text!r};"
            f"document.body.appendChild(d);}})();</script>")
