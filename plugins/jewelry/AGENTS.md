# AGENTS.md

面向 AI 编码代理的工作指南。在本插件内执行任何修改前请先阅读本文件。文件树与模块职责见 [STRUCTURE.md](STRUCTURE.md)，此处只写规则与坑。

## 项目概述

懿臻珠宝云（jewelry）：综合业务应用服务平台的业务插件——FastAPI 单体后端（`main.py`）+ SQLite 租户库（`db.py`）+ 无构建链 Vue3 前端（`frontend/`）。覆盖商品/库存/销售/借货/维修/采购/RFID 盘点/标签打印/安防等。

- 平台模式：由平台注入 `TENANT_DB_DIR`，网关以 `X-Resolved-Tenant-ID` 头标识租户，每租户独立库 `db_jewelry_{tenant}_v1.0.0.sqlite`；业务路径带网关前缀 `/app/jewelry/{tenant}`
- 独立模式（STANDALONE）：本地 `python main.py` 直接跑，默认端口 8002，库在 `dev_data/`，租户头缺失时回退 `tenant_trial`
- 打印：云端按模板排版（`rfid_print.py`）→ 生成 ZMIN 统一指令 `rfid_cmd` → 门店打印助手翻译为 PCLE 经 USB 出纸（RFID 写芯）；**ZPL 已全链路移除**，助手侧规范见 [agents/print/AGENTS.md](agents/print/AGENTS.md)

## 硬性约束（不要违反）

