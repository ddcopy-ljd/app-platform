# 防盗 RFID 传感器接入与安防功能 - 产品需求文档（简化版）

## Overview
- **Summary**: 为懿臻珠宝云新增「智能安防」能力：通过一个抽象驱动层纳管门店出口的防盗装备（UHF RFID 通道门、EAS 门禁、开关量传感器等），设备上报经统一判定后产生告警，并以界面弹窗声响和 Webhook 通知。全部后端逻辑集中在**一个新文件 `sensors.py`**，数据层仅 **3 张表 + 1 行设置**。
- **Purpose**: 防止珠宝商品未授权离店；用最小但可扩展的抽象屏蔽不同装备的报文差异。
- **Target Users**: 店长/店主（配置设备、布撤防、处置告警、临时放行）、门店员工（接收告警）。

## 设计原则：如何简化
- **离店放行不建授权表、不加业务钩子**：商品状态已是事实来源——EPC 对应商品状态为「已售」「借出」即自动放行；销售冲红、借货归还后状态自动回到「在库」，放行资格自动消失，零额外逻辑；
- **后端单文件**：`sensors.py` 内含驱动基类、注册表、4 个驱动、判定与通知；main.py 只加薄路由；
- **数据层 3+1**：`sensors`、`sensor_events`、`sensor_pass`（仅手工临时放行）三张表 + `sensor_settings` 单行 JSON 设置（布防状态、每日布撤防时间、webhook、抑制秒数）；
- **每日一个布防/撤防时刻**（不按星期分别配置）；**Webhook 只配一个目标**；
- 设备双接入保留（HTTP Webhook + WebSocket），但两者共用同一个处理函数；设备 WS 只做上报，无下行指令/远程配置（配置在界面编辑存储即可）。

## Goals
- 驱动注册表 + 统一事件模型：新增设备类型只需加一个驱动类并注册，判定与通知逻辑零改动；
- HTTP 与 WebSocket 两种设备接入，同一处理管线；
- 布防中未授权离店 → 告警 + 界面实时弹窗/声响 + Webhook 外发；
- 手动布防/撤防 + 每日定时自动切换；
- 事件留痕、确认/误报处置；
- 无硬件时可用内置 simulator 驱动完成演示与自测。

## Non-Goals
- MQTT、TCP/串口代理、远程下行指令/配置下发、OTA；
- 邮件/短信通知、多 Webhook 目标、按星期差异化布防计划；
- Android 手持机 App 适配、视频监控集成、跨门店总部大屏；
- 防拆(tamper)、通行方向等高级事件语义（原始报文中有则随 raw 留存，本期不判定）。

## Background & Context
- 代码库现无任何安防相关功能，属全新模块；
- 可复用：打印桥 WS 的「密钥鉴权 + heartbeat + last_seen 在线判定」模式；在线状态**只信设备上报帧**，服务端不得自刷；建表必须在 db.py SCHEMA 声明并经 init/upgrade 执行；i18n「zh 键先行」；字号 ≥14px；
- 用户已确认：接入 HTTP + WebSocket、功能四项保留但要求整体简化、通知为界面弹窗+Webhook、4 个内置驱动全保留。

## Functional Requirements

### FR-1 设备管理
- 注册字段：名称、所属门店、安装位置、驱动编码、启用状态；创建时自动生成每设备独立密钥（`secrets`），仅创建/轮换时一次性返回，接口不回显；
- 支持密钥轮换（旧密钥立即失效）、设备启停用、删除；全部写 operate_logs。

### FR-2 驱动抽象
- `SensorDriver` 基类：`driver_code`、`name`、`reports_epc`（能力布尔）、`parse(raw: dict) -> list[Report]`；
- `Report` 为统一内部结构：kind（`epc` / `signal` / `ping`）、epcs[]、alarm（布尔，供 EAS/开关量类）、ts；
- 注册表（dict + register 装饰器），枚举/按 code 查询；
- 内置驱动（每个仅做报文→Report 的转换，约十余行）：
  - `uhf_rfid_gate`：`{epcs:[...], ts}` → epc 上报；
  - `eas_gate`：`{alarm:true/false, ts}` → signal；
  - `contact_sensor`：`{state:"alarm"/"normal"/...}` → signal；
  - `simulator`：直接接受系统构造的 Report JSON。

