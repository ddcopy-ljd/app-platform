# 软硬协同统一任务引擎 · 实施计划（v1.1.0，本期：引擎 + 盘点迁移）

## Context

用户提出「懿臻珠宝云」软硬协同系统需求（7 项功能需求 + 非功能约束）：把现有「RFID 协同盘点」机制泛化为**统一工作任务引擎**，并补齐设备归属管理、严格盲采、首发抢占终结、离线容灾、H5 双模式。经确认的定案：

1. **开单任务形态**：PC 建单 → 手持机扫货回填 → 发起端收款完结（二期）
2. **盲采**：严格盲采删快照——设备端不存任何库存数据，本店/他店/未知分类全部由服务端判定，设备只回显统计数
3. **完结仲裁**：首发提交即关任务 + 立即解冻 + 事后复盘差异报告；撤销/终止仅限未完结前
4. **节奏**：先把协同盘点重构为统一任务引擎，验证后再接调拨、开单（**本期范围 = 引擎 + 盘点迁移**）

## 现状关键事实（探索结论）

- 后端协同盘点：main.py L2839-3163（task/start 冻结、end、confirm 解冻、abort、co/join|snapshot|scan|pull|finish|task）；设备身份=自报 device 参数+task_key
- 冻结闸 `_assert_stock_unfrozen`（main.py L2852）约 20 处调用（销售/出入库/调拨/采购），数据源 `_active_session`
- db.py：stocktake_sessions/devices/scans（UNIQUE(session_id,epc) 已是任务级去重）；迁移模式 migrate_schema() 幂等 SCHEMA+ALTER（L561-608）；1.0.8 在制改动（库位/经办人/调拨）已在树未提交
- App：**全新独立工程 `scan-assistant/`（包名 com.yizhen.scanassistant，versionName 1.0.0，不改造/不背旧 scanner-app=com.yizhen.rfid 1.x 包袱）**；核心 ApiClient.kt（activate/current/claim/scan/heartbeat/submit 全阻塞 OkHttp）、TaskActivity.kt（严格盲采、内存会话去重、1.2s 分组补传、10s 心跳、409 对账、断电恢复）、ActivateActivity/SettingsActivity；硬件层（RfidManager/TriggerChannels/RotateDecoderFactory/扫码 Capture Activity）从 scanner-app 复制改名，硬件时序零改动；release 复用同一 release.jks。本机无 Android 工具链，编译走 GitHub Actions（workflow 待新增授权）+ 真机验证
- H5：stock.html 已是协同实时视图（co/pull 轮询）；前端无任何摄像头扫码库（需本地打包 zxing，禁 CDN）；plugin.json 1.0.7

## 数据模型（追加 db.py SCHEMA，migrate_schema 幂等执行）

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT UNIQUE, task_key TEXT UNIQUE,
  type TEXT DEFAULT 'stocktake',      -- 本期仅 stocktake
  type_ref INTEGER DEFAULT 0,         -- 关联业务单据（调拨/开单二期用）
  status TEXT DEFAULT '进行中',        -- 进行中|已完成|已撤销|已终止
  initiator TEXT DEFAULT '', store_id INTEGER DEFAULT 0,
  title TEXT DEFAULT '', config TEXT DEFAULT '{}',
  result_id INTEGER DEFAULT 0,        -- 报告 → stocktakes.id
  created TEXT DEFAULT (datetime('now','localtime')),
  ended TEXT DEFAULT '', closed_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS task_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER, device_id INTEGER DEFAULT 0, device_code TEXT DEFAULT '',
  device_no INTEGER DEFAULT 0, name TEXT DEFAULT '', source TEXT DEFAULT 'app',
  last_seen TEXT DEFAULT (datetime('now','localtime')),
  submitted INTEGER DEFAULT 0, submit_at TEXT DEFAULT '',
  UNIQUE(task_id, device_code)
);
CREATE TABLE IF NOT EXISTS task_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER, epc TEXT DEFAULT '', device_code TEXT DEFAULT '',
  device_no INTEGER DEFAULT 0, rssi INTEGER DEFAULT 0,
  source TEXT DEFAULT 'rfid',         -- rfid|camera|manual
  verdict TEXT DEFAULT '',            -- 插入时服务端判定: in_store|other_store|unknown
  scanned_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(task_id, epc)
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER, event TEXT DEFAULT '', actor TEXT DEFAULT '',
  detail TEXT DEFAULT '', created TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                   -- App deviceKey（C27-XXXXXX）
  name TEXT DEFAULT '', bound_store_id INTEGER DEFAULT 0,
  device_token TEXT DEFAULT '',       -- 长期凭证，换绑重发
  status TEXT DEFAULT 'active', last_seen REAL DEFAULT 0,
  current_task_id INTEGER DEFAULT 0, app_version TEXT DEFAULT '',
  created TEXT DEFAULT (datetime('now','localtime')), activated_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS device_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  akey TEXT UNIQUE, store_id INTEGER, name TEXT DEFAULT '',
  created_by TEXT DEFAULT '', created TEXT DEFAULT (datetime('now','localtime')),
  expires REAL DEFAULT 0, used INTEGER DEFAULT 0, used_by TEXT DEFAULT ''
);
```

- 租户定位：新增 `_db_for_tenant_token(token)` / `_db_for_tenant_akey(akey)`，沿用 `_db_for_tenant_key`（main.py L3167）扫库反查模式
- 旧数据：stocktake_sessions 三表只读保留；升级回填 `_migrate_legacy_stocktake_tasks(conn)` 把遗留「进行中/待核对」旧会话一次性置已完成（解冻，防死锁）

## 状态机与冻结

```
进行中 ── 撤销(发起端) ──▶ 已撤销   不生成报告，解冻
       ── 终止(发起端) ──▶ 已终止   扫描数>0 生成部分盘点报告（复用 _run_stocktake），解冻
       ── 提交(任意设备,首发抢占) ──▶ 已完成  生成完整差异报告+解冻
                                  └─ 已非进行中 → 409 冲突提示
