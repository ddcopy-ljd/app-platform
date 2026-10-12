# plugins/STRUCTURE.md — 应用插件系统结构说明

> 本文件描述**应用插件**的系统结构与契约（包结构、配置文件、推广页、订阅机制、升级流水线）。
> 强制开发要求以《AGENTS.md》为准；跨模块架构红线以根目录《AGENTS.md》为准。冲突时以 AGENTS.md 为准。

---

## 1. 插件包结构

业务应用插件是一个标准化的压缩包（支持 `.zip`、`.tar.gz` 等格式），包含后端程序、前端资产、数据库迁移脚本以及可选的推广页。

```
plugins/{plugin_id}/
├── plugin.json          # 清单合同（见第 2 章）
├── main.py              # FastAPI 入口，暴露 /api/* 与 /ws/*
├── db.py                # 数据库初始化与访问层
├── sensors.py           # 设备驱动注册表示例（抽象基类 + @register）
├── rfid_print.py        # 业务扩展模块（可按需拆分多个顶层 .py）
├── scripts/
│   ├── init.py          # 新租户建库（唯一建库入口）
│   └── upgrade.py       # 版本间迁移（唯一改结构入口）
├── frontend/            # SPA（Vue3 global build，禁止构建产物入库）
├── promo/               # 推广页（纯静态，见第 3 章）
│   ├── index.html
│   ├── style.css
│   └── images/
└── build_package.py     # 打包脚本（自动发现顶层 .py 并校验 import 链）
```

- zip 根目录直接包含 `plugin.json`（不要多套一层目录）；包 ≤ 50MB。
- 打包排除构建产物、本地配置、`.venv`、`dist/`、门店本地运行配置（如 `print_agent.json`）。

---

## 2. 核心配置文件 (`plugin.json`)

每个插件包的根目录必须包含 `plugin.json`，用于向平台声明版本与应用能力。

| 字段名 | 类型 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| `id` | String | 必需 | 插件 ID，必须与上传接口地址里的 `{plugin_id}` 完全一致。 |
| `name` | String | 必需 | 插件名称。 |
| `softwareVersion` | String | 必需 | 当前插件的软件版本号（如 `2.7.0`）。 |
| `dataVersion` | String | 必需 | 当前数据结构版本号。结构未变则沿用上一版本号，结构升级则递增（不得高于 softwareVersion 前三段）。 |
| `entry` | String | 必需 | 后端入口。 |
| `icon` | String | 可选 | 图标。 |
| `category` | String | 可选 | 分类。 |
| `author` | String | 可选 | 作者。 |
| `description` | String | 可选 | 描述。 |
| `features` | Array | 可选 | 功能清单。 |
| `promo` | String | 可选 | 推广页入口的相对路径。要在应用市场展示独立宣传页时**必需**。 |
| `scripts.init` | String | 可选 | 建库脚本。 |
| `scripts.upgrade` | String | 可选 | 迁移脚本。 |

**⚠️ promo 字段安全红线**（强制约束见 AGENTS.md §8.3）：推广页入口文件必须是 `.html` 格式，且**必须放在单独的子目录里**（例如 `promo/index.html`），不能直接放在包根目录，否则 `plugin.json`、后端代码或内部脚本会被一起公开暴露。越过推广页目录读取包内其他文件的请求将被平台直接拒绝并返回 HTTP 404。

---

## 3. 推广页 (Promo Page)

为支持产品的独立推广与营销（PLG 模式），插件包可自带独立宣传网页。

1. **纯静态约束**：推广页必须是纯静态网页（仅限 HTML、CSS、JS 和图片）。它不依赖插件的后端服务进程，即使后端服务处于停止状态，推广页依然可以被外部正常访问。
2. **资源路径引用**：页面内的资源（如 `style.css`、`images/a.png`）必须使用**相对路径**引用。推广页只能引用该专用目录内的文件，无法越权访问外部资源。
3. **沙箱隔离**：推广页运行在受限的隔离环境中，允许运行脚本或打开新窗口。**禁止**读取平台主站的 Cookie 和浏览器本地存储（LocalStorage）；**禁止**在推广页内直接提交业务表单。
4. **用户引导跳转**：当用户需要注册或开通试用时，必须通过超链接跳转到平台提供的标准注册或订阅入口（详见根目录 AGENTS.md §3.6 租户门户机制）。

---

## 4. 应用订阅功能与权限管控（内网 API 机制）

基于「平台数据库与业务应用数据库严格分离，不保存或直接操作业务应用的业务表」的设计原则，插件在校验订阅功能时，采用「主动查询内网 API + 本地 Token 缓存」模式。

### 4.1 业务用户登录与状态查询

当业务侧普通员工在插件登录页（`/app/{plugin_id}/login`）输入账号密码完成认证时，插件的 FastAPI 后端必须向平台发起内部 HTTP 请求，查询该企业的当前订阅状态。

