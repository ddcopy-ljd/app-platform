"""珠宝云 v1.2 — 自动化冒烟测试（Smoke Test）

每次改完代码跑一遍，确保：
1. 后端能启动
2. 登录正常
3. 所有 GET /api/* 端点返回 200 或 4xx（404 说明路由丢了，500 说明崩了）
4. 前端 index.html / app.js 能正常 HTTP 200 加载

运行：cd plugins/jewelry && python scripts/smoke_test.py
退出码：0=全部通过, 非 0=有失败
"""
from __future__ import annotations
import os, sys, time, json, subprocess, urllib.request, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PORT = 8002
BASE = f"http://127.0.0.1:{PORT}"
# 冒烟直接用后端默认的 dev_data 目录（STANDALONE 模式下 tenant_trial）
DEV_DATA = os.path.join(ROOT, "dev_data")
SMOKE_TENANT = "tenant_trial"
SMOKE_DB = os.path.join(DEV_DATA, f"db_jewelry_{SMOKE_TENANT}_v1.0.0.sqlite")

# —— 需要跳过的端点（依赖外部硬件/Bridge/必须 query 参数，沙箱里跑不起来）——
SKIP_PATTERNS = [
    "/api/devices/register",        # 手持机注册
    "/api/sensors/heartbeat",       # 安防心跳（硬件发的）
    "/api/devices/heartbeat",       # 设备心跳
    "/ws/",                         # WS 端点
    "/bridge/",                     # Bridge 内部
    "/api/scanner/register",        # 扫码枪注册
    "/api/inventory/tag_scan",      # C27 真实盘点扫描
    "/api/devices/confirm_login",   # 手持机真实登录确认
    "/api/handheld/login-status",   # 必须 hkey 参数
    "/api/handheld/poll",           # 必须 hkey 参数
    "/api/task/observe",            # 必须 key 参数
    "/api/stocktake/qr",            # 必须 token 参数
]


def _req(method, path, token=None, data=None, timeout=15):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json", "Connection": "close"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace") if e.fp else ""
    except Exception as e:
        return 0, str(e)


def scan_get_endpoints() -> list[str]:
    """从 main.py 自动提取所有 GET /api/* 端点（路径模板用占位符替换）。"""
    main_py = os.path.join(ROOT, "main.py")
    with open(main_py, "r", encoding="utf-8") as f:
        src = f.read()
    import re
    routes = []
    # 匹配 @app.get("/api/xxx") 或 @app.api_route("/api/xxx", methods=["GET"])
    for m in re.finditer(r'@app\.(?:get|api_route)\(\s*["\']([^"\']+)["\']', src):
        path = m.group(1)
        if "/api/" not in path and "/app/" not in path:
            continue
        # 跳过非 GET 的 api_route（后面可能带 methods=[...]）
        if "@app.api_route" in m.group(0):
            # 检查是否允许 GET
            block_start = m.end()
            tail = src[block_start:block_start + 200]
            if "methods" in tail and "GET" not in tail.split("methods")[1].split(")")[0]:
                continue
        # 跳过登录/WS 桥内部
        if any(p in path for p in SKIP_PATTERNS):
            continue
        routes.append(path)
    # 路径参数替换：/api/sensors/{sid}/heartbeat → /api/sensors/1/heartbeat
    concrete = []
    for r in routes:
        concrete.append(re.sub(r'\{[^}]+\}', '1', r))
    return sorted(set(concrete))


