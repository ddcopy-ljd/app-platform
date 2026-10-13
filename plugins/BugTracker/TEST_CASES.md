# BugPulse 缺陷跟踪 - 测试用例台账

> 按《AGENTS.md》第 9 章维护。每条含「问题现象 → 根因 → 验证方法」。升级自测时逐条回归。

## TC-01 前端脚本未伺服导致整页无交互
- **问题现象**：打开工作区页面后登录遮罩不出现、所有按钮点击报 `ReferenceError: xxx is not defined`，看板/列表全空。
- **根因**：`main.py` 只挂了 `/` 伺服 index.html，未伺服 `app.js`；浏览器请求 `/app.js` 落到 404，脚本未执行。
- **验证方法**：`GET /app.js` 必须返回 200 且 `Content-Type: application/javascript`；页面加载后控制台无 ReferenceError。

## TC-02 浏览器缓存旧 404 导致走查误判
- **问题现象**：修复 app.js 路由后，浏览器普通刷新仍报脚本未加载。
- **根因**：首次访问时 `/app.js` 返回 404 被浏览器缓存；页面脚本无 no-cache 头时刷新不重新拉取。
- **验证方法**：`/` 与 `/app.js` 响应均带 `Cache-Control: no-cache`；走查用带查询串的地址（如 `/?nocache=1`）穿透缓存。

## TC-03 种子数据 seq 与已用缺陷编号冲突
- **问题现象**：在 ERP 项目下新建缺陷报 500（`UNIQUE constraint failed: bugs.code`）。
- **根因**：种子内置 ERP-101/102/103 三条，但 `projects.seq` 误设为 102，新建时生成 ERP-102 与已有行冲突。
- **验证方法**：种子后 `SELECT seq FROM projects WHERE key='ERP'` 应大于该项目最大编号（104）；新建缺陷返回 200 且 code 顺延。

## TC-04 删除缺陷必须级联清理截图文件
- **问题现象**：删除缺陷后 storage 目录残留孤立图片文件，占用空间且成为孤儿数据。
- **根因**：若只删 DB 行（含 bug_images）不删物理文件，文件永久残留。
- **验证方法**：`DELETE /api/bugs/{id}` 后，用 sqlite3 查 `bug_images/bug_comments/bugs` 该 id 计数全为 0，且 `storage/{tenant}/` 下无该 code 前缀文件；响应 `deletedImages` 等于删除前图片数。

## TC-05 带鉴权图片伺服
- **问题现象**：详情抽屉截图裂图。
- **根因**：`<img>` 请求不带 Authorization 头，图片接口 401。
- **验证方法**：`GET /api/images/{bug}/{img}` 无 token 返回 401；带 `?token=` 返回 200 且首字节为图片魔数（JPEG `FF D8 FF`）。

## TC-06 单张图片体积上限
- **问题现象**：恶意/超大上传可能撑爆 storage。
- **根因**：未限制 dataUrl/multipart 解码后字节数。
- **验证方法**：`POST /api/bugs` 的 images[].dataUrl 解码后 >2MB 应返回 413；multipart 追加同样 413。

## TC-07 端口占用（本地联调环境）
- **问题现象**：`HOST=0.0.0.0 PORT=8003` 启动后，本机 `curl 127.0.0.1:8003` 返回的是珠宝云页面。
- **根因**：本机已有历史进程监听 `127.0.0.1:8003`，Windows 下更具体的 127.0.0.1 绑定优先于 0.0.0.0。
- **验证方法**：本地自测前先 `netstat` 确认目标端口无 `127.0.0.1` 占用，或换用空闲端口（本次用 8010）。

## TC-08 平台沙箱 storage 目录约定
- **问题现象**：平台注入 `STORAGE_DIR=.../storage/bugtracker`（不含租户层），插件若直接写会跨租户混放。
- **根因**：平台 storage 约定为 `storage/{plugin}/{tenant}/v{version}`，插件需自建 `{tenant}` 子目录。
- **验证方法**：PLATFORM 模式下 `_storage_dir` 返回 `STORAGE_DIR/{tenant}`；不同租户图片文件互不可见。

