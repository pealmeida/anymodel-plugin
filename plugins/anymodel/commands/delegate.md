---
description: Delegate a task to any engine and model through the anymodel-runner subagent
argument-hint: "[--engine codex|claude] [--model <provider/model>] [--bridge builtin|litellm] [--write] [--background|--wait] [--resume|--fresh] [what the engine should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `anymodel:anymodel-runner` subagent via the `Agent` tool (`subagent_type: "anymodel:anymodel-runner"`), forwarding the raw user request as the prompt.
`anymodel:anymodel-runner` is a subagent, not a skill — do not call `Skill(anymodel:anymodel-runner)` (no such skill) or `Skill(anymodel:delegate)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
The final user-visible response must be the engine's output verbatim.

Raw user request:
$ARGUMENTS

Flag reference (these are runtime-selection flags — preserve them for the forwarded `delegate` call, do not treat them as part of the natural-language task text):

- `--engine codex|claude` — selects the executor harness. `codex` runs the task through `codex app-server`; `claude` runs it through `claude -p --output-format stream-json`. Default is the configured default engine (see `/anymodel:setup`).
- `--model <provider/model>` — selects what the harness thinks with. Provider prefixes supported by the registry: `zai/` (Z.AI GLM models), `ollama/` (Ollama Cloud gpt-oss / qwen3-coder / minimax), `opencode-go/` (glm / kimi / qwen / deepseek). When omitted, the engine's default model is used. Aliases (e.g. `spark`) resolve via config.
- `--bridge builtin|litellm` — selects how non-native providers are translated to the engine's wire format. `builtin` uses the built-in shim (no external dependency); `litellm` proxies through a LiteLLM bridge instance. Default is `builtin`.
- `--write` — grants the engine write access to the workspace sandbox (read-only is the default unless the engine has a real sandbox and `--write` is passed). Never default `--write` on engines without real sandboxing.

Execution mode:

- If the request includes `--background`, run the `anymodel:anymodel-runner` subagent in the background.
- If the request includes `--wait`, run the `anymodel:anymodel-runner` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them as part of the natural-language task text.
- If the request includes `--resume`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting the engine, check for a resumable thread from this Claude session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" delegate --resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current engine thread or start a new one.
- The two choices must be:
  - `Continue current engine thread`
  - `Start a new engine thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current engine thread (Recommended)` first.
- Otherwise put `Start a new engine thread (Recommended)` first.
- If the user chooses continue, add `--resume` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It makes exactly one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/companion.mjs" delegate ...` and returns that command's stdout as-is.
- Return the companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/anymodel:status`, fetch `/anymodel:result`, call `/anymodel:cancel`, summarize output, or do follow-up work of its own.
- If the helper reports that the engine is missing or unauthenticated, stop and tell the user to run `/anymodel:setup`.
- If the user did not supply a request, ask what the engine should investigate or fix.
