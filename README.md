# 综合业务应用服务平台

多租户插件化 SaaS 平台：FastAPI + Vue3 + SQLite。

- platform/ 平台核心（网关、插件生命周期、多版本沙箱升级）
- plugins/ 应用插件（jewelry 珠宝门店管理）
- platform/docs 服务平台开发规范
- AGENTS.md 跨模块总纲（架构红线/密钥安全/测试总则）
- plugins/AGENTS.md 插件开发要求（数据库/后端/前端/发布/踩坑）
- plugins/STRUCTURE.md 插件系统结构（包结构/plugin.json/推广页/订阅/升级流程）
- platform/AGENTS.md 平台与 scan-assistant 开发要求
- platform/STRUCTURE.md 平台系统结构（网关路由/鉴权/部署安全/沙箱访问）