## TC-09 密码必须哈希存储且列表/接口永不回显
- **问题现象**：早期实现明文存密码，用户管理列表一旦暴露 password 字段即泄露全员凭据。
- **根因**：种子与登录校验直接比较明文。
- **验证方法**：库中 `users.password` 以 `pbkdf2_sha256$` 开头；`GET /api/users` 响应不含 password 字段；`POST /api/auth/password` 旧密码错返回 400、改密后旧密码 401 / 新密码 200；历史明文库首次登录命中后自动升级为哈希。

## TC-10 静态脚本引用必须带版本参数穿透浏览器缓存
- **问题现象**：发新版后浏览器普通刷新仍执行旧 `app.js`（控制台报旧函数 `undefined`），走查结果与服务端实际伺服内容不一致。
- **根因**：`<script src="app.js">` 无版本参数，浏览器 memory cache 在同会话内直接命中旧副本（no-cache 头未能完全拦住）。
- **验证方法**：index.html 引用形如 `app.js?v={version}`，版本变更即穿透；走查前先 `localStorage.clear()` + 硬刷新，控制台历史日志与新报错分开判定。

## TC-11 免登录外部上报的租户隔离与限频防刷
- **问题现象**：`POST /api/report` 免鉴权，若不限流/不隔离，可被刷爆库或跨租户写入。
- **根因**：免登录端点必须依赖网关注入的 `X-Resolved-Tenant-ID` 隔离租户，并自行限频（每租户每分钟 5 条）。
- **验证方法**：带头上报返回 200 且落对应租户 `INBOX` 项目（status=open、reporter=`{姓名}（来自 {来源插件}）`、source_plugin/source_reporter 落列）；同租户第 6 条返回 429「上报太频繁」；非法类型 400、缺标题/来源过短 422（不占限频名额）；`GET /report` 返回 200 且带 no-cache。

## TC-12 旧库升级必须补 INBOX 项目与来源列
- **问题现象**：从 v1.0.0 升级后外部上报 500（`projects.key='INBOX'` 不存在）或写 bugs 报 `no such column: source_plugin`。
- **根因**：upgrade.py 未幂等补列/补 INBOX 项目行。
- **验证方法**：对 v1.0.0 库副本跑 `scripts/upgrade.py` 后：`PRAGMA table_info(bugs)` 含 source_plugin/source_reporter；`projects` 含 key='INBOX'（seq=900）；旧 bugs/users 数据条数不变；`POST /api/report` 返回 INBOX-900 起编号。

## TC-13 上报跟踪端点必须按门店隔离且不泄漏正文
- **问题现象**：新增 `GET /api/report/track`（免登录）若过滤不严，A 店能看到 B 店上报，或泄漏 detail/截图等敏感内容。
- **根因**：端点靠 `source_plugin + source_store` 双条件过滤，只返回 code/title/status/时间；租户隔离依赖网关注入头定位库文件（`_db(request)`），漏任一条件即跨店/跨租户泄漏。
- **验证方法**：`POST /api/report` 带 `store=WALKSTORE` 后：`GET /api/report/track?source=jewelry&store=WALKSTORE` 命中且 statusLabel 正确；`store=别的店` 返回空；管理端 `POST /api/bugs/{id}/status` 改 in_progress 后 track 同步显示「进行中」；响应字段仅 code/title/status/statusLabel/created/updated。历史无门店记录由 upgrade.py 回填 `source_store='总部'`（幂等：仅补空值）。

## TC-14 上报页粘贴截图必须复用压缩管线且受 3 张上限
- **问题现象**：粘贴图片若直接塞 dataURL 原图，超大截图（>2MB）会被服务端拒绝或撑爆请求体。
- **根因**：paste 事件取 `clipboardData.items` 的 File 后必须走 `addImageFile()`（长边 800 压缩 JPEG），与文件选择共用 `ST.imgs` 上限 3 张判断。
- **验证方法**：`/report?source=jewelry&store=WALKSTORE` 页面用 `new ClipboardEvent('paste',{clipboardData:dt})`（dt 含 1 个 png File）dispatch 后：`ST.imgs.length===1` 且 `#imgBox [data-thumb]` 为 1；已有 3 张时再粘贴显示「截图最多 3 张」；控制台无报错。
