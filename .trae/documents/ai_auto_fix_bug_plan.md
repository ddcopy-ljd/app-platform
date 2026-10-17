# AI 自动修 BUG 功能实现方案（Trae 工作流版）

## 背景

利用 Trae 已有的 AI 能力，在 BugTracker 管理页加一个「AI 修复」按钮，点击后 Trae 自动分析 BUG、定位代码、生成修复并提交。

## 核心思路

**不在代码里调 LLM API**，而是利用 Trae 的 Agent 能力：BugTracker 提供 BUG 数据接口，Trae 作为 AI 引擎读取 BUG → 分析代码 → 修改 → 提交 → 回写状态。

## 实现

### 1. BugTracker 数据接口（main.py 追加）

**GET /api/bugs/open-list**（免登录，限内网）：
```json
{
  "items": [
    {
      "id": 1, "code": "JEWELRY-1", "title": "页面白屏",
      "source_plugin": "jewelry", "steps": "...", "actual": "...",
      "expected": "...", "severity": "major", "created": "..."
    }
  ]
}
```

返回 open 状态的 BUG 列表，含 source_plugin 用于定位代码目录。

### 2. BugTracker 状态回写（已有）

`POST /api/bugs/{id}/status` 已有，Trae 修复后调用改 testing。

### 3. BugTracker 前端（app.js）

列表页加「AI 修复」按钮 → 弹窗显示 open BUG 列表 → 用户选一个 → 复制 BUG 信息到剪贴板 → 提示「请粘贴给 Trae 进行修复」。

### 4. Trae 侧工作流（用户操作）

用户把 BUG 信息粘贴给 Trae → Trae 读取代码 → 分析 → 修改 → 提交 → 调 BugTracker API 改状态。

## 关键文件

| 文件 | 改动 |
|---|---|
| `plugins/BugTracker/main.py` | 追加 GET /api/bugs/open-list 端点 |
| `plugins/BugTracker/frontend/app.js` | AI 修复按钮 + BUG 列表弹窗 + 复制功能 |

## 验证

1. BugTracker 创建 open BUG
2. 点「AI 修复」→ 弹窗显示 BUG 列表
3. 选一个 → 信息复制到剪贴板
4. 粘贴给 Trae → Trae 分析修复 → 调 API 改状态
