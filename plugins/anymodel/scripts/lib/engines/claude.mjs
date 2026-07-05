/**
 * Claude Code engine adapter (headless).
 *
 * Drives `claude -p --output-format json`. Phase 1 scope: single-shot turns,
 * coarse progress (start/finish), sandbox mapped to permission mode:
 *   read-only        -> default -p permissions (writes denied)
 *   workspace-write  -> --permission-mode acceptEdits
 * Model override uses `--model` (Claude model ids; registry-prefixed bridge
 * models are not routable through this engine).
 */
import { spawn } from "node:child_process";
import { binaryAvailable } from "../core/process.mjs";

function runClaude(args, cwd, onEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    onEvent?.({ message: "Claude headless turn started.", phase: "starting" });
  });
}

const claudeEngine = {
  id: "claude",

  async detect(cwd = process.cwd()) {
    return binaryAvailable("claude", ["--version"], { cwd });
  },

  async auth(cwd = process.cwd()) {
    const status = binaryAvailable("claude", ["--version"], { cwd });
    return {
      loggedIn: status.available,
      detail: status.available
        ? `claude CLI present (${status.detail}); auth is checked at run time`
        : status.detail
    };
  },

  capabilities() {
    return {
      nativeReview: false,
      write: true,
      resume: false,
      interrupt: false,
      modelOverride: true
    };
  },

  async startTurn(req, onEvent) {
    const args = ["-p", req.prompt, "--output-format", "json"];
    if (req.model) args.push("--model", req.model);
    if (req.sandbox === "workspace-write") args.push("--permission-mode", "acceptEdits");

    const { code, stdout, stderr } = await runClaude(args, req.cwd, onEvent);

    let finalMessage = stdout.trim();
    let raw = null;
    try {
      raw = JSON.parse(stdout);
      finalMessage = raw.result ?? finalMessage;
    } catch {
      // non-JSON output: keep raw stdout as the message
    }
    onEvent?.({ message: "Claude headless turn finished.", phase: "finalizing" });

    return {
      status: code === 0 ? "completed" : "failed",
      exitStatus: code,
      finalMessage,
      reasoningSummary: [],
      touchedFiles: [],
      threadRef: raw?.session_id ?? null,
      turnRef: null,
      stderr,
      raw
    };
  },

  async resumeTurn() {
    throw new Error("claude engine does not support resume yet (Phase 1).");
  },

  async interrupt() {
    throw new Error("claude engine does not support interrupt.");
  }
};

export default claudeEngine;
