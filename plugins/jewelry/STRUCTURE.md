# jewelry/STRUCTURE.md — 懿臻珠宝云插件结构说明

> 本文件描述 **懿臻珠宝云**（`plugins/jewelry/`）的专属目录结构、后端模块、数据库表、前端页面与打印桥接。
> 通用插件开发要求以《plugins/AGENTS.md》为准；通用插件结构/契约/升级流程以《plugins/STRUCTURE.md》为准。冲突时以通用文档为准。

---

## 1. 插件清单

| 字段 | 值 |
|---|---|
| id | `jewelry` |
| name | 懿臻珠宝云 |
| entry | `main.py` |
| softwareVersion | `1.2.36.261016` |
| dataVersion | `1.2.21` |
| 默认端口 | 8002 |
| 演示账号 | admin / admin123456 |
| promo | `promo/index.html` |

**功能清单（features）：**
- 商品一物一码归档（含 RFID 芯片 EPC）
- 库存管理（入库 / 盘点 / 标签打印）
- 销售开单（普通 / 定金尾款）
- 借货、客户、维修、采购与委外加工
- RFID 批量隔空盘点
- 打印助手（PrintBridge，门店电脑免驱直连标签打印机）
- 扫描助手（手持机安卓 App，扫码盘点/入库/调拨 + 应用内自升级）
- 多门店统一管理
- 企业网站与到店预约
- 智能安防（RFID/EAS 防盗设备接入与离店告警）

---

## 2. 目录结构

```
plugins/jewelry/
├── plugin.json              # 清单（见第 1 章）
├── main.py                  # FastAPI 入口，暴露 /api/* 与 /ws/*
├── db.py                    # SCHEMA 定义 + 建库 + 迁移辅助 + _db 连接器
├── sensors.py               # 设备驱动注册表（抽象基类 + @register + DRIVERS dict）
├── ops_api.py               # 运维端 API（/api/ops/*，仅 PRODUCTION_SUPPORT 穿透，只读巡检，见第 5.2 章）
├── rfid_print.py            # RFID 标签写入 / 打印扩展模块
├── test_printer.py          # 打印桥接测试脚本（不入包）
├── build_package.py         # 打包脚本（自动发现顶层 .py + 校验 import 链）
├── requirements.txt         # Python 依赖
├── TEST_CASES.md            # 测试用例台账
├── scripts/                 # 平台数据任务生命周期脚本 + 冒烟（不放常驻代理程序）
│   ├── init.py              # 新租户建库（调用 db.SCHEMA + seed_demo）
│   ├── upgrade.py           # 版本间迁移（增量 DDL）
│   └── smoke_test.py        # 冒烟测试
├── agents/                  # 两个本地助手的独立构建线（源码全部不入插件包，见第 6 章）
│   ├── scan/                # 扫描助手：Android 原生工程（Gradle，包名 com.yizhen.scanassistant）
│   └── print/               # 打印助手：PrintBridge 源码与打包
│       ├── print_agent.py       # 门店电脑本地运行的打印代理
│       ├── PrintBridge.spec     # PyInstaller 打包配置
│       ├── build_exe.bat        # 构建 PrintBridge.exe
│       └── PrintBridge-使用说明.txt
├── frontend/                # Vue3 SPA（global build，无构建步骤）
│   ├── index.html           # 工作区主入口
│   ├── app.js               # 集中状态对象 ST + methods（单文件）
│   ├── app.css              # 全局样式（含 .app-shell.mobile 移动端前缀）
│   ├── i18n.js              # 多语言字典（zh/en/it）
│   ├── stock.html           # 库存盘点页
│   ├── sale.html            # 销售开单页
│   └── vendor/              # 第三方库（vue.global.prod.js / qrcode.min.js / zxing.min.js）
├── mobile/                  # 网页版手机应用（免安装 H5/PWA，独立静态站点，见第 5.1 章）
│   ├── index.html           # 移动端 SPA 入口
│   ├── app.js               # 状态 ST + methods
│   ├── app.css              # 移动端设计系统（与主站同色系）
│   ├── i18n.js              # 移动端多语言字典（zh/zhHant/en/it/ja/ko）
│   ├── manifest.webmanifest # PWA 清单（可"添加到主屏幕"）
│   ├── vendor/              # vue.global.prod.js
│   └── icons/               # 启动图标
├── ops/                     # 运维端独立站点（红色危险主题，仅穿透模式可进，见第 5.2 章）
│   ├── index.html           # 运维端入口（红框壳 + 未授权遮罩）
│   ├── app.js               # 只读巡检渲染（原生 JS，相对 __APP_BASE__ 取数）
│   └── app.css              # 危险主题样式
├── promo/                   # 推广页（纯静态）
│   ├── index.html
│   ├── style.css
│   └── logo.png
├── dev_data/
│   └── seed_test_data.py    # 开发用种子数据（不入包）
├── docs/
│   └── 懿臻珠宝云软件开发规范及需求说明.md  # 需求与验收说明
└── downloads/               # 两个助手的分发产物（PrintBridge.exe / scan-assistant-release.apk，入包作首包兜底）
```

