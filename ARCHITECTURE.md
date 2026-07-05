# Any Model Plugin — Architecture

A Claude Code plugin that lets AI agents delegate tasks, run adversarial reviews, and manage
background jobs against **any provider and model**. Derived from OpenAI's `codex-plugin-cc`
(Apache-2.0 — retain LICENSE and NOTICE with attribution), generalized using what we proved
in the LiteLLM bridge work (2026-07-05).

## 1. The core insight: two orthogonal axes

Delegation needs an **executor** (an agent harness that plans, runs commands, edits files in a
sandbox) and a **model** (what the harness thinks with). The Codex plugin hardwires both to
OpenAI. We proved they separate cleanly:

- Executor stays Codex, model becomes anything → **already works today** via the LiteLLM
  bridge (validated agentically on 10 models / 3 providers: Z.AI GLM-4.6→5.2, Ollama Cloud
  gpt-oss/qwen3-coder/minimax, OpenCode Go glm/kimi/qwen/deepseek).
- Executor becomes anything → requires the **engine adapter layer** this project adds.

So the plugin exposes two user-facing knobs:

```
/anymodel:delegate --engine codex --model zai/glm-5.2  fix the flaky test
/anymodel:review   --engine claude                     --base main
```

## 2. Layering (what we keep, what we replace)

The upstream plugin dissection showed three layers. Reuse map:

