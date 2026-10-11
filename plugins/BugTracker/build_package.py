"""打包 BugPulse 缺陷跟踪插件为 zip：python build_package.py

产物输出到 dist/bugtracker_v{softwareVersion}.zip，版本号取自 plugin.json。
仅收录运行必需文件（白名单），dev_data/、storage/、demo/、__pycache__/ 等不打入。
"""

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "dist"

OTHER_FILES = ["plugin.json", "requirements.txt"]
INCLUDE_DIRS = ["scripts", "frontend"]
EXCLUDE_PARTS = ("__pycache__", ".pyc", "build", "dist")


def fail(msg: str) -> None:
    print(f"[打包失败] {msg}")
    sys.exit(1)


def discover_top_py() -> list[str]:
    skip = {"build_package.py"}
    mods = []
    for f in ROOT.glob("*.py"):
        if f.name.startswith("_") or f.name.startswith("test_") or f.name in skip:
            continue
        mods.append(f.stem)
    return sorted(mods)


def main() -> None:
    manifest_path = ROOT / "plugin.json"
    if not manifest_path.exists():
        fail("未找到 plugin.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    for key in ("id", "name", "softwareVersion", "dataVersion"):
        if not manifest.get(key):
            fail(f"plugin.json 缺少必填字段：{key}")
    if not re.fullmatch(r"\d+\.\d+\.\d+(\.\d{6})?", manifest["softwareVersion"]):
        fail(f"softwareVersion 格式应为 x.y.z 或 x.y.z.YYMMDD，当前：{manifest['softwareVersion']}")
    if not isinstance(manifest.get("features"), list) or not manifest["features"]:
        fail("features 必须是非空数组")

    scripts = manifest.get("scripts") or {}
    refs = [manifest.get("entry"), manifest.get("promo"), scripts.get("init"), scripts.get("upgrade")]
    for ref in filter(None, refs):
        if not (ROOT / ref).is_file():
            fail(f"plugin.json 引用的文件不存在：{ref}")

    files = [ROOT / f"{n}.py" for n in discover_top_py() if (ROOT / f"{n}.py").is_file()]
    files += [ROOT / name for name in OTHER_FILES if (ROOT / name).is_file()]
    for d in INCLUDE_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if f.is_file() and not any(p in f.parts or f.suffix == p for p in EXCLUDE_PARTS):
                files.append(f)
    if not files:
        fail("没有可打包的文件")

    # 防御：main.py 的本项目 import 链必须全部打包
    import ast
    visited, stack = set(), ["main.py"]
    while stack:
        name = stack.pop()
        if name in visited:
            continue
        visited.add(name)
        try:
            tree = ast.parse((ROOT / name).read_text(encoding="utf-8", errors="replace"))
        except (SyntaxError, FileNotFoundError):
            continue
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                mods = [node.module.split(".")[0]]
            for m in mods:
                if (ROOT / f"{m}.py").is_file() and m not in visited:
                    stack.append(f"{m}.py")
    packed = {f.name for f in files if f.suffix == ".py"}
    missing = [v for v in visited if v.endswith(".py") and v not in packed and v != "main.py"]
    if missing:
        fail(f"main.py 的 import 链未全部打包：{', '.join(missing)}")

    OUT_DIR.mkdir(exist_ok=True)
    version = manifest["softwareVersion"]
    out = OUT_DIR / f"{manifest['id']}_v{version}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, f.relative_to(ROOT).as_posix())
    print(f"[打包完成] {out}")
    print(f"  版本：v{version}（数据版本 v{manifest['dataVersion']}）")
    print(f"  收录：{len(files)} 个文件，{out.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
