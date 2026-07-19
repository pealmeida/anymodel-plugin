# Any Model Plugin

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/pealmeida/anymodel-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/pealmeida/anymodel-plugin/actions/workflows/ci.yml)

A Claude Code plugin that lets AI agents **delegate tasks**, run **adversarial reviews**, and manage **background jobs** from Claude Code to **any provider and model**.

## What it does

- **Delegate work** from Claude Code to another engine/model with a single slash command.
- **Run adversarial reviews** across different models and providers.
- **Manage background jobs** (`status`, `result`, `cancel`) just like the upstream plugin.

## Use it from any agent host

Claude Code is one of three surfaces — the same CLI powers all of them:

- **Universal CLI**: `node plugins/anymodel/scripts/companion.mjs <command>` (or `npx anymodel`) from any shell or agent.
- **MCP server**: `plugins/anymodel/scripts/mcp-server.mjs` exposes every capability as tools in any MCP host — Claude Code, Codex, Cursor, Windsurf, VS Code. See [INTEGRATIONS.md](INTEGRATIONS.md).
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

For a guided provider/model selection flow, use the semantic chain commands:

```
/anymodel:choose delegate with zai fix the flaky test
/anymodel:delegate-with ollama implement the parser guard
/anymodel:review-with opencode-go --base main challenge the architecture
```

Those commands probe reachable providers with `/anymodel:models`, ask for the
missing provider/model choice, then dispatch to the same companion CLI runtime.

## Quick start

### Prerequisites

- **Node.js 18.18+** — check with `node --version`.
- **No npm install needed** — the plugin has zero dependencies.

### Install as a Claude Code plugin

```bash
# Clone the repository
git clone https://github.com/pealmeida/anymodel-plugin.git
cd anymodel-plugin

# Register the marketplace and install
claude plugin marketplace add .
claude plugin install anymodel@any-model
```

### Use the CLI directly

```bash
# Delegate a task
node plugins/anymodel/scripts/companion.mjs delegate --engine direct --model zai/glm-5.2 "explain this codebase"

# Run a review
node plugins/anymodel/scripts/companion.mjs review --base main

# Check available models
node plugins/anymodel/scripts/companion.mjs models

# Verify your setup
node plugins/anymodel/scripts/companion.mjs setup
```

### Use as an MCP server

Add to your MCP host config (Claude Code, Codex, Cursor, Windsurf, VS Code):

```json
{
  "mcpServers": {
    "anymodel": {
      "command": "node",
      "args": ["/absolute/path/to/anymodel-plugin/plugins/anymodel/scripts/mcp-server.mjs"]
    }
  }
}
```

### Configure providers

Set API keys in your environment:

```bash
export ZAI_API_KEY="your-key"
export OLLAMA_API_KEY="your-key"
export OPENCODE_API_KEY="your-key"
```

Or load from a file:

```bash
node plugins/anymodel/scripts/companion.mjs shim --env-file ~/.anymodel.env
```

See [INTEGRATIONS.md](INTEGRATIONS.md) for detailed setup across different hosts.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — design, engine adapters, provider layer, config resolution
- [INTEGRATIONS.md](INTEGRATIONS.md) — CLI, MCP, and Claude Code native plugin setup
- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, adding providers/engines, testing
- [SECURITY.md](SECURITY.md) — API keys, sandboxing, bridge isolation, vulnerability reporting

## Roadmap

| Phase | Status | Goal |
|-------|--------|------|
| Phase 0 | Done | Scaffold repo; lift core orchestration; codex adapter + LiteLLM bridge; provider registry; loopback CI test |
| Phase 1 | Done | Codex + Claude adapters; per-thread config override (mixed providers on one broker); native + schema reviews on all engines |
| Phase 2 | Done | Built-in Responses→Chat shim (`companion.mjs shim`, `--bridge builtin`); quirk pipeline; unit test suite |
| Phase 3 | Done | Plugin command surface + runner agent; `models`/`setup`; `direct` engine; local marketplace install |
| Phase 4 | In progress | Semantic `/anymodel:*` chains for guided provider/model selection before delegation or adversarial review |

## Attribution

This project derives from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) under the Apache-2.0 license. See `LICENSE` and `NOTICE` for details.

## Security

- **API keys are never stored in this repository.** Providers are configured with
  `env_key` references in `registry.toml`; keys come from your environment or a
  local env file you pass to `companion.mjs shim --env-file` (keep it outside the
  repo — `.env` files are gitignored).
- **Sandboxing varies by engine.** The `codex` engine runs inside Codex's own
  sandbox; the `claude` engine uses Claude Code permission modes; the built-in
  `direct` engine has only tool-level guards (workspace path containment,
  symlink-hardened; `write_file`/`exec_command` exist only in `--write` mode).
  Don't point `--engine direct --write` at repositories you can't afford to
  mutate, and treat model output as untrusted input.
- The bridge (shim or LiteLLM) listens on `127.0.0.1` only.
- Found a vulnerability? Please open a private security advisory rather than a
  public issue.

## License

Apache-2.0 — see `LICENSE` and `NOTICE`.
