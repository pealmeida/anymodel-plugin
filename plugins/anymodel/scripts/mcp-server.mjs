#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "anymodel";
const SERVER_VERSION = "0.3.0";
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPANION_PATH = path.resolve(__dirname, "companion.mjs");

const TOOLS = [
  {
    name: "anymodel_delegate",
    description: "Delegate a task to an engine and return the result.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task to delegate." },
        engine: { type: "string", description: "Engine to use." },
        model: { type: "string", description: "Model identifier." },
        bridge: { type: "string", description: "Bridge/provider identifier." },
        write: { type: "boolean", description: "Allow writing files." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: ["prompt"]
    }
  },
  {
    name: "anymodel_review",
    description: "Run a code review over the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string", description: "Base ref to compare against." },
        engine: { type: "string", description: "Engine to use." },
        model: { type: "string", description: "Model identifier." },
        bridge: { type: "string", description: "Bridge/provider identifier." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: []
    }
  },
  {
    name: "anymodel_adversarial_review",
    description: "Run a portable adversarial review focused on a specific concern.",
    inputSchema: {
      type: "object",
      properties: {
        focus: { type: "string", description: "Focus area or concern for the review." },
        base: { type: "string", description: "Base ref to compare against." },
        engine: { type: "string", description: "Engine to use." },
        model: { type: "string", description: "Model identifier." },
        bridge: { type: "string", description: "Bridge/provider identifier." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: []
    }
  },
  {
    name: "anymodel_status",
    description: "Show active and recent AnyModel jobs.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Optional job identifier to narrow status." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: []
    }
  },
  {
    name: "anymodel_result",
    description: "Show the result of a finished AnyModel job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job identifier." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: ["jobId"]
    }
  },
  {
    name: "anymodel_cancel",
    description: "Cancel an active AnyModel job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job identifier." },
        cwd: { type: "string", description: "Working directory." }
      },
      required: ["jobId"]
    }
  },
  {
    name: "anymodel_models",
    description: "Probe configured model providers for available models.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Optional provider to filter results." }
      },
      required: []
    }
  },
  {
    name: "anymodel_setup",
    description: "Check local engine and provider setup.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  }
];

const TOOL_MAP = {
  anymodel_delegate: { command: "delegate", positionalKey: "prompt" },
  anymodel_review: { command: "review", positionalKey: null },
  anymodel_adversarial_review: { command: "adversarial-review", positionalKey: "focus" },
  anymodel_status: { command: "status", positionalKey: "jobId" },
  anymodel_result: { command: "result", positionalKey: "jobId" },
  anymodel_cancel: { command: "cancel", positionalKey: "jobId" },
  anymodel_models: { command: "models", positionalKey: null },
  anymodel_setup: { command: "setup", positionalKey: null }
};

let messageId = 0;
function nextId() {
  messageId += 1;
  return messageId;
}

function sendMessage(message) {
  const line = JSON.stringify(message);
  process.stdout.write(`${line}\n`);
}

function sendError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  sendMessage({ jsonrpc: "2.0", id, error });
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function log(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

async function handleInitialize(request) {
  const params = request.params ?? {};
  const protocolVersion = params.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
  sendResult(request.id, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
  });
}

function handlePing(request) {
  sendResult(request.id, {});
}

function handleToolsList(request) {
  sendResult(request.id, { tools: TOOLS });
}

function appendFlag(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") {
    args.push(flag, String(value));
  }
}

async function handleToolsCall(request) {
  const params = request.params ?? {};
  const toolName = params.name;
  const args = params.arguments ?? {};

  const mapping = TOOL_MAP[toolName];
  if (!mapping) {
    sendError(request.id, -32602, `Unknown tool: ${toolName}`);
    return;
  }

  const companionArgs = [mapping.command];

  appendFlag(companionArgs, "--engine", args.engine);
  appendFlag(companionArgs, "--model", args.model);
  appendFlag(companionArgs, "--bridge", args.bridge);
  if (args.write === true) {
    companionArgs.push("--write");
  }
  appendFlag(companionArgs, "--cwd", args.cwd);

  if (mapping.positionalKey && args[mapping.positionalKey] !== undefined) {
    companionArgs.push(String(args[mapping.positionalKey]));
  }

  log(`[mcp-server] spawning: ${process.execPath} ${COMPANION_PATH} ${companionArgs.join(" ")}`);

  const child = spawn(process.execPath, [COMPANION_PATH, ...companionArgs], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("companion process timed out after 15 minutes"));
    }, REQUEST_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 0);
    });
  });

  const text = exitCode === 0 ? stdout : (stderr || stdout);
  sendResult(request.id, {
    content: [{ type: "text", text }],
    isError: exitCode !== 0
  });
}

async function dispatchRequest(request) {
  if (request.jsonrpc !== "2.0") {
    sendError(request.id, -32600, "Invalid Request: jsonrpc must be '2.0'");
    return;
  }

  const method = request.method;

  if (method === "initialize") {
    await handleInitialize(request);
  } else if (method === "ping") {
    handlePing(request);
  } else if (method === "tools/list") {
    handleToolsList(request);
  } else if (method === "tools/call") {
    await handleToolsCall(request);
  } else if (method === "notifications/initialized") {
    // no response required for notifications
  } else {
    sendError(request.id, -32601, `Method not found: ${method}`);
  }
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    sendError(null, -32700, "Parse error: invalid JSON");
    return;
  }

  dispatchRequest(request).catch((error) => {
    log("[mcp-server] unhandled dispatch error:", error);
    if (request && typeof request.id !== "undefined") {
      sendError(request.id, -32603, error instanceof Error ? error.message : String(error));
    }
  });
}

function main() {
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      handleLine(buffer);
    }
  });

  process.stdin.on("error", (error) => {
    log("[mcp-server] stdin error:", error);
  });
}

main();