**打包排除项**（`build_package.py` 内置）：`__pycache__`、`.pyc`、`agents/`（整个独立构建线：扫描助手 Android 工程与打印助手源码；`agents/print/build`、`agents/print/dist` 为构建中间产物）、`dev_data/`、`docs/`、`demo/`、`print_agent.json`（门店本地配置）、`build_package.py` 自身、`test_*.py`、`_*.py`。

---

## 3. 后端模块组成

| 模块 | 职责 |
|---|---|
| `main.py` | FastAPI 入口；路由注册、鉴权拦截、SSO 换签、WS 透传、GZip 中间件、静态文件伺服 |
| `db.py` | `SCHEMA`（全部建表 DDL）、`seed_demo`（演示数据）、`migrate_schema`（结构迁移辅助）、`ensure_new_seeds`（新库种子）、`_db(request)` 连接器（with 块即关） |
| `sensors.py` | 设备驱动注册表：抽象基类 + `@register` 装饰器 + `DRIVERS` dict；HTTP/WS 双通道路径汇入同一处理函数；新增设备类型零改动核心管线 |
| `rfid_print.py` | RFID 芯片 EPC 写入、标签模板渲染、打印任务派发 |
| `scripts/init.py` | 平台调用的建库脚本，参数经 `--key=value` 与环境变量传入 |
| `scripts/upgrade.py` | 版本间增量迁移，环境变量见 `plugins/STRUCTURE.md` 第 5.3 节 |
| `agents/print/print_agent.py` | **打印助手（PrintBridge）**：门店电脑本地运行的打印代理，接收插件下发的打印任务并直连标签打印机；打包为 `PrintBridge.exe`（PyInstaller），分发到 `downloads/`（构建线源码不入插件包，仅分发产物） |
| `agents/scan/` | **扫描助手**：手持机 Android 原生工程（Kotlin/Gradle），独立构建线；release APK 复制到 `downloads/` 供应用内自升级分发。仓库根 `scripts/build_scan_app.bat` 一键构建并生成 `.md5` sidecar |

---

## 4. 数据库表（按业务域分组）

库文件命名：`db_jewelry_{tenant_id}_v1.2.17`。全部 DDL 在 [db.py](db.py) 的 `SCHEMA`。

### 4.1 组织与门店
| 表 | 说明 |
|---|---|
| `shops` | 企业（总部）资料 |
| `stores` | 门店资料（多门店） |
| `store_printers` | 门店打印机绑定 |
| `users` | 业务用户账号 |
| `user_stores` | 用户-门店权限（视角：总店 / 分店） |
| `tenant_profiles` | 租户档案（企业信息） |
| `clerk_types` | 店员类型 |

### 4.2 商品与库存
| 表 | 说明 |
|---|---|
| `categories` | 品类 |
| `product_types` | 商品类型 |
| `products` | 商品档案（含 EPC、金价、工费、重量等） |
| `locations` | 库位 |
| `inventory_logs` | 入库 / 出库流水 |
| `label_templates` | 标签模板（物理尺寸用 CSS mm 单位） |

### 4.3 销售与收款
| 表 | 说明 |
|---|---|
| `sales` | 销售单（普通 / 定金尾款） |
| `sale_items` | 销售明细 |
| `sale_payments` | 收款记录（支付方式存中文） |
| `deposits` | 定金记录 |

