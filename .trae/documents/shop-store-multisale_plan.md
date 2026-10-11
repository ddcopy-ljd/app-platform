# 店铺/门店两级 + 功能归位 + 快速开单多件扫描 实施计划

## 背景与决策（已与用户确认）

1. 新增「店铺 shops」层：一个店铺含多个门店。迁移时**自动建 1 个默认店铺，现有 stores 全部挂到其下**，后续可新增店铺、调整门店归属。
2. 一单多件：**主单 sales + 明细行 sale\_items**，每件一行（含单价），整单金额/实收**自动汇总**；兼容历史单件单。
3. 快速开单扫码：**RFID 扫描枪（YzApp UHF 桥）+ 本地 zxing 摄像头都支持**，按 EPC/条码自动匹配在库商品加入清单。
4. 入库：**入口移到门店管理内、必须指定门店**，入库商品直接绑定该门店；商品管理去掉入库入口。
5. 门店调拨已是独立页（nav `transfers`），保持独立、不在商品管理内（商品页仅保留"发起调拨"快捷入口）。
6. 扫描设备管理从盘点页移入门店管理（按门店维度管理其设备）。
7. 三语最后统一做：本期 i18n 新键只补中文 zh，en/it 等用户指令后统一补。版本号 plugin.json **不在本期提前改动**。

## Repository Research（现状结论）

* 数据模型 [db.py](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/db.py)：

  * 只有 `stores`（L40：id/name/code/owner/bridge\_key/printer\_name），**无 shops**；`products.store_id`（L104）、`devices.bound_store_id`、`locations.store_id` 均直接挂门店。

  * `sales`（L127）为**单件**：product/product\_id/amount 单值；无 sale\_items 表。

  * 迁移走 `SCHEMA`（executescript，幂等）+ `migrate_schema` 的 alters 列表（db.py L645 起）。

* 后端 [main.py](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/main.py)：

  * 门店：`POST /api/stores`（L2385）、`GET /api/stores`（L3649）、bridge/print 系列（L2409-2456）。

  * 入库：`POST /api/inventory/inbound`（L1758）**当前硬编码 store\_id=1**；`InboundIn`（L1734 附近）无 store\_id 字段。

  * 开单：`POST /api/sales`（L3561）单件，含冻结闸、经办人默认类别、商品置已售+`_inv('out')`；`GET /api/sales`（L3599）、void（L3623）。

  * 设备：`/api/devices*`、`device_activations`（含 store\_id）；盘点页使用。

