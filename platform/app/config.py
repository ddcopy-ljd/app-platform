from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PLATFORM_DB = DATA_DIR / "platform.db"
# 每个插件版本独立物理目录：packages/{plugin_id}/v{version}/
PACKAGES_DIR = DATA_DIR / "packages"
# 业务库：tenant_dbs/{plugin_id}/db_{plugin_id}_{tenant_id}_v{version}.sqlite
TENANT_DB_DIR = DATA_DIR / "tenant_dbs"
# 业务文件存储：storage/{plugin_id}/{tenant_id}/v{version}/
STORAGE_DIR = DATA_DIR / "storage"
FRONTEND_DIR = BASE_DIR / "frontend"

SANDBOX_TENANT_ID = "tenant_trial"
SESSION_TTL_SECONDS = 8 * 3600
MAX_PACKAGE_BYTES = 50 * 1024 * 1024
SCRIPT_TIMEOUT_SECONDS = 120

# AI Agent 升级流水线接口的鉴权密钥（请求头 X-Agent-Key）。
# 留空 = Agent 接口整体禁用；改成随机串即启用。泄露后在此更换即可。
AGENT_API_KEY = "ag_9f4e2c7b1d5a8e36f0c4b7d2e9a15c83"

for _d in (DATA_DIR, PACKAGES_DIR, TENANT_DB_DIR, STORAGE_DIR):
    _d.mkdir(parents=True, exist_ok=True)