### 4.4 业务办理
| 表 | 说明 |
|---|---|
| `customers` | 客户档案 |
| `loans` | 借货单 |
| `repairs` | 维修单 |
| `purchases` | 采购单 |
| `outsourcings` | 委外加工单 |

### 4.5 盘点与协同扫码
| 表 | 说明 |
|---|---|
| `stocktakes` | 盘点任务 |
| `stocktake_items` | 盘点明细 |
| `stocktake_sessions` | 扫码会话（`UNIQUE(session_id, epc)` 去重） |
| `stocktake_devices` | 盘点绑定的设备 |
| `stocktake_scans` | 扫码流水 |
| `tasks` | 协同任务（调拨 / 盘点共用） |
| `task_devices` | 任务绑定设备 |
| `task_scans` | 任务扫码流水 |
| `task_events` | 任务事件（含 `parse_error` 解析失败落库） |

### 4.6 设备与安防
| 表 | 说明 |
|---|---|
| `devices` | 设备档案（手持机 / 打印机等） |
| `device_activations` | 设备激活码 |
| `sensors` | 安防传感器（RFID/EAS） |
| `sensor_events` | 传感器事件（含离店告警） |
| `sensor_pass` | 通行记录 |
| `sensor_settings` | 传感器配置 |

### 4.7 调拨
| 表 | 说明 |
|---|---|
| `transfers` | 调拨单（scope=out/in 视角） |
| `transfer_items` | 调拨明细 |

### 4.8 系统
| 表 | 说明 |
|---|---|
| `languages` | 多语言字典（运行时） |
| `biz_config` | 业务配置 |
| `operate_logs` | 操作日志（PRODUCTION_SUPPORT 模式强制审计） |
| `appointments` | 到店预约 |

---

## 5. 前端页面

| 文件 | 用途 |
|---|---|
| `index.html` | 工作区主入口（PC 宽屏 / 移动端自适应，按指针类型判定） |
| `stock.html` | 库存盘点页（RFID 批量隔空盘点） |
| `sale.html` | 销售开单页（普通 / 定金尾款） |
| `app.js` | 集中状态对象 `ST` + methods（单文件，禁止与 i18n.js 重复声明同名函数） |
| `i18n.js` | 多语言字典（zh/en/it 三语，缺键会导致切换后残留中文） |
| `app.css` | 全局样式（移动端用 `.app-shell.mobile` 前缀，禁通用 `@media max-width`） |

前端禁止绝对路径请求 API（网关下 404），统一相对路径 + 封装的 `api()`。带鉴权的图片（如激活码二维码 `<img>`）必须携带登录凭证。物理尺寸预览用 CSS 物理单位（如标签 `width:70mm;height:35mm`）。

### 5.1 网页版手机应用（`mobile/`）

面向手机浏览器、**免安装**的独立移动端站点（非原生 App），安卓/苹果通用，可"添加到主屏幕"（PWA）。与主 SPA 同色系（金 `#C9A961` + 酒红 `#5C2233`），独立实现移动 UI，复用后端同一套 REST API。

- **访问路径**：后端 `main.py` 新增 `GET /mobile` 与 `GET /mobile/{asset_path:path}` 静态路由伺服 `mobile/`；平台网关下为 `/app/jewelry/{tenant}/mobile/`。
- **API 基地址**：`window.__APP_BASE__`（网关注入）或按当前路径自动推导（去掉 `/mobile` 前缀）→ 独立部署为 `''`（相对路径），网关下指向租户根。
- **多语言**：`mobile/i18n.js`（zh/zhHant/en/it/ja/ko 六语言，navigator.language 自动识别），`t(key)` 缺键回退简中。
- **PWA**：`manifest.webmanifest` 可"添加到主屏幕"；不使用 Service Worker（历史 sw.js 已移除，接口与静态资源一律直连，避免缓存错配）。
- **打包**：`build_package.py` 的 `INCLUDE_DIRS` 已含 `mobile`，随插件包发布。

### 5.2 运维端（`ops/` + `ops_api.py`）

