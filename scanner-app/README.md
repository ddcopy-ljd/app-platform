# RFID 盘点手持机 App（C27）

基于 Chainway C27 UHF RFID 手持终端的库存盘点应用，配合懿臻珠宝云使用。

## 功能

- **UHF RFID 批量扫描**：连续盘点，自动去重，显示扫描次数和时间
- **扫描触发**：支持 C27 机身物理扫描键（按住扫描、松开暂停），也支持屏幕按钮
- **多语言**：中文 / English，右上角一键切换
- **离线缓存**：网络断开时扫描记录自动暂存本机，恢复后自动重传
- **结果展示**：上传后显示相符 / 盘盈 / 盘亏 / 异常统计及明细
- **功率调节**：支持 5-30 dBm 天线功率设置

## 编译方式

本地无 Java 环境，代码推送 GitHub 后自动编译：

```bash
git add scanner-app/
git commit -m "add C27 RFID scanner app"
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
│       │   ├── MainActivity.kt       # WebView 容器
│       │   └── RfidBridge.kt         # RFID SDK 桥接层
│       ├── assets/www/
│       │   ├── index.html            # 盘点界面
│       │   ├── app.js               # 扫描逻辑 + 上传 + 离线队列
│       │   └── i18n.js              # 多语言字典
│       └── AndroidManifest.xml
└── demo/                               # 原型参考
```

## 使用流程

1. 在懿臻珠宝云后台「库存管理」→「RFID 手持机批量盘点」生成二维码
2. 复制接口地址（含密钥），粘贴到 App 的「服务器接口地址」并保存
3. 点击「开始盘点」或按住机身扫描键，开始批量扫描
4. 扫描完成后点击「结束并上传」，系统自动对比库存并返回结果
