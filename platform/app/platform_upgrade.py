"""平台自我升级：上传 zip -> 校验 -> 备份 -> 外部助手脚本接力（展开 + 重启）。

Windows 下正在运行的 python.exe 锁定 app/*.py，无法覆盖自身；
因此本模块只负责 校验/解包/备份/拉起外部 PowerShell 助手，
真正的「停进程 -> 覆盖文件 -> pip -> 重启」由 upgrade_helper.ps1 在
python 进程退出后完成。红线：platform/data 与 .venv 永不被触碰。
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

PLATFORM_DIR = Path(__file__).resolve().parent.parent      # platform/
ROOT = PLATFORM_DIR.parent                                  # 项目根
UPGRADE_DIR = PLATFORM_DIR / "_upgrade"
BACKUP_DIR = PLATFORM_DIR / "_backup"
HELPER_NAME = "upgrade_helper.ps1"

MAX_ZIP_BYTES = 50 * 1024 * 1024
KEEP_BACKUPS = 3
# 备份项：platform/ 下相对路径（目录或文件）
BACKUP_ITEMS = ["app", "frontend", "VERSION", "requirements.txt"]


class UpgradeError(Exception):
    """升级请求不合法（参数/版本/包结构问题），由 main.py 转 HTTP 400。"""


def current_version() -> str:
    try:
        return (PLATFORM_DIR / "VERSION").read_text(encoding="utf-8-sig").strip()
    except Exception:
        return "0.0.0"


def _vkey(v: str) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in v.strip().split("."))
    except Exception:
        return (0, 0, 0)


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """拒绝 zip 内路径穿越（../ 与绝对路径）。"""
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        if name.startswith("/") or ".." in name.split("/"):
            raise UpgradeError(f"压缩包内存在非法路径：{info.filename}")
    zf.extractall(dest)


def apply_upgrade(filename: str, content: bytes, operator: str) -> dict:
    if not filename.lower().endswith(".zip"):
        raise UpgradeError("请上传 .zip 平台发布包")
    if len(content) > MAX_ZIP_BYTES:
        raise UpgradeError("升级包过大（上限 50MB）")
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except Exception:
        raise UpgradeError("无法读取 zip 文件")

    # --- 1) 校验：包内必须有 platform/VERSION，且版本必须高于当前 ---
    ver_entry = next(
        (n for n in zf.namelist() if n.replace("\\", "/").endswith("platform/VERSION")),
        None,
    )
    if not ver_entry:
        raise UpgradeError(
            "压缩包内未找到 platform/VERSION，请上传平台发布包"
            "（build_all.py 产出的 yizhen-platform_vX.Y.Z.zip）"
        )
    new_ver = zf.read(ver_entry).decode("utf-8-sig", errors="ignore").strip()
    cur = current_version()
    if _vkey(new_ver) <= _vkey(cur):
        raise UpgradeError(f"升级包版本 v{new_ver} 不高于当前版本 v{cur}，拒绝升级")

    # --- 2) 解包到 _upgrade/new_{ts}，若带单层顶层目录则剥离 ---
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    UPGRADE_DIR.mkdir(parents=True, exist_ok=True)
    new_dir = UPGRADE_DIR / f"new_{ts}"
    try:
        _safe_extract(zf, new_dir)
    except UpgradeError:
        shutil.rmtree(new_dir, ignore_errors=True)
        raise
    children = [c for c in new_dir.iterdir()]
    if len(children) == 1 and children[0].is_dir():
        if not (children[0] / "platform").exists():
            shutil.rmtree(new_dir, ignore_errors=True)
            raise UpgradeError("压缩包结构不正确：缺少 platform/ 目录")
        staged = UPGRADE_DIR / f"staged_{ts}"
        children[0].rename(staged)          # 顶层目录整体上移一层
        shutil.rmtree(new_dir, ignore_errors=True)
        new_dir = staged

    # --- 3) 备份当前版本（app / frontend / VERSION / requirements / scripts） ---
    backup_dir = BACKUP_DIR / ts
    backup_dir.mkdir(parents=True, exist_ok=True)
    for item in BACKUP_ITEMS:
        src = PLATFORM_DIR / item
        if not src.exists():
            continue
        dst = backup_dir / item
        if src.is_dir():
            shutil.copytree(
                src, dst,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        else:
            shutil.copy2(src, dst)
    scripts_dir = ROOT / "scripts"
    if scripts_dir.exists():
        shutil.copytree(
            scripts_dir, backup_dir / "scripts", dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("__pycache__"),
        )
    # 只保留最近 KEEP_BACKUPS 份
    backups = sorted(d for d in BACKUP_DIR.iterdir() if d.is_dir())
    for old in backups[:-KEEP_BACKUPS]:
        shutil.rmtree(old, ignore_errors=True)

    # --- 4) 复制助手脚本并以分离进程拉起（响应返回后由它接管） ---
    helper_dst = UPGRADE_DIR / HELPER_NAME
    shutil.copy2(PLATFORM_DIR / "app" / HELPER_NAME, helper_dst)
    log_file = UPGRADE_DIR / "upgrade.log"
    spawn_args = [
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(helper_dst),
        "-ProcId", str(os.getpid()),
        "-Root", str(ROOT),
        "-NewDir", str(new_dir),
        "-LogFile", str(log_file),
    ]
    with open(log_file, "ab") as lf:
        if os.name == "nt":
            base = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            # 首选 BREAKAWAY：助手要杀死父进程（uvicorn），若与父进程同属一个
            # 开启 KILL_ON_JOB_CLOSE 的 Job Object，助手会被连坐终止（实测踩坑）；
            # breakaway 让它脱离 Job。宿主不允许 breakaway 时 CreateProcess 报
            # OSError，回退普通模式（真实服务器无 Job Object，不受影响）。
            try:
                subprocess.Popen(spawn_args, stdout=lf, stderr=lf,
                                 stdin=subprocess.DEVNULL, close_fds=True,
                                 creationflags=base | subprocess.CREATE_BREAKAWAY_FROM_JOB)
            except OSError:
                subprocess.Popen(spawn_args, stdout=lf, stderr=lf,
                                 stdin=subprocess.DEVNULL, close_fds=True,
                                 creationflags=base)
        else:
            subprocess.Popen(spawn_args, stdout=lf, stderr=lf,
                             stdin=subprocess.DEVNULL, close_fds=True,
                             start_new_session=True)
    return {
        "ok": True,
        "current_version": cur,
        "new_version": new_ver,
        "backup_dir": str(backup_dir),
        "message": (
            f"升级包 v{new_ver} 已接收并完成备份，"
            "平台正在自动展开并重启（约 1 分钟），期间服务短暂不可用"
        ),
    }