运营者专用的独立站点（红色危险主题，与业务端完全隔离），默认只读巡检 + 少量受控写操作；经平台网关调试票证进入，不提供任何登录表单。

- **访问路径**：`GET /ops` 与 `GET /ops/{asset_path:path}`（静态壳同样卡模式）；平台网关下为 `/gw/{票据}/ops/`，网关对 HTML 注入 `window.__APP_BASE__`，前端一律相对该基址请求 `api/ops/*`。
- **唯一准入**：`X-System-Bypass-Auth: true` **且** `X-Operator-Mode: PRODUCTION_SUPPORT` 同时成立（`ops_api.require_ops` 统一依赖）；普通业务 Bearer 登录、SANDBOX 穿透（同为 bypass 但模式不同）一律 403。
- **端点**：
  - 只读巡检：`GET /api/ops/context`（租户/操作者/版本）、`GET /api/ops/overview`（组织/库存/会员/今日+近7日销售/设备在线）、`GET /api/ops/devices`（扫描助手清单：在线只信 `last_seen` 上报帧，APK 指纹与服务端包比对标记待升级）、`GET /api/ops/audit`（本租户 `operate_logs` 查询）。
  - 助手发布（写操作，强制审计）：`GET /api/ops/agents`（当前发布状态+发布历史）、`POST /api/ops/agents/publish`（multipart 上传：校验扩展名/≤30MB/空文件 → MD5 → 临时文件原子替换 → `.md5` sidecar → manifest.json 历史 → `operate_logs`）、`POST /api/ops/agents/scan/force`（强更开关，写/删 `.force` sidecar）。
  - 受控写操作（main.py 内实现，复用业务引擎，每笔二次确认 + 强制审计，action 前缀「运维端·」）：`GET /api/ops/tasks/active`（进行中任务，盘点任务=库存冻结来源）、`POST /api/ops/tasks/{tid}/terminate`（强制终止：抢占终态 `closed_by='ops'` → 有扫描生成部分盘点报告 → 释放设备 → 立即解冻；非进行中 409）、`GET /api/ops/users`（业务账号列表，永不回显密码）、`POST /api/ops/users/{uid}/reset-password`（生成 8 位随机密码仅响应回显一次，置 `users.must_change_pwd=1` 强制用户登录后改密）。两个 POST 的 body 均为可选 `FaceGuardIn{face:128维向量|emergency:口令}`，人脸功能启用时必须二选一通过，审计 detail 追加验证方式（人脸姓名+距离 / 应急口令）。
  - 人脸确认（v1.2.40 起，仅卡上述两个高危写操作，巡检/进门不刷脸）：`GET /api/ops/face/status`（enabled=已录模板数>0、count、has_emergency）、`GET /api/ops/face/templates`（列表**永不回显 descriptor**）、`POST /api/ops/face/enroll`（姓名+128 维特征，重名 400，≤20 个）、`DELETE /api/ops/face/templates/{tid}`（删完最后一个自动停用）、`POST /api/ops/face/emergency`（应急口令，8-64 位）。浏览器端用本地 `ops/vendor/` 的 face-api.js（tinyFaceDetector+68 landmarks+recognition，约 7MB，无外网依赖）提取特征；服务端纯 Python 欧氏距离 1:N 比对，阈值 0.5（严格档）。模板存平台注入 `STORAGE_DIR/face/`（`templates.json`+`emergency.key`，与 agents/ 同级跨版本持久；独立运行回退 `dev_storage/face/`），应急口令为 PBKDF2-SHA256（20 万轮加盐）存储。浏览器仅 HTTPS/本机可用摄像头，无摄像头或非安全上下文时 UI 回落应急口令；未设口令则拒绝操作而不是放行。模型权重含无后缀 `-shardN` 文件，`/ops/{path}` 静态路由对 `vendor/models/` 前缀单独放行。
