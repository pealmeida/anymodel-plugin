---
description: Run an adversarial review through an interactive provider and model selection chain
argument-hint: "[<provider/model>|<provider>] [--engine codex|claude|direct] [--base <ref>] [--scope auto|working-tree|branch] [focus]"
allowed-tools: Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial review after helping the user choose the provider/model. This is the review-focused semantic chain for users who want a selected model to challenge the current implementation while the main CLI model orchestrates the command.

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

Review rules:

- Preserve runtime and review flags exactly: `--engine`, `--base`, `--scope`, `--wait`, `--background`, `--cwd`.
- Preserve any focus text exactly after removing provider/model selector words.
- This command is review-only. Do not fix issues, apply patches, or suggest that you are about to make changes.

Foreground dispatch:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" adversarial-review <final arguments>
```

Background dispatch:

- If the final arguments include `--background`, launch the Bash command in the background and do not wait for completion.
- Tell the user exactly: "AnyModel adversarial review started in the background. Check `/anymodel:status` for progress."

Return foreground stdout verbatim. Do not summarize, fix, or add commentary after the review.

