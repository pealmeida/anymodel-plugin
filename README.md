# Any Model Plugin

A Claude Code plugin that lets AI agents **delegate tasks**, run **adversarial reviews**, and manage **background jobs** from Claude Code to **any provider and model**.

## What it does

- **Delegate work** from Claude Code to another engine/model with a single slash command.
- **Run adversarial reviews** across different models and providers.
- **Manage background jobs** (`status`, `result`, `cancel`) just like the upstream plugin.

## Use it from any agent host

Claude Code is one of three surfaces — the same CLI powers all of them:

- **Universal CLI**: `node plugins/anymodel/scripts/companion.mjs <command>` (or `npx anymodel`) from any shell or agent.
- **MCP server**: `plugins/anymodel/scripts/mcp-server.mjs` exposes every capability as `anymodel_*` tools in any MCP host — Claude Code, Codex, Cursor, Windsurf, VS Code. See [INTEGRATIONS.md](INTEGRATIONS.md).
- **Claude Code native plugin**: `/anymodel:*` commands via the marketplace install below.

## The two-axes concept

Delegation is built on two orthogonal ideas:

- **Executor harness** — the agent runtime that plans, runs commands, edits files, and manages sandboxes (e.g., Codex, Claude).
- **Model** — the underlying provider/model the harness uses to reason and respond.

The Codex plugin hardwires both to OpenAI. This project separates them so you can mix and match:

```
/anymodel:delegate --engine codex  --model zai/glm-5.2  fix the flaky test
/anymodel:review   --engine claude --base main
```

## Quick start

_TODO: installation, setup, and first-delegate steps once Phase 0 scaffolding is complete._

## Roadmap

| Phase | Status | Goal |
|-------|--------|------|
| Phase 0 | ✅ Done | Scaffold repo; lift core orchestration; codex adapter + LiteLLM bridge; provider registry; loopback CI test |
| Phase 1 | ✅ Done | Codex + Claude adapters; per-thread config override (mixed providers on one broker); native + schema reviews on all engines |
| Phase 2 | ✅ Done | Built-in Responses→Chat shim (`companion.mjs shim`, `--bridge builtin`); quirk pipeline; unit test suite |
| Phase 3 | ✅ Done | Plugin command surface + runner agent; `models`/`setup`; `direct` engine; local marketplace install |

## Attribution

This project derives from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) under the Apache-2.0 license. See `LICENSE` and `NOTICE` for details.
