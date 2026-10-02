"""打包综合业务应用服务平台为 zip：python build_package.py

产物输出到 dist/platform_v{VERSION}.zip，版本号取自 platform/VERSION 文件。
打包前自动从 git 提交记录提取本次版本的功能变更，生成 changes.lst（同时打入包内）。
仅收录部署必需文件（白名单），data/、samples/、demo/、__pycache__/ 等不打入。
"""

import re
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # platform/
REPO = ROOT.parent                              # 仓库根目录
PLUGIN_REL = "platform"
OUT_DIR = ROOT / "dist"

# 打包白名单（相对 platform/）
INCLUDE_FILES = ["VERSION", "requirements.txt"]
INCLUDE_DIRS = ["app", "frontend", "tools"]
EXCLUDE_PARTS = ("__pycache__", ".pyc")


def fail(msg: str) -> None:
    print(f"[打包失败] {msg}")
    sys.exit(1)


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def read_version() -> str:
    p = ROOT / "VERSION"
    if not p.exists():
        fail("未找到 VERSION 文件")
    v = p.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        fail(f"VERSION 格式应为 x.y.z，当前为：{v!r}")
    return v


def build_changes(version: str) -> str:
    """从 git 历史提取本版本功能变更：上一版本号修改点之后的 platform/ 提交。"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [f"# 综合业务应用服务平台 v{version} 功能变更", f"# 打包时间 {ts}\n"]

    if not git("rev-parse", "--is-inside-work-tree"):
        lines.append("（未在 git 仓库中，无法提取变更记录，请手工补充）")
        return "\n".join(lines)

    bumps = git("log", "--pretty=%H", "-S", "", "--pickaxe-regex",
                "--", f"{PLUGIN_REL}/VERSION").splitlines()
    range_spec = f"{bumps[1]}..HEAD" if len(bumps) >= 2 else "HEAD"

    raw = git("log", "--pretty=%H%x09%s", range_spec, "--", PLUGIN_REL).splitlines()
    skip = bumps[0] if bumps else ""
    commits = [line.split("\t", 1)[1] for line in raw
               if "\t" in line and not line.startswith(skip)]

    if commits:
        lines.append("本次版本变更：")
        lines.extend(f"  - {c}" for c in reversed(commits))
    else:
        lines.append("本次版本变更：（无新提交，或变更尚未 commit，请先提交再打包）")

    dirty = git("status", "--porcelain", "--", PLUGIN_REL)
    if dirty:
        lines.append("\n⚠ 注意：以下改动尚未 commit，未计入上方清单：")
        lines.extend(f"  {l}" for l in dirty.splitlines())
    return "\n".join(lines)


def main() -> None:
    version = read_version()

    # 收集文件
    files = [ROOT / name for name in INCLUDE_FILES if (ROOT / name).is_file()]
    for d in INCLUDE_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if f.is_file() and not any(p in f.parts or f.suffix == p for p in EXCLUDE_PARTS):
                files.append(f)
    if not files:
        fail("没有可打包的文件")

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / f"platform_v{version}.zip"

    # 生成功能变更清单
    changes = build_changes(version)
    changes_path = OUT_DIR / "changes.lst"
    changes_path.write_text(changes, encoding="utf-8")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, f.relative_to(ROOT).as_posix())
        zf.writestr("changes.lst", changes)

    print(f"[打包完成] {out}")
    print(f"  版本：v{version}")
    print(f"  收录：{len(files)} 个文件 + changes.lst，{out.stat().st_size / 1024:.1f} KB")
    print(f"  变更清单：{changes_path}")


if __name__ == "__main__":
    main()
