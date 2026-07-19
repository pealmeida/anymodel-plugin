/**
 * Built-in minimal agent engine ("direct").
 *
 * A no-dependency adapter that drives OpenAI-compatible chat/completions endpoints
 * directly. It implements a tiny agent loop: the model may call read_file, list_dir,
 * write_file or exec_command tools; results are appended to the conversation and sent
 * back until the model returns a final message or the iteration budget is exhausted.
 *
 * Model selection is registry-prefixed (e.g. "zai/glm-5.2"); the prefix is stripped
 * before the upstream request. Auth is taken from the provider's env_key.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadRegistry, resolveModelProvider } from "../providers/registry.mjs";

const MAX_ITERATIONS = 12;
const USER_AGENT = "anymodel-direct";

/**
 * @typedef {import("./engine.d.ts").TurnRequest} TurnRequest
 * @typedef {import("./engine.d.ts").TurnEvent} TurnEvent
 * @typedef {import("./engine.d.ts").TurnEventSink} TurnEventSink
 * @typedef {import("./engine.d.ts").TurnResult} TurnResult
 * @typedef {import("./engine.d.ts").Engine} Engine
 * @typedef {import("./engine.d.ts").EngineAvailability} EngineAvailability
 * @typedef {import("./engine.d.ts").EngineAuthState} EngineAuthState
 * @typedef {import("./engine.d.ts").EngineCapabilities} EngineCapabilities
 */

/**
 * Ensure a path is contained within the workspace root.
 * @param {string} cwd
 * @param {string} raw
 * @returns {string} resolved absolute path
 * @throws {Error} when the path escapes the workspace
 */
function safeResolve(cwd, raw) {
  const resolved = path.resolve(cwd, raw);
  // Symlink-hardened containment: compare real paths of the workspace root and
  // the deepest existing ancestor of the target, so a symlink inside the
  // workspace cannot point writes/reads outside it.
  const realCwd = fs.realpathSync(cwd);
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.realpathSync(probe);
  const contained = (base, target) =>
    target === base || target.startsWith(base + path.sep);
  if (!contained(realCwd, realProbe) || !contained(realCwd, path.resolve(realProbe, path.relative(probe, resolved)))) {
    throw new Error(`Path escapes workspace: ${raw}`);
  }
  return resolved;
}

/**
 * @param {TurnRequest} req
 * @returns {object}
 */
function buildReadTools(req) {
  return {
    read_file: {
      description: "Read the contents of a file inside the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path relative to cwd" } },
        required: ["path"],
        additionalProperties: false
      }
    },
    list_dir: {
      description: "List files and directories inside a workspace directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path relative to cwd" } },
        required: ["path"],
        additionalProperties: false
      }
    }
  };
}

/**
 * @param {TurnRequest} req
 * @returns {object}
 */
