"""打包综合业务应用服务平台为整站 zip：python platform/build_all.py

产物输出到 dist/yizhen-stack_v{VERSION}.zip。
白名单收录平台 + jewelry 插件 + scan-assistant/scanner-app 两个 Android 客户端，
排除 .trae/、.git/、.venv/、__pycache__/、运行时 data/、*.aar 厂商 SDK、签名密钥 release.jks、
Android build/.gradle 产物、本地 sqlite 调试库等敏感/可变数据。

额外拷贝一份运行时生产数据库到 backup/（排除 trial/沙箱库），目标机解压后可选择恢复或全新初始化。
"""

import io
import re
import shutil
import sqlite3
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # 仓库根目录
DIST = ROOT / "dist"
BACKUP_OUT = ROOT / ".build_backup_tmp"         # 临时备份缓存目录

# ============ 工具 ============
def log(msg: str) -> None:
    print(f"  {msg}")

def read_version() -> str:
    v = (ROOT / "platform" / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        raise SystemExit(f"VERSION 格式应为 x.y.z，当前：{v!r}")
    return v

IGNORE_PARTS = (
    "__pycache__", ".git", ".venv", ".trae", ".idea", ".vscode",
    "node_modules", "dist", "build", ".gradle", "gradle",       # 注意：gradle wrapper JAR 在 gradle/wrapper/ 白名单显式收录
    ".pytest_cache", ".mypy_cache",
)
IGNORE_SUFFIX = (".pyc", ".pyo", ".log", ".err", ".sqlite", ".jks", ".aar", ".zip")
IGNORE_NAMES = {
    "release.jks",                            # Android 签名密钥
    "DeviceAPI_ver20220518_release.aar",       # 厂商 SDK，不确定分发许可
    "watch-build.ps1",
}

def should_exclude(rel_parts: list[str], name: str) -> bool:
    """按路径黑名单判断是否排除。rel_parts 是相对仓库根的各段（不含 name），name 是文件/目录名。"""
    # 整个目录名命中黑名单
    for p in rel_parts:
        if p in IGNORE_PARTS:
            return True
        if p.startswith(".") and p != ".github":
            return True
    if name in IGNORE_PARTS or name.startswith("."):
        return True
    if name in IGNORE_NAMES:
        return True
    if name.endswith(IGNORE_SUFFIX):
        return True
    return False

def zip_add(zf: zipfile.ZipFile, src: Path, arcname: str) -> None:
    zf.write(src, arcname)

def collect_files(root: Path, base_arc: str, exclude_extra=None):
    """遍历 root 目录，按黑白名单收集文件。返回 (Path, arcname) 列表。"""
    out = []
    exclude_extra = exclude_extra or set()
    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(root.parent)        # 相对仓库根
        if any(p in exclude_extra for p in rel.parts):
            continue
        if should_exclude(list(rel.parts[:-1]), rel.name):
            continue
        out.append((f, str(Path(base_arc) / rel.relative_to(root.parent)).as_posix()))
    return out

# ============ 具体收录清单 ============
PLATFORM_DIR = ROOT / "platform"
PLUGIN_DIR = ROOT / "plugins" / "jewelry"
SCAN_DIR = ROOT / "scan-assistant"
SCANNER_DIR = ROOT / "scanner-app"

def collect_platform() -> list[tuple[Path, str]]:
    """收录平台源码（不含 data/、demo/、docs/ 之外的运行时）。"""
    files = []
    include_dirs = ["app", "frontend", "tools", "docs"]
    include_files = ["VERSION", "requirements.txt", "build_package.py", "build_all.py"]
    for d in include_dirs:
        base = PLATFORM_DIR / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if f.is_file() and not should_exclude(
                list(f.relative_to(PLATFORM_DIR).parts[:-1]), f.name
            ):
                files.append((f, f"platform/{f.relative_to(PLATFORM_DIR).as_posix()}"))
    for fname in include_files:
        p = PLATFORM_DIR / fname
        if p.is_file():
            files.append((p, f"platform/{fname}"))
    return files

def collect_jewelry() -> list[tuple[Path, str]]:
    base = PLUGIN_DIR
    files = []
    include_dirs = ["frontend", "logo", "promo", "scripts", "demo"]
    include_files = [
        "main.py", "db.py", "sensors.py", "rfid_print.py",
        "plugin.json", "requirements.txt", "build_package.py",
        "TEST_CASES.md",
    ]
    for d in include_dirs:
        b = base / d
        if not b.is_dir():
            continue
        for f in sorted(b.rglob("*")):
            if f.is_file() and not should_exclude(
                list(f.relative_to(base).parts[:-1]), f.name
            ):
                files.append((f, f"plugins/jewelry/{f.relative_to(base).as_posix()}"))
    for fname in include_files:
        p = base / fname
        if p.is_file():
            files.append((p, f"plugins/jewelry/{fname}"))
    return files

def collect_android(proj_root: Path, arc_top: str) -> list[tuple[Path, str]]:
    """白名单式收录 Android 源码：排除 build/.gradle/libs 厂商 SDK、release.jks。"""
    files = []
    # 优先显式列出必须的目录
    for sub in ["app/src", "gradle/wrapper"]:
        b = proj_root / sub
        if not b.is_dir():
            continue
        for f in sorted(b.rglob("*")):
            if f.is_file() and not should_exclude(
                list(f.relative_to(proj_root).parts[:-1]), f.name
            ):
                files.append((f, f"{arc_top}/{f.relative_to(proj_root).as_posix()}"))
    for fname in ["build.gradle", "settings.gradle", "gradle.properties", "build.bat",
                   "proguard-rules.pro", "README.md"]:
        p = proj_root / fname
        if p.is_file():
            files.append((p, f"{arc_top}/{fname}"))
    # demo 目录（排除 .aar）
    demo = proj_root / "demo"
    if demo.is_dir():
        for f in sorted(demo.rglob("*")):
            if f.is_file() and not should_exclude(
                list(f.relative_to(proj_root).parts[:-1]), f.name
            ):
                files.append((f, f"{arc_top}/{f.relative_to(proj_root).as_posix()}"))
    return files

def collect_root_files() -> list[tuple[Path, str]]:
    """仓库根目录要带走的启动脚本与规范。"""
    pick = ["start_platform.bat", "start_jewelry.bat", "AGENTS.md", "应用插件开发说明.md"]
    out = []
    for name in pick:
        p = ROOT / name
        if p.is_file():
            out.append((p, name))
    return out

# ============ 数据库备份（运行时拷贝，目标机选择恢复） ============
def make_db_backup(out_dir: Path) -> list[tuple[Path, str]]:
    """从 platform/data/tenant_dbs/ 拷出每个插件的最新正式版本库。
    排除 trial/沙箱库、旧历史版本、platform.db（那是平台级 SQLite，用户会话/审计/版本记录）。
    平台 platform.db 也拷，但放在 backup/platform/。
    """
    dbs: list[tuple[Path, str]] = []
    tenant_root = ROOT / "platform" / "data" / "tenant_dbs"
    if not tenant_root.is_dir():
        return dbs

    now = datetime.now().strftime("%Y%m%d")
    for plugin_root in sorted(tenant_root.iterdir()):
        if not plugin_root.is_dir():
            continue
        plugin_id = plugin_root.name
        # 收集所有 sqlite
        latest_per_tenant: dict[str, Path] = {}
        for dbfile in plugin_root.glob("*.sqlite"):
            name = dbfile.name
            # trial/沙箱库直接排除
            if "_tenant_trial_" in name or "_tenant_trial_" in name:
                continue
            # 解析 db_<plugin>_<tenant>_v<dataVersion>.sqlite
            m = re.match(rf"db_{re.escape(plugin_id)}_([a-z0-9]+)_v(\d+\.\d+\.\d+)\.sqlite", name)
            if not m:
                continue
            tenant, ver = m.group(1), m.group(2)
            # 选每个租户的最高版本
            prev = latest_per_tenant.get(tenant)
            if prev is None or ver > re.search(r"_v(\d+\.\d+\.\d+)\.sqlite", prev.name).group(1):
                latest_per_tenant[tenant] = dbfile

        for tenant, dbfile in latest_per_tenant.items():
            dst_name = f"{plugin_id}_{tenant}_v{re.search(r'_v(\d+\.\d+\.\d+)\.sqlite', dbfile.name).group(1)}.sqlite"
            arc = f"backup/{now}/{plugin_id}/{dst_name}"
            dbs.append((dbfile, arc))

    # 平台级 db（用户会话、版本记录、审计等）
    pdb = ROOT / "platform" / "data" / "platform.db"
    if pdb.is_file():
        dbs.append((pdb, f"backup/{now}/platform/platform.db"))

    return dbs

# ============ 主流程 ============
def main() -> None:
    version = read_version()
    top = f"yizhen-stack_v{version}"
    log(f"版本号 v{version}，输出顶层目录 {top}")

    dist_dir = ROOT / "dist"
    dist_dir.mkdir(exist_ok=True)
    out_zip = dist_dir / f"{top}.zip"

    log("收集文件...")
    files: list[tuple[Path, str]] = []
    files += collect_platform();              log(f"  platform/ 源码 {len(files)}")
    files += collect_jewelry();               log(f"  + jewelry/ 插件源码 {len(files)}")
    files += collect_android(SCAN_DIR, "scan-assistant")
    files += collect_android(SCANNER_DIR, "scanner-app"); log(f"  + Android 客户端 {len(files)}")
    files += collect_root_files();            log(f"  + 根脚本 {len(files)}")

    dup = {}
    for _p, arc in files:
        dup.setdefault(arc, []).append(_p)
    duplicates = {k: v for k, v in dup.items() if len(v) > 1}
    if duplicates:
        log(f"⚠ 以下路径在 zip 中重复，只保留一份：{list(duplicates.keys())[:5]}")

    # 依赖清单（去重聚合）
    merged_reqs = io.StringIO()
    seen = set()
    for p in [PLATFORM_DIR / "requirements.txt", PLUGIN_DIR / "requirements.txt"]:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line in seen:
                continue
            seen.add(line)
            merged_reqs.write(line + "\n")

    # 启动脚本（从 start_platform.bat / start_jewelry.bat 复制一份到 scripts/）
    scripts_dir = PLATFORM_DIR / "_scripts_placeholder"   # 仅用于占位，实际直接写 zip
    script_contents = {}
    for name in ["start_platform.bat", "start_jewelry.bat"]:
        p = ROOT / name
        if p.is_file():
            script_contents[name] = p.read_bytes()

    # 极简部署说明
    readme = (ROOT / "README.txt").read_text(encoding="utf-8") if (ROOT / "README.txt").is_file() else ""
    deploy_guide = f"""综合业务应用服务平台 v{version} · 外网部署包
打包时间：{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
git 基线：请见 .git 或 changes.lst

目录结构：
  platform/            服务端平台源码（FastAPI + Uvicorn）
  plugins/jewelry/     懿臻珠宝云插件源码 v1.1.2 / dataVersion 1.1.0
  scan-assistant/      Android 扫码助手客户端（源码）
  scanner-app/         Android RFID 盘点客户端（源码）
  backup/              本次打包附带的开发数据库备份（可选恢复）

Windows Server 部署：
  1. 安装 Python 3.11+（推荐 3.13），勾选 Add to PATH
  2. 在项目根目录运行：
     python -m venv .venv
     .venv\\Scripts\\python.exe -m pip install --upgrade pip
     .venv\\Scripts\\python.exe -m pip install -r requirements.txt
  3. 可选：恢复开发数据 backup/ 到 platform/data/tenant_dbs/ 与 platform/data/platform.db
     （正式生产部署建议全新初始化，首次启动自动创建 admin/admin123 管理员与默认租户）
  4. 启动平台：
     start_platform.bat
     平台会自动拉起已注册的 jewelry/inventory 插件服务
  5. 首次启动访问 http://服务器IP:8000/ 完成初始化

重要安全提示：
  - scanner-app/app/release.jks（签名密钥）未打包，签正式 APK 时请自行放回
  - Android 厂商 SDK（DeviceAPI_*.aar）未打包，请从厂商渠道获取后放入
    scan-assistant/app/libs/ 与 scanner-app/app/libs/
  - 生产部署务必修改默认管理员密码 admin123 与 admin/123456（插件内）
  - AGENT_API_KEY 环境变量控制 Agent 升级流水线接口，生产不开启可留空

参考文档：应用插件开发说明.md
""".encode("utf-8")

    db_backups = make_db_backup(ROOT / "_backup_tmp")
    log(f"  附带数据库备份 {len(db_backups)} 个（排除 trial/沙箱）")

    # ===== 写入 zip =====
    log(f"写入 {out_zip.name} ...")
    out_zip.parent.mkdir(exist_ok=True)
    if out_zip.exists():
        out_zip.unlink()

    total_bytes = 0
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # 源码文件
        written = set()
        for src, arc in files:
            arc_top = f"{top}/{arc}"
            if arc_top in written:
                continue
            written.add(arc_top)
            zf.write(src, arc_top)
            total_bytes += src.stat().st_size

        # 依赖清单
        zf.writestr(f"{top}/requirements.txt", merged_reqs.getvalue())

        # 启动脚本（scripts/ 子目录）
        zf.writestr(
            f"{top}/scripts/start_platform.bat",
            (ROOT / "start_platform.bat").read_bytes() if (ROOT / "start_platform.bat").is_file() else b"",
        )
        zf.writestr(
            f"{top}/scripts/start_jewelry.bat",
            (ROOT / "start_jewelry.bat").read_bytes() if (ROOT / "start_jewelry.bat").is_file() else b"",
        )

        # 部署说明
        zf.writestr(f"{top}/DEPLOY.txt", deploy_guide)

        # 数据库备份
        for src, arc in db_backups:
            arc_top = f"{top}/{arc}"
            zf.write(src, arc_top)
            total_bytes += src.stat().st_size

        # backup/ 目录说明（当没有任何备份时也保留空壳说明）
        if not db_backups:
            zf.writestr(
                f"{top}/backup/__README__.txt",
                "本目录为数据库备份预留。若需要恢复数据，请把 .sqlite 文件按\nbackup/<日期>/<plugin_id>/<dbname>.sqlite 放入此处。",
            )

    final_kb = out_zip.stat().st_size / 1024
    log(f"✓ 打包完成 {out_zip}")
    log(f"  zip 体积 {final_kb:.1f} KB，未压缩源码 {total_bytes/1024:.1f} KB，收录 {len(files)} 个源码文件 + {len(db_backups)} 个数据库备份")

if __name__ == "__main__":
    main()
