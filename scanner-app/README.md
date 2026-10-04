# 懿臻珠宝云 · 手持机 App（C27）

基于 Chainway C27 UHF RFID 手持终端的应用，配合懿臻珠宝云使用。

## 功能

- **扫码登录**：启动 App 扫网页端（手机/电脑）【手持机登录】二维码，网页上核对设备名并确认后进入系统；会话**当天有效**，隔日自动失效需重新扫码
- **主界面**：销售出单、库存盘点两个入口 + 参数设置
- **销售出单**：内嵌 WebView 加载服务端出单界面（与手机/电脑网页同源同界面）；商品识别支持**扫描条码 / 扫描二维码 / 扫描 EPC 码**，EPC 识别使用小功率防止串扫邻柜商品；机身扳机 = 快捷 EPC 识别
- **库存盘点**：UHF RFID 批量扫描，扫服务端盘点任务二维码加入任务，连续盘点自动去重，离线缓存断网续传，多机协同
- **参数设置**：分别设置**出单识别功率**（默认 10dBm 小功率）与**盘点扫描功率**（默认 30dBm），支持**边扫边调**——试扫时拖动功率滑杆，通过提示音判断可扫距离
- **多语言**：中文 / English 一键切换

## 编译方式

本地无 Java 环境，代码推送 GitHub 后自动编译：

```bash
git add scanner-app/ plugins/jewelry/
git commit -m "add handheld login + sale checkout"
git push
```

推送后 GitHub Actions 自动构建 APK，在 Actions 页面下载产物：
- `rfid-scanner-debug` — 调试版（可直接安装）
- `rfid-scanner-release` — 发布版

## 项目结构

```
scanner-app/
├── .github/workflows/android-build.yml   # CI 自动编译
├── app/
│   ├── libs/DeviceAPI_ver20220518_release.aar  # C27 RFID SDK
│   └── src/main/
│       ├── java/com/yizhen/rfid/
│       │   ├── LoginActivity.kt     # 扫码登录（当天有效会话）
│       │   ├── HomeActivity.kt      # 主界面（出单/盘点/设置）
│       │   ├── SaleActivity.kt      # 销售出单（WebView + 扫码桥接）
│       │   ├── MainActivity.kt      # 库存盘点页
│       │   ├── SettingsActivity.kt  # 参数设置（双功率 + 试扫）
│       │   ├── AuthApi.kt           # 扫码登录接口客户端
│       │   ├── ApiClient.kt         # 协同盘点接口客户端
│       │   ├── RfidManager.kt       # UHF 模块封装
│       │   └── ...
│       ├── res/layout/               # activity_login/home/sale/settings/main
│       └── AndroidManifest.xml       # 启动页 = LoginActivity
└── demo/                             # 原型参考
```

## 使用流程

### 登录（每天一次）
1. 手机/电脑网页登录懿臻珠宝云
2. PC 端左侧栏底部 / 手机端「我的」页 → 【手持机登录】，显示二维码
3. App 点【扫码登录】扫该二维码（可在 App 里设置设备名称，网页确认时显示）
4. 网页上核对设备名 → 【确认登录】，App 自动进入主界面

### 销售出单
1. 主界面点【销售出单】，进入与服务端手机版一致的出单界面
2. 出单表单中商品识别可选：扫条码 / 扫二维码 / 扫EPC码（EPC 自动使用出单小功率）；也可按机身扳机快捷扫 EPC
3. 功率在【参数设置 → 出单识别功率】调整，可边扫边调听声音定距离

### 库存盘点
1. 在懿臻珠宝云后台「库存管理」→「RFID 手持机批量盘点」开启任务生成二维码
2. 主界面点【库存盘点】，扫码加入任务并下载库存快照
3. 按住机身扫描键批量扫描，数据自动上传比对
4. 主管结束任务后自动停止；盘点功率在【参数设置 → 盘点扫描功率】预先调整