function buildWriteTools(req) {
  if (req.sandbox !== "workspace-write") return {};
  return {
    write_file: {
      description: "Create or overwrite a file inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to cwd" },
          content: { type: "string", description: "Full file content" }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    },
    exec_command: {
      description: "Run a shell command inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  };
}

/**
 * @param {TurnRequest} req
 * @returns {object[]}
 */
function buildTools(req) {
  const defs = { ...buildReadTools(req), ...buildWriteTools(req) };
  return Object.entries(defs).map(([name, spec]) => ({
    type: "function",
    function: { name, ...spec }
  }));
}

/**
 * @param {string} cwd
 * @param {object} toolCall
 * @param {TurnEventSink} onEvent
 * @param {Set<string>} touchedFiles
 * @returns {Promise<string>}
 */
async function runTool(cwd, toolCall, onEvent, touchedFiles) {
  const name = toolCall.function?.name;
  let args = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || "{}");
  } catch {
    return `Invalid JSON arguments for ${name}`;
  }

  try {
    if (name === "read_file") {
      const target = safeResolve(cwd, args.path);
      onEvent({
        phase: "update",
        message: `Reading ${args.path}`,
        kind: "fileChange",
        detail: { path: target, action: "read" }
      });
      return fs.readFileSync(target, "utf8");
    }

    if (name === "list_dir") {
      const target = safeResolve(cwd, args.path || ".");
      onEvent({
        phase: "update",
        message: `Listing ${args.path || "."}`,
        kind: "fileChange",
        detail: { path: target, action: "list" }
      });
      const entries = fs.readdirSync(target, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
    }

    if (name === "write_file") {
      const target = safeResolve(cwd, args.path);
      onEvent({
        phase: "update",
        message: `Writing ${args.path}`,
        kind: "fileChange",
        detail: { path: target, action: "write" }
      });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content ?? "", "utf8");
      touchedFiles.add(target);
      return `Wrote ${args.path}`;
    }

    if (name === "exec_command") {
      onEvent({
        phase: "update",
        message: `Running command`,
        kind: "command",
        detail: { command: args.command }
      });
      try {
        const stdout = execSync(args.command, {
          cwd,
          timeout: 60000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
        return stdout ?? "";
      } catch (err) {
        const exit = err.status ?? (err.signal ? 128 : 1);
        const out = [err.stdout ?? "", err.stderr ?? ""].filter(Boolean).join("\n");
        return `exit ${exit}\n${out}`;
      }
    }

    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {object[]} messages
 * @param {object[]} tools
 * @returns {Promise<object>}
 */
async function chatCompletion(baseUrl, apiKey, messages, tools) {
  const body = {
    model: messages.modelHint,
    messages,
    tools,
    tool_choice: "auto",
    stream: false
  };
  delete body.modelHint;

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

/** @type {Engine} */
const directEngine = {
  id: "direct",

  /** @type {(cwd: string) => Promise<EngineAvailability>} */
  async detect() {
    const hasFetch = typeof globalThis.fetch === "function";
    return {
      available: hasFetch,
      detail: hasFetch ? "global fetch available" : "global fetch not available"
    };
  },

  /** @type {(cwd: string) => Promise<EngineAuthState>} */
  async auth() {
    const registry = loadRegistry();
    const providers = Object.values(registry.providers || {});
    const ready = providers.filter((p) => Boolean(process.env[p.env_key]));
    if (ready.length === 0) {
      return {
        loggedIn: false,
        detail: "No provider API key set in environment"
      };
    }
    return {
      loggedIn: true,
      detail: `${ready.length} provider(s) ready`
    };
  },

  /** @type {() => EngineCapabilities} */
  capabilities() {
    return {
      nativeReview: false,
      write: true,
      resume: false,
      interrupt: false,
      modelOverride: true
    };
  },

  /** @type {(req: TurnRequest, onEvent: TurnEventSink) => Promise<TurnResult>} */
  async startTurn(req, onEvent) {
    const sink = onEvent || (() => {});
    const modelSpec = String(req.model || "").trim();
    const resolved = resolveModelProvider(modelSpec, loadRegistry());
    if (!resolved) {
      throw new Error(`Model must be registry-prefixed (e.g. zai/...); got "${modelSpec}"`);
    }
    const upstreamModel = modelSpec.slice(resolved.providerId.length + 1);
    const apiKey = process.env[resolved.provider.env_key];
    if (!apiKey) {
      throw new Error(`Provider ${resolved.providerId} requires ${resolved.provider.env_key}`);
    }

    sink({ phase: "start", message: "Starting direct turn", kind: "agentMessage" });

    /** @type {object[]} */
    const messages = [
      {
        role: "system",
        content: `You are a coding agent working in ${req.cwd}. Use the provided tools; finish with a final text answer.`
      },
      { role: "user", content: req.prompt }
    ];

    const tools = buildTools(req);
    const touchedFiles = new Set();

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      messages.modelHint = upstreamModel;
      const completion = await chatCompletion(resolved.provider.base_url, apiKey, messages, tools);
      delete messages.modelHint;

      const choice = completion.choices?.[0];
      const message = choice?.message || {};

      if (message.tool_calls?.length) {
        messages.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: message.tool_calls
        });

        for (const toolCall of message.tool_calls) {
          sink({
            phase: "update",
            message: `Tool call: ${toolCall.function?.name}`,
            kind: "reasoning",
            detail: toolCall
          });
          const result = await runTool(req.cwd, toolCall, sink, touchedFiles);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result
          });
        }
        continue;
      }

      const finalMessage = message.content || "";
      sink({
        phase: "complete",
        message: "Turn complete",
        kind: "agentMessage",
        detail: { finalMessage }
      });
      return {
        status: "completed",
        finalMessage,
        reasoningSummary: [],
        touchedFiles: Array.from(touchedFiles),
        threadRef: "",
        turnRef: ""
      };
    }

    throw new Error(`Tool loop exceeded ${MAX_ITERATIONS} iterations`);
  },

  /** @type {(threadRef: string, req: TurnRequest, onEvent: TurnEventSink) => Promise<TurnResult>} */
  async resumeTurn() {
    throw new Error("direct engine does not support resuming threads");
  },

  /** @type {(threadRef: string, turnRef: string) => Promise<void>} */
  async interrupt() {
    throw new Error("direct engine does not support interrupting turns");
  }
};

export default directEngine;
