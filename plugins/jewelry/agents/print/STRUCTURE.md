# STRUCTURE.md

项目结构与数据流说明。

## 目录结构

```
PrintAgent_ZMIN/
├── Program.cs                     # 入口：单实例互斥锁、托盘图标、服务装配
├── PrintAgent.csproj              # net8.0-windows / WinForms / 引用 LabelPrinter.dll
├── app.manifest                   # UAC 清单
├── app.ico                        # 应用与托盘图标
├── config.json                    # 模板配置（运行时读写的是输出目录下的副本）
├── AGENTS.md                      # AI 代理工作指南
├── STRUCTURE.md                   # 本文件
│
├── Forms/
│   └── FormMain.cs                # 主界面：状态栏、语言切换、任务 ListView
│
├── Models/
│   ├── AppConfig.cs               # 配置模型：Load/Save config.json（Newtonsoft.Json）
│   └── PrintTask.cs               # 打印任务模型（Source/PrinterType/Interface/ContentJson）
│
├── Services/
│   ├── LocalHttpServer.cs         # 本地 HTTP 服务（HttpListener，回环地址）
│   ├── CloudSyncService.cs        # 云端 WebSocket 长连接（断线重连、任务 ACK）
│   ├── PrintDispatcher.cs         # 打印调度器：按 PrinterType 分发到具体打印服务
│   ├── ZMinRfidService.cs         # ZMIN RFID 打印（结构化标签 + 指令透传）
│   ├── StandardAndPosPrintService.cs # ESC/POS 网络透传 + Windows 驱动打印
│   ├── PrinterDiscoveryService.cs # 枚举驱动打印机 + ZMIN 免驱 USB 主板 SN
│   └── I18nService.cs             # 静态多语言字典（7 种语言）
│
└── libs/
    └── LabelPrinter.dll           # 致明兴官方 SDK（闭源，勿动）
```

## 运行时数据流

```
                        ┌──────────────┐
  网页/前端 ──POST────▶ │ LocalHttpServer│ (127.0.0.1:18180)
   /api/print           └──────┬───────┘
                               │ 构造 PrintTask (Source=Local)
  云端服务器 ──WebSocket──▶ CloudSyncService
   print_task                   │ 构造 PrintTask (Source=Cloud)
                               ▼
                      ┌────────────────┐
                      │ PrintDispatcher │  唯一调度入口
                      └───────┬────────┘
            ┌─────────────────┼──────────────────────┐
            ▼                 ▼                      ▼
     rfid / raw_passthrough   pos                  standard
     ZMinRfidService    StandardAndPosPrintService
     (LabelPrinter.dll) (TCP 9100 / Win 驱动)
            │
            ▼
     结果 (success, message)
            │
   ┌────────┴────────┐
   ▼                 ▼
 OnPrintTaskFinished  task_ack ──WebSocket──▶ 云端
 (更新 UI 列表)
```

## 模块职责边界

- **Program.cs**：只做装配（config → i18n → dispatcher → httpServer → cloudSync → tray/Form），不含业务逻辑。
- **LocalHttpServer**：协议解析 + 触发事件；不直接打印，打印走 `PrintDispatcher`。
- **CloudSyncService**：连接生命周期管理（3s 未配置轮询 / 5s 断线重连）、`register`/`ping/pong`/`print_task`/`task_ack` 协议。
- **PrintDispatcher**：解析 `ContentJson`（兼容包一层 `content` 或直接平铺），按 `PrinterType` 路由：`rfid`、`raw_passthrough`、`pos`、`standard`。
- **ZMinRfidService**：唯一直接操作 `LabelPrinter.dll` 的类；RFID 图元命名必须带 `rfiduhf`/`text`/`barcode` 前缀。
- **FormMain**：纯展示层，通过订阅 httpServer/cloudSync 事件刷新任务列表。

## 本地 HTTP API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 心跳，返回 pong |
| GET | `/api/printers` | 列出驱动打印机 + ZMIN 免驱 USB 设备 |
| POST | `/api/init` | 初始化 `{serverUrl, storeKey}`，触发事件保存配置并重启云连接 |
| POST | `/api/print` | 提交打印任务（PrintTask JSON），立即返回 taskId，异步执行 |

统一响应 JSON：`{code, msg, ...}`，0 为成功；CORS 全开放，支持 OPTIONS 预检。

## 云端 WebSocket 协议

- 连接头：`X-Store-Key: <门店密钥>`；保活 20s。
- 出站：`register`（连接后）、`pong`（应答 ping）、`task_ack`（任务结果）。
- 入站：`ping`、`print_task`（或任何含 `printerType` 字段的报文）。

## 打印任务类型（PrinterType）

| 类型 | 关键字段 | 去向 |
|---|---|---|
| `rfid` | content: epc, texts[], barcode, width/height/gap, speed/darkness/dpi | ZMIN SDK `PrintLabel` |
| `raw_passthrough` | content.rawCommands | ZMIN SDK `SetPrinterParams` 透传 |
| `pos` | content.rawBase64 或 text（GBK） | TCP 9100 字节流 |
| `standard` | content.text | Windows 驱动 `PrintDocument` |

`Interface`：`NET`（按 PrinterIp 连接）/ `USB`（按主板 SN 连接 ZMIN 免驱）/ `DRIVER`。
