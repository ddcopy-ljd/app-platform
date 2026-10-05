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
# 仅数据已就绪（正式/试运行）的版本才有租户库可供服务使用
STARTABLE_STATUSES = ("ready", "trial", "trial_passed")

_procs: dict[int, subprocess.Popen] = {}
_lock = threading.RLock()


def service_log_path(plugin_id: str, version: str) -> Path:
    return LOG_DIR / f"{plugin_id}_v{version}.log"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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
    pkg = package_dir(plugin_id, sw)
    entry = _script_path(pkg, json.loads(v["manifest"]).get("entry"))
    if not entry:
        raise PluginError(f"v{sw} 插件包未声明 entry 服务入口，无法启动")

    port = _free_port()
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
                    (f"服务进程异常退出（退出码 {code}）", r["id"]),
                )


def get_service_log(plugin_id: str, version_id: int) -> dict:
    with get_conn() as conn:
        v = _get_version(conn, plugin_id, version_id)
    path = service_log_path(plugin_id, v["software_version"])
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    return {"software_version": v["software_version"], "log": "\n".join(text.splitlines()[-200:])}


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
