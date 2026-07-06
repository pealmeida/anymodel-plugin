---
description: Probe configured model providers and show what each key can actually invoke
argument-hint: '[--engine <id>] [--provider <id>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" models "$ARGUMENTS"
```

Present the full command output to the user exactly as returned. Do not summarize or condense it. Preserve all details including:
- Each provider's endpoint, auth status, and reachable `/models` list
- Which models each key can actually invoke, per provider
- Plan-verification results built into the probe (capability vs. wire-format checks)
- Any error messages or unreachable endpoints
- Follow-up commands such as `/anymodel:setup` and `/anymodel:delegate`
