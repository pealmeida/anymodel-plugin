import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.resolve(__dirname, "../plugins/anymodel/scripts/mcp-server.mjs");

// Live-fire tests that hit real provider APIs are opt-in: they spend tokens and
// depend on network/credentials, so they only run with ANYMODEL_LIVE_TESTS=1.
const LIVE = Boolean(process.env.ANYMODEL_LIVE_TESTS);
const LIVE_SKIP = LIVE ? false : "set ANYMODEL_LIVE_TESTS=1 to run live provider tests";

// Env vars that can inject provider credentials into the spawned server
// (directly, or via an env file the server auto-loads at startup).
const CREDENTIAL_ENV_KEYS = ["ANYMODEL_ENV_FILE", "ZAI_API_KEY", "OLLAMA_API_KEY", "OPENCODE_API_KEY"];

function hermeticEnv() {
  const env = { ...process.env };
  for (const key of CREDENTIAL_ENV_KEYS) delete env[key];
  return env;
}

function sendMCP(messages, timeoutMs = 10000, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP_SERVER], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP server timed out"));
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      resolve({ code, lines, stderr });
    });

    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + "\n");
    }
    child.stdin.end();
  });
}

describe("mcp-server.mjs", () => {
  describe("initialize", () => {
    it("responds with server info", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      ]);
      const init = lines.find((m) => m.id === 1);
      assert.ok(init);
      assert.ok(init.result);
      assert.strictEqual(init.result.serverInfo.name, "anymodel");
      assert.strictEqual(init.result.serverInfo.version, "0.3.1");
      assert.strictEqual(init.result.protocolVersion, "2025-06-18");
      assert.ok(init.result.capabilities.tools);
    });
  });

  describe("ping", () => {
    it("responds with empty result", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]);
      const pong = lines.find((m) => m.id === 2);
      assert.ok(pong);
      assert.deepStrictEqual(pong.result, {});
    });
  });

  describe("tools/list", () => {
    it("returns 8 tools with correct names", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      const toolsResp = lines.find((m) => m.id === 2);
      assert.ok(toolsResp);
      assert.ok(Array.isArray(toolsResp.result.tools));
      assert.strictEqual(toolsResp.result.tools.length, 8);

      const names = toolsResp.result.tools.map((t) => t.name).sort();
      assert.deepStrictEqual(names, [
        "adversarial_review",
        "cancel",
        "delegate",
        "models",
        "result",
        "review",
        "setup",
        "status",
      ]);
    });

    it("each tool has a name, description, and inputSchema", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      const toolsResp = lines.find((m) => m.id === 2);
      for (const tool of toolsResp.result.tools) {
        assert.strictEqual(typeof tool.name, "string", `tool missing name`);
        assert.ok(tool.name.length > 0, `tool has empty name`);
        assert.strictEqual(typeof tool.description, "string", `${tool.name}: missing description`);
        assert.ok(tool.description.length > 0, `${tool.name}: empty description`);
        assert.ok(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name}: missing inputSchema`);
      }
    });
  });

  describe("tools/call", () => {
    it("calls models tool and returns content", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "models", arguments: {} } },
      ], 10000, hermeticEnv());
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.ok(result.result.content.length > 0);
      assert.strictEqual(result.result.content[0].type, "text");
      assert.ok(result.result.content[0].text.includes("AnyModel Providers"));
    });

    it("calls setup tool and returns content", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "setup", arguments: {} } },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.ok(result.result.content[0].text.includes("AnyModel Setup"));
    });

    it("calls status tool and returns content", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.ok(result.result.content[0].text.includes("AnyModel Status"));
    });

    it("returns error for unknown tool", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nonexistent", arguments: {} } },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.error);
      assert.strictEqual(result.error.code, -32602);
    });

    // Hermetic variants: credentials are scrubbed, so the direct engine fails
    // fast on the missing-key path instead of making a live API call.
    it("calls delegate tool with prompt (missing key surfaces as tool error)", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegate", arguments: { prompt: "hello", engine: "direct", model: "zai/glm-5.2" } } },
      ], 10000, hermeticEnv());
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.strictEqual(result.result.isError, true);
      assert.ok(result.result.content[0].text.includes("ZAI_API_KEY"));
    });

    it("calls review tool (missing key surfaces as tool error)", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "review", arguments: { engine: "direct", model: "zai/glm-5.2" } } },
      ], 10000, hermeticEnv());
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.strictEqual(result.result.isError, true);
      assert.ok(result.result.content[0].text.includes("ZAI_API_KEY"));
    });

    it("calls adversarial_review tool (missing key surfaces as tool error)", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "adversarial_review", arguments: { engine: "direct", model: "zai/glm-5.2" } } },
      ], 10000, hermeticEnv());
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      assert.strictEqual(result.result.isError, true);
      assert.ok(result.result.content[0].text.includes("ZAI_API_KEY"));
    });

    it("live: delegate tool returns content", { skip: LIVE_SKIP }, async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegate", arguments: { prompt: "hello", engine: "direct", model: "zai/glm-5.2" } } },
      ], 60000);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
    });

    it("live: review tool returns content", { skip: LIVE_SKIP }, async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "review", arguments: { engine: "direct", model: "zai/glm-5.2" } } },
      ], 60000);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
    });

    it("live: adversarial_review tool returns content", { skip: LIVE_SKIP }, async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "adversarial_review", arguments: { engine: "direct", model: "zai/glm-5.2" } } },
      ], 60000);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
    });

    it("calls result tool with jobId", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "result", arguments: { jobId: "nonexistent" } } },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.strictEqual(result.result.isError, true);
    });

    it("calls cancel tool with jobId", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cancel", arguments: { jobId: "nonexistent" } } },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.strictEqual(result.result.isError, true);
    });
  });

  describe("notifications/initialized", () => {
    it("does not respond to notifications", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]);
      const pong = lines.find((m) => m.id === 2);
      assert.ok(pong);
      assert.deepStrictEqual(pong.result, {});
    });
  });

  describe("error handling", () => {
    it("returns error response when delegate is called without prompt", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegate", arguments: {} } },
      ], 30000);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.result);
      assert.ok(Array.isArray(result.result.content));
      const text = result.result.content[0].text;
      assert.ok(text.includes("A prompt is required"));
    });

    it("returns method not found for unknown methods", async () => {
      const { lines } = await sendMCP([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", id: 2, method: "unknown/method" },
      ]);
      const result = lines.find((m) => m.id === 2);
      assert.ok(result);
      assert.ok(result.error);
      assert.strictEqual(result.error.code, -32601);
    });
  });
});
