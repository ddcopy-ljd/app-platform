# platform/AGENTS.md — 平台与 scan-assistant 开发要求

> 本文件是**平台核心**（`platform/`）与**安卓辅助 App**（`scan-assistant/`）的强制开发要求。
> 跨模块通用规则、架构红线、密钥安全总则以根目录《AGENTS.md》为准。冲突时：根目录 AGENTS.md > 本文件。

---

## 1. Android 原生 App 规范（scan-assistant）

1. **必须 Kotlin 原生实现，禁止 WebView/H5**；App 设置页分组、条目按既定结构维护。
2. 必须签名 APK（CI release 使用固定 release.jks，保证可直接覆盖升级；不同签名无法覆盖安装）。
3. 版本语义：`重构.功能.修订.日期（短日期 YYMMDD）`——修 BUG 只进 z 位（1.3.9 → 1.3.10，不是 1.4.0），以及修订的日期（短日期 YYMMDD）。
4. 物理扳机、功能键广播、屏幕按钮三个触发通道共用同一套状态机，避免重复触发；
   C27 扳机不产生按键事件，需监听 `android.rfid.FUN_KEY` 广播并处理 down+false 双拍；
   C72 的 `startInventoryTag()` 首次可能假失败，需连续重试最多 3 次、间隔 200ms。
5. 同一会话扫描数据按 `UNIQUE(session_id, epc)` 全局去重；实时显示新增/重复计数。
6. **盘存中禁止强杀 App/拔电池**（UHF 模块会锁死，只能整机重启）——代码与提示都要规避。

---

## 2. scan-assistant 高频踩坑速查（违反过且造成过实际事故）

- 设备与电脑同网段（都是 192.168.1.x）但手持机浏览器打不开、App fail to connect，电脑端 netstat 抓不到任何外部连接 → 光猫/路由器开了 **AP 隔离/用户隔离（或外网防火墙）**，二层直接阻断无线互访，设备 ping 电脑报 `Destination Host Unreachable`；进路由后台关 AP 隔离/防火墙。诊断用 USB+开发者模式：`adb shell ping <电脑IP>`，同网段却 Host Unreachable 即可确诊；应急联调可 `adb reverse tcp:8002 tcp:8002` 走 USB 线（App 服务器地址填 `http://127.0.0.1:8002`，但用期间不能拔线）。
- Windows 用户名含中文（俊达）时 Kotlin daemon 把 classpath 转义成 `C:\Users\u4FCAu8FBE\…` → 本地 `compileReleaseKotlin` 报一堆 jar 找不到；工程 gradle.properties 必须设 `kotlin.compiler.execution.strategy=in-process`。本机已有完整工具链（JDK17 Temurin、SDK `C:\Android` 含 build-tools 34/android-34、Gradle 8.2），本地构建前设 `ANDROID_HOME=C:\Android`，不必默认走 CI。