- **内部 API 示例**：`GET http://platform-core:8000/internal/api/tenants/{tenant_id}/plugins/{plugin_id}/auth`
- **平台返回示例**：
```json
{
  "isValid": true,
  "status": "active",
  "features": ["stock_overview", "stock_in_out"]
}
```

### 4.2 JWT 缓存签发与高并发处理

为避免后续每次业务请求都调用平台接口产生性能损耗：

1. 插件后端在登录成功后，签发**插件自己的业务 JWT Token** 给前端。
2. 插件后端将平台返回的 `features`（功能清单）直接打包写入该业务 JWT 的 Payload 载荷中，并设置合理的过期时间（如 2 小时）。
3. 业务用户后续发起 API 请求时，插件后端通过解析该业务 Token，直接读取 `features` 列表进行接口级别的防越权拦截（如使用 FastAPI 的 `Depends` 依赖）。
4. Token 过期后，前端发起 Refresh Token 请求，插件后端再次调用平台内网 API 刷新权限，实现无缝续期。

### 4.3 前端界面动态适配

插件前端在接收到登录成功返回的 `features` 后，应当将其存入全局状态（如 Pinia）。在渲染界面时，必须根据该清单动态判断，隐藏或锁定未订阅的高级功能菜单及操作按钮。

---

## 5. 插件升级作业流程（五步流水线）

> **触发方式**：以后只要说类似「升级珠宝云插件到平台」「发布 XX 插件新版本」「把 XX 应用升级发版」这类话，AI Agent 识别意图后即按本章流程执行，无需再贴规范全文。
> 本章基于珠宝云 v1.0.3 → v1.0.5 的完整实战流程沉淀，已经平台验证跑通。
> 升级红线与禁止事项见《AGENTS.md》第 1 章（数据库规则）与第 4 章（发布与升级流程）。

### 5.0 角色与职责边界

| 角色 | 职责 |
|------|------|
| AI Agent（插件作者身份） | 通读当前版本源码、编写升级代码与迁移脚本、按规范打包、上传、沙箱自测 |
| 平台 | 版本管理、verdict 判定、沙箱隔离、数据复制与安全、迁移脚本执行（120s 超时）、服务拉起、正式切换、版本链与历史记录 |

**铁律：转正式不由 Agent 操作**——自测通过后通知人工，在平台【应用插件管理】点"正式切换"。

### 5.1 前置约定

- 所有 Agent 请求带请求头：`X-Agent-Key: <platform/app/config.py 中的 AGENT_API_KEY>`
- 版本号均为三段式 `x.y.z`，逐段比较（版本号语义见根目录 AGENTS.md §7 Android 章或对应插件约定）
- 平台地址：`http://localhost:8000`（见 start_platform.bat）

### 5.2 版本基线规则

1. **只取正式版版本号做基线**：release-info 响应里的 `current_version` / `current_data_version` 是唯一基准；本地工作区 plugin.json 的草稿版本号不作数（草稿号可能未发布、可能与平台版本链错位，跳空属正常，无需回补）。
2. **正式切换未完成前，所有测试都针对正式版本的数据迁移**：沙箱试运行的数据必须源自正式版租户库（平台自动按版本链 hop 迁移，如 v1.0.2 → v1.0.3），测试结论直接代表正式切换时的迁移效果。
3. **正式切换后**，平台对每个真实租户执行同一迁移脚本、同一路径，Agent 无需逐租户操作。

### 5.3 升级流程（五步）

#### 第 ① 步：取基线版本信息

```
GET /api/agent/plugins/{plugin_id}/release-info?target=<打算发布的新版本号>
```

从响应读取：`current_version`（正式版）、`current_data_version`（迁移基线）、`source_dir`（当前版本源码目录，同机可直接读）、`verdict`。

verdict 判定：
- `ok` → 继续流程
- `exists` → 目标版本已存在，递增 softwareVersion 后重新取
- `older` → 不高于正式版，禁止发布，终止

#### 第 ② 步：开发升级内容 + 编写迁移脚本

- 通读 `source_dir` 下当前版本源码，实施功能变更（开发仍在工作区 `plugins/{plugin_id}/` 进行）；
- 判断数据结构是否变更：
  - **未变更** → `dataVersion` 保持不变（平台自动全量复制旧库，无需迁移逻辑）；
  - **有变更** → `dataVersion` 必须递增，并实现 `scripts/upgrade.py`：

```python
import os, shutil, sqlite3
old_db, new_db = os.environ["OLD_DB_PATH"], os.environ["NEW_DB_PATH"]
src = sqlite3.connect(old_db); dst = sqlite3.connect(new_db)
src.backup(dst); src.close()
dst.execute("ALTER TABLE items ADD COLUMN location TEXT NOT NULL DEFAULT 'A区'")  # 增量DDL
dst.commit(); dst.close()
if os.path.isdir(os.environ["OLD_STORAGE"]):   # 用了文件存储才需要
    shutil.copytree(os.environ["OLD_STORAGE"], os.environ["NEW_STORAGE"], dirs_exist_ok=True)
```

  可用环境变量：`OLD_DB_PATH / NEW_DB_PATH / OLD_STORAGE / NEW_STORAGE / TENANT_ID / OLD_DATA_VERSION / NEW_DATA_VERSION`
  （平台已把旧库完整复制到 NEW_DB_PATH，脚本只做增量迁移；120 秒超时）