### FR-3 设备接入
- HTTP：`POST /api/sensors/ingest`，`X-Sensor-Key` 头（兼容 `?key=`）；禁用设备 403；
- WebSocket：`/ws/sensor?key=`，鉴权后接收 JSON 帧（普通上报帧 + `{"type":"heartbeat"}`）；
- 两通道刷新 last_seen 后调用同一个 `sensors.handle(...)`，处理结果一致。

### FR-4 统一判定（四条规则）
1. **布防 + EPC 上报**：逐 EPC 查询商品——商品状态为「已售」「借出」或存在未过期的手工放行记录 → 放行；否则为未授权。存在任何未授权 EPC 即产生 `alarm/critical`（含商品货号/名称）；全部放行则产生 `info` 通行记录；
2. **布防 + signal**（EAS/开关量）：alarm=true → `alarm/critical`；
3. **撤防中**：所有上报只记 `info`，不产生告警；
4. **重复抑制**：同一传感器 + 同一 EPC（signal 类按分钟）在 `dedup_sec`（默认 60 秒）内已有告警的，跳过不再产生。

### FR-5 布防/撤防
- 设置中保存 armed 状态与每日 arm_time/disarm_time（HH:MM）；
- 手动切换立即生效并写日志；
- 一个分钟级后台任务：到点自动切换；服务启动时先按当前时间校正状态。

### FR-6 手工临时放行
- `sensor_pass`：epc、原因、过期时间、创建人；创建/删除写日志；
- 仅作为商品状态之外的补充（委外、展览、临时拿出等场景），过期自动失效。

### FR-7 通知
- 界面通道：`/ws/security`（业务登录态鉴权）——告警时向所有已打开的工作区推送，前端弹红色模态 + 提示音，可确认/静音；
- Webhook 通道：设置中单个 url + secret；异步 POST 告警 JSON，带 HMAC-SHA256 签名头，失败最多重试 3 次，记录最后结果；SANDBOX 模式下不真实外发、只记 mock。

### FR-8 事件与处置
- 事件全部落 `sensor_events`（epcs、原始报文、时间、级别）；
- 支持按状态查询；告警可「确认」或「标误报」，记录处理人、备注、时间。

### FR-9 前端「安防中心」
- 导航新增一个页签，单页紧凑排布：
  1. 顶部状态条：布防状态 + 布防/撤防开关、设备在线数、未处理告警数；
  2. 事件流（默认展开）：时间倒序、告警红色高亮、行内确认/误报；
  3. 设备、临时放行、布防时间/Webhook 设置：三个折叠面板；
  4. 新增设备时展示一次性密钥与两条接入地址；
- PC 与移动端均可用，新增字号 ≥14px；i18n zh 先行，en/it 补齐。

## Non-Functional Requirements
- **NFR-1** 新增驱动 = 新增一个类 + register，一行接入，不动判定/路由；
- **NFR-2** 通知异步，ingest 响应不被 webhook 拖慢；单事件处理 < 100ms；
- **NFR-3** 密钥不回显、不入日志；
- **NFR-4** 设备/布撤防/手工放行/处置均写 operate_logs；
- **NFR-5** 新表经 SCHEMA + init/upgrade 创建，禁止运行时建表；版本号递增（目标 1.0.7，以 release-info verdict 为准），有新表 dataVersion 同步递增。

## Constraints
- FastAPI + SQLite、8002 端口、网关（含 WS 透传）；无新增第三方依赖。

## Assumptions
- 设备/网关能发 JSON HTTP 或 WS 请求；设备时钟可能不准，ts 缺失用服务端时间。

## Acceptance Criteria

### AC-1: 数据迁移安全
- **Type**: `rule`
- **Given**: 一份 dataVersion 1.0.5 租户库副本；
- **When**: 执行 upgrade.py 迁移，重复执行一次，并在新库写入设备/事件数据；
- **Then**: sensors/sensor_events/sensor_pass/sensor_settings 均存在；旧表行数不变；重复执行不报错；新链路可读写；
- **Pass Condition**: 表结构、旧数据行数、幂等、新读写四项通过；
- **Evidence**: sqlite3 对比与脚本输出。

### AC-2: 设备注册、密钥与鉴权
- **Type**: `rule`
- **When**: 注册设备 → 正确密钥 ingest → 错误密钥 ingest → 轮换后旧密钥 ingest；
- **Then**: 密钥仅注册/轮换时返回一次，列表不回显；结果依次为 200、401、401；禁用设备 403；
- **Pass Condition**: 响应码序列全部符合；
- **Evidence**: 接口记录与响应。

