# Any Model Plugin

A Claude Code plugin that lets AI agents **delegate tasks**, run **adversarial reviews**, and manage **background jobs** from Claude Code to **any provider and model**.

## What it does

- **Delegate work** from Claude Code to another engine/model with a single slash command.
- **Run adversarial reviews** across different models and providers.
- **Manage background jobs** (`status`, `result`, `cancel`) just like the upstream plugin.

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
| Phase 1 | ✅ Done (delegate) | Codex + Claude adapters; per-thread `thread/start` config override (mixed providers on one broker); schema-review still pending |
| Phase 2 | Planned | Built-in Responses→Chat shim; quirk pipeline; replay-fixture regression suite |
| Phase 3 | Planned | Gemini / OpenCode adapters; stop-gate across engines; marketplace publish |

## Attribution

This project derives from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) under the Apache-2.0 license. See `LICENSE` and `NOTICE` for details.