- 更新 `plugin.json`：softwareVersion 递增（必须高于正式版）、dataVersion 按上述规则、features/description 同步更新。

#### 第 ③ 步：打包

- 执行 `python build_package.py`（插件目录下），产物 `dist/{id}_v{softwareVersion}.zip`
- zip 根目录直接包含 `plugin.json`（不要多套一层目录）；≤ 50MB
- 必填字段：`id、name、softwareVersion、dataVersion、entry`
- 可选字段：`icon、category、author、description、features、promo（独立子目录，见第 2 章）、scripts.init、scripts.upgrade`
- `id` 必须与上传接口地址里的 `{plugin_id}` 完全一致

**打包排除项**：EXE/构建产物目录（如 `scripts/build`、`scripts/dist`）、门店本地运行配置（如 `print_agent.json`）不入插件包；打包脚本已内置 `EXCLUDE_PARTS / EXCLUDE_NAMES`，新增构建产物时同步维护。

#### 第 ④ 步：上传（自动触发沙箱）

```
POST /api/agent/plugins/{plugin_id}/release      # multipart/form-data, 字段名 file
```

响应含 `auto_prepare.started` 和 `pipeline_url`。

#### 第 ⑤ 步：轮询结果 + 沙箱自测

```
GET /api/agent/plugins/{plugin_id}/pipeline/{software_version}    # 每 5 秒轮询
```

- `result=running`：stage=preparing 看迁移进度，继续等；
- `result=failed`：读 `error` 和 `log_tail`（日志尾 30 行）定位迁移脚本问题 → 修好后递增 softwareVersion 从第①步重来；
- `result=success`：stage=trial，平台自动拉起沙箱服务，用 `sandbox_url` 做功能自测。

**沙箱访问方式**（注意：`/app/{插件ID}/{租户ID}/` 是正式版入口，沙箱要走票证）：
1. `POST /api/auth/login`（平台管理员账号）拿会话；
2. `POST /api/plugins/{plugin_id}/gateway/ticket`，body：`{"mode":"SANDBOX","tenant_id":null,"version":"<目标版本>"}`，取响应 `url`（形如 `/gw/{ticket}/`）；
3. 后续所有自测请求都发往 `http://localhost:8000/gw/{ticket}/...`（平台注入免鉴权头）。

**自测清单**（测试纪律见根目录 AGENTS.md §9）：
1. 入口页 200；
2. 本次新增/变更的 API 逐一验证；
3. 数据核对：直接用 sqlite3 比对沙箱新旧库（`platform/data/tenant_dbs/{plugin}/`）行数一致、新增列已落库——确认是"本来没数据"还是"迁移丢了"；
4. 写入链路自测（涉及数据结构变更的升级必做）：在沙箱实际创建一条测试数据再删除，验证新代码对迁移后的库能正常读写、自动生成字段（如 EPC/编号）符合新格式逻辑；
5. **测试数据必须清理**，不留脏数据在沙箱；
6. **回归用例**：逐条执行该插件测试用例台账（见 5.5）中的历史用例，确认旧问题未复发。

### 5.4 命令速查

```bash
KEY="X-Agent-Key: <AGENT_API_KEY>"

# ① 基线
curl -s -H "$KEY" "http://localhost:8000/api/agent/plugins/jewelry/release-info?target=1.0.6"

# ③ 打包（插件目录下）
python build_package.py

# ④ 上传
curl -s -X POST -H "$KEY" -F "file=@dist/jewelry_v1.0.6.zip" \
  "http://localhost:8000/api/agent/plugins/jewelry/release"

# ⑤ 轮询
curl -s -H "$KEY" "http://localhost:8000/api/agent/plugins/jewelry/pipeline/1.0.6"
```

### 5.5 测试用例积累机制

开发与升级过程中发现的问题，**酌情记录在案，作为下次升级的测试用例**：

1. **台账位置**：每个插件一份 `plugins/{plugin_id}/TEST_CASES.md`，随插件一起维护；
2. **记录时机**：开发中踩到的问题（代码缺陷、环境坑、易错点）、迁移脚本的边界场景、自测中发现平台/工具链的注意事项；
3. **记录格式**：每条含「问题现象 → 根因 → 验证方法（可执行的测试步骤）」；
4. **使用时机**：下次升级的自测清单第 6 条，逐条回归执行，确认旧问题未复发；
5. 已修复且不再可能出现的问题可标记归档，不删除。
