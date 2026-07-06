# Contributing to Any Model Plugin

## Development setup

- **Node.js 18.18+** (see `package.json` `engines`); check with `node --version`.
- **No dependencies to install** — pure ESM with zero npm deps, so there is no `npm install`.
  Clone and go.
- Verify your checkout:

  ```sh
  node --test tests/shim.test.mjs
  ```

- Keep API keys in your environment or a gitignored `.env` passed to
  `companion.mjs shim --env-file` — never commit them.

## Project layout

Everything lives under `plugins/anymodel/`:

- `scripts/companion.mjs` — **CLI entry point**; a subcommand router every surface calls into.
- `lib/core/` — **orchestration layer** (args, state, jobs, git, render), vendored from
  `openai/codex-plugin-cc`. Keep its structure parallel to upstream to ease **sync**; log any
  divergence in the upstream-sync notes.
- `lib/engines/` — one **adapter per executor** (`codex.mjs`, `claude.mjs`, `direct.mjs`).
  `engine.d.ts` is the **contract** and source of truth for the interface.
- `lib/providers/` — `registry.toml` (provider defs), `quirks.mjs` (the quirk-normalizing
  pipeline), and the built-in **Responses→Chat shim**.
- `scripts/mcp-server.mjs` — exposes capabilities as `anymodel_*` MCP tools for non-Claude
  hosts (Codex, Cursor, Windsurf, VS Code).
- `commands/` and `agents/` — the **Claude Code surface**: thin forwarder commands and runner
  subagents. The subagent makes exactly one Bash call to the CLI and returns stdout verbatim.

## Adding a provider

1. Add a `[providers.<id>]` block to `lib/providers/registry.toml` with `base_url`, `env_key`,
   and `wire` (`"chat"` for OpenAI-compatible chat completions).
2. Add any `quirks = [...]` flags (see existing entries and `quirks.mjs` — e.g.
   `function-tools-only`, `flat-assistant-content`, `strict-tool-adjacency`,
   `empty-choices-chunks`).
3. Smoke-test:

   ```sh
   node plugins/anymodel/scripts/companion.mjs models
   node plugins/anymodel/scripts/companion.mjs delegate --engine direct --model <id>/<model> "hello"
   ```

4. New quirks need a replay fixture under the debug harness for regression coverage.

## Adding an engine

1. Create `lib/engines/<id>.mjs` implementing the **`Engine`** interface in `engine.d.ts`
   (`detect`, `auth`, `capabilities`, `startTurn`, `resumeTurn`, `interrupt`).
2. Register it in `lib/engines/index.mjs` via the `ENGINE_MODULES` map (entry order is the order
   returned by `listEngines()`).
3. `capabilities()` **must be honest about sandboxing**: `codex` has a real sandbox, `claude`
   uses permission modes, `direct` has only tool-level guards (workspace path containment +
   symlink hardening; `write_file`/`exec_command` only in `--write`). Never default `--write`
   on for engines without real sandboxing.
4. Add a fake-engine fixture for unit tests.

## Code style

- **ESM only** (`"type": "module"`); no CommonJS.
- **No external dependencies** — Node standard library only. If you need one, raise an issue first.
- **JSDoc on every export** (parameters, return values, side effects); it stands in for a type
  checker, so keep it accurate.
- `node --check` **must pass** on every file you touch.
- Match surrounding formatting; no new config files or formatters.

## Testing

- **Unit tests** on the built-in Node runner (`node --test tests/shim.test.mjs` or `npm test`).
  Add a test for any shim or quirk behavior change.
- **Live smoke** via the companion CLI, with a mock provider (the `mock/echo` loopback route
  exercises the full wire path with zero keys) or a real model:

  ```sh
  node plugins/anymodel/scripts/companion.mjs delegate --engine direct --model <id>/<model> "ping"
  ```

- The **replay harness** (`companion debug replay`) captures outbound payloads to bisect
  quirks; record a fixture when you fix a new one.

## Pull requests

- Keep PRs **small and focused** — one logical change each.
- **Add or update tests for any behavior change** (new quirks need fixtures; new engines need a
  fake-fixture test).
- **No secrets** — **push protection is on**, so accidental commits will be blocked. Keys live
  in env vars or a gitignored `.env`, never in argv (visible in `ps`) or job-state files.
- Document interface changes in `ARCHITECTURE.md` and keep `engine.d.ts` in sync.
- Don't reformat files you didn't touch.