1. **租户隔离**：任何 SQL/文件操作必须经由 `db.connect(tenant)` 取连接，禁止跨租户读写、禁止在代码里硬编码租户号或内网 IP。手持机激活码/下载地址一律用浏览器当前主机相对地址拼接。
2. **EPC 与品类绑定**：EPC = 数字前缀(8,配置) + 门店码(4) + 品类码(2) + 序号(6)，共 20 位纯数字；印刷条码同构 12 位（`_gen_type_epc` / `_compute_item_barcode`）。品类必选才能生成 EPC（400）；已生成 EPC 的商品**品类锁定**（400，需重新建档）；EPC 修改仅限「在库」状态且全库唯一（409）。改动这些规则前先与用户确认。
3. **盘点冻结**：库存写入类接口必须过 `_assert_stock_unfrozen`，冻结期禁止改库存状态/EPC 补发，不要绕过。
4. **标签模板化**：打印一律按 `label_templates` + 品类绑定（`product_types.label_template_id`）排版；无绑定才回退默认布局。画布固定 528×203 点（66×25.4mm @203dpi）。内建模板种子在 `db.py _ensure_builtin_label_templates`（按名字幂等），改内置模板坐标必须同步升 `_BUILTIN_VER`，否则老库不更新。
5. **前端缓存**：缓存由伺服层统一保证——`main.py` 静态资源路由（`/`、`spa_asset`、`mobile_asset`、`/logo/`）统一走 `_no_cache_file()`：`Cache-Control: no-cache` + 自算 ETag（mtime+size）+ `If-None-Match` 304 协商；`/site` 动态页补 no-cache 头。**改任何前端文件（含图片/字体/manifest）保存后普通刷新即生效，`?v=` 版本串手工升级不再是必需步骤**（历史 `?v=` 字符串保留不清理）。注意：Starlette `FileResponse` 自带 ETag 但不处理 If-None-Match，条件请求由 `_no_cache_file` 自己协商，新加资源路由必须复用该函数。
6. **助手下载接口**：已在平台 `_MACHINE_PATHS` 白名单，免登录且与租户无关；`downloads/` 不进打包清单，**发布升级包后会被重置为空**，需提醒用户经运维端重新上传扫描助手 APK / 打印助手 EXE。
7. **运维端访问**：`ops_api.py` 只能经平台「生产运维穿透模式」票据进入，普通业务路径访问返回 403——这是平台行为，不要在插件内"修复"。
8. **打印相关改动先读权威参考程序**：凡是涉及标签打印 / PCLE 指令 / RFID 写芯的新代码或调试脚本（`rfid_print.py`、`agents/print/`、临时验证脚本一律适用），动笔前必须先读 `C:\Users\俊达\Desktop\RFID打印机\NetProxyTest\` 下真机验收过的程序：
   - `BtPrintTest\README.md`：X19D 实测 **203dpi（1mm=8dots）**、标签 66×25.4mm=**528×203 dots**、间隙 40 dots、PCLE 以 `\r` 结尾
   - `JewelryLabel\Program.cs` / `QuickTest.cs` / `Diagnose.cs`：10-18 真机验收的 PCLE 打印序列（`N / q528 / Q203,40 / T / S / W1`）
   - `ZMIN_RFID\SDK\.Net Framework\C#\LabelPrinter_Dll_1.27_Demo\Form1.cs`：官方 SDK 结构化打印的单位约定（宽高/坐标为 **mm**）与调用姿势（`printerdpi` 须与实际一致）
   - `LabelSimulator\`、`net_feed_test.py`、`ws_store_test.py`：仿真与链路测试参考
   该目录与本文档或代码注释冲突时，**以该目录的实测程序为准**，并回头修正文档。

## 代码约定

- 后端单体：API 全在 `main.py`（按业务分段），建表/种子在 `db.py`，**老库兼容靠 `migrate_schema` 幂等补列**——新增列必须走迁移，不能只改 CREATE TABLE。
- 打印结果统一 `(bool success, str message)`；错误信息面向最终用户，可直接弹窗展示。
- 前端无构建链：`index.html`（单页+模板）+ `app.js`（逻辑）+ `app.css` + `i18n.js`（`t(key, params)`，`{n}` 插值，中文单字典）。Vue 全局构建在 `vendor/vue.global.prod.js`，不要引入 npm/打包工具。
- 版本号：`plugin.json` 的 `softwareVersion` 用四段式（如 `1.2.47.261018`，末段=日期），`dataVersion` 独立演进；发版同步 `CHANGELOG.md`。
- 打包：`python build_package.py` → `dist/jewelry_v{版本}.zip`（版本取自 plugin.json；排除 `__pycache__/build/dist/downloads`）。

## 常见任务指引

| 需求 | 入口 |
|---|---|
| 新增/修改 API | [main.py](main.py)（先搜同类路由照抄鉴权/租户写法） |
| 表结构变更 | [db.py](db.py) 建表 + `migrate_schema` 补列 |
| EPC/条码规则 | [main.py](main.py) `_gen_type_epc` / `_compute_item_barcode` |
| 标签模板/排版 | [rfid_print.py](rfid_print.py) `build_zmin_content` / `content_to_commands` + slots；模板种子见 `db.py` |
| 芯片写芯/回读换算 | [rfid_print.py](rfid_print.py) `chip_epc_hex` / `decode_chip_epc`（BCD，E28 前缀） |
| 前端页面/交互 | [frontend/index.html](frontend/index.html) + [app.js](frontend/app.js) |
| 界面文案 | [i18n.js](frontend/i18n.js)（`t()` 单字典） |
| 运维端接口 | [ops_api.py](ops_api.py) |
| 安防/传感接入 | [sensors.py](sensors.py) |
| 演示数据 | `_seed_demo_data.py` |

## 测试与验证

- 本地验证：`python main.py` → `http://127.0.0.1:8002`（STANDALONE）。改前端后**先确认版本串已升**再验证。
- 打印相关改动必须真机验证（ZMIN X19D / DL-735RE）；RFID 写芯的坑与铁律见 [agents/print/AGENTS.md](agents/print/AGENTS.md)「X19D 实测铁律」——写芯成功与否**只能手持机 UHF 扫描确认**，天线位回读不可信。
- 盘点冻结期间写接口会 400/拒绝，属预期行为，验证业务流前先解冻。
- 完整回归用例见 [TEST_CASES.md](TEST_CASES.md)。
