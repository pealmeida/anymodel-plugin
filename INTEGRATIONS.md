# Integrations — Any Model Plugin from any agent host

Any Model Plugin runs from **any** agent host that can spawn a process or speak MCP. The same
`companion.mjs` CLI powers every surface, so behavior is identical across hosts — only the glue
differs.

## 1. Universal CLI

`plugins/anymodel/scripts/companion.mjs` is a pure-ESM Node script with zero runtime deps. Any
shell, agent, or CI runner that can spawn a process can drive it directly:

```bash
ANY="$HOME/anymodel-plugin/plugins/anymodel/scripts/companion.mjs"

# Delegate a task to an engine/model (codex|claude|direct)
node "$ANY" delegate --engine codex --model zai/glm-5.2 --write "fix the flaky auth test"

# Adversarial review against the current branch (portable, every engine)
node "$ANY" review --engine claude --base main --scope working-tree

# See what each provider key can actually invoke
node "$ANY" models
```

Turn subcommands accept `--engine`, `--model`, `--provider`, `--effort`, `--base`, `--write`,
`--background`/`--wait`, `--resume`/`--fresh`, `--json`. Job lifecycle: `status`, `result`,
`cancel`. Config resolves: CLI flags > env > `./.anymodel.toml` >
`~/.config/anymodel/config.toml` > defaults. Works unchanged from bash, GitHub Actions, GitLab
CI, n8n/Zapier, or any custom agent loop.

## 2. MCP server (any MCP-capable host)

The server lives at `plugins/anymodel/scripts/mcp-server.mjs` — **stdio** transport, exposing
the surface as tools (`delegate`, `review`, `adversarial_review`, `models`, `status`, `result`,
`cancel`, `setup`). Every host uses the same config
shape; only the file location and (sometimes) the top-level key differ:

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

Per-host locations and notes:

- **Claude Code** — `claude mcp add anymodel -- node /abs/path/mcp-server.mjs`, or drop the JSON
  above into a project-level `.mcp.json`.
- **Codex CLI** — TOML in `~/.codex/config.toml`:
  ```toml
  [mcp_servers.anymodel]
  command = "node"
  args    = ["/absolute/path/to/anymodel-plugin/plugins/anymodel/scripts/mcp-server.mjs"]
  ```
- **Cursor** — `.cursor/mcp.json` in the workspace (the JSON shape above).
- **Windsurf** — `~/.codeium/windsurf/mcp_config.json` (same shape).
- **VS Code** — `.vscode/mcp.json` in the workspace (same shape).

Always use absolute paths — hosts resolve `command` from their own working directory. After
registration the tools appear alongside the host's native tool set.

## 3. Claude Code native plugin

For the richest experience, install as a first-class plugin to get the `/anymodel:*` slash
commands (`choose`, `delegate-with`, `review-with`, `delegate`, `review`,
`adversarial-review`, `models`, `setup`, `status`, `result`, `cancel`) with subagent routing,
guided model selection, and resume prompts:

```bash
claude plugin marketplace add /path/to/anymodel-plugin
claude plugin install anymodel@any-model
```

Then from any session:

```
/anymodel:choose delegate with zai fix the flaky test
/anymodel:delegate-with ollama --write implement the parser guard
/anymodel:review-with opencode-go --base main challenge the architecture
/anymodel:delegate --engine codex --model zai/glm-5.2 --write fix the flaky test
/anymodel:review   --engine claude --base main
/anymodel:setup
```

The native commands wrap the same `companion.mjs` calls from §1, so behavior matches the CLI and
MCP paths exactly.

## 4. Requirements

- **Node.js 18+** — companion CLI and MCP server are pure ESM, no npm install step.
- **Provider API keys** — set in env (`ZAI_API_KEY`, `OLLAMA_API_KEY`, `OPENCODE_API_KEY`, …)
  or load from a file via the `ANYMODEL_ENV_FILE` environment variable (or `companion.mjs shim --env-file ~/.anymodel.env`). Keys never appear in
  argv or job-state files.
- **codex CLI** — only needed for the `codex` engine (`codex app-server`); install with
  `npm install -g @openai/codex`.
- **claude CLI** — only needed for the `claude` engine (`claude -p --output-format stream-json`).
- **direct engine** — needs nothing but provider keys: a built-in agent loop speaking
  OpenAI-compatible chat to any registry provider. Sandbox is a tool whitelist (weakest); use
  `--write` deliberately.

Run `node companion.mjs setup` (or `/anymodel:setup`) to confirm which engines and providers
are available in your environment.
