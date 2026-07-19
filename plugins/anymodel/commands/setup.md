---
description: Check local engine and provider setup, and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" setup --json $ARGUMENTS
```

If the result says the default engine is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install it now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install engine (Recommended)`
  - `Skip for now`
- If the user chooses install, follow the engine's documented install procedure (for `codex`, `npm install -g @openai/codex`), then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" setup --json $ARGUMENTS
```

If the engine is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If the engine is installed but not authenticated, preserve the guidance to run its login command (for `codex`, `!codex login`).
- Preserve provider-registry probe results and any review-gate state changes.
