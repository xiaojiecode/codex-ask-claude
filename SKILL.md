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

If `claude` is missing, check whether `.omx/state/claude-install-declined.json` exists in the target workspace. If it exists, do not ask again; tell the user Claude CLI is still missing and that a prior decline marker exists. If it does not exist, ask the user whether Codex should install and configure Claude CLI.

If the user declines installation/configuration, record the choice so future runs do not repeat the same question:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remember-claude-install-declined.ps1 `
  -Workspace "D:\path\to\workspace" `
  -Reason "User declined Claude CLI setup for frontend delegation."
```

2. Inspect the target workspace enough to produce a precise implementation prompt:

```powershell
Get-ChildItem
rg --files
```

Read the package/build files and only the UI files needed to understand the task.

3. Ask Claude CLI to make the frontend edits directly. Prefer the bundled wrapper because it captures live stdout/stderr, writes a run log, and leaves an artifact:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\invoke-claude-frontend.ps1 `
  -Workspace "D:\path\to\workspace" `
  -Model sonnet `
  -Effort medium `
  -FallbackModel opus `
  -Prompt "<precise implementation prompt>"
```

Use a direct `claude -p "<prompt>"` call only if the wrapper is unavailable.

The wrapper is designed for slow or flaky network runs. It waits for long-running calls, streams visible CLI output as it arrives, and records the full output log for later review.

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
