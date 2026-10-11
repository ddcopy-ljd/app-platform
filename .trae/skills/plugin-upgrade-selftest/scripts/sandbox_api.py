# -*- coding: utf-8 -*-
"""沙箱网关请求辅助：自动登录、取 SANDBOX 票证并转发请求。

用法：
  python sandbox_api.py <plugin_id> <version> <METHOD> <path> [json_body]

示例：
  python sandbox_api.py jewelry 1.0.6 GET /api/health
  python sandbox_api.py jewelry 1.0.6 GET "/api/products?page=1&size=2"
  python sandbox_api.py jewelry 1.0.6 POST /api/inventory/rfid-scan "{\"epcs\":[\"YZZ0101000001\"]}"

环境变量：
  PLATFORM_BASE（默认 http://localhost:8000）
  PLATFORM_ADMIN_USER / PLATFORM_ADMIN_PASS（默认 admin / admin123）

注意：票证 url 自带尾斜杠，本脚本已做 rstrip 处理，path 以 / 开头即可。
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("PLATFORM_BASE", "http://localhost:8000").rstrip("/")
USER = os.environ.get("PLATFORM_ADMIN_USER", "admin")
PWD = os.environ.get("PLATFORM_ADMIN_PASS", "admin123")


def http(method, url, token=None, body=None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode("utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(2)
    plugin_id, version, method, path = sys.argv[1:5]
    body = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None

    login = http("POST", f"{BASE}/api/auth/login",
                 body={"username": USER, "password": PWD})
    token = login["token"]
    ticket = http("POST", f"{BASE}/api/plugins/{plugin_id}/gateway/ticket",
                  token=token,
                  body={"mode": "SANDBOX", "tenant_id": None, "version": version})
    prefix = BASE + ticket["url"].rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    result = http(method, prefix + path, body=body)
    if isinstance(result, (dict, list)):
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result)


if __name__ == "__main__":
    main()
