---
description: Delegate through an interactive provider and model selection chain
argument-hint: "[<provider/model>|<provider>] [--engine codex|claude|direct] [--bridge builtin|litellm] [--write] [task]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Delegate a task after helping the user choose the provider/model. This is the delegation-focused semantic chain for users who know they want execution, but not necessarily which model to use.

Raw user request:
`$ARGUMENTS`

Selection rules:

- If the request contains `--model <provider/model>`, preserve it and skip model selection.
- If it contains a natural model token such as `zai/glm-5.2`, `ollama/qwen3-coder`, or `opencode-go/kimi`, convert that to `--model <token>`.
- If it contains only a provider id, run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" models --provider <provider> --json
  ```
  Then ask the user to choose one reachable model returned for that provider.
- If it contains no provider/model, run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" models --json
  ```
  Then ask the user to choose from up to three reachable `<provider>/<model>` options.
- Ignore providers where `ok` is false or no models are returned.
- If no reachable model exists, return the models output verbatim and tell the user to run `/anymodel:setup`.

Task rules:

- Preserve runtime flags exactly: `--engine`, `--bridge`, `--write`, `--background`, `--wait`, `--resume`, `--fresh`, `--cwd`.
- If no task remains after removing provider/model selector words, ask what the selected model should investigate, solve, or implement.
- Do not rewrite the user's task.

Dispatch:

- Invoke the `anymodel:anymodel-runner` subagent via the `Agent` tool (`subagent_type: "anymodel:anymodel-runner"`), forwarding the final request as if the user had called `/anymodel:delegate`.
- The final request must include `--model <selected provider/model>`.
- The subagent must make exactly one Bash call to:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" delegate <final arguments>
  ```
- Return the companion stdout verbatim. Do not summarize or add commentary.