### AC-3: 设备在线状态
- **Type**: `rule`
- **When**: WS 设备正常上报时查询；静默超 15 秒后查询；
- **Then**: 先在线后离线；last_seen 只在接收处理中更新；
- **Pass Condition**: 状态转换正确且无服务端自刷路径；
- **Evidence**: 状态接口输出 + 源码检查。

### AC-4: 未授权告警全链路
- **Type**: `rule`
- **Given**: 布防中，一件在库商品 EPC；
- **When**: 经 HTTP 与 WS 各上报一次（不同 EPC），订阅 /ws/security；
- **Then**: 两条 alarm/critical 事件（含商品信息）；安全 WS 收到推送；前端弹红色模态+提示音；未处理计数 +2；
- **Pass Condition**: 事件、推送、弹窗、计数均可观察；
- **Evidence**: 事件行、WS 帧、浏览器截图。

### AC-5: 商品状态自动放行
- **Type**: `rule`
- **When**: 将商品销售（状态=已售）后上报其 EPC；冲红（状态回在库）后再上报；借货中商品上报；
- **Then**: 已售/借出时仅 info 通行记录、无告警；冲红后再通过产生告警；
- **Pass Condition**: 放行/告警随商品状态自动切换，且全程无任何手工授权操作；
- **Evidence**: 事件记录与商品状态时序。

### AC-6: 手工临时放行与过期
- **Type**: `rule`
- **When**: 为在库 EPC 创建 1 分钟有效的手工放行并上报；等待过期后再上报；
- **Then**: 第一次无告警（info）；过期后产生告警；
- **Pass Condition**: 放行与过期结果正确；
- **Evidence**: sensor_pass 与事件记录。

### AC-7: EAS 门告警与撤防静默
- **Type**: `rule`
- **When**: 布防中 eas_gate 上报 alarm=true；撤防后再次上报；
- **Then**: 先产生无 EPC 告警；后撤防只记 info；
- **Pass Condition**: 两次结果分别为 critical/info；
- **Evidence**: 事件记录。

### AC-8: 重复抑制
- **Type**: `rule`
- **When**: 60 秒内同一传感器同一未授权 EPC 连续上报两次；窗口过后再报；
- **Then**: 共 2 条告警（窗口内仅 1 条）；
- **Pass Condition**: 条数为 2；
- **Evidence**: 事件计数。

### AC-9: 手动与每日定时布撤防
- **Type**: `rule`
- **When**: 手动切换；配置最近的 arm/disarm 时刻等待到点；重启服务后查询；
- **Then**: 手动立即生效且写日志；定时自动切换；重启后状态与当前时间应处状态一致；
- **Pass Condition**: 三种情况状态正确；
- **Evidence**: 状态时序与日志。

### AC-10: Webhook 外发与沙箱拦截
- **Type**: `rule`
- **When**: NORMAL 下产生告警；SANDBOX 下产生告警；
- **Then**: 本地接收服务器 NORMAL 时收到 POST 且 HMAC 签名正确；SANDBOX 无真实外发；
- **Pass Condition**: 外发/拦截均符合；
- **Evidence**: 接收服务器日志。

### AC-11: 事件处置与审计
- **Type**: `rule`
- **When**: 确认一条告警（带备注）、标另一条为误报；查询 operate_logs；
- **Then**: 处置状态/人/时间完整；设备创建、密钥轮换、布撤防、手工放行均有审计日志；
- **Pass Condition**: 处置字段完整且审计无缺项；
- **Evidence**: 事件行与日志查询。

### AC-12: 扩展友好性
- **Type**: `rubric`
- **Dimension**: 新增一类设备驱动的改动隔离度
- **Scale**: 1-5
- **Anchors**: 1 = 需改判定逻辑或多处路由；3 = 加驱动类但仍需小改注册/判定；5 = 仅加一个类并装饰器注册，其他零改动；
- **Pass Threshold**: >= 4
- **Evidence**: sensors.py 结构评审与一次试扩展。

### AC-13: 界面质量
- **Type**: `rubric`
- **Dimension**: PC/移动端可用性
- **Scale**: 1-5
- **Anchors**: 1 = 关键流程缺失或单端不可用；3 = 双端可用但粗糙、有 <14px 字号；5 = 状态/事件/设备/放行/设置流程完整、告警醒目、双端布局合理；
- **Pass Threshold**: >= 4
- **Evidence**: 双视口截图走查。

## Open Questions
- [ ] 每日布防/撤防时刻的默认值（建议 10:00 / 21:00）；
- [ ] en/it 文案是否随本次一并补齐（默认按 zh 先行、发布前补 en）。
