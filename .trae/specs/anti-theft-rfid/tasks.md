# 防盗 RFID 传感器接入与安防功能 - 实施计划（简化版）

## 总体结构

- **一个新文件**：`plugins/jewelry/sensors.py`（驱动基类/注册表、4 驱动、统一判定、设置与通知辅助）
- **main.py**：仅增加薄路由，直接调用 sensors.py 函数
- **3 张表 + 1 行设置**：
  - `sensors`：id, name, store_id, location, driver_code, auth_key, enabled, last_seen, created
  - `sensor_events`：id, sensor_id, event_type(alarm/pass/info), severity, epcs(JSON), raw(JSON), event_ts, handle_status(未处理/已确认/误报), handler, handle_note, handled_at
  - `sensor_pass`：id, epc, reason, expires_at, created_by, created
  - `sensor_settings`：单行（id=1, data JSON）：`{armed:false, arm_time:"21:00", disarm_time:"10:00", webhook_url:"", webhook_secret:"", dedup_sec:60, webhook_last:""}`

## Task 1: 数据层与迁移
- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - db.py SCHEMA 新增 4 张表（sensors / sensor_events / sensor_pass / sensor_settings）；
  - sensor_settings 幂等插入默认行；sensor_pass.epc 建索引；
  - 同步 upgrade.py 头部 dataVersion 说明；plugin.json 更新 softwareVersion/dataVersion = 1.0.7（最终以 release-info verdict 为准）。
- **Acceptance Criteria Addressed**: AC-1
- **Completion Evidence**: `init.py` 建库含 4 表与默认行；`upgrade.py` 从 1.0.5 重复执行幂等无报错；sqlite3 旧表行数不变。

## Task 2: 驱动抽象、内置驱动与核心处理函数
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - sensors.py 定义 Report（dataclass：kind/epcs/alarm/ts）、SensorDriver 基类（code/name/reports_epc/parse）、DRIVERS 注册表与 @register；
  - 4 个内置驱动类：uhf_rfid_gate（epcs 字段，兼容 epc 单数）、eas_gate（alarm 布尔）、contact_sensor（state=alarm 触发）、simulator（透传 Report 字段）；
  - `handle(conn, sensor, raw)`：驱动 parse → 逐 Report 判定（布防状态读取、EPC 商品状态查询「已售/借出」、sensor_pass 未过期记录、signal 告警、撤防 info、dedup 抑制）→ 落 sensor_events → 告警时触发通知（界面推送 + webhook）。
- **Acceptance Criteria Addressed**: AC-4, AC-5, AC-6, AC-7, AC-8, AC-12
- **Completion Evidence**: `test_sensors.py` 9 项核心判定自测 ALL PASS；新增驱动仅需 `class + @register`，handle/路由零改动。

## Task 3: 设备接入通道与管理接口
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 鉴权辅助：按 auth_key 查设备（常量时间比较），失败 401；禁用 403；
  - POST /api/sensors/ingest（X-Sensor-Key，兼容 query key）：刷新 last_seen → handle；
  - WS /ws/sensor?key=：鉴权；接收帧中 heartbeat 仅刷新 last_seen，其余同 ingest；
  - 设备管理：GET /api/sensors（含在线判定 last_seen<15s，has_key 布尔不回显）、POST（返回一次性 key + HTTP/WS 接入地址）、PUT、DELETE、POST /{id}/rotate-key；driver_code/store_id 合法性校验；全部写 operate_logs；
  - POST /api/sensors/{id}/simulate：仅 simulator 驱动可用。
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Completion Evidence**: E2E AC-2 6 条全通过；AC-3 WS 在线→15秒离线正确；源码无他处更新 last_seen。

## Task 4: 设置、布防调度与通知
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - GET/PUT /api/sensors/settings：armed、arm_time/disarm_time、webhook_url/secret、dedup_sec；secret 不回显（空串判定）；
  - 手动布撤防经 settings 更新（source=manual），写日志与事件；
  - startup 启动分钟级 asyncio 定时任务：到点切换 armed（source=schedule）；启动先校正；
  - 通知：WS /ws/security（业务 Token 鉴权）连接集合，告警广播；webhook 异步 POST + HMAC-SHA256（X-Security-Signature）、3 次重试、结果写 settings.webhook_last；SANDBOX 模式不外发只记 mock；
  - 事件接口：GET /api/sensors/events（状态筛选）、POST /api/sensors/events/{id}/handle（确认/误报+备注）；
  - 手工放行：GET/POST /api/sensors/pass、DELETE /api/sensors/pass/{id}；写日志。
- **Acceptance Criteria Addressed**: AC-9, AC-10, AC-11
- **Completion Evidence**: AC-9 定时自动布防通过；AC-10 NORMAL 外发+HMAC 正确、SANDBOX 拦截正确；AC-11 处置字段完整+审计日志覆盖。

## Task 5: 前端「安防中心」
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**:
  - NAV_ITEMS + 移动端 tab 增加 security（🛡️）；
  - index.html：顶部状态条（布防开关/在线/未处理）、事件流（行内确认/误报、红色高亮）、设备面板（新增向导显示一次性 key 与接入地址、轮换/删除）、临时放行面板、设置面板（时间/webhook/抑制秒数）；
  - app.js：数据加载、/ws/security 实时推送与断线重连、红色告警模态 + Web Audio 提示音（静音/确认）、未处理红点；
  - app.css：PC 多列、移动单列，字号 ≥14px；
  - i18n.js：zh 新键先行并同步补 en/it。
- **Acceptance Criteria Addressed**: AC-13
- **Completion Evidence**: 浏览器走查确认「五区布局完整、告警弹窗红色醒目、确认/静音可用、事件流状态更新正确、字号目测 ≥14px、i18n 无键名残留」。

## Task 6: E2E 自测与回归
- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - E2E 脚本串联 AC-1~AC-11 全部 rule 项（HTTP/WS 调用 + sqlite 核对 + 本地 webhook 接收）；
  - 执行 TEST_CASES.md 历史回归并增补本次用例；清理测试数据；输出自测报告；
  - 不代为正式切换，发布由人工决定。
- **Acceptance Criteria Addressed**: AC-1 ~ AC-11
- **Completion Evidence**: `test_sec_e2e.py` 30/30 PASS（含 AC-1~AC-11 全部 rule）；测试数据已清理。
