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
| softwareVersion | `1.2.33.261016` |
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
- 本地打印桥接（PrintBridge，门店电脑免驱直连标签打印机）
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
├── rfid_print.py            # RFID 标签写入 / 打印扩展模块
├── test_printer.py          # 打印桥接测试脚本（不入包）
├── build_package.py         # 打包脚本（自动发现顶层 .py + 校验 import 链）
├── requirements.txt         # Python 依赖
├── TEST_CASES.md            # 测试用例台账
├── scripts/
│   ├── init.py              # 新租户建库（调用 db.SCHEMA + seed_demo）
│   ├── upgrade.py           # 版本间迁移（增量 DDL）
│   ├── print_agent.py       # PrintBridge 打印桥接（门店电脑本地运行）
│   ├── PrintBridge.spec     # PyInstaller 打印桥接打包配置
│   ├── build_exe.bat        # 构建 PrintBridge.exe
│   ├── PrintBridge-使用说明.txt
│   └── smoke_test.py        # 冒烟测试
├── frontend/                # Vue3 SPA（global build，无构建步骤）
│   ├── index.html           # 工作区主入口
│   ├── app.js               # 集中状态对象 ST + methods（单文件）
│   ├── app.css              # 全局样式（含 .app-shell.mobile 移动端前缀）
│   ├── i18n.js              # 多语言字典（zh/en/it）
│   ├── stock.html           # 库存盘点页
│   ├── sale.html            # 销售开单页
│   └── vendor/              # 第三方库（vue.global.prod.js / qrcode.min.js / zxing.min.js）
├── promo/                   # 推广页（纯静态）
│   ├── index.html
│   ├── style.css
│   └── logo.png
├── dev_data/
│   └── seed_test_data.py    # 开发用种子数据（不入包）
├── docs/
│   └── 懿臻珠宝云软件开发规范及需求说明.md  # 需求与验收说明
└── downloads/               # PrintBridge.exe 分发产物（入包）
```

**打包排除项**（`build_package.py` 内置）：`__pycache__`、`.pyc`、`scripts/build`、`scripts/dist`（打印桥接构建中间产物）、`dev_data/`、`docs/`、`demo/`、`print_agent.json`（门店本地配置）、`build_package.py` 自身、`test_*.py`、`_*.py`。

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
| `scripts/print_agent.py` | **PrintBridge**：门店电脑本地运行的打印代理，接收插件下发的打印任务并直连标签打印机；打包为 `PrintBridge.exe`（PyInstaller），分发到 `downloads/` |

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

---

## 6. PrintBridge 打印桥接

门店电脑本地运行的打印代理，免驱直连标签打印机：

- **源码**：[scripts/print_agent.py](scripts/print_agent.py)
- **打包**：`scripts/build_exe.bat` + `scripts/PrintBridge.spec`（PyInstaller）→ 产物 `PrintBridge.exe`，复制到 `downloads/` 随插件包分发
- **配置**：门店本地 `print_agent.json`（**不入包**，记录打印机端口 / 型号等）
- **使用说明**：见 `scripts/PrintBridge-使用说明.txt`
- **链路**：插件后端下发打印任务 → PrintBridge 接收 → 直连打印机出标签

PrintBridge 与插件后端通过本地 HTTP 通信；`print_agent.json` 用 `utf-8-sig` 读取（防 BOM 崩 `json.load`）。

---

## 7. 版本与升级

- **当前 softwareVersion**：`1.2.33.261016`（重构.功能.修订.日期 YYMMDD）
- **当前 dataVersion**：`1.2.21`（不得高于 softwareVersion 前三段）
- **建库**：`scripts/init.py`（新租户，调 `db.SCHEMA` + `seed_demo`）
- **迁移**：`scripts/upgrade.py`（增量 DDL，幂等，120 秒超时）
- 升级五步流水线见 [plugins/STRUCTURE.md](../STRUCTURE.md) 第五章；踩坑见 [plugins/AGENTS.md](../AGENTS.md) 第 5 章。
