"""插件服务子进程管理：每个插件版本各自独立启动/停止一个服务进程。"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from .config import DATA_DIR, STORAGE_DIR, TENANT_DB_DIR
from .db import audit, get_conn, now_str
from .plugin_service import PluginError, _find_version, _get_version, _script_path, package_dir

LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
STARTUP_TIMEOUT = 8
LOG_ROTATE_BYTES = 5 * 1024 * 1024   # 单文件超 5MB 启动时轮转为 .log.1
LOG_TAIL_LINES = 15                  # 崩溃汇总附带的日志尾部行数
# 仅数据已就绪（正式/试运行）的版本才有租户库可供服务使用
STARTABLE_STATUSES = ("ready", "trial", "trial_passed")

# --- 端口持久化分配：正式段 8002 起、试运行段 8100 起，按 插件@版本@模式 固定，重启不变 ---
PROD_PORT_BASE = 8002
TRIAL_PORT_BASE = 8100
PORT_MAP_PATH = DATA_DIR / "port_map.json"
WATCHDOG_INTERVAL = 15
CRASH_WINDOW = 120          # 秒：该窗口内连续崩溃 3 次则放弃自动拉起
CRASH_LIMIT = 3

_procs: dict[int, subprocess.Popen] = {}
_lock = threading.RLock()
_crash_ts: dict[int, list[float]] = {}


def _load_port_map() -> dict[str, int]:
    try:
        return json.loads(PORT_MAP_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_port_map(m: dict[str, int]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PORT_MAP_PATH.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")


def _port_taken(port: int) -> bool:
    return _port_open(port)


def _port_bindable(port: int) -> bool:
    # SO_REUSEADDR：允许绑定刚释放（TIME_WAIT）的端口，避免同版本重启时端口漂移；
    # 真正被监听占用的端口已由 _port_taken(connect 探测) 先行排除。
    try:
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def _alloc_port(plugin_id: str, sw: str, mode: str) -> int:
    """持久化端口分配：同 插件+版本+模式 永远返回同一端口；被外程序占用时顺延并更新映射。"""
    key = f"{plugin_id}@{sw}@{mode}"
    base = PROD_PORT_BASE if mode == "prod" else TRIAL_PORT_BASE
    m = _load_port_map()
    port = int(m.get(key, 0))
    if port and not _port_taken(port) and _port_bindable(port):
        return port
    for cand in range(base, base + 400):
        if cand == port:
            continue
        if not _port_taken(cand) and _port_bindable(cand):
            m[key] = cand
            _save_port_map(m)
            if port:
                _write_log(plugin_id, sw, f"端口 {port} 被占用，v{sw} 改用备用端口 {cand}")
            return cand
    raise PluginError(f"无可用端口（{base} 起连续 400 个均被占用）")


def forget_ports(plugin_id: str, sw: str) -> None:
    """版本删除/替换时回收其持久端口映射。"""
    m = _load_port_map()
    changed = False
    for key in (f"{plugin_id}@{sw}@prod", f"{plugin_id}@{sw}@trial"):
        if key in m:
            m.pop(key, None)
            changed = True
    if changed:
        _save_port_map(m)


def service_log_path(plugin_id: str, version: str) -> Path:
    return LOG_DIR / f"{plugin_id}_v{version}.log"


def _rotate_log(plugin_id: str, version: str) -> None:
    """启动前检查日志体积，超阈值则轮转（.log → .log.1，仅保留一代）。

    只在启动前执行——运行中的进程持有句柄，Windows 下改名会失败。
    """
    path = service_log_path(plugin_id, version)
    try:
        if path.exists() and path.stat().st_size > LOG_ROTATE_BYTES:
            old = path.with_suffix(path.suffix + ".1")
            old.unlink(missing_ok=True)
            path.rename(old)
    except OSError:
        pass


def _log_tail(plugin_id: str, version: str, lines: int = LOG_TAIL_LINES) -> str:
    """取插件服务日志尾部若干行，用于崩溃汇总。"""
    path = service_log_path(plugin_id, version)
    try:
        if path.exists():
            content = path.read_text(encoding="utf-8", errors="replace")
            return "\n".join(content.splitlines()[-lines:])
    except OSError:
        pass
    return "（服务日志为空或不可读）"


def _append_watchdog_log(text: str) -> None:
    """平台级崩溃/守护事件汇总，供事后统一分析。"""
    with (LOG_DIR / "watchdog.log").open("a", encoding="utf-8") as f:
        f.write(f"[{now_str()}] {text}\n")


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _write_log(plugin_id: str, version: str, text: str) -> None:
    with service_log_path(plugin_id, version).open("a", encoding="utf-8") as f:
        f.write(f"[{now_str()}] [platform] {text}\n")


def _kill(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        # venv 的 python.exe 是启动器，需连同真实解释器子进程一起结束
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def _launch(plugin_id: str, v) -> tuple[subprocess.Popen, int]:
    sw = v["software_version"]
    _rotate_log(plugin_id, sw)
    pkg = package_dir(plugin_id, sw)
    entry = _script_path(pkg, json.loads(v["manifest"]).get("entry"))
    if not entry:
        raise PluginError(f"v{sw} 插件包未声明 entry 服务入口，无法启动")

    port = _alloc_port(plugin_id, sw, "prod" if v["status"] == "ready" else "trial")
    env = {
        **os.environ,
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
        "PLUGIN_ID": plugin_id,
        "PLUGIN_VERSION": sw,
        "DATA_VERSION": v["data_version"],
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "TENANT_DB_DIR": str(TENANT_DB_DIR / plugin_id),
        "STORAGE_DIR": str(STORAGE_DIR / plugin_id),
    }
    _write_log(plugin_id, sw, f"启动 v{sw}：{entry.relative_to(pkg)}，端口 {port}")
    with service_log_path(plugin_id, sw).open("a", encoding="utf-8") as log_file:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        proc = subprocess.Popen(
            [sys.executable, str(entry)], cwd=pkg, env=env,
            stdout=log_file, stderr=subprocess.STDOUT, creationflags=flags,
        )

    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            raise PluginError(f"v{sw} 服务进程启动后退出（退出码 {proc.returncode}），请查看服务日志")
        if _port_open(port):
            return proc, port
        time.sleep(0.2)
    _kill(proc)
    raise PluginError(f"v{sw} 服务在 {STARTUP_TIMEOUT} 秒内未监听端口 {port}，已终止")


def start_service(plugin_id: str, version_id: int, operator: str) -> None:
    with _lock:
        sync_states()
        with get_conn() as conn:
            v = _get_version(conn, plugin_id, version_id)
        sw = v["software_version"]
        if v["service_state"] == "running":
            raise PluginError(f"v{sw} 服务已在运行")
        if v["status"] not in STARTABLE_STATUSES:
            raise PluginError(f"v{sw} 数据尚未就绪（需初始化、试运行或已切换），无法启动服务")
        try:
            proc, port = _launch(plugin_id, v)
        except PluginError as e:
            with get_conn() as conn:
                conn.execute("UPDATE plugin_versions SET service_error=? WHERE id=?", (str(e), version_id))
                audit(conn, operator, "启动服务失败", plugin_id, str(e))
            raise
        _procs[version_id] = proc
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET service_state='running', service_port=?, service_pid=?, "
                "service_started_at=?, service_error=NULL WHERE id=?",
                (port, proc.pid, now_str(), version_id),
            )
            audit(conn, operator, "启动服务", plugin_id, f"v{sw}，PID {proc.pid}，端口 {port}")


def stop_service(plugin_id: str, version_id: int, operator: str) -> None:
    with _lock:
        with get_conn() as conn:
            v = _get_version(conn, plugin_id, version_id)
        sw = v["software_version"]
        if v["service_state"] != "running":
            raise PluginError(f"v{sw} 服务未在运行")
        proc = _procs.pop(version_id, None)
        if proc:
            _kill(proc)
        _write_log(plugin_id, sw, f"服务已停止（操作人 {operator}）")
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET service_state='stopped', service_pid=NULL, service_port=NULL, "
                "service_error=NULL WHERE id=?",
                (version_id,),
            )
            audit(conn, operator, "停止服务", plugin_id, f"v{sw}，PID {v['service_pid']}")


def stop_if_running(plugin_id: str, version_id: int, operator: str) -> bool:
    with _lock:
        with get_conn() as conn:
            v = _get_version(conn, plugin_id, version_id)
        if v["service_state"] != "running":
            return False
        stop_service(plugin_id, version_id, operator)
        return True


def is_running(plugin_id: str, software_version: str | None) -> bool:
    if not software_version:
        return False
    with get_conn() as conn:
        v = _find_version(conn, plugin_id, software_version)
    return bool(v) and v["service_state"] == "running"


def handover(plugin_id: str, old_sw: str | None, new_sw: str, force_start: bool = False) -> str | None:
    """正式版本变更：原正式版本服务在运行（或 force_start）时启动新版本服务并停止原版本。"""
    with _lock:
        with get_conn() as conn:
            old = _find_version(conn, plugin_id, old_sw) if old_sw else None
            new = _find_version(conn, plugin_id, new_sw)
        old_running = bool(old) and old["service_state"] == "running"
        if not (old_running or force_start):
            return None
        if new["service_state"] != "running":
            start_service(plugin_id, new["id"], "system")
        if old_running:
            stop_service(plugin_id, old["id"], "system")
        return f"服务已交接至 v{new_sw}" + (f"，v{old_sw} 服务已停止" if old_running else "")


def sync_states() -> None:
    """发现意外退出的服务进程并更新状态。"""
    with _lock, get_conn() as conn:
        rows = conn.execute("SELECT id FROM plugin_versions WHERE service_state='running'").fetchall()
        for r in rows:
            proc = _procs.get(r["id"])
            if proc is None or proc.poll() is not None:
                code = proc.returncode if proc else "未知"
                _procs.pop(r["id"], None)
                conn.execute(
                    "UPDATE plugin_versions SET service_state='stopped', service_pid=NULL, service_port=NULL, "
                    "service_error=? WHERE id=?",
                    (f"服务进程异常退出（退出码 {code}），崩溃详情见服务日志与 logs/watchdog.log", r["id"]),
                )


def get_service_log(plugin_id: str, version_id: int) -> dict:
    with get_conn() as conn:
        v = _get_version(conn, plugin_id, version_id)
    path = service_log_path(plugin_id, v["software_version"])
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    # 该插件的崩溃摘录（watchdog.log 中以此插件名开头的记录，取最后 3 条）
    wd_path = LOG_DIR / "watchdog.log"
    wd_all: list[str] = []
    if wd_path.exists():
        try:
            lines = wd_path.read_text(encoding="utf-8", errors="replace").splitlines()
            cur: list[str] = []
            for ln in lines:
                if ln.startswith(f"[") and "插件 " in ln and f" {plugin_id} " in ln:
                    if cur:
                        wd_all.append("\n".join(cur))
                    cur = [ln]
                elif cur:
                    cur.append(ln)
            if cur:
                wd_all.append("\n".join(cur))
        except OSError:
            pass
    return {
        "software_version": v["software_version"],
        "log": "\n".join(text.splitlines()[-300:]),
        "error": v["service_error"] or "",
        "watchdog": "\n\n".join(wd_all[-3:]),
    }


def stop_all() -> None:
    with _lock:
        for version_id, proc in list(_procs.items()):
            _kill(proc)
            _procs.pop(version_id, None)
        with get_conn() as conn:
            conn.execute(
                "UPDATE plugin_versions SET service_state='stopped', service_pid=NULL, service_port=NULL "
                "WHERE service_state='running'"
            )


def start_serving_versions() -> list[str]:
    """平台启动时自动拉起各插件的「正式版本」(current_version) 服务，使其调试入口开箱即用。

    同时拉起处于试运行/试运行通过状态的版本，因为沙箱模式需要它对外提供服务。
    单个插件启动失败不影响其他插件，结果逐条记录返回。
    """
    messages: list[str] = []
    with get_conn() as conn:
        plugins = conn.execute("SELECT id, current_version FROM plugins ORDER BY id").fetchall()

    for p in plugins:
        plugin_id = p["id"]
        current = p["current_version"]
        with get_conn() as conn:
            targets: list[tuple[int, str]] = []
            if current:
                v = _find_version(conn, plugin_id, current)
                if v and v["service_state"] != "running" and v["status"] in STARTABLE_STATUSES:
                    targets.append((v["id"], f"v{current}(正式)"))
            for t in conn.execute(
                "SELECT id, software_version FROM plugin_versions "
                "WHERE plugin_id=? AND status IN ('trial','trial_passed') AND service_state<>'running'",
                (plugin_id,),
            ).fetchall():
                targets.append((t["id"], f"v{t['software_version']}(试运行)"))

        for version_id, label in targets:
            try:
                start_service(plugin_id, version_id, "system")
                messages.append(f"{plugin_id} {label} 已随平台启动")
            except Exception as e:  # noqa: BLE001 - 自动启动需兜底，避免单点失败阻断其他插件
                messages.append(f"{plugin_id} {label} 启动失败：{e}")
    return messages


# ---------------------------------------------------------------- 服务守护（watchdog）

def _watchdog_once() -> None:
    """检查「应运行」的实例：进程意外退出则自动重新拉起（含崩溃保护）。"""
    with _lock:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT id, plugin_id, software_version FROM plugin_versions WHERE service_state='running'"
            ).fetchall()
        for r in rows:
            vid = r["id"]
            proc = _procs.get(vid)
            if proc is None or proc.poll() is None:
                continue  # 正常运行；proc 缺失属平台重启遗留，由 auto-start 负责
            code = proc.returncode
            pid, sw = r["plugin_id"], r["software_version"]
            crash_note = (
                f"插件 {pid} v{sw} 进程意外退出（退出码 {code}，PID {proc.pid}）"
                f"\n--- 崩溃前日志尾部 ---\n{_log_tail(pid, sw)}"
            )
            _append_watchdog_log(crash_note)
            _write_log(pid, sw, f"[watchdog] 检测到进程退出（退出码 {code}），开始自动重启（详见 watchdog.log）")
            nowt = time.time()
            ts = [t for t in _crash_ts.get(vid, []) if nowt - t < CRASH_WINDOW]
            ts.append(nowt)
            if len(ts) >= CRASH_LIMIT:
                ts.clear()
                _crash_ts[vid] = ts
                msg = (f"v{sw} 在 {CRASH_WINDOW}s 内连续崩溃 {CRASH_LIMIT} 次，停止自动拉起，请人工排查；"
                       f"崩溃摘录已记录 watchdog.log")
                _write_log(pid, sw, f"[watchdog] {msg}")
                _append_watchdog_log(f"插件 {pid} {msg}")
                sync_states()
                continue
            _crash_ts[vid] = ts
            try:
                start_service(pid, vid, "watchdog")
                _crash_ts.pop(vid, None)
                _write_log(pid, sw, f"[watchdog] v{sw} 已自动重启")
            except Exception as e:  # noqa: BLE001 - 单实例失败不阻断其他实例巡检
                _write_log(pid, sw, f"[watchdog] v{sw} 自动重启失败：{e}")
                _append_watchdog_log(f"插件 {pid} v{sw} 自动重启失败：{e}")


def start_watchdog() -> None:
    def _loop() -> None:
        while True:
            time.sleep(WATCHDOG_INTERVAL)
            try:
                _watchdog_once()
            except Exception:  # noqa: BLE001 - 守护线程永不因异常退出
                pass

    threading.Thread(target=_loop, name="plugin-watchdog", daemon=True).start()