```

- 转换全部用条件 UPDATE：`UPDATE tasks SET ... WHERE id=? AND status='进行中'`，rowcount==0 → 409
- `_active_session` 改为查 `tasks WHERE type='stocktake' AND status='进行中'`；**「待核对」中间态删除**；`_assert_stock_unfrozen` 签名不变，约 20 处调用点零改动
- 事后复盘 = 已完成/已终止任务凭 result_id 只读查看 stocktakes+stocktake_items

## 端点设计

**发起端（登录）**
```
POST /api/tasks/start            {type:'stocktake', title?} → 409 已有盘点任务进行中；返回 task_key+join_url
GET  /api/tasks?scope=active|history    GET /api/tasks/{id}（详情：设备/进度/结果）
POST /api/tasks/{id}/cancel      撤销      POST /api/tasks/{id}/terminate 终止
GET  /api/tasks/{id}/report      只读复盘报告
```

**设备端（免登录，Bearer device_token；scan/heartbeat 兼容 ?key=task_key 的 H5 参与）**
```
POST /api/device/activate        {akey,code,name,app_version} → 一次性激活、绑定门店、发 token
POST /api/device/claim           {task_key} → 独占校验(current_task_id)→409；任务已结束→403；登记 task_devices+分配编号+占用
GET  /api/device/current         断电恢复：设备档案+当前任务（指向已关闭任务自动清占用）
POST /api/device/scan            {device?,tags:[{epc,rssi}],source?} → 排重入库+服务端分类 verdict
POST /api/device/heartbeat       → {status,submitted,mine,server_time}（App 10s，取代旧 pollTask）
POST /api/device/submit          首发抢占提交完结 → 报告+解冻；败者 409 明确冲突文案
```

**观察流（H5 协同模式 + PC 复用）**
```
GET /api/task/observe?key=&since_id= → {status, devices, stats{in_store,other_store,unknown,total}, items, max_id}
```

**设备管理（登录）**
```
GET /api/devices   POST /api/devices/activation {store_id,name}→{akey,url,expires_in:900}
GET /api/devices/activations   POST /api/devices/{id}/unbind|disable|enable
```

**兼容策略**：`/api/stocktake/co/*` 直断改 410「协同盘点已升级，请将手持机 App 升级到 2.0」；`/api/stocktake/task/*` 协同端点删除（含 _session_* 辅助、/qr SVG 端点——二维码改前端 qrSvgDataUrl 本地生成）；旧单人盘点 /stocktake/setup|upload 保留不动。

## 盲采改造（R3）

- 服务端插入时判定 verdict：products 无此 EPC→unknown；status∈(在库/已定/借出)→in_store；否则 other_store。scan 响应只含 `{accepted, mine, total, stats{三类计数}, status}`，**不含任何明细**
- 设备 UI（App+H5）：删快照下载/本店·异常页签/高价值横幅/本地比对引擎；保留「已成功上报 N · 本地待上传 M · UHF · 本机编号」；buzz 只按新上报 vs 重复

## 设备激活流程（R1）

管理端选门店+设备名 → 生成 akey（15 分钟一次性）→ 前端画二维码 `http://{lan_ip}:{port}/api/device/activate?key={akey}` → App 扫码 POST activate（code=既有 C27-XXXXXX deviceKey）→ 绑定门店+存 token。跨店重认证：设备端解绑（清 token/门店，保留 code）→ 扫新店激活码重绑；管理端可强制解绑（旧 token 立即失效）。

## 实施任务拆解

**T1 后端引擎**（db.py SCHEMA 新表+回填；main.py tasks 端点+observe；冻结闸切数据源；旧 co/task 端点删除、co/* 改 410）
验证：遗留进行中旧库升级后冻结解除；curl 矩阵 start→销售 409→cancel→销售成功；start→scan→submit→report 只读；submit 二连发第二个 409；terminate 空扫描不生成报告。

**T2 设备档案与激活**（devices/device_activations + 管理端点 + activate/claim/current/heartbeat/submit）
验证：curl 生成激活码→activate→claim 独占 409→current 断电恢复→unbind 后旧 token 403。

**T3 PC 端 UI**（index.html 库存页 count 子页任务卡片泛化：任务号/状态/发起人/设备在线表[60s 离线置灰]/三类统计/二维码；撤销[红]/终止[橙二次确认]/复盘报告按钮；历史任务列表与旧单人盘点批次共存；设备管理 modal[列表/生成激活码/解绑/停用]；app.js 新增 startTask/loadActiveTask/loadTasks/cancelTask/terminateTask/openTaskReport/loadDevices/genActivation/unbindDevice，删 confirmCoTask/loadCoQr，loadCoTask→loadActiveTask 保留 L508 轮询入口；全局冻结横幅数据源切换）
验证：浏览器全流程发起→出码→撤销/终止/复盘；三语切换完整。

**T4 手持机 App 2.0**（versionCode 20 / versionName 2.0.0，x 位重构语义；release.jks 不变）
- ApiClient.kt：parse 改 {origin,token}；方法 activate/claim/current/scan/heartbeat/submit，删 join/snapshot/pull/finish/task；qrKind 增 QR_ACTIVATE/QR_TASK/QR_LEGACY 拒绝；Bearer 头，401/403→重新激活引导
- Prefs.kt：新增 apiOrigin/deviceToken/storeId/storeName/currentTaskJson/queueJson（queue 升级为 [{epc,rssi,source,ts}]，兼容迁移）
- StockActivity.kt：删快照链路；doJoin→doClaim（409 独占弹窗）；新增提交完结按钮（本地 queue>0 禁用提示防漏报 R5；409 冲突 AlertDialog→leaveTask）；pullOthers 删除、pollTask 并入 heartbeat(10s)；断电恢复 onCreate→api.current()→恢复任务态+队列立即 flush；上报 409 沿用 taskClosed 清态
- activity_main.xml：删页签/快照行/高值横幅，加「已上报 N·待传 M」+「提交完结」按钮
- SettingsActivity：设备激活/重新认证入口、绑定门店展示、设备码/版本
- strings.xml 三语约 25 键，字号≥14sp
真机验证：激活→领任务→UHF/摄像头扫描→计数→提交完结→第二把枪 409→杀进程重启恢复→断网积压→拦截提交→恢复补传。

**T5 H5 双模式**（新建 frontend/task.html，stock.html 改 meta 跳转）
- 自主模式：本地打包 `frontend/vendor/zxing.min.js`（禁 CDN）；BarcodeDetector 仅增强（LAN http 非 secure context 不可依赖）；App WebView 内仍 YzApp.scan() 桥优先
- 协同模式：轮询 observe 渲染设备在线表+分类统计+明细流（观察端可见明细）
- 自主扫码：zxing 连续取景 → EPC 进 PENDING → 1.2s flush POST device/scan?key=&device={uuid}（uuid 存 localStorage）→ 仅显示上报/待传计数
- 拒绝旧 /co/join 任务码（存量旧码流通）
验证：手机浏览器协同实时流；自主模式连续扫码上报；旧码拦截提示。

**T6 三语 + 回归 + 打包**
i18n.js 三语约 60 新键；回归：_assert_stock_unfrozen 调用链抽样（销售 L3207、出入库 L1757/1783、调拨 L1837/1941）、旧单人盘点 /upload、历史盘点批次明细、no-cache；TEST_CASES.md 补录；plugin.json 1.1.0 打包。

**同步清理**：main.py 删 _session_* 与 /qr；index.html 任务卡片文案「协同盘点」→「盘点任务」；app.js 删 confirmCoTask/loadCoQr；i18n 删「待核对」相关键。

## 版本

- plugin.json softwareVersion/dataVersion → **1.1.0**（1.0.8 在制改动[库位/经办人/调拨/开单日期]随包一并发布，不再单独出 1.0.8；原 spec 的 Task8 走查收尾/TEST_CASES 仍需完成）
- App versionCode 20 / versionName 2.0.0

## 主要风险

1. **冻结语义切换**最高风险：`_active_session` 换数据源 + 升级回填关闭遗留旧任务，两步缺一即永久冻结；回归覆盖全部冻结调用链
2. **旧 App 1.x 直断**：410 明确提示升级，现场需升级指引；不做双格式兼容（旧 App 拉快照违反盲采定案）
3. **首发抢占竞态**：submit/cancel/terminate 并发全走条件 UPDATE（SQLite 单写者）；回归「提交瞬间终止」不出双报告
4. H5 必须显式拒 /co/join 旧码；设备 last_seen 只信设备上报帧（沿用心跳惯例）
