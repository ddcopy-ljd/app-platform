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
# 顶层 .py 模块：自动扫描 ROOT/*.py，避免新增模块时漏加
TOP_PY_MODULES = []          # 留空即自动发现（glob 全部顶层 .py）
OTHER_FILES = ["plugin.json", "requirements.txt"]
INCLUDE_DIRS = ["scripts", "frontend", "promo", "logo"]
EXCLUDE_PARTS = ("__pycache__", ".pyc", "build", "dist")  # scripts/build、scripts/dist 为打印桥接 EXE 构建产物，另行分发
EXCLUDE_NAMES = ("print_agent.json",)  # 门店本地运行配置，不入包


def discover_top_py() -> list[str]:
    """扫描 ROOT 下所有顶层 .py，排除打包/测试/临时脚本。"""
    skip = {"build_package.py"}  # 打包脚本自身不入包
    mods = []
    for f in ROOT.glob("*.py"):
        if f.name.startswith("_"): continue  # _xxx.py 临时脚本
        if f.name.startswith("test_"): continue  # test_*.py 测试脚本
        if f.name in skip: continue
        mods.append(f.stem)
    return sorted(mods)


def discover_local_modules(entry: str = "main.py") -> list[str]:
    """递归扫描 entry.py 的 import 链，返回所有本项目模块名（不含 .py）。"""
    import ast
    visited: set[str] = set()
    stack = [entry]
    while stack:
        name = stack.pop()
        if name in visited:
            continue
        visited.add(name)
        src = (ROOT / name).read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    mod = alias.name.split(".")[0]
                    if (ROOT / f"{mod}.py").is_file() and mod not in visited:
                        stack.append(f"{mod}.py")
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.level == 0:
                    mod = node.module.split(".")[0]
                    if (ROOT / f"{mod}.py").is_file() and mod not in visited:
                        stack.append(f"{mod}.py")
    return sorted(visited)


def validate_package_modules(files: list[Path]) -> None:
    """打包前验证：所有 main.py 的本项目 import 链都在 files 里。"""
    imported = discover_local_modules("main.py")  # 返回 ["main.py", "db.py", ...]
    packed = {f.name for f in files if f.suffix == ".py"}
    missing = [m for m in imported if m not in packed and m != "main.py"]
    if missing:
        fail(f"main.py 的本项目 import 链中，以下模块未被打包：{', '.join(missing)}")


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
    top_py = TOP_PY_MODULES if TOP_PY_MODULES else discover_top_py()
    files = [ROOT / f"{n}.py" for n in top_py if (ROOT / f"{n}.py").is_file()]
    files += [ROOT / name for name in OTHER_FILES if (ROOT / name).is_file()]
    for d in INCLUDE_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if f.is_file() and f.name not in EXCLUDE_NAMES \
                    and not any(p in f.parts or f.suffix == p for p in EXCLUDE_PARTS):
                files.append(f)
    if not files:
        fail("没有可打包的文件")

    # 防御：确保 main.py 的本项目 import 链全部被打包
    validate_package_modules(files)

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