- **助手产物目录**：平台注入的 `STORAGE_DIR/agents/`（插件级共享存储根，升级仅迁移 `{租户}/v{版本}` 子目录，本目录跨版本持久）；独立运行回退 `dev_storage/agents/`（gitignore）。下载链路「发布目录优先、包内 `downloads/` 兜底」——`_scan_app_apk()` 与 `GET /api/print-agent/download` 已接入；发布后立即对全租户生效。
- **强制改密（dataVersion 1.2.22 起）**：`users.must_change_pwd=1` 时 `_require_auth` 仅放行 `/api/auth/logout`、`/api/auth/me`、`/api/auth/change-password`，其余接口一律 403「请先修改密码」；PC 端登录/恢复会话即弹出强制改密遮罩（不可关闭，仅「修改并继续 / 退出登录」两个出口）；自助改密 `POST /api/auth/change-password`（校验原密码、新旧不同、成功清旗标并写 `operate_logs`「修改密码」）；管理员在账号管理设置密码同样清旗标（管理员知情设密不强制改）。
- **打包**：`ops/` 与顶层 `ops_api.py` 随插件包发布；与业务端同一次插件升级生效。

---

## 6. 两个本地助手（`agents/`，独立构建线，源码不入插件包）

### 6.1 打印助手（PrintAgent，.NET 8 WinForms）

门店电脑本地运行的打印代理（2026-10-17 起由 Python PrintBridge 替换为 C# PrintAgent_ZMIN 工程）：

- **源码**：`agents/print/`（net8.0-windows WinForms 单文件工程：本地 HTTP `127.0.0.1:18180` 收任务 + 云端 WS 长连接 + ZMIN RFID/ESC-POS/Win 驱动打印调度，厂商闭源 `libs/LabelPrinter.dll` 勿动）；工程内规范见 `agents/print/AGENTS.md` 与 `agents/print/STRUCTURE.md`
- **构建**：`dotnet publish -c Release -r win-x64 --self-contained true` → 单文件产物 `agents/print/bin/Release/net8.0-windows10.0.19041.0/win-x64/publish/PrintAgent.exe`（需 .NET 8 SDK；bin/obj/厂商 SDK 资料包 `.Net/` 均 gitignore 不入库）
- **分发**：对外下载名仍 `PrintBridge.exe`——`GET /api/print-agent/download` 链路「运维端发布目录优先 → 包内 `downloads/` 兜底 → C# publish 产物」，发布时把 PrintAgent.exe 改名 PrintBridge.exe 上传
- **配置**：`config.json` 在 exe 运行目录读写（非项目根副本）；门店密钥等连接信息由程序配置页填写
- **真机验证**：打印/RFID 写入改动必须在 ZMIN 真机验收（工程 AGENTS.md 有实测铁律清单，勿凭仿真推断）

### 6.2 扫描助手（手持机 Android App）

- **工程**：`agents/scan/`（Gradle，applicationId `com.yizhen.scanassistant` **永不改**，否则现网设备无法覆盖安装）
- **构建**：仓库根 `scripts/build_scan_app.bat`（release 构建 → 拷贝 APK 到 `downloads/scan-assistant-release.apk` 并生成 `.md5` sidecar）；CI 见 `.github/workflows/scan-assistant-build.yml`
- **签名**：release.jks 不入库，Gradle 按相对路径引用工作区根并列的外部 `scanner-app/app/release.jks`；缺失时退化为未签名包（debug 不受影响）
- **自升级**：设备免鉴权调 `GET /api/scan-app/info`（md5/size/force）+ `GET /api/scan-app/download`（接口路径已硬编码进现网 App，**只加不改**）；包内 `downloads/` 优先，回退 `agents/scan/app/build/outputs/apk/release/` 开发构建产物
- **规范与踩坑**：见 [platform/AGENTS.md](../../platform/AGENTS.md)（Android 原生规范、扳机通道、AP 隔离、Kotlin daemon 等）

---

## 7. 版本与升级

- **当前 softwareVersion**：`1.2.36.261016`（重构.功能.修订.日期 YYMMDD）
- **当前 dataVersion**：`1.2.21`（不得高于 softwareVersion 前三段）
- **建库**：`scripts/init.py`（新租户，调 `db.SCHEMA` + `seed_demo`）
- **迁移**：`scripts/upgrade.py`（增量 DDL，幂等，120 秒超时）
- 升级五步流水线见 [plugins/STRUCTURE.md](../STRUCTURE.md) 第五章；踩坑见 [plugins/AGENTS.md](../AGENTS.md) 第 5 章。