def smoke():
    results = {"pass": [], "warn": [], "fail": []}

    # 1) 清理旧库，init 新库
    print("=== [1/5] 初始化测试库 ===")
    os.makedirs(DEV_DATA, exist_ok=True)
    for suffix in ("", "-wal", "-shm", "-journal"):
        p = SMOKE_DB + suffix
        if os.path.exists(p):
            os.remove(p)
    init_py = os.path.join(ROOT, "scripts", "init.py")
    r = subprocess.run(
        [sys.executable, init_py, f"--tenant-id={SMOKE_TENANT}",
         f"--new-db-path={SMOKE_DB}"],
        capture_output=True, text=True, cwd=ROOT, timeout=30,
    )
    if r.returncode != 0:
        print("❌ init.py 失败:", r.stderr[:300])
        return False
    print("✅ init 完成")

    # 2) 起后端
    print("\n=== [2/5] 启动后端 ===")
    env = os.environ.copy()
    env["UNIFIED_ACCESS_MODE"] = "STANDALONE"
    env["HOST"] = "127.0.0.1"
    env["TENANT_ID"] = SMOKE_TENANT
    env["TENANT_DB_DIR"] = DEV_DATA
    proc = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "main.py")],
        env=env, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    # 等启动（最多 15s）
    ready = False
    for i in range(15):
        time.sleep(1)
        try:
            s, _ = _req("GET", "/api/health")
            if s in (200, 401, 404):
                ready = True
                break
        except Exception:
            pass
    if not ready:
        print("❌ 后端启动超时")
        proc.kill()
        return False
    print(f"✅ 已启动 PID={proc.pid}")

    try:
        # 3) 登录拿 token
        print("\n=== [3/5] 登录 ===")
        s, body = _req("POST", "/api/auth/login",
                       data={"username": "admin", "password": "123456"})
        if s != 200:
            print(f"❌ 登录失败 status={s}: {body[:200]}")
            return False
        token = json.loads(body)["token"]
        print(f"✅ 登录成功 token=***{token[-6:]}")

        # 4) 前端静态资源（后端挂载在根路径 /）
        print("\n=== [4/5] 前端静态资源 ===")
        for f in ["/", "/app.js", "/i18n.js"]:
            s, _ = _req("GET", f)
            if s == 200:
                results["pass"].append(f"GET {f} → 200")
            else:
                results["fail"].append(f"GET {f} → {s}")
                print(f"  ❌ {f}: {s}")
        print(f"  前端静态 OK")

        # 5) 遍历所有 GET API（串行逐个打，避免并发挤兑 FastAPI 默认线程池）
        print("\n=== [5/5] 冒烟遍历所有 GET /api/* 端点 ===")
        endpoints = scan_get_endpoints()
        print(f"  共发现 {len(endpoints)} 个端点")
        for i, path in enumerate(endpoints):
            t0 = time.time()
            s, body = _req("GET", path, token=token, timeout=15)
            dt = time.time() - t0
            time.sleep(0.05)
            # 200/201/302 → PASS; 4xx → WARN（业务拒绝）; 0/5xx → FAIL
            if 200 <= s < 400:
                results["pass"].append(f"GET {path} → {s}")
            elif 400 <= s < 500:
                results["warn"].append(f"GET {path} → {s} ({body[:60]})")
            else:
                results["fail"].append(f"GET {path} → {s} ({dt:.1f}s) {body[:100]}")
                print(f"  ❌ [{dt:.1f}s] {s} {path}")
            # 进度打点
            if (i + 1) % 10 == 0 or dt > 1:
                print(f"    ... #{i+1}/{len(endpoints)}  [{dt:.2f}s] {s} {path}")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

    # —— 输出报告 ——
    print("\n" + "=" * 60)
    print(f"冒烟测试报告  PASS={len(results['pass'])}  WARN={len(results['warn'])}  FAIL={len(results['fail'])}")
    print("=" * 60)
    if results["warn"]:
        print("\n⚠️  WARN（业务层拒绝，不算崩但要看一眼）:")
        for w in results["warn"]:
            print(f"  {w}")
    if results["fail"]:
        print("\n❌  FAIL（路由丢了或代码崩了）:")
        for f in results["fail"]:
            print(f"  {f}")
    else:
        print("\n✅ 零失败！所有端点都通")

    # 清理测试库
    try:
        os.remove(SMOKE_DB)
        os.remove(SMOKE_DB + "-wal") if os.path.exists(SMOKE_DB + "-wal") else None
        os.remove(SMOKE_DB + "-shm") if os.path.exists(SMOKE_DB + "-shm") else None
    except Exception:
        pass

    return len(results["fail"]) == 0


if __name__ == "__main__":
    ok = smoke()
    sys.exit(0 if ok else 1)
