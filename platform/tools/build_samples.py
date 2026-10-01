"""生成演示用插件包到 samples/ 目录：python tools/build_samples.py"""

import json
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "samples"

INIT_PY = '''import os, sqlite3
db = os.environ["NEW_DB_PATH"]
tenant = os.environ["TENANT_ID"]
conn = sqlite3.connect(db)
conn.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)")
conn.executemany("INSERT INTO items (name, qty) VALUES (?, ?)",
                 [(f"{tenant}-商品{i}", i * 10) for i in range(1, 6)])
conn.commit()
conn.close()
print(f"init {tenant}: items x5 -> {os.path.basename(db)}")
'''

UPGRADE_PY = '''import os, shutil, sqlite3
old_db, new_db = os.environ["OLD_DB_PATH"], os.environ["NEW_DB_PATH"]
src = sqlite3.connect(old_db)
dst = sqlite3.connect(new_db)
src.backup(dst)
src.close()
dst.execute("ALTER TABLE items ADD COLUMN location TEXT NOT NULL DEFAULT 'A区'")
dst.execute("CREATE TABLE IF NOT EXISTS stock_logs (id INTEGER PRIMARY KEY, item_id INTEGER, delta INTEGER, ts TEXT)")
dst.commit()
dst.close()
if os.path.isdir(os.environ["OLD_STORAGE"]):
    shutil.copytree(os.environ["OLD_STORAGE"], os.environ["NEW_STORAGE"], dirs_exist_ok=True)
print(f"upgrade {os.environ['TENANT_ID']}: v{os.environ['OLD_DATA_VERSION']} -> v{os.environ['NEW_DATA_VERSION']}")
'''

SERVER_PY = '''import html, json, os, re, sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PLUGIN_ID = os.environ["PLUGIN_ID"]
VERSION = os.environ["PLUGIN_VERSION"]
DB_DIR = Path(os.environ["TENANT_DB_DIR"])
TENANT_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _context(self):
        tenant = self.headers.get("X-Resolved-Tenant-ID", "")
        if not TENANT_RE.match(tenant):
            return None, {"error": "missing X-Resolved-Tenant-ID"}
        mode = self.headers.get("X-Operator-Mode", "NORMAL")
        bypass = self.headers.get("X-System-Bypass-Auth") == "true"
        db = DB_DIR / f"db_{PLUGIN_ID}_{tenant}_v{VERSION}.sqlite"
        if not db.exists():
            return None, {"error": f"tenant db not found: {db.name}"}
        conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        items = [dict(r) for r in conn.execute("SELECT * FROM items ORDER BY id LIMIT 20")]
        conn.close()
        return {
            "plugin": PLUGIN_ID, "version": VERSION, "pid": os.getpid(),
            "tenant": tenant, "database": db.stem, "mode": mode,
            "operator": self.headers.get("X-Operator-ID"),
            "role": "SUPER_ADMIN" if bypass else "USER",
            "side_effects": "MOCK" if mode == "SANDBOX" else "REAL",
            "danger_border": mode == "PRODUCTION_SUPPORT",
            "items": items,
        }, None

    def do_GET(self):
        ctx, err = self._context()
        if err:
            return self._send(400, err)
        if self.path.split("?")[0].rstrip("/").endswith("/api/info"):
            return self._send(200, ctx)
        self._send(200, render(ctx), "text/html; charset=utf-8")

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


def render(ctx):
    e = lambda v: html.escape(str(v))
    cols = list(ctx["items"][0].keys()) if ctx["items"] else []
    rows = "".join("<tr>" + "".join(f"<td>{e(r[c])}</td>" for c in cols) + "</tr>" for r in ctx["items"])
    border = "6px solid #dc2626" if ctx["danger_border"] else "1px solid #e5e7eb"
    warn = ('<div class="warn">⚠ 生产运维穿透模式：正在以超级权限操作真实企业数据（操作人 '
            + e(ctx["operator"]) + '）</div>') if ctx["danger_border"] else ""
    sandbox = '<div class="sb">🧪 沙箱模式：外部副作用已 Mock 拦截</div>' if ctx["mode"] == "SANDBOX" else ""
    return f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>库存管理 v{e(ctx['version'])}</title>
<style>body{{margin:0;font-family:"Microsoft YaHei",sans-serif;background:#f4f6fb}}
.wrap{{margin:16px;background:#fff;border:{border};border-radius:12px;padding:20px 24px}}
h1{{font-size:20px;margin:0 0 10px}} .meta{{color:#6b7280;font-size:13px;line-height:1.9}}
.warn{{background:#fee2e2;color:#b91c1c;font-weight:700;padding:10px 14px;border-radius:8px;margin-bottom:12px}}
.sb{{background:#fef3c7;color:#b45309;padding:10px 14px;border-radius:8px;margin-bottom:12px}}
table{{border-collapse:collapse;margin-top:14px;font-size:13px}} td,th{{border:1px solid #e5e7eb;padding:6px 12px}} th{{background:#f8f9ff}}</style>
</head><body><div class="wrap">{warn}{sandbox}<h1>📦 库存管理 <small>v{e(ctx['version'])}</small></h1>
<div class="meta">租户：<b>{e(ctx['tenant'])}</b> · 数据库：{e(ctx['database'])} · 角色：{e(ctx['role'])} ·
模式：{e(ctx['mode'])} · 外部副作用：{e(ctx['side_effects'])} · PID {e(ctx['pid'])}</div>
<table><tr>{''.join(f'<th>{e(c)}</th>' for c in cols)}</tr>{rows}</table>
<p class="meta"><a href="api/info">api/info（JSON）</a></p></div></body></html>"""


if __name__ == "__main__":
    host, port = os.environ.get("HOST", "127.0.0.1"), int(os.environ["PORT"])
    print(f"{PLUGIN_ID} v{VERSION} listening on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
'''

