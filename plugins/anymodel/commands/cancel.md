---
description: Cancel an active background AnyModel job in this repository
argument-hint: '[job-id]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" cancel "$ARGUMENTS"`
