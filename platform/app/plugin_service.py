"""应用插件升级引擎：插件包登记、租户数据复制/迁移、试运行、正式切换与回滚。"""

import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

from .config import (
    MAX_PACKAGE_BYTES,
    PACKAGES_DIR,
    SANDBOX_TENANT_ID,
    SCRIPT_TIMEOUT_SECONDS,
    STORAGE_DIR,
    TENANT_DB_DIR,
)
from .db import audit, get_conn, now_str

PLUGIN_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")
VERSION_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
BUSY_STATUSES = ("preparing", "switching")
# 演示节奏：让进度条与暂停横幅可见
STEP_DELAY = float(os.environ.get("DEMO_STEP_DELAY", "0.8"))


class PluginError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def vkey(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in version.split("."))


# ---------------------------------------------------------------- 路径与命名

def db_name(plugin_id: str, tenant_id: str, version: str) -> str:
    return f"db_{plugin_id}_{tenant_id}_v{version}"


def db_path(plugin_id: str, tenant_id: str, version: str) -> Path:
    return TENANT_DB_DIR / plugin_id / f"{db_name(plugin_id, tenant_id, version)}.sqlite"


def storage_path(plugin_id: str, tenant_id: str, version: str) -> Path:
    return STORAGE_DIR / plugin_id / tenant_id / f"v{version}"


def package_dir(plugin_id: str, version: str) -> Path:
    return PACKAGES_DIR / plugin_id / f"v{version}"


def sqlite_uri(path: Path) -> str:
    return "sqlite:///" + path.as_posix()


# ---------------------------------------------------------------- 查询

def _version_rows(conn, plugin_id: str) -> list[sqlite3.Row]:
    rows = conn.execute("SELECT * FROM plugin_versions WHERE plugin_id=?", (plugin_id,)).fetchall()
    return sorted(rows, key=lambda r: vkey(r["software_version"]))


