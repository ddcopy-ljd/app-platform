# 珠宝云企业推广页（/site）多语言可写 — 实施方案

## Context

珠宝插件的企业网站 `/site`（服务端渲染的租户推广页，main.py `public_site()`）目前固定中文：租户资料字段（名称/slogan/简介/地址/营业时间/橱窗标题等）只有单值中文列，页面文案硬编码，无语言切换。

用户要求：**租户内容「可按语言录入」**（可写多语言，不是前端翻译字典），沿用插件既有的商品名称多语言模式（主列=中文 + `*_i18n` JSON 列存其它语言，见 app.js L459-475、products.name\_i18n）。语言范围 6 语言（zh/en/it/ja/ko/zhHant）。

## 关键口径

1. **租户内容 = 可写多语言**：按语言存进 `tenant_profiles.i18n` JSON，缺语言回退中文主列。
2. **插件固定文案 = 内置文案包**：导航、预约表单标签、四大安心承诺、橱窗统计行、footer 等由服务端 `SITE_UI` 字典提供 6 语言（平台自有文案，只能内置翻译）。品牌故事区块现为硬编码营销文案，本次仅纳入文案包翻译，不做可写化（避免范围膨胀）。
3. **橱窗商品跟随语言**：商品名用已有 `name_i18n`、橱窗描述用已有 `showcase_desc_i18n`（/site 现在没用上，本次接上）。
4. 语言协商：`?lang=` 查询参数 > `Accept-Language` 头 > 默认 zh；页面导航栏加语言切换链接（保留当前锚点）。

## 改动点

### 1. db.py（dataVersion 1.2.18→1.2.19）

* SCHEMA `tenant_profiles` 增列 `i18n TEXT DEFAULT '{}'`；migrate\_schema ALTER 清单同步（与 stores.name\_i18n 同款幂等补列）。

* `_seed_base_dicts` 的 languages 补 ja/ko/zhHant（INSERT OR IGNORE；确认旧库升级路径会重跑该函数，否则在 migrate/ensure\_new\_seeds 补种）。

### 2. main.py

* `ProfileIn` 增 `i18n: str = "{}"`；`PUT /api/profile` 校验 JSON 合法后落库；`GET /api/profile` 原样返回。

* `public_site()`：

  * `_site_lang(request)` 协商语言（白名单 6 码，`zh-Hant`→zhHant 归一）；`<html lang>` 映射。

  * `_pick(prof_i18n, lang, field, fallback)` 取租户内容，缺回退中文主列。

  * `SITE_UI = {lang: {nav_about, nav_showcase, nav_booking, book_title, ...}}` 固定文案包（6 语言），模板内所有硬编码中文改从文案包取。

  * 橱窗卡片：name/desc 走 `_pick`（name\_i18n/showcase\_desc\_i18n）；「货号/预约看货/到店咨询/附权威证书/产地：材质：…」标签随文案包。

  * 导航栏尾部渲染语言切换（当前语言高亮，链接 `?lang=xx`）。

* `/site` 免鉴权特性不变；预约提交 `POST /api/bookings`（如有）字段不动。

### 3. 前端（app.js + index.html + i18n 六字典 + app.css）

* 总部管理「企业网站」表单（app.js L3560 saveProfile / ST.profile）：

  * 表单顶部加语言切换 chips（列表= languages 表，复用商品名称多语言交互模式）；切到非中文时，name/slogan/intro/address/hours/showcase\_title/showcase\_subtitle/categories 读写 `ST.profile.i18n[lang]`，中文照写主列。

  * 保存时序列化 i18n JSON 一并 PUT。

  * 提供「查看站点」入口带 `?lang=` 预览。

* i18n 六字典补表单新键（site.langEdit 等，zh 基线+5 语言），I18N\_VER 同步双处 bump。

* app.css 补切换 chips 样式（≥14px、var(--text) 系颜色）。

### 4. 版本与台账

* plugin.json dataVersion 1.2.19、features 补一句；upgrade.py docstring 补迁移说明。

* TEST\_CASES.md 入册 TC-35（现象→根因→验证方法）。

## 验证（按 AGENTS.md 分级）

1. **迁移**：旧库 upgrade.py 重跑两次幂等（i18n 列存在、languages 补齐）；新 init 正常。
2. **Python E2E**（8002 STANDALONE，中文用 Python 防乱码）：PUT profile 带 i18n → `GET /site?lang=en` 断言英文内容+无中文残留（内容区）→ 缺 ja 时回退中文 → Accept-Language: it 协商命中 → 橱窗商品 name\_i18n 生效 → 非法 i18n JSON 被 400。测试数据全清理。
3. **浏览器走查**：总部管理表单逐语言录入→保存→/site 语言切换渲染→预约表单文案跟随→控制台无报错→EN/繁体验证→清理恢复。
4. 不做全量回归（非核心管线，仅相关性测试 + 迁移验证）。

## 不做

* 品牌故事/承诺文案的可写化；/market 插件推广页；平台侧改动。

