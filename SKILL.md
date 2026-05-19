---
name: codex-ask-claude
description: Use when Codex needs to implement frontend UI or UX changes by delegating the actual UI code edits to the local Claude CLI. Trigger for React, Vue, Svelte, Angular, HTML, CSS, Tailwind, component layout, visual polish, responsive behavior, browser UI fixes, dashboards, forms, and other frontend-facing coding tasks where Claude should edit files while Codex orchestrates, reviews, and verifies.
---

# Codex Ask Claude

Delegate frontend UI implementation to the local Claude CLI, then have Codex review the diff and run the normal project checks.

## Required Workflow

1. Confirm Claude CLI is available:

```powershell
claude --version
```

If `claude` is missing, check whether `.codex-ask-claude/state/claude-install-declined.json` exists in the target workspace. If it exists, do not ask again; tell the user Claude CLI is still missing and that a prior decline marker exists. If it does not exist, ask the user whether Codex should install and configure Claude CLI.

If the user declines installation/configuration, record the choice so future runs do not repeat the same question:

```bash
node ./scripts/remember-claude-install-declined.mjs \
  --workspace "/path/to/workspace" \
  --reason "User declined Claude CLI setup for frontend delegation."
```

2. Inspect the target workspace enough to produce a precise implementation prompt:

```powershell
Get-ChildItem
rg --files
```

Read the package/build files and only the UI files needed to understand the task.

3. Ask Claude CLI to make the frontend edits directly. Prefer a bundled wrapper because it captures raw stdout/stderr to a run log, shows compact live progress by default, and leaves an artifact.

Use the Node.js wrapper on all platforms, including Windows:

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/workspace" \
  --model sonnet \
  --effort medium \
  --fallback-model opus \
  --prompt "<precise implementation prompt>"
```

The wrapper expands `~` in workspace, artifact, and Claude executable paths. On macOS/Linux, it also searches common non-login-shell locations such as `~/.local/bin`, `~/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` when `claude` is not on `PATH`.

On Windows, prefer the real `claude.exe`. If only a `.cmd` / `.bat` shim is found, the wrapper refuses prompts or arguments containing shell-sensitive characters such as `%`, `!`, `&`, `|`, `<`, `>`, `^`, or newlines instead of passing them through `cmd.exe`.

## Command Permission Control

Claude command and tool permissions are controlled by the local Claude CLI session, not by Codex. The wrapper must not weaken that boundary: it does not elevate OS privileges, does not bypass Claude permission checks by default, and does not add extra filesystem access unless explicitly requested.

Use these wrapper options when the task needs an explicit permission posture:

```bash
node ./scripts/invoke-claude-frontend.mjs \
  --workspace "/path/to/workspace" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Glob,Grep" \
  --disallowed-tools "Bash(rm *)" \
  --add-dir "/path/to/extra-readonly-context" \
  --prompt "<precise implementation prompt>"
```

Permission rules:

- Default: omit permission flags and let the user's configured Claude CLI policy decide.
- Prefer least privilege: pass `--allowed-tools` when a task only needs read/edit/search tools.
- Deny dangerous shell patterns with `--disallowed-tools` when shell access is unnecessary or risky.
- Use `--tools ""` only when intentionally disabling Claude's tools for an advisory-only response.
- Use `--add-dir` only for directories the user intentionally wants Claude to access.
- Do not pass `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or bypass-style permission modes from this skill.
- If Claude asks for an unexpected command permission, stop and ask the user instead of broadening access silently.

Use a direct `claude -p "<prompt>"` call only if the Node wrapper is unavailable.

The wrapper is designed for slow or flaky network runs. It waits for long-running calls, streams visible CLI output as it arrives, and records the full output log for later review.

By default, Claude `stream-json` stdout is compacted in the terminal to key progress lines and the final result so large tool payloads do not flood Codex output. The raw stream is still saved in `.codex-ask-claude/artifacts/*.log` and `.codex-ask-claude/artifacts/*.md`. Use `--raw-live-output` only when debugging the wrapper or Claude protocol output.

## Session Reuse

The wrapper keeps a lightweight Claude session state per workspace so repeated Codex calls can reuse Claude's conversation context. It is not a long-running background process; each run invokes Claude CLI normally, captures the returned `session_id`, and stores it under:

```text
.codex-ask-claude/state/claude-sessions/<session-key>.json
```

On the next run with the same workspace and session key, the wrapper passes `--resume <session_id>` to Claude CLI.

Session controls:

- Default: use session key `default` and resume it when available.
- `--session-key <name>`: keep separate Claude contexts for different tasks, branches, or review threads.
- `--new-session`: ignore the stored session once and replace it with the new returned session.
- `--no-session-reuse`: disable reading and writing session state for one run.
- `--resume-session <uuid>`: explicitly resume a known Claude session id and update the local state.
- `--fork-session`: when resuming, ask Claude CLI to fork into a new session id.

Use separate session keys when prompts contain different secrets, customers, or unrelated task context. Do not rely on session reuse as the source of truth; Codex must still inspect the current files and review the final diff.

## Model Selection

Use the smallest reliable Claude model for the UI task:

- `sonnet` with `medium` effort by default for normal UI implementation, responsive fixes, and component work.
- `sonnet` with `high` effort for larger multi-file UI refactors, tricky stateful interactions, or visual QA corrections.
- `opus` with `high` or `xhigh` effort only for broad redesigns, ambiguous product/UI decisions, complex debugging, or repeated failed Sonnet attempts.

Prefer passing `-FallbackModel opus` when using `sonnet` so overloaded or degraded model calls can recover automatically. For quick cosmetic fixes, leave fallback empty if speed and cost matter more than resilience.

4. Include these constraints in the Claude prompt:

- Preserve unrelated user changes.
- Follow the repository's existing framework, components, styling system, and design language.
- Build the actual usable UI, not an explanatory or marketing page, unless explicitly requested.
- Keep layouts responsive and prevent text overlap on common mobile and desktop widths.
- Use existing icon, component, state, routing, and data patterns when present.
- Edit files directly and summarize changed files.
- Surface only visible CLI output; do not expose private chain-of-thought or hidden reasoning.

For complex UI tasks, read `references/prompt-contract.md` before writing the prompt.

5. After Claude returns, Codex must review the result:

```powershell
git diff --stat
git diff
```

If the diff misses the request or introduces obvious issues, run a focused follow-up Claude pass. Codex should avoid manually editing frontend UI source while this skill is active; keep Codex's role to orchestration, review, verification, and reporting.

6. Verify with the repository's normal commands when available:

- package install/build/typecheck/lint/test scripts
- targeted unit tests for changed behavior
- browser or Playwright checks for visible UI work

## Final Report

Tell the user:

- Claude CLI performed the frontend code edits.
- which files changed
- which verification commands ran and their results
- any remaining risk or blocked check
