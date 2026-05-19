# Codex Ask Claude

## English

`codex-ask-claude` is a Codex skill for frontend UI work. It lets Codex orchestrate the task while the local Claude CLI performs the actual frontend code edits.

### What It Does

- Delegates React, Vue, Svelte, Angular, HTML, CSS, Tailwind, component, layout, and responsive UI work to Claude CLI.
- Shows compact Claude CLI progress while the model is running, so long or slow network calls are visible without flooding stdout.
- Saves a Markdown artifact and a live output log under `.omx/artifacts`.
- Supports explicit model selection through `-Model`, `-FallbackModel`, and `-Effort`.
- Detects missing Claude CLI and supports remembering when the user declines installation.

### Requirements

- Node.js 18+ for the cross-platform wrapper
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

Run the cross-platform Node.js wrapper from the skill folder:

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/frontend-project" \
  --model sonnet \
  --effort medium \
  --fallback-model opus \
  --prompt "Implement the requested frontend UI change by editing files directly."
```

The wrapper works on Windows, macOS, and Linux. It expands `~` in workspace, artifact, and Claude executable paths, and on macOS/Linux also searches common non-login-shell locations such as `~/.local/bin`, `~/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` when `claude` is not on `PATH`.

### Command Permissions

The wrapper does not grant Claude extra privileges. Claude's available commands and tools are still governed by the local Claude CLI policy, the current OS user, and the target workspace. By default, the wrapper does not set a bypass mode.

Use explicit permission flags when you want a tighter run:

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/frontend-project" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Glob,Grep" \
  --disallowed-tools "Bash(rm *)" \
  --add-dir "/path/to/extra-context" \
  --prompt "Implement the requested frontend UI change by editing files directly."
```

Guidelines:

- Prefer least privilege with `--allowed-tools` / `--disallowed-tools`.
- Use `--tools ""` for advisory-only Claude responses with tools disabled.
- Use `--add-dir` only for directories Claude should intentionally access.
- Do not use bypass flags such as `--dangerously-skip-permissions` through this skill.
- If Claude requests surprising command access, stop and ask before broadening permissions.

### Model Strategy

- Use `sonnet` with `medium` effort for normal frontend implementation.
- Use `sonnet` with `high` effort for larger multi-file UI work or tricky debugging.
- Use `opus` with `high` or `xhigh` effort only for broad redesigns, ambiguous UI/product decisions, or repeated failed Sonnet attempts.
- Add `-FallbackModel opus` when reliability matters more than speed.

### Long Runs And Output

The wrapper is built for slow model calls and poor network conditions. It:

- waits for long-running Claude CLI calls
- shows compact progress for Claude `stream-json` output
- emits heartbeat status lines when Claude is still running without output
- records the full raw stdout/stderr stream in `.log` and `.md` artifacts

It only surfaces visible CLI output. It should not expose hidden chain-of-thought. Use `--raw-live-output` only when you need the uncompressed live stream for debugging.

### Missing Claude CLI

If Claude CLI is missing, Codex should ask whether to install and configure it. If the user declines, record that decision:

```bash
node ./scripts/remember-claude-install-declined.mjs \
  --workspace "/path/to/frontend-project" \
  --reason "User declined Claude CLI setup for frontend delegation."
```

This creates `.omx/state/claude-install-declined.json` in the target workspace so future runs can avoid repeated prompts.

### Test

```powershell
node .\tests\invoke-claude-frontend.node.tests.mjs
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\Code\Codex\codex-ask-claude
```

---

## 中文

`codex-ask-claude` 是一个面向前端 UI 编写的 Codex skill。它让 Codex 负责任务编排、结果审查和验证，把实际的前端代码修改交给本地 Claude CLI 执行。

### 功能

- 将 React、Vue、Svelte、Angular、HTML、CSS、Tailwind、组件、布局、响应式 UI 等任务委托给 Claude CLI。
- 在模型运行时展示精简进度，长时间调用或网络较差时不会像黑盒一样无响应，也不会把完整 `stream-json` 刷满 stdout。
- 在 `.omx/artifacts` 下保存 Markdown artifact 和完整运行日志。
- 支持通过 `-Model`、`-FallbackModel`、`-Effort` 显式选择模型策略。
- 能检测 Claude CLI 是否缺失，并在用户拒绝安装后记录状态，避免反复询问。

### 环境要求

- Node.js 18+，用于跨平台包装脚本
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

在 skill 目录中运行跨平台 Node.js 包装脚本：

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/frontend-project" \
  --model sonnet \
  --effort medium \
  --fallback-model opus \
  --prompt "Implement the requested frontend UI change by editing files directly."
```

该 wrapper 兼容 Windows、macOS 和 Linux。它会展开 workspace、artifact、Claude 可执行文件路径中的 `~`，并且在 macOS/Linux 的非登录 shell 环境下，当 `PATH` 里找不到 `claude` 时，会额外搜索 `~/.local/bin`、`~/bin`、`/opt/homebrew/bin`、`/usr/local/bin` 等常见目录。

### 命令权限控制

wrapper 不会给 Claude 额外提权。Claude 能使用哪些命令和工具，仍由本机 Claude CLI 策略、当前系统用户权限和目标工作区共同决定。默认情况下，wrapper 不设置绕过权限检查的模式。

需要更严格控制时，可以显式传权限参数：

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/frontend-project" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Glob,Grep" \
  --disallowed-tools "Bash(rm *)" \
  --add-dir "/path/to/extra-context" \
  --prompt "Implement the requested frontend UI change by editing files directly."
```

使用规则：

- 优先最小权限，按任务需要配置 `--allowed-tools` / `--disallowed-tools`。
- 只做咨询、不希望 Claude 使用工具时，使用 `--tools ""`。
- 只有用户明确希望 Claude 访问额外目录时才使用 `--add-dir`。
- 不要通过这个 skill 使用 `--dangerously-skip-permissions` 之类绕过权限检查的参数。
- 如果 Claude 请求了意料之外的命令权限，先停下来询问用户，不要静默扩大权限。

### 模型策略

- 常规前端实现使用 `sonnet` + `medium`。
- 多文件 UI 改造、复杂交互或疑难调试使用 `sonnet` + `high`。
- 大范围重设计、需求较模糊的 UI/产品决策，或 Sonnet 多次失败时再使用 `opus` + `high/xhigh`。
- 当稳定性比速度更重要时，建议加上 `-FallbackModel opus`。

### 长时间调用与输出

包装脚本专门处理耗时较长或网络较差的 Claude 调用。它会：

- 等待长时间运行的 Claude CLI 调用
- 对 Claude `stream-json` 输出展示精简进度
- Claude 暂时没有输出时定期打印等待状态
- 在 `.log` 和 `.md` artifact 中保存完整原始 stdout/stderr

脚本只展示 CLI 可见输出，不应暴露隐藏的 chain-of-thought。只有调试 wrapper 或 Claude 协议输出时才建议使用 `--raw-live-output` 恢复原始实时流。

### Claude CLI 缺失处理

如果 Claude CLI 没有安装，Codex 应先询问用户是否安装并配置。若用户拒绝，可记录该选择：

```bash
node ./scripts/remember-claude-install-declined.mjs \
  --workspace "/path/to/frontend-project" \
  --reason "User declined Claude CLI setup for frontend delegation."
```

这会在目标工作区生成 `.omx/state/claude-install-declined.json`，后续运行时可避免重复询问。

### 测试

```powershell
node .\tests\invoke-claude-frontend.node.tests.mjs
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\Code\Codex\codex-ask-claude
```
