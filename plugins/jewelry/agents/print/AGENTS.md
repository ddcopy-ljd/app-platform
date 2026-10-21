# AGENTS.md

面向 AI 编码代理的工作指南。在本仓库中执行任何修改前请先阅读本文件。

## 项目概述

PrintAgent_ZMIN 是一个 Windows 桌面打印代理程序（.NET 8 WinForms），核心能力：

- 通过本地 HTTP 服务（默认 `127.0.0.1:18180`）接收浏览器/网页下发的打印任务
- 通过 WebSocket 连接云端服务器，接收云端打印任务并回传 ACK
- 调度致明兴（ZMIN）RFID 标签打印、ESC/POS 小票打印（TCP 9100）、Windows 驱动打印
- 系统托盘常驻 + 主界面任务列表，支持 7 种语言切换

## 构建与运行

```powershell
# 还原 + 构建（输出到 bin\Debug\net8.0-windows\）
dotnet build

# 直接运行（WinExe，无控制台窗口）
dotnet run

# 发布单目录
dotnet publish -c Release -r win-x64 --self-contained true
```

要求：Windows + .NET 8 SDK。目标框架 `net8.0-windows`，启用 WinForms 与 Nullable。

## 硬性约束（不要违反）

1. **`libs\LabelPrinter.dll` 是致明兴官方闭源 SDK**，禁止删除、替换或反编译修改。新增打印功能必须基于其公开 API（`PrintUtility`、`ZMPrinter`、`ZMLabel`、`LabelObject` 等）。
2. **单实例互斥锁**：`Program.cs` 使用 `Global\PrintAgent_SingleInstance_Mutex`，不要改动锁名，否则旧版本用户会双开冲突。
3. **HTTP 仅监听回环地址**（`127.0.0.1` / `localhost`），禁止绑定 `0.0.0.0`，避免局域网攻击面。
4. **CORS 全开放是有意为之**（网页端需跨域调用），不要收紧后再"修复"它；如要收紧需与用户确认。
5. **`config.json` 存于 exe 所在目录**（`Environment.ProcessPath` 目录；单文件发布时 `AppDomain.CurrentDomain.BaseDirectory` 指向解包临时目录，不可用于定位配置）。调试时修改项目根下的 `config.json` 不会影响运行实例，除非同步到输出目录。
6. **RFID 图元命名规则**：`LabelObject.ObjectName` 必须以 `rfiduhf` / `text` / `barcode` 开头，这是 ZMIN SDK 的解析约定，改名将导致打印失败。

## 代码约定

- 命名空间统一 `PrintAgent.*`（`Forms` / `Models` / `Services`）。
- 打印结果统一返回 `(bool success, string message)` 元组，错误信息面向最终用户，可直接进 UI 列表。
- 服务间通信用事件（`event Action<...>`），UI 更新需 `Invoke` 回主线程（参见 `FormMain.BindEvents`）。
- 打印调度入口唯一：所有任务（本地/云端）都必须经过 `PrintDispatcher.DispatchAsync`，禁止在别处直接调打印服务。
- 新增 UI 文案必须走 `I18nService.T(key)`，并在全部 7 个语言字典中补齐 key，缺失会回退英文。
- 任务状态文案目前是中文字面量（"待处理"/"执行中"/"已完成"/"失败"），由 `PrintTask.Status` 承载；改动时注意与 UI 显示逻辑同步。

## 常见任务指引

