/**
 * Codex engine adapter.
 *
 * Drives the local `codex app-server` (vendored client in ../core/codex.mjs).
 * Model routing:
 *   - engine-native model (or none)  -> default provider from the user's codex config
 *   - registry-prefixed model (zai/…, ollama/…, opencode-go/…, mock/…, self/…)
 *     -> per-thread config override { model_provider: "litellm", model } through the
 *        local bridge proxy. Requires [model_providers.litellm] in the user-level
 *        ~/.codex/config.toml (verified by `setup`). This avoids CODEX_HOME env
 *        switching entirely, so a shared broker can serve mixed-provider turns.
 *
 * The config override is unofficial app-server API (verified on codex-cli 0.142.x);
 * `detect()` gates on the codex binary, and setup verification should confirm
 * bridge routing with a mock/echo turn.
 */
import {
  getCodexAvailability,
  getCodexAuthStatus,
  interruptAppServerTurn,
  runAppServerReview,
  runAppServerTurn
} from "../core/codex.mjs";
import { isBridgeModel } from "../providers/registry.mjs";

// Bridge provider ids must exist as [model_providers.<id>] in the user-level
// codex config: "litellm" (external proxy, port 4000) or "anymodel" (built-in
// shim, `companion.mjs shim`, port 4001).
const BRIDGE_PROVIDERS = { litellm: "litellm", builtin: "anymodel" };
const DEFAULT_BRIDGE = process.env.ANYMODEL_BRIDGE === "builtin" ? "builtin" : "litellm";

function bridgeProviderId(req) {
  const key = req.bridge && BRIDGE_PROVIDERS[req.bridge] ? req.bridge : DEFAULT_BRIDGE;
  return BRIDGE_PROVIDERS[key];
}

function buildTurnOptions(req) {
  const model = req.model?.trim() || null;
  const options = {
    prompt: req.prompt,
    model,
    effort: req.effort ?? null,
    sandbox: req.sandbox === "workspace-write" ? "workspace-write" : "read-only",
    outputSchema: req.outputSchema ?? null,
    persistThread: Boolean(req.persistThread),
    threadName: req.threadName ?? null,
    resumeThreadId: req.resumeThreadRef ?? null,
    disableBroker: Boolean(req.disableBroker)
  };
  if (model && isBridgeModel(model)) {
    options.configOverride = { model_provider: bridgeProviderId(req), model };
  }
  return options;
}

function toTurnResult(result) {
  return {
    status: result.status === 0 ? "completed" : "failed",
    exitStatus: result.status,
    finalMessage: result.finalMessage ?? "",
    reasoningSummary: result.reasoningSummary ?? [],
    touchedFiles: result.touchedFiles ?? [],
    threadRef: result.threadId ?? null,
    turnRef: result.turnId ?? null,
    stderr: result.stderr ?? "",
    raw: result
  };
}

const codexEngine = {
  id: "codex",

  async detect(cwd = process.cwd()) {
    return getCodexAvailability(cwd);
  },

  async auth(cwd = process.cwd()) {
    const status = await getCodexAuthStatus(cwd);
    return { loggedIn: Boolean(status.loggedIn), detail: status.detail ?? "" };
  },

  capabilities() {
    return {
      nativeReview: true,
      write: true,
      resume: true,
      interrupt: true,
      modelOverride: true
    };
  },

  async startTurn(req, onEvent) {
    const result = await runAppServerTurn(req.cwd, {
      ...buildTurnOptions(req),
      onProgress: onEvent ?? null
    });
    return toTurnResult(result);
  },

  /**
   * Native built-in reviewer (review/start). `nativeTarget` is the codex
   * ReviewTarget ({type:"uncommittedChanges"} | {type:"baseBranch",branch}).
   * Bridge models work here too via the per-thread config override.
   */
  async startReview(req, onEvent) {
    const model = req.model?.trim() || null;
    const options = {
      target: req.nativeTarget,
      model,
      onProgress: onEvent ?? null
    };
    if (model && isBridgeModel(model)) {
      options.configOverride = { model_provider: bridgeProviderId(req), model };
    }
    const result = await runAppServerReview(req.cwd, options);
    return {
      status: result.status === 0 ? "completed" : "failed",
      exitStatus: result.status,
      finalMessage: result.reviewText ?? "",
      reasoningSummary: result.reasoningSummary ?? [],
      touchedFiles: [],
      threadRef: result.threadId ?? null,
      turnRef: result.turnId ?? null,
      stderr: result.stderr ?? "",
      raw: result
    };
  },

  async resumeTurn(threadRef, req, onEvent) {
    return this.startTurn({ ...req, resumeThreadRef: threadRef }, onEvent);
  },

  async interrupt(threadRef, turnRef, cwd = process.cwd()) {
    return interruptAppServerTurn(cwd, { threadId: threadRef, turnId: turnRef });
  }
};

export default codexEngine;
