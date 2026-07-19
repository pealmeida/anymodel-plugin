---
description: Pick an AnyModel action, provider, and model through an interactive semantic chain
argument-hint: "[delegate|review] [with <provider/model>] [--engine codex|claude|direct] [--write] [task or review focus]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Guide the user through a semantic AnyModel chain, then dispatch to the existing runtime. This command is a selector only; do not implement delegation or review logic here.

Raw user request:
`$ARGUMENTS`

Semantic chain:

1. Determine the action.
   - If the request clearly says `delegate`, `execute`, `run`, `fix`, `implement`, or `solve`, choose `delegate`.
   - If it says `review`, `adversarial`, `challenge`, `critique`, or `audit`, choose `adversarial-review`.
   - Otherwise use `AskUserQuestion` once:
     - `Delegate task`
     - `Adversarial review`

2. Determine provider/model.
   - First preserve any explicit `--model <provider/model>` argument.
   - Also accept natural forms like `with zai/glm-5.2`, `using ollama/qwen3-coder`, or `on opencode-go/kimi`.
   - If an exact `<provider>/<model>` is not present, run:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" models --json
     ```
   - Parse the JSON. Ignore providers with `ok: false` or an empty `models` list.
   - If no usable provider/model is available, stop and return the models output verbatim, then tell the user to run `/anymodel:setup`.
   - If the user named a provider but not a model, ask them to choose one reachable model for that provider.
   - If the user named neither provider nor model, ask them to choose from the most useful reachable options. Prefer showing up to three concrete choices as `<provider>/<model>`, using the provider/model names exactly as returned by `models --json`.

3. Determine the engine.
   - Preserve any explicit `--engine <id>`.
   - If omitted, do not ask. Let the companion runtime use its configured default engine.

4. Determine the work text.
   - For `delegate`, require a task. If the request does not include one after removing action/provider/model selection words, ask what the selected model should investigate, solve, or implement.
   - For `adversarial-review`, focus text is optional. Preserve any provided focus text exactly.

5. Dispatch.
   - Build a final argument string from the original flags that are still relevant, the selected `--model <provider/model>`, and the task/focus text.
   - Preserve `--engine`, `--bridge`, `--write`, `--base`, `--scope`, `--wait`, `--background`, `--resume`, and `--fresh` when present.
   - Do not include selector-only words like `delegate with`, `review using`, or `choose`.

Delegate dispatch:

- Invoke the `anymodel:anymodel-runner` subagent via the `Agent` tool (`subagent_type: "anymodel:anymodel-runner"`), forwarding the final request as if the user had called `/anymodel:delegate`.
- The subagent must make exactly one Bash call to:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" delegate <final arguments>
  ```
- Return the companion stdout verbatim.

Adversarial review dispatch:

- Run:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" adversarial-review <final arguments>
  ```
- Return stdout verbatim. Do not summarize, fix, or add commentary after the review.

