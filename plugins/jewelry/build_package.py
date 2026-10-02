"""打包懿臻珠宝云插件为 zip：python build_package.py

产物输出到 dist/jewelry_v{softwareVersion}.zip，版本号取自 plugin.json。
打包前自动从 git 提交记录提取本次版本的功能变更，生成 changes.lst（同时打入包内）。
仅收录运行必需文件（白名单），dev_data/、docs/、demo/、__pycache__/ 等不打入。
"""

import json
import re
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent  # 仓库根目录
PLUGIN_REL = "plugins/jewelry"
OUT_DIR = ROOT / "dist"

# 打包白名单
INCLUDE_FILES = ["plugin.json", "main.py", "db.py", "requirements.txt"]
INCLUDE_DIRS = ["scripts", "frontend", "promo", "logo"]
EXCLUDE_PARTS = ("__pycache__", ".pyc")


def fail(msg: str) -> None:
    print(f"[打包失败] {msg}")
    sys.exit(1)


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def build_changes(version: str) -> str:
    """从 git 历史提取本版本功能变更：上一版本号修改点之后的本插件提交。"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [f"# 懿臻珠宝云 v{version} 功能变更", f"# 打包时间 {ts}\n"]

    if not git("rev-parse", "--is-inside-work-tree"):
        lines.append("（未在 git 仓库中，无法提取变更记录，请手工补充）")
        return "\n".join(lines)

    # 找 plugin.json 中 softwareVersion 的历次修改，取上一次作为本次变更起点
    bumps = git("log", "--pretty=%H", "-S", '"softwareVersion"',
                "--", f"{PLUGIN_REL}/plugin.json").splitlines()
    range_spec = f"{bumps[1]}..HEAD" if len(bumps) >= 2 else "HEAD"

    raw = git("log", "--pretty=%H%x09%s", range_spec, "--", PLUGIN_REL).splitlines()
    # 排除版本号修改提交本身
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
    manifest_path = ROOT / "plugin.json"
    if not manifest_path.exists():
        fail("未找到 plugin.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # 与平台一致的最低校验
    for key in ("id", "name", "softwareVersion", "dataVersion"):
        if not manifest.get(key):
            fail(f"plugin.json 缺少必填字段：{key}")
    if not re.fullmatch(r"\d+\.\d+\.\d+", manifest["softwareVersion"]):
        fail(f"softwareVersion 格式应为 x.y.z，当前为：{manifest['softwareVersion']}")
    if not isinstance(manifest.get("features"), list) or not manifest["features"]:
        fail("plugin.json 的 features 必须是非空数组")

    # 清单引用的文件必须真实存在
    scripts = manifest.get("scripts") or {}
    refs = [manifest.get("entry"), manifest.get("promo"), scripts.get("init"), scripts.get("upgrade")]
    for ref in filter(None, refs):
        if not (ROOT / ref).is_file():
            fail(f"plugin.json 引用的文件不存在：{ref}")

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
    version = manifest["softwareVersion"]
    out = OUT_DIR / f"{manifest['id']}_v{version}.zip"

    # 生成功能变更清单
    changes = build_changes(version)
    changes_path = OUT_DIR / "changes.lst"
    changes_path.write_text(changes, encoding="utf-8")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, f.relative_to(ROOT).as_posix())
        zf.writestr("changes.lst", changes)

    print(f"[打包完成] {out}")
    print(f"  版本：v{version}（数据版本 v{manifest['dataVersion']}）")
    print(f"  收录：{len(files)} 个文件 + changes.lst，{out.stat().st_size / 1024:.1f} KB")
    print(f"  变更清单：{changes_path}")


if __name__ == "__main__":
    main()
