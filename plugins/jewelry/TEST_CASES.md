# 懿臻珠宝云 - 测试用例台账

> 每次升级自测时逐条回归执行，确认旧问题未复发。
> 记录格式：问题现象 → 根因 → 验证方法。
> 新问题随时追加；已彻底修复且不可能复发的标记「已归档」，不删除。

---

## TC-01 EPC 门店码格式迁移（旧格式兼容）

- **问题现象**：v1.0.5 将 EPC 格式从「前缀+品类码+序号」升级为「前缀+门店码+品类码+序号」，历史数据中存在旧格式与脏 EPC（随机十六进制串、尾部混入货号、品类码错位）。
- **根因**：`_migrate_clean_dirty_epc` 需同时识别两种格式，旧格式按「门店+品类」重新分配续号。
- **验证方法**：准备含旧格式 EPC 的租户库 → 执行迁移 → 校验所有 EPC 匹配现行正则（前缀+2位门店hex+2位品类码+序号位）且品类码与商品 `product_type_code` 一致、无重复、序号不冲突。

## TC-02 biz_config.bridge_key 列幂等补全

- **问题现象**：v1.0.5 新增 `bridge_key` 列；旧库迁移和全新初始化都依赖此列存在。
- **根因**：`migrate_schema` 的 ADD COLUMN 清单与 SCHEMA 建表语句必须同步维护。
- **验证方法**：迁移后库与全新 init 的库分别执行 `SELECT bridge_key FROM biz_config WHERE id=1` 均可成功；重复执行 upgrade.py 不报错（幂等）。

## TC-03 打包排除构建产物与本地配置

- **问题现象**：`build_package.py` 白名单收录整个 `scripts/` 目录，导致 PrintBridge EXE 构建产物（约 20MB）与门店本地配置 `print_agent.json` 险些打入插件包。
- **根因**：EXCLUDE_PARTS 原先只有 `__pycache__/.pyc`。
- **验证方法**：打包后检查 zip 内容：不含 `scripts/build/`、`scripts/dist/`、`print_agent.json`；体积 ≤ 50MB；根目录直接含 `plugin.json`。

## TC-04 沙箱入口必须走票证而非 /app/ 路径

- **问题现象**：自测时直接访问 `/app/jewelry/tenant_trial/` 返回 302/400「请选择已开通该应用的真实企业租户」。
- **根因**：`/app/{插件ID}/{租户ID}/` 是正式版入口（NORMAL 模式），沙箱必须先取 SANDBOX 票证再走 `/gw/{ticket}/`。
- **验证方法**：按升级规范 9.3 第⑤步流程取票证，入口页经 `/gw/{ticket}/` 返回 200。

## TC-05 Git Bash 下 curl 传中文 JSON 失败

- **问题现象**：Windows Git Bash 中 `curl -d '{"name":"中文"}'` 报 "There was an error parsing the body"。
- **根因**：命令行参数中文编码在 Windows 控制台传输时损坏。
- **验证方法**：需要中文请求体时，先用 Python 写 UTF-8 文件再 `curl --data-binary @body.json`。写入链路自测（涉及中文名称的数据）必须用此方式。

## TC-06 EPC 自动生成序号续号不冲突

- **问题现象**：同门店同品类下新建商品，EPC 序号必须接续该组已占用的最大序号。
- **根因**：`_gen_type_epc` 按（门店码+品类码）前缀 LIKE 查询取最大序号 +1。
- **验证方法**：沙箱中连续创建两条同品类商品 → EPC 序号递增且不重复；删除中间一条后再建，不得复用刚删的序号造成历史混淆（按当前实现为取最大值续号，验证实际行为符合预期）。

## TC-07 迁移脚本头部说明与实际 dataVersion 同步

- **问题现象**：upgrade.py 文档字符串曾停留在「dataVersion 1.0.0」，与实际数据版本（1.0.3）不符，误导后续维护。
- **根因**：版本递增时只改了 plugin.json，漏改脚本说明。
- **验证方法**：每次升级后检查 `scripts/upgrade.py` 头部说明中提到的数据版本语义与 plugin.json 的 dataVersion 一致。

## TC-08 打包变更清单对未提交改动的提示

- **问题现象**：changes.lst 由 git 提交记录生成，若改动未 commit，清单会缺项（仅有一行⚠提示）。
- **根因**：打包基于 git log 提取变更。
- **验证方法**：升级打包前确认插件目录改动已 commit，或核对 changes.lst 尾部⚠清单与实际改动一致。

## TC-09 数据核对区分"本来没数据"与"迁移丢数据"

- **问题现象**：沙箱自测时 `/api/products` 返回 0 条，需判断是 tenant_trial 正式库本来就无数据，还是迁移脚本丢了数据。
- **根因**：不能只看 API 返回，必须直接比对新旧库文件。
- **验证方法**：用 sqlite3 分别打开 `platform/data/tenant_dbs/jewelry/` 下旧版本库与新版本库，比对核心表（products/stores 等）行数一致。

## TC-10 epc_cleaned 一次性闸门导致种子/造数脏码永久漏网

- **问题现象**：开发库 100 件商品 EPC 100% 不合规（手持机实扫 24 位芯片 TID），迁移清理却从不触发：init 顺序为「SCHEMA→migrate_schema（置 epc_cleaned=1）→灌种子」，种子与造数脚本在闸门置位后写入脏码，且 seed_test_data.py 还主动置位闸门。
- **根因**：清理闸门只能挡住"闸门之前就存在"的脏数据；种子/造数路径必须自行保证合规。
- **验证方法**：①全新 init 后校验 12 件种子 EPC 全部匹配现行正则且品类段一致；②造数脚本产物 100% 合规；③`db.assign_rule_epcs(conn)` 连跑两次，第二次返回空映射（幂等）；④历史脏库（含不合规/品类错位/重复）经该函数重排后，inventory_logs、stocktake_items（按 product_id）、stocktake_scans（按旧→新映射）引用一致，盘盈未登记标签（product_id IS NULL）保留原值。

## TC-11 材质英文长码迁移转换后不落库

- **问题现象**：库里存 `PLATINUM/GOLD/...` 长码时，`_migrate_material_and_type` 虽在局部变量完成转换与推断，但长码场景用 `want or cur_mat` 取值，推断结果为兜底 `OTH` 时反而把 OTH 落库，长码永不收敛为简写。
- **根因**：以转换后的局部变量判断现状 + 错误地用兜底值覆盖确定的长码信息。
- **验证方法**：插入 material='PLATINUM' 的商品后执行迁移 → 落库必须为 `PT`（推断出更精确材质时除外）；再跑一次迁移结果不变（幂等）。

## TC-12 打包后工作区继续改码导致"包-源码漂移"

- **问题现象**：v1.0.5 打包（22:48）后工作区又改了 db.py/main.py/app.js/print_agent.py（多门店打印桥），沙箱跑的是包内旧码，自测结论无法覆盖工作区新码。
- **根因**：打包不是冻结点；插件改动又未 commit，changes.lst 也缺项（与 TC-08 叠加）。
- **验证方法**：沙箱验证前先 `git status` 确认待发布改动已全部 commit 且打包时间晚于最后一次源码修改；必要时解包 zip 与工作区逐文件比对。修复必须重新打包（版本号递增）后重走沙箱，不得把沙箱结论外推到未打包代码。
