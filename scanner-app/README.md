# 懿臻珠宝云 · 手持机 App（C27）

基于 Chainway C27 UHF RFID 手持终端的**通用壳 App**，配合懿臻珠宝云使用。
核心页面（销售出单、库存盘点）为**原生实现**，视觉与操作跟系统一致、无 WebView 卡顿；
App 同时保留 `WebActivity` 通用网页容器与 `YzApp` JS 桥，服务端 `sale.html` / `stock.html` 供手机、电脑浏览器直接使用。

## 功能

- **扫码登录**：启动 App 扫网页端【手持机登录】二维码，网页确认后进入系统；会话**当天有效**
- **主界面**：销售出单、库存盘点两个入口 + 参数设置
- **销售出单**（原生页）：识别支持**条码 / 二维码 / EPC**，EPC 用小功率防串扫邻柜；带商品图/编码/价格，填写客户电话金额后提交；机身扳机 = 快捷 EPC 识别
- **库存盘点**（原生页）：扫任务二维码加入，UHF 连续扫描实时比对/去重/协同，离线缓存断网续传，任务暂停后按一下自动重新加入（无需重新扫码）
- **参数设置**（设备级）：出单功率（默认 10dBm）/ 盘点功率（默认 30dBm），支持边扫边调听声定距离；扳机适配模式；中英文切换

## 架构：壳 + 网页 + JS 桥

```
App（壳）                          服务端
┌────────────────────┐   HTTPS   ┌──────────────────────────┐
│ LoginActivity      │──────────▶│ /api/auth/*  手持机登录    │
│ HomeActivity       │           │                          │
│ WebActivity(通用)   │◀──网页───│ /sale.html  销售出单页     │
│  └ WebView+YzApp桥 │◀──网页───│ /stock.html 库存盘点页     │
│ SettingsActivity   │──────────▶│ /api/*      业务接口       │
│ RfidManager(UHF)   │           └──────────────────────────┘
└────────────────────┘
```

**JS 桥 `window.YzApp`**（WebActivity 注入）：
- `scan('barcode'|'qrcode'|'epc')` 单次识别（epc 自动出单小功率，扫到即停）
- `device()` 设备信息 JSON；`setPower(dbm)` / `power()` 功率
- `stockStart()` / `stockStop()` 连续盘点扫描（自动切盘点功率）
- `beep()` / `vibrate(ms)` 硬件反馈

**网页回调 `window.YzScanner`**：`onResult(code,type)` 单次结果、`onState(on)` 扫描状态、`onTags([{epc,rssi}])` 盘点批量标签（约150ms一批）。
网页可定义 `window.YzTrigger = { onTrigger() }` 接管机身扳机。

## 编译方式

本地无 Java 环境，代码推送 GitHub 后由 Actions 自动编译，在 Actions 页面下载：
- `rfid-scanner-debug` — 调试版
- `rfid-scanner-release` — 发布版

## 项目结构

```
scanner-app/app/src/main/java/com/yizhen/rfid/
├── LoginActivity.kt     # 扫码登录（当天有效会话）
├── HomeActivity.kt      # 主界面（出单/盘点/设置）
├── WebActivity.kt       # 通用网页容器 + YzApp 桥 + 扳机转发
├── SettingsActivity.kt  # 参数设置（双功率 + 试扫）
├── AuthApi.kt           # 扫码登录接口
├── RfidManager.kt       # UHF 模块封装
├── TriggerChannels.kt   # 扳机通道适配
└── Prefs.kt             # 本地设置

plugins/jewelry/frontend/
├── sale.html            # 销售出单页（壳加载，App/浏览器通用）
└── stock.html           # 库存盘点页（壳加载，含盘点引擎/离线队列）
```

## 使用流程

### 登录（每天一次）
1. 手机/电脑网页登录懿臻珠宝云 → 【手持机登录】显示二维码
2. App 点【扫码登录】扫二维码（可设设备名，网页确认时显示）
3. 网页核对设备名 →【确认登录】，App 进入主界面

### 销售出单
1. 主界面 →【销售出单】
2. 扫条码 / 扫二维码 / 扫EPC（EPC 自动小功率），或按机身扳机快捷扫 EPC
3. 出单功率在【参数设置 → 出单识别功率】调整，可边扫边听声定距离

### 库存盘点
1. 网页端「协同盘点任务」开启任务生成二维码
2. 主界面 →【库存盘点】→ 扫任务码加入（自动下载快照）
3. 点按钮或按扳机连续扫描，数据实时上传比对；断网自动缓存续传
4. 盘点功率在【参数设置 → 盘点扫描功率】预先调整；任务结束后需扫新任务码