| Layer | Upstream files | Verdict |
|---|---|---|
| **Surface** (commands/*.md, agents/, skills/, hooks/) | all | Adapt: rename, add `--engine`/`--model` flags; keep the "thin forwarder subagent" pattern verbatim |
| **Orchestration** (args, state, job-control, tracked-jobs, process, workspace, git, render, prompts) | `scripts/lib/*` | Lift as `lib/core/` — provider-neutral already; proven by us driving it against 3 providers unchanged |
| **Engine client** (app-server.mjs, codex.mjs, broker-*) | `scripts/lib/` | Becomes ONE adapter among several behind a new interface |

Also reuse verbatim: `schemas/review-output.schema.json`, `prompts/adversarial-review.md`,
`prompts/stop-review-gate.md`, the detached `task-worker` background-job pattern, and the
`status`/`result`/`cancel` job lifecycle.

## 3. Engine adapter interface

Derived from what the orchestration layer actually consumes (the `TurnCaptureState`
normalization in upstream `codex.mjs` is the spec):

```ts
interface Engine {
  id: string;                                  // "codex" | "claude" | "direct" | ...
  detect(cwd): { available, detail };          // binary present, version gates
  auth(cwd): { loggedIn, detail };
  capabilities(): {
    nativeReview: boolean;      // codex: review/start; others: schema-review fallback
    write: boolean;             // can apply edits (sandboxed)
    resume: boolean;            // thread continuation
    interrupt: boolean;
    modelOverride: boolean;     // per-turn model/provider selection
  };
  startTurn(req: TurnRequest, onEvent): Promise<TurnResult>;
  resumeTurn(threadRef: string, req: TurnRequest, onEvent): Promise<TurnResult>;
  interrupt(threadRef, turnRef): Promise<void>;
}

// TurnRequest: { cwd, prompt, model?, provider?, effort?, sandbox: "read-only"|"workspace-write",
//                outputSchema?, threadName?, persistThread? }
// TurnEvent (normalized): { phase, message, kind: "command"|"fileChange"|"reasoning"|"agentMessage"|..., detail }
// TurnResult: { status, finalMessage, reasoningSummary[], touchedFiles[], threadRef, turnRef, stderr }
```

### Adapter: codex (Phase 0 — port of current behavior)

Wraps `codex app-server` JSON-RPC over stdio + shared broker (lift upstream client wholesale).
Model/provider selection, two mechanisms we validated:

1. **`thread/start` `config` override map** — `{ model_provider, model }` genuinely switches
   provider per thread. Clean UX, but **unofficial API**: silently accepted-and-ignored fields
   are the failure mode (we saw `profile` accepted+ignored). Version-pin Codex; feature-detect
   by confirming traffic lands on the expected base_url (loopback ping route).
2. **`CODEX_HOME` switch** — official, coarse (per-process), our current production path.
   Keep as fallback when (1) breaks.

Known hard constraints (empirically proven, Codex 0.142.5):
- Project-local `.codex/config.toml` **ignores** `model_provider`, `model_providers`, `profile`.
- `wire_api = "chat"` removed; custom providers must serve the **Responses API**.
- Native reviewer (`review/start`) is Codex-only; adversarial review is portable.

### Adapter: claude (Phase 1)

`claude -p --output-format stream-json` (or Agent SDK). Gives Claude-reviewing-Claude and
cross-model checks. Sandbox via permission modes; map stream-json events → TurnEvents.

### Adapter: direct (Phase 2)

A minimal built-in agent loop (read/list/exec/write tools) speaking OpenAI-compatible chat
directly to any provider in the registry. No external CLI dependency; the "any model, no
harness installed" floor. Sandbox = tool whitelist (read-only drops write/exec-mutating tools).

### Adapters: gemini / opencode / … (Phase 3)

Same pattern; add when demanded.

## 4. Provider layer (the model axis)

### Provider registry

Declarative file (user-editable, shippable defaults):

```toml
[providers.zai]
base_url = "https://api.z.ai/api/coding/paas/v4"   # plan-specific endpoints are a real thing
env_key  = "ZAI_API_KEY"
wire     = "chat"
quirks   = ["function-tools-only", "flat-assistant-content", "strict-tool-adjacency"]

[providers.opencode-go]
base_url = "https://opencode.ai/zen/go/v1"          # ≠ zen/v1 (that's pay-as-you-go!)
env_key  = "OPENCODE_API_KEY"
quirks   = ["function-tools-only", "flat-assistant-content", "strict-tool-adjacency",
            "empty-choices-chunks"]
```

Lesson learned: subscription plans live on **different endpoints** than metered APIs
(Z.AI coding/paas/v4, OpenCode zen/go/v1). The registry must model endpoint-per-plan,
and `setup` should probe `/models` on each configured endpoint to verify key↔plan pairing.

### Wire bridging: own the Responses→Chat shim (recommendation)

Today we bridge with a LiteLLM proxy + `openai/chat_completions/*` prefix. It works, but we
had to patch LiteLLM site-packages **three times** (empty-`choices` chunks; assistant
content-lists/empty messages; tool-result adjacency) plus a pre-call tool-type sanitizer.
Those patches die on every `pip install --upgrade`.

**Phase 2 goal: replace the Python proxy with a small Node shim inside the plugin** —
`/v1/responses` in, provider chat-completions out — implementing the quirk pipeline natively.
We already hold the complete event-mapping spec (captured SSE sequences: `response.created` →
`output_item.added` → `output_text.delta`/`function_call` → `response.completed`). Benefits:
no Python dependency, no upgrade-fragile patches, quirks become first-class config.
LiteLLM stays supported as an *optional* backend (spend tracking, fallbacks, 100+ providers)
via `bridge = "litellm" | "builtin"`.

### Quirk pipeline (generalize the three patches)

Transforms applied to outbound chat payloads / inbound streams, keyed by registry flags:

| Quirk flag | Transform | Origin |
|---|---|---|
| `function-tools-only` | strip non-`function` tool types (Codex sends freeform apply_patch, local_shell) | Z.AI: `tools[N].type is illegal` |
| `flat-assistant-content` | assistant content parts-list → string; drop empty assistant msgs | Kimi 400s both |
| `strict-tool-adjacency` | reorder `tool` results directly after their `tool_calls` message (Codex interleaves preamble text) | Kimi enforces OpenAI spec |
| `empty-choices-chunks` | tolerate stream chunks with empty `choices` (usage-only) | Kimi/free tiers crashed the bridge |

Default-on where harmless; all covered by replay tests (below).

## 5. Commands (surface)

| Command | Notes |
|---|---|
| `/anymodel:delegate` | upstream `rescue` renamed; `--engine`, `--model`, `--effort`, `--write`, `--background/--wait`, `--resume/--fresh` |
| `/anymodel:review` | native reviewer when engine supports it, else schema-review; `--base <ref>` |
| `/anymodel:adversarial-review` | portable prompt-template + JSON-schema review, read-only sandbox — works on every engine |
| `/anymodel:status` / `result` / `cancel` | unchanged job lifecycle |
| `/anymodel:models` | NEW: probe registry endpoints' `/models`, show what each key can actually invoke (plan verification built in) |
| `/anymodel:setup` | detect engines, probe providers, manage optional Stop review gate |

Keep upstream's forwarder-subagent discipline: the subagent makes exactly one Bash call to the
companion CLI and returns stdout verbatim (prevents the orchestrating model from "helping").
Model aliases (upstream's `spark`) generalize to user-defined aliases in config.

## 6. Config resolution

Unlike Codex, we own our config, so per-project settings actually work:

```
CLI flags  >  env vars  >  <repo>/.anymodel.toml  >  ~/.config/anymodel/config.toml  >  defaults
```

Config carries: default engine, default model per engine, provider registry overrides,
aliases, review-gate toggle, bridge mode.

## 7. Security & sandboxing honesty

- **codex engine**: real sandbox (approvalPolicy=never + read-only/workspace-write) — inherit.
- **claude engine**: permission modes; document the difference.
- **direct engine**: sandbox is tool-whitelist only — weakest; say so in `capabilities()` and
  surface it in `setup` output. Never default `--write` on engines without real sandboxing.
- Keys live in env/config files, never in argv (visible in `ps`) or job-state files.
- Review gate (Stop hook) can loop expensively — keep upstream's off-by-default + warning.

## 8. Testing strategy

- **Fake-engine fixture** (upstream has `fake-codex-fixture.mjs` — generalize per adapter).
- **Loopback provider**: the `self/echo` mock trick — proxy pointing at itself exercises the
  full wire path with zero keys; keep as `mock/echo` route + CI default.
- **Payload replay harness**: the technique that cracked Kimi — capture outbound payloads,
  replay curl variants, bisect fields. Ship as a dev tool (`companion debug replay`), with
  recorded fixtures for each quirk as regression tests.
- **Live matrix** (opt-in, keys required): the write-and-verify-readback agentic smoke test we
  used, per provider × model, in CI cron.

## 9. Repo layout

```
any-model-plugin/
├── .claude-plugin/marketplace.json
├── LICENSE  NOTICE                      # Apache-2.0, attribution to OpenAI codex-plugin-cc
├── plugins/anymodel/
│   ├── .claude-plugin/plugin.json
│   ├── commands/  agents/  skills/  hooks/  prompts/  schemas/
│   └── scripts/
│       ├── companion.mjs                # CLI entry (subcommand router)
│       └── lib/
│           ├── core/                    # lifted upstream: args, state, jobs, git, render…
│           ├── engines/                 # engine.d.ts + codex.mjs, claude.mjs, direct.mjs…
│           ├── providers/               # registry.mjs, quirks.mjs, bridge-builtin.mjs, bridge-litellm.mjs
│           └── debug/                   # capture + replay harness
└── tests/
```

## 10. Phased roadmap

- **Phase 0 (prove the repo)**: scaffold; lift `lib/core`; codex adapter with CODEX_HOME
  switching + LiteLLM bridge management (current working state, productized); provider
  registry seeded with zai / ollama / opencode-go; `/anymodel:models`; loopback CI test.
- **Phase 1**: claude adapter (headless stream-json); schema-review on non-codex engines;
  `thread/start` config-override fast path with feature detection.
- **Phase 2**: built-in Node Responses→Chat shim + quirk pipeline; drop the mandatory Python
  dependency; replay-fixture regression suite.
- **Phase 3**: gemini/opencode adapters; stop-gate across engines; marketplace publish.

## 11. Risks

| Risk | Mitigation |
|---|---|
| `thread/start` config map is unofficial | version-pin codex; loopback feature-detect; CODEX_HOME fallback |
| LiteLLM upgrades erase patches | Phase 2 builtin shim; until then pin version + patch-apply script |
| Provider quirk drift | quirk registry + replay fixtures; `/anymodel:models` probes |
| Upstream codex-plugin-cc evolves | vendored fork of `lib/core` with sync log; keep file structure parallel to ease diffing |
| Engines' CLI protocols change (claude stream-json, codex app-server) | adapter-level version gates in `detect()` |
```
