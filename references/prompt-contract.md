# Claude Frontend Prompt Contract

Use this template when preparing a Claude CLI prompt for substantial frontend UI work.

```text
You are Claude Code running locally inside this workspace. Implement this frontend UI task by editing files directly.

User request:
<paste the user's exact UI request>

Workspace context:
- cwd: <absolute path>
- frontend stack: <React/Vue/Svelte/Angular/HTML/etc.>
- relevant files: <paths and why they matter>
- available commands: <build/lint/test/dev commands>

Implementation constraints:
- Preserve unrelated user changes.
- Follow existing component, route, styling, data, and state patterns.
- Build the actual usable UI surface, not a feature explanation screen.
- Keep the change scoped to the requested UI task.
- Ensure responsive layout on mobile and desktop.
- Prevent text and controls from overlapping.
- Use existing icon/component libraries when present.
- Avoid adding new dependencies unless the task clearly requires them.

After editing, summarize:
- files changed
- important behavior or visual changes
- verification commands you ran or recommend
```

If Claude's first pass is close but incomplete, send a short follow-up prompt that includes the failing check, the observed issue, and the exact file or UI surface to correct.

Before invoking Claude, choose the smallest permission surface the task needs. For ordinary UI edits, prefer explicit allowed tools such as `Read,Edit,Glob,Grep` and deny risky shell patterns when shell execution is unnecessary. Do not use bypass permission flags from this skill. If Claude asks for surprising command access, stop and ask the user before rerunning with broader permissions.

Use a distinct `--session-key` for each ongoing review, feature, branch, or customer context so Claude can reuse useful conversation state without blending unrelated work. Use `--new-session` when the old Claude context is stale.

For slow network or long model calls, invoke the Node wrapper with live output enabled and a generous outer command timeout. The terminal shows compact progress by default; use the saved `.codex-ask-claude/artifacts/*.log` for the raw stdout/stderr stream, or pass `--raw-live-output` only when debugging protocol-level output.

Model defaults:

- Use `-Model sonnet -Effort medium` for normal frontend work.
- Use `-Model sonnet -Effort high` when the UI task spans many files or needs careful debugging.
- Use `-Model opus -Effort high` only for high-ambiguity redesigns or when Sonnet repeatedly fails.
- Add `-FallbackModel opus` when reliability matters more than speed.
