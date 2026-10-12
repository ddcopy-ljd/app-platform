---
name: plugin-upgrade-selftest
description: 本仓库应用插件升级流水线自测（取基线、迁移脚本、打包、上传、沙箱票证回归、数据核对）。当用户要求插件升级自测、沙箱试运行、发布新版本插件或回归 TEST_CASES 时使用。不用于正式切换（必须人工操作）。
---

# 应用插件升级自测（本工作区）

依据 [plugins/STRUCTURE.md](../../../plugins/STRUCTURE.md) 第五章执行；本 skill 只补充本仓库实测得到的决策规则与坑位。

## 铁律

- **绝不代操作"试运行通过 / 正式切换 / 设为正式版本"**（pass-trial、switch、set-current）。自测通过后通知人工。
- 不得跳过 release-info 的 verdict 检查；不得覆盖上传同版本号（平台拒绝，必须递增）。
- 迁移脚本不得删除/清空旧数据，必须幂等；结构变更才递增 dataVersion。
- 沙箱测试数据必须清理；临时脚本放在仓库根目录并以 `_` 前缀，结束即删。

## 流程

1. **基线**：`GET /api/agent/plugins/jewelry/release-info?target=x.y.z`，只认响应中的 `current_version/current_data_version`，工作区草稿号不作数；verdict 必须为 ok。
2. **开发与迁移**：在 `plugins/<id>/` 工作区改代码；结构有变更则 dataVersion 递增并更新 `scripts/upgrade.py` 头部与完成打印中的版本语义（TC-07）。
3. **先 commit 再打包**：changes.lst 由 git log 生成，未提交改动会缺项。`python build_package.py` 后核查 zip：根目录直接含 plugin.json、无 build/dist/本地配置（如 print_agent.json）、≤50MB。
4. **上传+轮询**：`POST /api/agent/plugins/<id>/release`（multipart 字段 file）；每 5 秒轮询 `pipeline/<version>` 至 stage=trial/result=success；failed 时读 versions/{id}/log 的 script 行。
5. **沙箱回归**：票证网关（见下），只读面+写入链路+sqlite 直连核对+测试数据清理；逐条回归 `plugins/<id>/TEST_CASES.md`。

## 本仓库关键决策规则

- **单一试运行槽位**：同一插件同时只允许一个 trial/trial_passed 版本；"最后两个版本及正式版"不可删除，标记"试运行通过"也不释放槽位。新版本被挡时只能请人工正式切换当前试运行版本后再 prepare（接口 `POST /versions/{id}/prepare`，body `{"tenants":[]}`）。
- **迁移幂等性 > 一次性闸门**：迁移校正逻辑（如 EPC 规则化）要天然幂等并在每次升级无条件执行；不要依赖"只跑一次"的标志位闸门——旧版本可能在脏数据未清时提前置位，闸门会永久阻断后续修复（见 jewelry TC-10）。
- **包-源码漂移**：沙箱跑的是 `platform/data/packages/<id>/v<x>/` 解包代码，不是工作区。工作区在打包后的任何修复都不会进入当前沙箱，必须递增版本重新打包；验证前用 git status 与打包时间交叉确认。
- **自动生成字段可安全重算**：前提是确认该字段所有写入入口都是系统规则生成（无外部实扫值绑定）。验证手段：grep 全部 `SET <字段>=` 入口。
- **init 顺序陷阱**：SCHEMA→migrate_schema→灌种子。迁移中置位的闸门挡不住种子脏数据；种子/造数脚本必须自身合规。

## 已验证结论（下次回归的实测基线）

- **TC-10 EPC 闸门/规则化（2026-10-06，v1.0.6 周期实测）**
  - 问题基线：开发库 100 件商品 EPC 全部是手持机 24 位实扫 TID，而 `epc_cleaned=1` 已被旧代码提前置位，旧闸门 early-return 使清理永不触发。
  - 修复（取消闸门，每次迁移幂等执行 `assign_rule_epcs`）后全部实测通过：
    - 构造「`epc_cleaned=1` + 100 件脏码」的库跑 migrate_schema → 0 不合规、0 品类错位；再跑一次 EPC 零变化；
    - 已合规的干净库跑 migrate_schema → EPC 零变化（幂等不误伤）；
    - 全新 init 12 件种子全合规；`assign_rule_epcs` 连跑两次第二次返回空映射。
  - 回归判据：现行正则 `^前缀([0-9A-F]{2})(\d{2})([0-9A-F]{bits})$`（YZZ/bits=6 时共 13 位），品类段必须等于 `product_type_code`、全库无重复；100 件存量重排后 inventory_logs 205 行、stocktake_items 170 行、stocktake_scans 39 行同步、残留不一致 0，盘盈未登记标签（product_id IS NULL）保留原实扫值。