BASE = {
    "id": "inventory",
    "name": "库存管理",
    "icon": "📦",
    "category": "业务应用",
    "author": "平台研发组",
    "description": "面向珠宝门店的商品库存管理，支持入库、出库、盘点与库位管理。",
    "features": ["商品档案与库存数量管理", "入库 / 出库登记", "库存盘点", "多库位管理"],
}

PACKAGES = [
    ("2.1.0", "2.1.0", {"init": "scripts/init.py"}),
    ("2.2.0", "2.1.0", {"init": "scripts/init.py"}),
    ("2.3.0", "2.3.0", {"init": "scripts/init.py", "upgrade": "scripts/upgrade.py"}),
    ("2.4.0", "2.3.0", {"init": "scripts/init.py", "upgrade": "scripts/upgrade.py"}),
    ("2.6.0", "2.3.0", {"init": "scripts/init.py", "upgrade": "scripts/upgrade.py"}),
    ("2.7.0", "2.3.0", {"init": "scripts/init.py", "upgrade": "scripts/upgrade.py"}),
]

PROMO_HTML = '''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>库存管理 · 珠宝门店库存解决方案</title><link rel="stylesheet" href="style.css"></head>
<body>
<header class="hero"><div class="logo">📦</div><h1>库存管理</h1>
<p>面向珠宝门店的商品库存管理，入库、出库、盘点与库位一站式完成。</p>
<span class="ver">当前版本 v{version}</span></header>
<section class="grid">
<div class="card"><h3>🗂 商品档案</h3><p>款式、材质、重量、证书统一建档，库存数量实时可见。</p></div>
<div class="card"><h3>📥 入库 / 出库</h3><p>扫码登记，自动生成库存流水，异常变动及时提醒。</p></div>
<div class="card"><h3>📋 库存盘点</h3><p>按柜台、库位分批盘点，盘盈盘亏一目了然。</p></div>
<div class="card"><h3>📍 多库位管理</h3><p>门店、保险柜、展柜多库位调拨，货品去向可追溯。</p></div>
</section>
<section class="cta"><h2>免费试用，全功能开放</h2><p>在平台注册企业账号后，从应用市场开通试用即可使用。</p></section>
<footer>© 平台研发组 · 库存管理插件</footer>
</body></html>
'''

PROMO_CSS = '''body{margin:0;font-family:"Microsoft YaHei",sans-serif;color:#1f2937;background:#f8fafc}
.hero{text-align:center;padding:64px 20px 48px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}
.logo{font-size:56px}.hero h1{font-size:36px;margin:10px 0}.hero p{opacity:.9;font-size:16px}
.ver{display:inline-block;margin-top:12px;background:rgba(255,255,255,.2);padding:4px 14px;border-radius:999px;font-size:13px}
.grid{max-width:960px;margin:-28px auto 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;padding:0 20px}
.card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(31,41,55,.08)}
.card h3{margin:0 0 8px;font-size:16px}.card p{margin:0;color:#6b7280;font-size:13.5px;line-height:1.7}
.cta{text-align:center;padding:48px 20px}.cta h2{margin:0 0 8px}.cta p{color:#6b7280}
footer{text-align:center;color:#9ca3af;font-size:12px;padding:24px}
'''


def build() -> None:
    OUT.mkdir(exist_ok=True)
    for sw, dv, scripts in PACKAGES:
        manifest = {**BASE, "softwareVersion": sw, "dataVersion": dv, "scripts": scripts,
                    "entry": "server/app.py", "promo": "promo/index.html"}
        path = OUT / f"inventory_v{sw}.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("plugin.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            zf.writestr("scripts/init.py", INIT_PY)
            if "upgrade" in scripts:
                zf.writestr("scripts/upgrade.py", UPGRADE_PY)
            zf.writestr("server/app.py", SERVER_PY)
            zf.writestr("promo/index.html", PROMO_HTML.replace("{version}", sw))
            zf.writestr("promo/style.css", PROMO_CSS)
        print("生成", path)


if __name__ == "__main__":
    build()