| 需求 | 入口 |
|---|---|
| 新增本地 HTTP 接口 | [LocalHttpServer.cs](Services/LocalHttpServer.cs) `ProcessRequest` |
| 新增打印任务类型 | [PrintTask.cs](Models/PrintTask.cs) 加类型 → [PrintDispatcher.cs](Services/PrintDispatcher.cs) 加分支 |
| 新增/调整统一 RFID 指令 | [RfidCommand.cs](Services/Rfid/RfidCommand.cs) 语法 → 对应品牌后端翻译/执行（唯一入口 [RfidCommandExecutor.cs](Services/Rfid/RfidCommandExecutor.cs)） |
| 调整 RFID 排版字段 | [ZMinRfidService.cs](Services/ZMinRfidService.cs) `PrintRfidLabel` |
| 调整云端协议 | [CloudSyncService.cs](Services/CloudSyncService.cs) `HandleIncomingMessageAsync` |
| 新增/修改文案 | [I18nService.cs](Services/I18nService.cs)（7 个字典全改） |
| 配置项增减 | [AppConfig.cs](Models/AppConfig.cs)（注意旧 config.json 反序列化兼容） |

## 测试与验证

- 无单元测试工程。验证方式：构建后运行，调用 `POST http://127.0.0.1:18180/api/print` 发测试任务，观察主界面任务列表状态。
- 快速心跳检查：`GET /api/ping` 应返回 `{"code":0,"msg":"pong"}`。
- 打印相关改动必须在真机（ZMIN RFID 打印机）上验证后再交付，仿真器无法验证 RFID 写入。

## 统一 RFID 指令层（Services/Rfid/）

业务模板产出一条统一文本指令流（一行一条、`#` 注释、大小写不敏感、坐标单位 mm），由品牌后端翻译为原生指令：