* 前端：

  * 导航 NAV\_ITEMS（[app.js L162](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/app.js#L162-L179)），无店铺/门店管理一级入口；门店与打印代理在 `tab==='profile'`（[index.html L1080](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L1080-L1135)），`createStore`。

  * 设备管理 modal 由盘点页按钮 `openDevices` 打开（[index.html L339](file:///c:/Users/俊达/Desktop/综合业务应用服务平台/plugins/jewelry/frontend/index.html#L339)，modal L1892）。

  * 入库：`openInbound`（app.js L815，store\_id:1）走 sheet `inbound`（index.html L1442），提交 `/api/inventory/inbound`（app.js L1605）。商品页有入库按钮。

  * 快速开单：`quickSale`（app.js L1507）单件 sheet；扫码桥 `window.YzApp.scan(type)` + `window.YzScanner.onResult`（app.js L756-798）；**index.html 未引入 zxing**（仅 stock.html 用 vendor/zxing.min.js）。

  * 盘点冻结 `frozen`/`_assert_stock_unfrozen` 已覆盖开单/入库；新多件开单与门店入库必须继续受冻结闸约束。

* 可复用：vendor/zxing.min.js 已存在（stock.html 摄像头模式）；UHF 桥 onResult 机制可复用。

## Files and Modules

* `plugins/jewelry/db.py`：新增 shops、sale\_items 建表；stores 加 shop\_id；biz\_config 无需动（每店铺上限落 shops）；幂等 alters + 数据迁移（默认店铺回填）。

* `plugins/jewelry/main.py`：shops CRUD；stores 增强（带 shop\_id）；inbound 必选门店；sales 多件事务化重写 + 查询返回明细；设备列表/激活按门店；迁移回填。

* `plugins/jewelry/frontend/index.html`：新增「店铺管理」「门店管理」页/区，门店详情含设备与入库；商品页去入库；开单 sheet 改多件 + 扫码加件 + 摄像头取景；引入 zxing。

* `plugins/jewelry/frontend/app.js`：导航与 ST 状态；shops/stores 加载；门店入库；多件开单逻辑（扫描匹配、清单、汇总、上限校验）；摄像头扫码控制器；设备管理归位。

* `plugins/jewelry/frontend/i18n.js`：仅补 zh 新键。

* `plugins/jewelry/frontend/stock.html` / scan-assistant：本期**不改**（盘点/设备链路已稳定，避免回归）。

## 数据模型变更（幂等迁移）

```sql
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  sale_item_limit INTEGER DEFAULT 20,   -- 快速开单单件数上限
  sort_order INTEGER DEFAULT 0,
  created TEXT DEFAULT (datetime('now','localtime'))
);
-- stores 增列：shop_id INTEGER DEFAULT 0
-- 销售明细
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  epc TEXT DEFAULT '',
  code TEXT DEFAULT '',
  name TEXT DEFAULT '',
  price REAL DEFAULT 0,        -- 成交单价快照
  seq INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
```

迁移回填（在 migrate\_schema 内，执行前判断，保证幂等）：

* 若 shops 为空：插入默认店铺「默认店铺」；把所有 `stores.shop_id=0` 的门店 UPDATE 为该店铺 id。

* 对历史 sales（product\_id 非空且无 sale\_items）回填 1 条 sale\_items（price=sales.amount），保证老单在新界面也显示为明细。

## Implementation Steps（依赖顺序）

1. **db.py**：加 shops/sale\_items 建表、stores.shop\_id alter、索引；在 migrate\_schema 末尾加幂等数据回填（默认店铺、stores 归属、历史单明细）。
2. **main.py 店铺/门店**：

   * `GET/POST/PUT/DELETE /api/shops`（删除需无门店关联，否则 400 中文提示）；`sale_item_limit` 校验 ≥1。

   * stores create/update 接收 shop\_id（缺省取首个店铺）；`GET /api/stores` 返回 shop\_name/shop\_id；新增门店归属调整接口（或并入 update）。
3. **main.py 入库归位**：`InboundIn` 加 `store_id`（必填，>0，校验门店存在）；`/api/inventory/inbound` 用该 store\_id 与该门店库位（替换硬编码 1）；EPC 门店段用真实 store\_id。
4. **main.py 设备归位**：确认 `/api/devices`、激活码生成已带 store\_id；补"按门店筛选"查询参数 `store_id`（门店管理内嵌列表用）；设备停用/解绑复用现有接口。
5. **main.py 多件开单**：

   * `SaleReq` 增加 `items: list[{product_id|epc, price?}]`，保留旧单件字段兼容。

   * 事务内：查店铺上限（经商品 store→shop），校验 1≤件数≤上限；逐件校验在库、未重复、同店（跨店混单给中文 400）；amount=Σ单价（自动汇总，不接受手改总价），paid/status 沿用；插 sales + sale\_items；逐件置已售 + `_inv('out')`；任一失败整体回滚。

   * `GET /api/sales` 与详情返回 items；小票数据含明细；void 逐件回滚库存（沿用现状语义并扩展）。
6. **前端导航与组织页**：

   * NAV 增加「店铺管理」（shops）与「门店管理」（stores）；把 profile 内的门店/打印/库位区块迁入门店管理（打印代理、库位主数据保持在门店维度）。

   * 店铺管理：店铺增删改、每店铺"开单件数上限"设置；门店管理：按店铺分组列门店，门店详情含 基本信息/入库/扫描设备/库位 子区。

   * 设备管理 modal 从盘点页移入门店详情（盘点页保留只读状态或移除按钮，二选一在实现时保持盘点页不报错；建议盘点页移除"设备管理"按钮，仅在门店管理统一维护）。
7. **前端门店入库**：门店详情内"入库"按钮打开 sheet，store\_id 固定为该门店（不可改），提交 `/api/inventory/inbound`；商品管理（products）移除入库入口与 sheet 触发（保留商品建档/编辑）。
8. **前端多件快速开单**：

   * 重写 sale sheet：顶部客户/日期/经办人/支付方式；中部"已扫商品清单"（名称/货号/EPC/单价/移除），实时合计；底部扫码加件 + 手动从在库下拉加件。

   * 扫码：App WebView 走 YzApp UHF（连续扫加件，onResult 去重）；浏览器走 zxing 摄像头（index.html 引入 vendor/zxing.min.js，video 取景 + 循环解码），统一按 EPC→rfid\_epc、否则按条码→barcode/code 匹配在库商品。

   * 达到店铺上限禁用再加（中文提示）；非在库/跨店/重复给 toast；提交多件 payload，成功刷新。
9. **i18n**：仅补 zh 新键（店铺/门店/上限/多件开单/扫码加件/入库归属等）。
10. 清理：商品页 `+ 入库` 与 `openDevices` 旧入口摘除后，确认 app.js methods 挂载与 index.html 无悬空引用。

## Dependencies and Considerations

* 盘点冻结：多件开单、门店入库仍必须先过 `_assert_stock_unfrozen`；任务进行中这些入口按现有冻结态禁用。

* EPC 跨店：开单/入库按 EPC 全局唯一匹配，不校验门店段；调拨后商品 store\_id 变化，明细只存快照。

* 兼容：sales 旧单件字段保留；历史单回填明细后界面统一；对外 API/打印桥字段不删除只新增。

* 多件支付：整单一次 paid/method；欠款状态按 Σamount 比较。退货/void 需逐件恢复在库并写日志。

* 删除店铺：仅当其下无门店时允许；门店有关联商品/设备时不允许物理删除（停用或拦截）。

* zxing 仅本地 vendor，禁 CDN；手机浏览器 https/摄像头权限与 PC http 本地测试差异需在验证时覆盖（无摄像头时降级为手动选择 + UHF）。

## Validation

* 后端：重启 8002；新增/扩展 C:\Temp 脚本覆盖：

  * 迁移幂等（连跑两次结构一致、默认店铺回填、stores 全归属、历史单有明细）。

  * shops CRUD + 上限；stores 归属；inbound 必选门店且落 store\_id、库位按门店隔离。

  * 多件开单：3 件成功合计正确、超上限 400、含非在库/跨店/重复 400、库存逐件已售、void 逐件回滚、历史单件单仍可查。

  * 回归：`task_engine_test.py`（38）、`h5_test.py`（9）确保冻结/设备/盘点未受影响。

* 前端（浏览器 127.0.0.1:8002，注入 token 省登录步数）：

  * 店铺管理建店铺设上限；门店管理看到设备/入库/库位子区；门店内入库商品归属正确。

  * 商品页无入库入口；快速开单可摄像头/UHF（有桥时）加件、清单与合计、达上限拦截、提交成功；无 console 红色错误、无裸 i18n 键。

* py\_compile + 前端无 JS 语法错误（无 node 时用浏览器 console 验证）。

## Risks

* 前端 profile 搬迁牵连打印代理/库位：风险中。处理——整区块迁移而非重写，保持 bridges/locations 既有方法与接口不变，仅改挂载位置。

* 多件开单与历史单件/小票/void 兼容：风险中。处理——保留旧字段 + 明细回填 + 逐件回滚，回归历史单展示。

* 摄像头在 PC http 与移动端差异：风险中。处理——zxing 失败自动降级手动选择/UHF，不阻断主流程。

* 设备管理入口迁移影响盘点页：风险低。处理——摘除按钮但保留 app.js 函数，盘点页其余功能不动并回归。

* 迁移误改存量：风险低。处理——全部 IF NOT EXISTS/条件 UPDATE，先在 dev\_data 库验证并备份，不删任何存量列/数据。