def _get_plugin(conn, plugin_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM plugins WHERE id=?", (plugin_id,)).fetchone()
    if not row:
        raise PluginError("插件不存在", 404)
    return row


def _get_version(conn, plugin_id: str, version_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM plugin_versions WHERE id=? AND plugin_id=?", (version_id, plugin_id)
    ).fetchone()
    if not row:
        raise PluginError("版本不存在", 404)
    return row


def _find_version(conn, plugin_id: str, software_version: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM plugin_versions WHERE plugin_id=? AND software_version=?",
        (plugin_id, software_version),
    ).fetchone()


def _ensure_idle(conn, plugin_id: str) -> None:
    busy = conn.execute(
        f"SELECT software_version FROM plugin_versions WHERE plugin_id=? AND status IN {BUSY_STATUSES}",
        (plugin_id,),
    ).fetchone()
    if busy:
        raise PluginError(f"v{busy['software_version']} 正在执行数据任务，请稍候", 409)


def _active_tenants(conn, plugin_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT t.id FROM tenant_apps ta JOIN tenants t ON t.id = ta.tenant_id "
        "WHERE ta.plugin_id=? AND ta.status='active' AND t.status='active' AND t.is_sandbox=0 "
        "ORDER BY t.id",
        (plugin_id,),
    ).fetchall()
    return [r["id"] for r in rows]


def list_plugins() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM plugins ORDER BY created_at").fetchall()
        result = []
        for p in rows:
            versions = _version_rows(conn, p["id"])
            result.append({
                "id": p["id"],
                "name": p["name"],
                "icon": p["icon"],
                "current_version": p["current_version"],
                "gateway_state": p["gateway_state"],
                "app_status": p["app_status"],
                "running_count": sum(v["service_state"] == "running" for v in versions),
                "version_count": len(versions),
                "busy": any(v["status"] in BUSY_STATUSES for v in versions),
            })
        return result


def get_plugin_detail(plugin_id: str) -> dict:
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        rows = _version_rows(conn, plugin_id)
        protected_from = max(0, len(rows) - 2)
        versions = []
        prev = None
        for idx, v in enumerate(rows):
            if prev is None:
                structure = "initial"
            elif v["data_version"] == prev["data_version"]:
                structure = "same"
            else:
                structure = "upgrade"
            versions.append({
                "id": v["id"],
                "software_version": v["software_version"],
                "data_version": v["data_version"],
                "package_name": v["package_name"],
                "package_size": v["package_size"],
                "uploaded_at": v["uploaded_at"],
                "status": v["status"],
                "progress": v["progress"],
                "source_version": v["source_version"],
                "trial_tenants": json.loads(v["trial_tenants"]),
                "prepared_at": v["prepared_at"],
                "switched_at": v["switched_at"],
                "error": v["error"],
                "has_entry": bool(json.loads(v["manifest"]).get("entry")),
                "has_promo": bool(json.loads(v["manifest"]).get("promo")),
                "service": {
                    "state": v["service_state"],
                    "port": v["service_port"],
                    "pid": v["service_pid"],
                    "started_at": v["service_started_at"],
                    "error": v["service_error"],
                },
                "structure": structure,
                "prev_data_version": prev["data_version"] if prev else None,
                "is_current": v["software_version"] == p["current_version"],
                "protected": idx >= protected_from or v["software_version"] == p["current_version"],
            })
            prev = v
        tenants = conn.execute(
            "SELECT t.id, t.name, t.is_sandbox, COALESCE(ta.status, '') AS app_status "
            "FROM tenants t LEFT JOIN tenant_apps ta ON ta.tenant_id=t.id AND ta.plugin_id=? "
            "ORDER BY t.is_sandbox, t.id",
            (plugin_id,),
        ).fetchall()
        audits = conn.execute(
            "SELECT ts, operator, action, detail FROM audit_logs WHERE target=? ORDER BY id DESC LIMIT 30",
            (plugin_id,),
        ).fetchall()
        return {
            "id": p["id"],
            "name": p["name"],
            "icon": p["icon"],
            "category": p["category"],
            "author": p["author"],
            "description": p["description"],
            "features": json.loads(p["features"]),
            "current_version": p["current_version"],
            "gateway_state": p["gateway_state"],
            "app_status": p["app_status"],
            "created_at": p["created_at"],
            "versions": versions,
            "tenants": [dict(t) for t in tenants],
            "audits": [dict(a) for a in audits],
        }


def get_version_log(plugin_id: str, version_id: int) -> dict:
    with get_conn() as conn:
        v = _get_version(conn, plugin_id, version_id)
        return {"software_version": v["software_version"], "status": v["status"], "log": v["log"]}


# ---------------------------------------------------------------- 上传插件包

def _safe_extract(zf: zipfile.ZipFile, target: Path) -> None:
    root = target.resolve()
    for member in zf.infolist():
        dest = (root / member.filename).resolve()
        if not dest.is_relative_to(root):
            raise PluginError(f"插件包包含非法路径：{member.filename}")
    zf.extractall(root)


def _find_manifest_root(extract_dir: Path) -> Path:
    if (extract_dir / "plugin.json").is_file():
        return extract_dir
    children = [c for c in extract_dir.iterdir() if c.is_dir()]
    if len(children) == 1 and (children[0] / "plugin.json").is_file():
        return children[0]
    raise PluginError("插件包根目录缺少 plugin.json")


def _script_path(pkg_root: Path, rel: str | None) -> Path | None:
    if not rel:
        return None
    path = (pkg_root / rel).resolve()
    if not path.is_relative_to(pkg_root.resolve()) or not path.is_file():
        raise PluginError(f"插件包内找不到脚本：{rel}")
    if path.suffix not in (".py", ".sh"):
        raise PluginError("迁移脚本仅支持 .py 或 .sh")
    return path


def _promo_path(pkg_root: Path, rel: str | None) -> Path | None:
    if not rel:
        return None
    path = (pkg_root / rel).resolve()
    if not path.is_relative_to(pkg_root.resolve()) or not path.is_file():
        raise PluginError(f"插件包内找不到推广页：{rel}")
    if path.suffix.lower() not in (".html", ".htm"):
        raise PluginError("promo 推广页必须是 .html 文件")
    if path.parent == pkg_root.resolve():
        raise PluginError("promo 推广页需放在单独子目录（如 promo/index.html），该目录会被公开访问")
    return path


def _validate_manifest(m: dict) -> dict:
    plugin_id = str(m.get("id", "")).strip()
    sw = str(m.get("softwareVersion", "")).strip()
    dv = str(m.get("dataVersion", "")).strip()
    if not PLUGIN_ID_RE.match(plugin_id):
        raise PluginError("plugin.json 的 id 必须为 2-32 位小写字母、数字或下划线，且以字母开头")
    if not VERSION_RE.match(sw) or not VERSION_RE.match(dv):
        raise PluginError("softwareVersion / dataVersion 必须为 x.y.z 格式")
    if vkey(dv) > vkey(sw):
        raise PluginError("dataVersion 不能大于 softwareVersion")
    name = str(m.get("name", "")).strip()
    if not name:
        raise PluginError("plugin.json 缺少 name")
    features = m.get("features", [])
    if not isinstance(features, list):
        raise PluginError("features 必须为数组")
    scripts = m.get("scripts") or {}
    if not isinstance(scripts, dict):
        raise PluginError("scripts 必须为对象")
    return {
        "id": plugin_id,
        "name": name[:40],
        "icon": str(m.get("icon", "🧩"))[:4] or "🧩",
        "category": str(m.get("category", ""))[:20],
        "author": str(m.get("author", ""))[:40],
        "description": str(m.get("description", ""))[:500],
        "features": [str(f)[:100] for f in features][:20],
        "softwareVersion": sw,
        "dataVersion": dv,
        "scripts": {"init": scripts.get("init"), "upgrade": scripts.get("upgrade")},
        "entry": m.get("entry") or None,
        "promo": m.get("promo") or None,
    }


def register_package(filename: str, content: bytes, operator: str) -> dict:
    if len(content) > MAX_PACKAGE_BYTES:
        raise PluginError("插件包超过 50MB 限制")
    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise PluginError("插件包必须为 .zip 格式")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            _safe_extract(zf, tmp_dir)
        pkg_root = _find_manifest_root(tmp_dir)
        try:
            raw = json.loads((pkg_root / "plugin.json").read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise PluginError(f"plugin.json 解析失败：{e}")
        m = _validate_manifest(raw)
        _script_path(pkg_root, m["scripts"]["init"])
        _script_path(pkg_root, m["scripts"]["upgrade"])
        entry = _script_path(pkg_root, m["entry"])
        if entry and entry.suffix != ".py":
            raise PluginError("entry 服务入口仅支持 .py")
        _promo_path(pkg_root, m["promo"])

        with get_conn() as conn:
            plugin = conn.execute("SELECT * FROM plugins WHERE id=?", (m["id"],)).fetchone()
            versions = _version_rows(conn, m["id"]) if plugin else []
            same_sw_old = None   # 同 software_version 的旧非正式版本行（替换目标）
            if plugin and versions:
                last = versions[-1]
                # 同 softwareVersion 且非正式版 → 自动替换（删除旧行后插入新行）
                same_row = next((v for v in reversed(versions)
                                 if v["software_version"] == m["softwareVersion"]
                                 and v["software_version"] != plugin["current_version"]),
                                None)
                if same_row:
                    same_sw_old = same_row
                elif vkey(m["softwareVersion"]) <= vkey(last["software_version"]):
                    raise PluginError(
                        f"软件版本 {m['softwareVersion']} 必须大于已有最新版本 {last['software_version']}"
                    )

            # --- 同版本替换：先 stop 旧服务 + 删旧 DB 行 + 清旧包目录 + 清旧数据快照 ---
            if same_sw_old is not None:
                from . import runtime
                old_sw = same_sw_old["software_version"]
                old_pkg = package_dir(m["id"], old_sw)
                runtime.stop_if_running(m["id"], same_sw_old["id"], operator)
                conn.execute("DELETE FROM plugin_versions WHERE id=?", (same_sw_old["id"],))
                if old_pkg.exists():
                    shutil.rmtree(old_pkg, ignore_errors=True)
                for f in (TENANT_DB_DIR / m["id"]).glob(f"db_{m['id']}_*_v{old_sw}.sqlite*"):
                    f.unlink(missing_ok=True)
                for d in (STORAGE_DIR / m["id"]).glob(f"*/v{old_sw}"):
                    shutil.rmtree(d, ignore_errors=True)
                audit(conn, operator, "上传替换同版本", m["id"],
                      f"旧 v{old_sw}（{same_sw_old['status']}）已删除，准备写入新包")

            target = package_dir(m["id"], m["softwareVersion"])
            if target.exists():
                shutil.rmtree(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(pkg_root, target)

            meta = (m["name"], m["icon"], m["category"], m["author"], m["description"],
                    json.dumps(m["features"], ensure_ascii=False))
            if plugin:
                conn.execute(
                    "UPDATE plugins SET name=?, icon=?, category=?, author=?, description=?, features=? WHERE id=?",
                    (*meta, m["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO plugins (name, icon, category, author, description, features, id, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (*meta, m["id"], now_str()),
                )
                # 演示：订阅模块尚未实现，新插件默认为所有真实租户开通
                conn.execute(
                    "INSERT OR IGNORE INTO tenant_apps (tenant_id, plugin_id) "
                    "SELECT id, ? FROM tenants WHERE is_sandbox=0",
                    (m["id"],),
                )
            conn.execute(
                "INSERT INTO plugin_versions (plugin_id, software_version, data_version, package_name, "
                "package_size, manifest, uploaded_at) VALUES (?,?,?,?,?,?,?)",
                (m["id"], m["softwareVersion"], m["dataVersion"], filename[:120], len(content),
                 json.dumps(m, ensure_ascii=False), now_str()),
            )
            audit(conn, operator, "上传插件包", m["id"],
                  f"v{m['softwareVersion']}（数据版本 v{m['dataVersion']}）{filename}")
    return {"plugin_id": m["id"], "software_version": m["softwareVersion"], "data_version": m["dataVersion"]}


# ---------------------------------------------------------------- 数据任务

class TaskLog:
    def __init__(self, version_id: int):
        self.version_id = version_id

    def write(self, line: str, level: str = "info") -> None:
        text = f"[{now_str()}] [{level}] {line}\n"
        with get_conn() as conn:
            conn.execute("UPDATE plugin_versions SET log = log || ? WHERE id=?", (text, self.version_id))

    def progress(self, value: int) -> None:
        with get_conn() as conn:
            conn.execute("UPDATE plugin_versions SET progress=? WHERE id=?", (value, self.version_id))


def _run_script(script: Path, env_vars: dict[str, str], log: TaskLog) -> None:
    if script.suffix == ".py":
        cmd = [sys.executable, str(script)]
    else:
        bash = shutil.which("bash")
        if not bash:
            raise RuntimeError("当前环境缺少 bash，无法执行 .sh 脚本")
        cmd = [bash, str(script)]
    cmd += [f"--{k.lower().replace('_', '-')}={v}" for k, v in env_vars.items()]
    env = {**os.environ, **env_vars, "PYTHONIOENCODING": "utf-8"}
    log.write(f"执行脚本 {script.name}")
    proc = subprocess.run(
        cmd, cwd=script.parent, env=env, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=SCRIPT_TIMEOUT_SECONDS,
    )
    for line in (proc.stdout + proc.stderr).splitlines():
        if line.strip():
            log.write(f"  | {line}", "script")
    if proc.returncode != 0:
        raise RuntimeError(f"脚本 {script.name} 退出码 {proc.returncode}")


def _clear_target(plugin_id: str, tenant_id: str, version: str) -> tuple[Path, Path]:
    new_db = db_path(plugin_id, tenant_id, version)
    new_storage = storage_path(plugin_id, tenant_id, version)
    new_db.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(str(new_db) + suffix).unlink(missing_ok=True)
    if new_storage.exists():
        shutil.rmtree(new_storage)
    return new_db, new_storage


def _init_tenant(plugin_id: str, tenant_id: str, ver: sqlite3.Row, log: TaskLog) -> None:
    sw = ver["software_version"]
    new_db, new_storage = _clear_target(plugin_id, tenant_id, sw)
    manifest = json.loads(ver["manifest"])
    pkg = package_dir(plugin_id, sw)
    script = _script_path(pkg, manifest["scripts"]["init"])
    if script:
        _run_script(script, {
            "TENANT_ID": tenant_id,
            "NEW_DB_URI": sqlite_uri(new_db),
            "NEW_DB_PATH": str(new_db),
            "NEW_STORAGE": str(new_storage),
            "NEW_VERSION": sw,
            "NEW_DATA_VERSION": ver["data_version"],
        }, log)
    else:
        sqlite3.connect(new_db).close()
    new_storage.mkdir(parents=True, exist_ok=True)
    if not new_db.exists():
        raise RuntimeError("初始化脚本未创建数据库")
    log.write(f"租户 {tenant_id}：初始化 {db_name(plugin_id, tenant_id, sw)}", "ok")


def _copy_sqlite(src: Path, dst: Path) -> None:
    s = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    try:
        s.backup(d)
    finally:
        s.close()
        d.close()


def _migration_hops(plugin_id: str, src: sqlite3.Row, dst: sqlite3.Row) -> list[sqlite3.Row]:
    """源→目标之间所有结构变化点，按版本链依次执行各自包内的迁移脚本。"""
    with get_conn() as conn:
        chain = [v for v in _version_rows(conn, plugin_id)
                 if vkey(src["software_version"]) < vkey(v["software_version"]) <= vkey(dst["software_version"])]
    hops, cur_dv = [], src["data_version"]
    for v in chain:
        if v["data_version"] != cur_dv:
            hops.append(v)
            cur_dv = v["data_version"]
    if cur_dv != dst["data_version"]:
        hops.append(dst)
    return hops


def _migrate_tenant(plugin_id: str, tenant_id: str, src: sqlite3.Row, dst: sqlite3.Row, log: TaskLog) -> None:
    old_sw, new_sw = src["software_version"], dst["software_version"]
    old_db = db_path(plugin_id, tenant_id, old_sw)
    old_storage = storage_path(plugin_id, tenant_id, old_sw)
    if not old_db.exists():
        log.write(f"租户 {tenant_id}：v{old_sw} 无数据，按新版本初始化", "warn")
        _init_tenant(plugin_id, tenant_id, dst, log)
        return
    new_db, new_storage = _clear_target(plugin_id, tenant_id, new_sw)

    hops = _migration_hops(plugin_id, src, dst)
    if not hops:
        _copy_sqlite(old_db, new_db)
        if old_storage.exists():
            shutil.copytree(old_storage, new_storage)
        else:
            new_storage.mkdir(parents=True, exist_ok=True)
        log.write(f"租户 {tenant_id}：结构未变，复制 {old_db.stem} → {new_db.stem}", "ok")
        return

    tmp_dir = Path(tempfile.mkdtemp(prefix=f"mig_{plugin_id}_{tenant_id}_", dir=TENANT_DB_DIR / plugin_id))
    try:
        prev, prev_db, prev_storage = src, old_db, old_storage
        for i, hop in enumerate(hops):
            last = i == len(hops) - 1
            hop_sw = hop["software_version"]
            hop_db = new_db if last else tmp_dir / f"step{i}.sqlite"
            hop_storage = new_storage if last else tmp_dir / f"storage{i}"
            manifest = json.loads(hop["manifest"])
            script = _script_path(package_dir(plugin_id, hop_sw), manifest["scripts"]["upgrade"])
            if not script:
                raise RuntimeError(
                    f"v{hop_sw} 数据结构变更为 v{hop['data_version']}，但其插件包未声明 scripts.upgrade 迁移脚本"
                )
            hop_storage.mkdir(parents=True, exist_ok=True)
            log.write(f"租户 {tenant_id}：迁移步骤 {i + 1}/{len(hops)} 使用 v{hop_sw} 的迁移脚本 "
                      f"（数据 v{prev['data_version']} → v{hop['data_version']}）")
            _run_script(script, {
                "TENANT_ID": tenant_id,
                "OLD_STORAGE": str(prev_storage),
                "NEW_STORAGE": str(hop_storage),
                "OLD_DB_URI": sqlite_uri(prev_db),
                "NEW_DB_URI": sqlite_uri(hop_db),
                "OLD_DB_PATH": str(prev_db),
                "NEW_DB_PATH": str(hop_db),
                "OLD_VERSION": prev["software_version"],
                "NEW_VERSION": new_sw if last else hop_sw,
                "OLD_DATA_VERSION": prev["data_version"],
                "NEW_DATA_VERSION": hop["data_version"],
            }, log)
            if not hop_db.exists():
                raise RuntimeError(f"v{hop_sw} 迁移脚本未生成新数据库")
            prev, prev_db, prev_storage = hop, hop_db, hop_storage
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    log.write(f"租户 {tenant_id}：结构迁移 v{src['data_version']} → v{dst['data_version']} 完成", "ok")


def _run_steps(tenants: list[str], action, log: TaskLog) -> None:
    total = len(tenants)
    for i, tenant_id in enumerate(tenants, 1):
        action(tenant_id)
        time.sleep(STEP_DELAY)
        log.progress(int(i * 100 / total))


def _spawn(target, *args) -> None:
    threading.Thread(target=target, args=args, daemon=True).start()


# ---- 首个版本：初始化

def start_init(plugin_id: str, version_id: int, operator: str) -> None:
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        v = _get_version(conn, plugin_id, version_id)
        _ensure_idle(conn, plugin_id)
        if p["current_version"]:
            raise PluginError("插件已有运行版本，请使用试运行升级流程")
        if v["status"] not in ("uploaded", "failed"):
            raise PluginError("当前状态不可初始化")
        tenants = _active_tenants(conn, plugin_id) + [SANDBOX_TENANT_ID]
        conn.execute(
            "UPDATE plugin_versions SET status='preparing', progress=0, error=NULL, log='' WHERE id=?",
            (version_id,),
        )
        audit(conn, operator, "初始化首个版本", plugin_id, f"v{v['software_version']}")
    _spawn(_init_worker, plugin_id, version_id, tenants)


def _init_worker(plugin_id: str, version_id: int, tenants: list[str]) -> None:
    log = TaskLog(version_id)
    try:
        with get_conn() as conn:
            v = _get_version(conn, plugin_id, version_id)
        log.write(f"开始初始化 v{v['software_version']}，租户：{', '.join(tenants)}")
        _run_steps(tenants, lambda t: _init_tenant(plugin_id, t, v, log), log)
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET status='ready', progress=100, prepared_at=?, switched_at=? WHERE id=?",
                (now_str(), now_str(), version_id),
            )
            conn.execute("UPDATE plugins SET current_version=? WHERE id=?", (v["software_version"], plugin_id))
        log.write("初始化完成，网关已指向该版本", "ok")
    except Exception as e:  # noqa: BLE001 - 后台任务需兜底记录
        log.write(f"初始化失败：{e}", "error")
        with get_conn() as conn:
            conn.execute("UPDATE plugin_versions SET status='failed', error=? WHERE id=?", (str(e), version_id))


# ---- 阶段 A：沙箱试运行准备

def start_prepare(plugin_id: str, version_id: int, extra_tenants: list[str], operator: str) -> None:
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        v = _get_version(conn, plugin_id, version_id)
        _ensure_idle(conn, plugin_id)
        if not p["current_version"]:
            raise PluginError("请先初始化首个版本")
        if v["status"] not in ("uploaded", "failed", "trial", "trial_passed"):
            raise PluginError("当前状态不可发起试运行")
        cur = _find_version(conn, plugin_id, p["current_version"])
        if vkey(v["software_version"]) <= vkey(cur["software_version"]):
            raise PluginError("只能对高于当前运行版本的新版本发起试运行")
        # 允许多个版本同时处于试运行状态：各版本拥有独立的服务进程、端口与按版本隔离的
        # 租户库快照，互不影响；仅数据准备/切换任务通过 _ensure_idle 串行，避免并发迁库。
        allowed = set(_active_tenants(conn, plugin_id))
        invalid = [t for t in extra_tenants if t not in allowed]
        if invalid:
            raise PluginError(f"租户不可用于试运行：{', '.join(invalid)}")
        tenants = [SANDBOX_TENANT_ID] + [t for t in dict.fromkeys(extra_tenants)]
        conn.execute(
            "UPDATE plugin_versions SET status='preparing', progress=0, error=NULL, log='', "
            "source_version=?, trial_tenants=? WHERE id=?",
            (cur["software_version"], json.dumps(tenants), version_id),
        )
        audit(conn, operator, "发起试运行", plugin_id,
              f"v{cur['software_version']} → v{v['software_version']}，抽取租户：{', '.join(tenants)}")
    _stop_before_data_task(plugin_id, version_id)
    _spawn(_prepare_worker, plugin_id, version_id, cur["software_version"], tenants)


def _prepare_worker(plugin_id: str, version_id: int, source_sw: str, tenants: list[str]) -> None:
    log = TaskLog(version_id)
    try:
        with get_conn() as conn:
            src = _find_version(conn, plugin_id, source_sw)
            dst = _get_version(conn, plugin_id, version_id)
        mode = "复制" if src["data_version"] == dst["data_version"] else "结构迁移"
        log.write(f"阶段A 沙箱试运行准备：v{source_sw} → v{dst['software_version']}（{mode}）")
        log.write("仅抽取指定租户数据，真实业务不受影响")
        _run_steps(tenants, lambda t: _migrate_tenant(plugin_id, t, src, dst, log), log)
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET status='trial', progress=100, prepared_at=? WHERE id=?",
                (now_str(), version_id),
            )
        log.write(f"试运行数据已就绪，可启动 v{dst['software_version']} 服务并在网关调试中以沙箱模式验证", "ok")
    except Exception as e:  # noqa: BLE001
        log.write(f"试运行准备失败：{e}", "error")
        with get_conn() as conn:
            conn.execute("UPDATE plugin_versions SET status='failed', error=? WHERE id=?", (str(e), version_id))


def pass_trial(plugin_id: str, version_id: int, operator: str) -> None:
    with get_conn() as conn:
        v = _get_version(conn, plugin_id, version_id)
        if v["status"] != "trial":
            raise PluginError("仅试运行中的版本可标记通过")
        conn.execute("UPDATE plugin_versions SET status='trial_passed' WHERE id=?", (version_id,))
        audit(conn, operator, "试运行通过", plugin_id, f"v{v['software_version']}")
    TaskLog(version_id).write(f"管理员 {operator} 确认试运行通过", "ok")


# ---- 阶段 B/C：暂停服务、全量重迁、切换

def start_switch(plugin_id: str, version_id: int, operator: str) -> None:
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        v = _get_version(conn, plugin_id, version_id)
        _ensure_idle(conn, plugin_id)
        if v["status"] != "trial_passed":
            raise PluginError("试运行通过后才能正式切换")
        tenants = _active_tenants(conn, plugin_id) + [SANDBOX_TENANT_ID]
        source_sw = p["current_version"]
        conn.execute("UPDATE plugins SET gateway_state='MAINTENANCE' WHERE id=?", (plugin_id,))
        conn.execute(
            "UPDATE plugin_versions SET status='switching', progress=0, error=NULL, source_version=? WHERE id=?",
            (source_sw, version_id),
        )
        audit(conn, operator, "正式切换", plugin_id,
              f"v{source_sw} → v{v['software_version']}，网关进入 MAINTENANCE，全量重迁 {len(tenants)} 个租户")
    was_running = _stop_before_data_task(plugin_id, version_id)
    _spawn(_switch_worker, plugin_id, version_id, source_sw, tenants, was_running)


def _stop_before_data_task(plugin_id: str, version_id: int) -> bool:
    """数据任务会重建该版本的租户库，先停止其服务进程。"""
    from . import runtime

    stopped = runtime.stop_if_running(plugin_id, version_id, "system")
    if stopped:
        TaskLog(version_id).write("数据任务开始前已停止本版本服务", "warn")
    return stopped


def _switch_worker(plugin_id: str, version_id: int, source_sw: str, tenants: list[str], was_running: bool) -> None:
    log = TaskLog(version_id)
    try:
        with get_conn() as conn:
            src = _find_version(conn, plugin_id, source_sw)
            dst = _get_version(conn, plugin_id, version_id)
        log.write("阶段B 网关进入 MAINTENANCE，拦截业务请求")
        log.write(f"基于 v{source_sw} 最新数据全量重迁，活跃租户：{', '.join(tenants)}")
        _run_steps(tenants, lambda t: _migrate_tenant(plugin_id, t, src, dst, log), log)
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET status='ready', progress=100, switched_at=? WHERE id=?",
                (now_str(), version_id),
            )
            conn.execute(
                "UPDATE plugins SET current_version=?, gateway_state='NORMAL' WHERE id=?",
                (dst["software_version"], plugin_id),
            )
        log.write(f"阶段C 主路由切向 v{dst['software_version']}，业务恢复", "ok")
        _handover(plugin_id, source_sw, dst["software_version"], was_running, log)
    except Exception as e:  # noqa: BLE001
        log.write(f"全量重迁失败：{e}；主路由保持 v{source_sw}，业务恢复", "error")
        with get_conn() as conn:
            conn.execute("UPDATE plugins SET gateway_state='NORMAL' WHERE id=?", (plugin_id,))
            conn.execute(
                "UPDATE plugin_versions SET status='failed', error=? WHERE id=?",
                (f"切换失败，已保持旧版本：{e}", version_id),
            )


def _handover(plugin_id: str, old_sw: str | None, new_sw: str, force_start: bool, log: TaskLog) -> None:
    from . import runtime

    try:
        msg = runtime.handover(plugin_id, old_sw, new_sw, force_start)
        if msg:
            log.write(msg, "ok")
    except Exception as e:  # noqa: BLE001
        log.write(f"服务交接失败：{e}", "error")


def set_current(plugin_id: str, version_id: int, operator: str) -> None:
    """设为正式版本（秒级回滚）：仅修改主路由指向，使用目标版本的独立数据快照。"""
    from . import runtime

    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        v = _get_version(conn, plugin_id, version_id)
        _ensure_idle(conn, plugin_id)
        if v["status"] != "ready":
            raise PluginError("仅数据已就绪的版本可设为正式版本")
        if v["software_version"] == p["current_version"]:
            raise PluginError("该版本已是正式版本")
    # 原正式版本服务在运行时，先拉起新版本服务，失败则不切换路由
    msg = runtime.handover(plugin_id, p["current_version"], v["software_version"])
    with get_conn() as conn:
        conn.execute("UPDATE plugins SET current_version=? WHERE id=?", (v["software_version"], plugin_id))
        audit(conn, operator, "设为正式版本", plugin_id,
              f"v{p['current_version']} → v{v['software_version']}" + (f"；{msg}" if msg else ""))
    log = TaskLog(version_id)
    log.write(f"管理员 {operator} 将本版本设为正式版本（主路由切换）", "warn")
    if msg:
        log.write(msg, "ok")


def set_app_status(plugin_id: str, status: str, operator: str) -> None:
    if status not in ("OPEN", "MAINTENANCE"):
        raise PluginError("应用状态只能为 OPEN 或 MAINTENANCE")
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        if p["app_status"] == status:
            return
        conn.execute("UPDATE plugins SET app_status=? WHERE id=?", (status, plugin_id))
        audit(conn, operator, "设置应用状态", plugin_id,
              "开放" if status == "OPEN" else "维护（暂停企业业务访问）")


def delete_version(plugin_id: str, version_id: int, operator: str) -> dict:
    """删除指定插件版本。

    只允许删除非正式版（uploaded / failed / preparing / trial / trial_passed）。
    正式版（等于 plugins.current_version）、正在初始化的数据任务（init）、
    正式切换数据任务（switching）一律拒绝。
    返回清理摘要（包目录、沙箱库、storage 清理情况）。
    """
    from . import runtime

    # --- 1) 校验 + 拷贝字段（避免 sqlite3.Row 跨 conn 失效）---
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        v = _get_version(conn, plugin_id, version_id)
        sw = v["software_version"]
        v_status = v["status"]
        svc_pid = v["service_pid"]
        is_current = sw == p["current_version"]
        gw_state = p["gateway_state"]

    # 保护 1：正式版受保护
    if is_current:
        raise PluginError(
            f"v{sw} 是当前正式版本（current_version），不可删除。"
            " 如需更换版本，请先发布新版本并设为正式版。"
        )
    # 保护 2：数据任务进行中受保护
    if v_status in ("init", "switching"):
        raise PluginError(
            f"v{sw} 正在 {v_status} 数据任务中，不可删除。"
            " 请等任务结束或手动停止。"
        )
    # 保护 3：网关维护中受保护
    if gw_state == "MAINTENANCE":
        raise PluginError("插件处于 MAINTENANCE 维护状态，无法删除版本")

    # --- 2) 停服务 + 串行保护 ---
    stopped = runtime.stop_if_running(plugin_id, version_id, operator)
    with get_conn() as c:
        _ensure_idle(c, plugin_id)

    pkg = package_dir(plugin_id, sw)
    pkg_gone = False
    db_gone = []
    storage_gone = []

    # --- 3) 删版本行 + 审计 ---
    with get_conn() as conn:
        conn.execute("DELETE FROM plugin_versions WHERE id=?", (version_id,))
        audit(conn, operator, "删除版本", plugin_id,
              f"v{sw}（{v_status}），PID {svc_pid} 已停={stopped}")

    # --- 4) 清包目录 ---
    if pkg.exists():
        shutil.rmtree(pkg, ignore_errors=True)
        pkg_gone = not pkg.exists()

    # --- 5) 清该版本所有租户数据库快照（含 trial 沙箱库）---
    for f in (TENANT_DB_DIR / plugin_id).glob(f"db_{plugin_id}_*_v{sw}.sqlite*"):
        try:
            f.unlink(missing_ok=True)
            db_gone.append(f.name)
        except OSError:
            pass

    # --- 6) 清该版本所有 storage 快照 ---
    for d in (STORAGE_DIR / plugin_id).glob(f"*/v{sw}"):
        try:
            shutil.rmtree(d, ignore_errors=True)
            storage_gone.append(str(d))
        except OSError:
            pass

    return {
        "plugin_id": plugin_id,
        "software_version": sw,
        "service_stopped": stopped,
        "package_removed": pkg_gone,
        "db_snapshots_removed": db_gone,
        "storage_snapshots_removed": storage_gone,
    }


# ---------------------------------------------------------------- 网关上下文

def resolve_gateway(plugin_id: str, mode: str, tenant_id: str | None, version: str | None, operator: str,
                    record_audit: bool = True) -> dict:
    """解析路由目标版本与注入 Header；version 为空时按模式自动路由。"""
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        if p["gateway_state"] == "MAINTENANCE":
            raise PluginError("系统升级中，暂停使用（网关 MAINTENANCE，请求已拦截）", 503)
        # 维护状态只拦截企业常规访问，管理员沙箱/运维穿透仍可进入排障
        if mode == "NORMAL" and p["app_status"] == "MAINTENANCE":
            raise PluginError("应用维护中，暂停使用（平台已将应用设为维护状态）", 503)

        if version:
            target = _find_version(conn, plugin_id, version)
            if not target:
                raise PluginError(f"版本 v{version} 不存在", 404)
        else:
            target = None
            if mode == "SANDBOX":
                trials = conn.execute(
                    "SELECT * FROM plugin_versions WHERE plugin_id=? AND status IN ('trial','trial_passed')",
                    (plugin_id,),
                ).fetchall()
                # 多个版本可同时试运行；未显式指定版本时默认进入版本号最高的试运行版本
                if trials:
                    target = max(trials, key=lambda r: vkey(r["software_version"]))
            if not target and p["current_version"]:
                target = _find_version(conn, plugin_id, p["current_version"])
            if not target:
                raise PluginError("应用尚未设置正式版本", 404)
        target_sw = target["software_version"]

        if mode == "SANDBOX":
            tenant_id = SANDBOX_TENANT_ID
            headers = {
                "X-Resolved-Tenant-ID": SANDBOX_TENANT_ID,
                "X-System-Bypass-Auth": "true",
                "X-Operator-Mode": "SANDBOX",
            }
            behavior = ["鉴权中间件免密放行，赋予 SUPER_ADMIN", "连接独立沙箱库", "强制 Mock 拦截短信/邮件等外部副作用"]
        elif mode in ("NORMAL", "PRODUCTION_SUPPORT"):
            if not tenant_id or tenant_id not in _active_tenants(conn, plugin_id):
                raise PluginError("请选择已开通该应用的真实企业租户")
            if mode == "NORMAL":
                headers = {"X-Resolved-Tenant-ID": tenant_id}
                behavior = ["连接真实租户库", "常规业务鉴权", "真实执行外部副作用"]
            else:
                headers = {
                    "X-Resolved-Tenant-ID": tenant_id,
                    "X-System-Bypass-Auth": "true",
                    "X-Operator-Mode": "PRODUCTION_SUPPORT",
                    "X-Operator-ID": operator,
                }
                behavior = ["赋予真实库超级权限", "真实执行外部副作用", "前端强制渲染红色危险警告边框", "后端记录越权审计日志"]
                if record_audit:
                    audit(conn, operator, "生产运维穿透", plugin_id, f"进入租户 {tenant_id} 工作台（v{target_sw}）")
        else:
            raise PluginError("未知的调试模式")

        if target["service_state"] != "running":
            raise PluginError(f"v{target_sw} 服务未启动，请先在版本链中启动该版本服务", 503)

    path = db_path(plugin_id, tenant_id, target_sw)
    return {
        "mode": mode,
        "tenant_id": tenant_id,
        "target_version": target_sw,
        "is_formal": target_sw == p["current_version"],
        "port": target["service_port"],
        "upstream": f"http://127.0.0.1:{target['service_port']}/",
        "headers": headers,
        "behavior": behavior,
        "database": db_name(plugin_id, tenant_id, target_sw),
        "database_exists": path.exists(),
        "danger": mode == "PRODUCTION_SUPPORT",
    }


def maintenance_status() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT p.id, p.name, p.current_version, v.software_version AS target, v.progress "
            "FROM plugins p LEFT JOIN plugin_versions v ON v.plugin_id=p.id AND v.status='switching' "
            "WHERE p.gateway_state='MAINTENANCE'"
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------- 推广页

def promo_file(plugin_id: str, version: str | None, rel_path: str) -> Path:
    """version 为空时取正式版本的推广页；仅允许访问推广页所在目录内的文件。"""
    with get_conn() as conn:
        p = _get_plugin(conn, plugin_id)
        sw = version or p["current_version"]
        v = _find_version(conn, plugin_id, sw) if sw else None
    if not v:
        raise PluginError("该应用尚未发布正式版本", 404)
    promo = json.loads(v["manifest"]).get("promo")
    if not promo:
        raise PluginError(f"v{sw} 未提供推广页", 404)
    pkg = package_dir(plugin_id, sw).resolve()
    index = (pkg / promo).resolve()
    root = index.parent
    target = index if not rel_path else (root / rel_path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise PluginError("文件不存在", 404)
    return target