- 语法：`N | L w,h,gap | S speed,darkness[,dpi] | T x,y,size,font,style,"文本" | B x,y,h,scale,textPos,type,"内容" | RF block,mode,len,"HEX"(0=EPC,1=USER) | RD [epc|tid|both] | RTID | FEED n | BACKFEED n | CAL paper|rfid | PWR read,write | IP query|static a,m,g|dhcp|feedback 口,ip[,协议] | RQ n | PRINT [份数] | CONFIG tear,<mm> | TEST bounds,<宽>,<高> | LINE/BOX <线框>`
- 触发面：`POST /api/rfid/exec`（同步, 支持 dryRun 翻译预览）、`GET /api/rfid/capabilities?brand=zmin`、打印任务 `printerType="rfid_cmd"`（`content.commands`）、云端 `device_cmd`→`device_ack`（远程维护预留通道）。
- 唯一入口：`RfidCommandExecutor.ExecuteAsync(brand, iface, ip, target, commands, timeoutMs, dryRun)`，三方（HTTP/调度器/云端）复用，禁止绕过。
- 能力矩阵：后端 `SupportedOps` 声明细粒度支持（含 `IP.static` 等）；不在清单内的指令执行前明确报错，不静默忽略。ZMIN 限制：PCLE 无退纸指令（BACKFEED 不支持）、无静态IP设置指令（IP static/dhcp 不支持，仅 IP query/feedback）、纸校准仅 USB 通道（ZM_MediaDetect）。
- 设备档案：`AppConfig.DeviceProfiles`（key=`brand|ip或SN`）持久化每台机器的 L/S/PWR 默认值；指令流缺这些命令时自动套用档案（不同类型打印机独立校准/配置）。
- 通道：USB=ZMPCLx64 免驱（回读 ZM_GetData_USB，可开箱配网校准）；NET=SDK 透传排版 + TCP 9100 socket 回读（RD{r},2,0,0 / RQ2,n）。
- tspl/zpl 后端规划中，仅在注册表预留；新增品牌 = 实现 `IRfidBackend` 并注册进 `RfidCommandExecutor.Backends`。
- ZMIN 通道: USB(免驱 DLL, 若被 Windows 打印驱动占用则写入无效且无回传——设备枚举出现 USBPRINT 驱动即为此状态) / NET(TCP 9100) / BT(经典蓝牙 SPP 虚拟串口, 复用 `BtSppPrintService`, PCLE 反馈口=0 同链路回读, GBK 编码)。
- X19D 实测铁律（2026-10-17/18 真机验证, 勿再踩坑）:
  - **任务缓冲内禁放 RD**：RD 与 RF 同任务会卡死固件（灯闪、不出纸、U 也无响应），只能断电恢复。天线位/射频场回读均**不可用于校验本次写入**（详见下文「天线区读数」条），校验唯一可靠手段 = 手持机 UHF 扫 / 标签错误标记块判据。
  - **连打抖动**：连续 USB 任务时单张可能报 `PR verification failed. USB has been reset, please try again.`——直接重试同任务即可恢复，勿重启助手/勿断电（10-18 连打 3 张实踩，第 3 张失败、重发即成）。
  - **打印+写 EPC 走统一指令**（三通道通用，勿用裸 PCLE 序列）：`N / L 66,25.4,5 / S 4,12 / T.. / B.. / RF1,0,<字节数>,"<BCD打包HEX>" / PRINT 1`。EPC 纯数字按 **BCD 打包**（每字节 2 位数字，20 位 EPC=10 字节，勿 ASCII 转 hex）。**不要**加 `I8/RS/RW/S40/H10`（曾致写入失败+错误标记）。
  - 撕纸位置：固件参数，PCLE/DLL 层无指令。私有指令 `#UM>FD{点}\r\n`（点=mm×8@203dpi，如 17mm=FD136）经 Frida 抓 LabelSoft(WritePrinter 走 spooler)破译并双点验证。统一指令 `CONFIG tear,<mm>` 已实现（三通道, NV 持久保存, 真机双标签对比验收通过）。LabelSoft 是 .NET Reactor 加密, 静态反编译不可行; Frida 17 hook 方法与坑见项目记忆。
  - 天线位置：`CAL rfid`=自动定位(ZM_AutoRFTagDetc/RM)；`CAL rfid,manual,芯片距离mm,错误标识偏移mm,重试次数`=手动(ZM_SetRFIDPosition, 仅 USB)。
  - **天线区读数与身份对应（10-18 两轮实测）**：`ZM_ReadRFTagDataUSB` 读的是**射频场内某张**（含出纸口堆放张），非固定"天线位"；场边仅一张时读数 100% 稳定（10/10 同值零抖动），多张同场才随机应答。打印前后对比：前读 EPC 3000…1524/TID…1428 → 打印写入 3000…1917 → 后读 3000…1525/TID…1828，**写入值永不出现**；打印后立即退纸也仅 -100 dots 即 -3200（行程不足，二次实锤）。**「打印前读TID→打印→按TID回读」实测同样无法闭环。芯片写入校验唯一可靠手段=手持机 UHF 扫 / 标签错误标记块判据**。
  - **TID 读取（10-18 新增, 官方参数）**：`ZM_ReadRFTagDataUSB(255,0,0,2,buf,1000)` 读出厂 TID（`E2806A96…` 格式，写EPC不变）；与 EPC 读取 `(255,1,15,0,buf,8000)` 同会话稳定配对。来源：Java SDK（ZMPrinter-4.69.jar）LSF Demo `readUHFTag(0,2)`=读TID不写EPC / `readUHFTag(0,3)`=读TID后写EPC，字节码实锤映射 `ZM_ReadRFTagDataUSB(255,p1,0,p2,buf,1000)`。NET 通道官方读取协议：先发 `NB{端口},{本机IP},1\r\n`（动态反连 13000-31000 随机口），再发 `RD{天线},2,{功率},2\r\n`（末参 3=读了要写EPC/2=只读），打印机反连送 512B 标签数据。
  - **退纸真实行为（10-18 实测）**：`ZM_SetPrinterState(1)`+`ZM_EnableBackFeed` 是 `ZM_FeedBack` 的前置（缺前者恒报 -3200）；`ZM_SetPrinterState(1)` 在打印机冷启动后 SDK 未初始化时报 -3243（跑过一次 SDK 任务后才成功）。退纸行程=**纸道松弛余量**非固定值：打印后纸绷紧，仅能退 1-2 步（-3200=行程耗尽，需断电复位），SDK 通道打完的标签（停撕纸位外）**无法退回天线区回读**；`ZM_FeedMedia` 在该状态下恒报 -3237。
  - **EAN13(E30) 条码宽度**：固定 95 模块，总宽=95×窄bar点数+左右静区各11模块。窄bar 3 点=285 点(35.6mm)，x33mm 起必超 66mm 纸宽右边界（最后一位被裁，真机踩过）；靠右布局用窄bar 2 点(190 点)+x≤35mm。Code128 等可变码制按 模块数×窄bar 估算。
  - **打印头横向偏移（TEST bounds 实测）**：逻辑 x=0 打在纸面约 10mm 处——纸左 10mm 打不到，逻辑 x>56mm 出纸右缘（全坐标系相对纸面右移~10mm，条码裁字的真正根因）。业务端布局内容限 x≤56mm(448dots)。统一指令 `TEST bounds,宽,高` 打印边界测试页可复测。
  - 三通道真机验收（2026-10-17）：USB 全功能（打印/写入/读/校准/配置）；BT=打印+写入（读不做，固件限制），出向口 COM6；NET=打印+写入（SDK 透传，IP 经 USB `RQ 3` 查询）。同一统一指令序列三通道通用，业务端只换 interface。
  - USB 挂死特征：OpenPort 成功但所有指令无实物反应 → 断电重启打印机即可恢复。
  - 三通道成功要素（2026-10-18 实钉, TC-52, 勿动参数）:
    - **BT 时序**：开壳后等 RFCOMM 链路 **5 秒**（1 秒=拨号未完成指令全丢）；发送后保活 **≥6 秒**再关串口（发完即关=数据截断）；响应不按单次 read<buf 提前断开。BT 打印稳定后仍不做读（RQ/RD 无回传，固件限制）。
    - **NET 回读**：打印走 TCP 9100；RD/RQ 回读数据由打印机**反连主机 9200** 反馈口送回（RfidTransport 已实现监听，9200 被占时退化同链路读）；有数据则重置超时窗口。
    - **统一指令坐标一律 mm**：超 `L` 声明的标签高度=静默打到纸外（勿按点阵，EEEEEE 消失真因）；**不认 PCLE 裸 `q/Q`**，尺寸/间隙用 `L 66,25.4,5`。三通道通用纯打印序列：`N / L 66,25.4,5 / S 4,12 / T x,y,0,4,1,1,N,"文本" / PRINT 1`（双行安全布局 y=6/14mm）。
  - 助手进程 USB 卡死（区别于打印机挂死）：连续混打十数次后 USB 派发可挂起（任务不落账、无回执，BT/NET 不受影响），**重启 PrintAgent.exe 即恢复**，打印机无需断电。疑 UsbPcleService 无超时保护，待查（TC-53）。

## RFID 标签纸形状库（Models/LabelPaper.cs + Services/LabelPaperStore.cs）

- 数据：尺寸/间隙、可打印区域边距(Margin*)、天线/inlay 位置尺寸(Antenna*)、Source(local|cloud)；独立文件 `labelpapers.json`（exe 目录，带 Version/UpdatedAt，供珠宝云整库同步覆盖）。
- 绑定：`DeviceProfile.LabelPaperId` 按设备(brand|ip/SN)勾选所用标签纸；执行时 L 注入优先级 = 指令流显式 `L` > 绑定标签纸 > 档案 W/H。
- 校验：T/B 锚点超出可打印区域或压住 inlay 区 → **警告仍打印**（msg 前缀"警告: …"，code=0；dryRun 同样输出）。
- 接口：`GET/POST /api/labelpapers`（save|delete|bind）、云端 `device_cmd` action `labelpaper_list/save/delete/sync`（绑定复用 `profile_set`）。
