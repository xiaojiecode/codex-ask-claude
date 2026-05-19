# Codex Ask Claude

## English

`codex-ask-claude` is a Codex skill for frontend UI work. It lets Codex orchestrate the task while the local Claude CLI performs the actual frontend code edits.

### What It Does

- Delegates React, Vue, Svelte, Angular, HTML, CSS, Tailwind, component, layout, and responsive UI work to Claude CLI.
- Streams Claude CLI `stdout` and `stderr` while the model is running, so long or slow network calls are visible instead of silent.
- Saves a Markdown artifact and a live output log under `.omx/artifacts`.
- Supports explicit model selection through `-Model`, `-FallbackModel`, and `-Effort`.
- Detects missing Claude CLI and supports remembering when the user declines installation.

### Requirements

- Windows PowerShell or PowerShell 7
- Local Claude CLI installed and authenticated
- Codex skill runtime

Check Claude CLI:

```powershell
claude --version
```

### Install

Clone or copy this folder into your Codex skills directory, or install it through your preferred Codex skill installation flow:

```text
codex-ask-claude/
  SKILL.md
  agents/openai.yaml
  references/
  scripts/
  tests/
```

### Usage

Run the wrapper from the skill folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\invoke-claude-frontend.ps1 `
  -Workspace "D:\path\to\frontend-project" `
  -Model sonnet `
  -Effort medium `
  -FallbackModel opus `
  -Prompt "Implement the requested frontend UI change by editing files directly."
```

### Model Strategy

- Use `sonnet` with `medium` effort for normal frontend implementation.
- Use `sonnet` with `high` effort for larger multi-file UI work or tricky debugging.
- Use `opus` with `high` or `xhigh` effort only for broad redesigns, ambiguous UI/product decisions, or repeated failed Sonnet attempts.
- Add `-FallbackModel opus` when reliability matters more than speed.

### Long Runs And Output

The wrapper is built for slow model calls and poor network conditions. It:

- waits for long-running Claude CLI calls
- streams visible `stdout` and `stderr`
- emits heartbeat status lines when Claude is still running without output
- records a full `.log` and `.md` artifact

It only surfaces visible CLI output. It should not expose hidden chain-of-thought.

### Missing Claude CLI

If Claude CLI is missing, Codex should ask whether to install and configure it. If the user declines, record that decision:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remember-claude-install-declined.ps1 `
  -Workspace "D:\path\to\frontend-project" `
  -Reason "User declined Claude CLI setup for frontend delegation."
```

This creates `.omx/state/claude-install-declined.json` in the target workspace so future runs can avoid repeated prompts.

### Test

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\invoke-claude-frontend.tests.ps1
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\Code\Codex\codex-ask-claude
```

---

## 中文

`codex-ask-claude` 是一个面向前端 UI 编写的 Codex skill。它让 Codex 负责任务编排、结果审查和验证，把实际的前端代码修改交给本地 Claude CLI 执行。

### 功能

- 将 React、Vue、Svelte、Angular、HTML、CSS、Tailwind、组件、布局、响应式 UI 等任务委托给 Claude CLI。
- 在模型运行时实时输出 Claude CLI 的 `stdout` 和 `stderr`，长时间调用或网络较差时不会像黑盒一样无响应。
- 在 `.omx/artifacts` 下保存 Markdown artifact 和完整运行日志。
- 支持通过 `-Model`、`-FallbackModel`、`-Effort` 显式选择模型策略。
- 能检测 Claude CLI 是否缺失，并在用户拒绝安装后记录状态，避免反复询问。

### 环境要求

- Windows PowerShell 或 PowerShell 7
- 已安装并完成认证的本地 Claude CLI
- Codex skill 运行环境

检查 Claude CLI：

```powershell
claude --version
```

### 安装

将本目录克隆或复制到 Codex skills 目录，或使用你常用的 Codex skill 安装流程：

```text
codex-ask-claude/
  SKILL.md
  agents/openai.yaml
  references/
  scripts/
  tests/
```

### 使用

在 skill 目录中运行包装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\invoke-claude-frontend.ps1 `
  -Workspace "D:\path\to\frontend-project" `
  -Model sonnet `
  -Effort medium `
  -FallbackModel opus `
  -Prompt "Implement the requested frontend UI change by editing files directly."
```

### 模型策略

- 常规前端实现使用 `sonnet` + `medium`。
- 多文件 UI 改造、复杂交互或疑难调试使用 `sonnet` + `high`。
- 大范围重设计、需求较模糊的 UI/产品决策，或 Sonnet 多次失败时再使用 `opus` + `high/xhigh`。
- 当稳定性比速度更重要时，建议加上 `-FallbackModel opus`。

### 长时间调用与输出

包装脚本专门处理耗时较长或网络较差的 Claude 调用。它会：

- 等待长时间运行的 Claude CLI 调用
- 实时转发可见的 `stdout` 和 `stderr`
- Claude 暂时没有输出时定期打印等待状态
- 保存完整 `.log` 和 `.md` artifact

脚本只展示 CLI 可见输出，不应暴露隐藏的 chain-of-thought。

### Claude CLI 缺失处理

如果 Claude CLI 没有安装，Codex 应先询问用户是否安装并配置。若用户拒绝，可记录该选择：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remember-claude-install-declined.ps1 `
  -Workspace "D:\path\to\frontend-project" `
  -Reason "User declined Claude CLI setup for frontend delegation."
```

这会在目标工作区生成 `.omx/state/claude-install-declined.json`，后续运行时可避免重复询问。

### 测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\invoke-claude-frontend.tests.ps1
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\Code\Codex\codex-ask-claude
```