- **TC-12 包-源码漂移（2026-10-06 实测）**
  - 漂移事实：v1.0.5 包 22:48 打出后工作区又改了 db.py/main.py/app.js/print_agent.py（多门店打印桥），沙箱实际执行解包旧码，沙箱结论无法覆盖工作区修复；平台禁止同版本覆盖上传，修复只能递增 v1.0.6 重新打包后才进入沙箱验证。
  - 可复用核查动作：沙箱验证前 `git status` 插件目录须无待发布的未提交改动、打包产物时间须晚于最后一次源码修改；必要时解包 zip 与工作区逐文件 diff。注意 `/api/health` 的 version 与流水线版本一致只能证明包版本正确，**不能证明包内容与工作区一致**。

## 沙箱票证访问

1. 平台登录 `POST /api/auth/login`（admin/admin123），后续带 `Authorization: Bearer <token>`（非 cookie）。
2. `POST /api/plugins/<id>/gateway/ticket`，body `{"mode":"SANDBOX","tenant_id":null,"version":"x.y.z"}`。
3. 请求前缀 `http://localhost:8000` + 响应 `url`，**url 自带尾斜杠，拼接 path 前必须 rstrip("/")**；`/gw/ticket//api/...` 双斜杠不命中 API，会被静态 index.html 兜底（返回 200+HTML，极易误判）。
4. Agent 专用接口（release/pipeline/release-info）只认 `X-Agent-Key`；服务启停、票证、版本日志等管理接口只认登录 token，两者不通用。
5. 可直接用辅助脚本：`python .trae/skills/plugin-upgrade-selftest/scripts/sandbox_api.py <plugin_id> <version> GET /api/health`（POST 加 JSON 字符串作为第 4 参数）。

## 用开发库替换沙箱数据（SOP）

必须**停服→覆盖→启动**，服务运行中覆盖会被进程持有的旧连接架空：

1. `POST /versions/{id}/service/stop`（登录 token），sleep 2–3 秒确认端口释放；
2. 复制库文件到 `platform/data/tenant_dbs/<id>/db_<id>_tenant_trial_v<version>.sqlite`（覆盖前可先备份一份）；
3. `POST /versions/{id}/service/start`，sleep 5 秒后先查 pipeline 服务 state=running 再取票证回归；
4. 回归产生日志/痕迹后，重复一次本流程恢复干净库。

## 环境坑（Windows/PowerShell）

- PowerShell 5 不支持 `&&`，用 `;` 或分行；`$LASTEXITCODE` 判断成败。
- 命令行中文 JSON 会编码损坏：写成 UTF-8 文件后 `curl.exe --data-binary "@file.json"`。
- Agent 接口报"Agent 接口未启用"= 平台进程环境缺 `AGENT_API_KEY`（从 platform/app/config.py 或启动窗口确认）；重启平台需带该环境变量，或在用户级设置后重开窗口。
- 平台重启后会自动重新拉起试运行服务（新端口），以 pipeline 响应的 service.port 为准，勿缓存旧票证端口。
- 端口占用排查：`netstat -ano | findstr ":8000 "`；进程身份用 `Get-CimInstance Win32_Process -Filter "ProcessId=..."` 看 CommandLine 与 CreationDate（同名 python 进程很多）。
- 复杂 Python 逻辑写成根目录 `_xxx.py` 临时文件执行（python -c 在 PowerShell 下引号极易出错），用完删除。

## 数据核对

- 必须 sqlite 直连比对，不能只看 API；核对行数、新增列（PRAGMA table_info）、字段格式正则、引用完整性（日志/明细按 product_id 或旧→新映射同步）。
- "0 条"先判断本来没数据还是迁移丢失：比对源版本库（`db_*_v<old>.sqlite`）。
- 正式切换时平台会全量重迁覆盖沙箱库，手工替换的开发库数据不保留，这是预期行为。

## 完成标准

- 流水线 success + 沙箱只读/写入/结构/清理全部有证据通过；
- TEST_CASES 台账新增本轮问题（现象→根因→验证方法）；
- 临时文件清干净，git 工作区只留应提交的代码/文档改动；
- 向人工汇报：版本、dataVersion、沙箱结论、未打包修复（若有）、待执行的正式切换。
