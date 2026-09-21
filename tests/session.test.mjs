import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

import { getSessionId, buildProviderHeaders, _resetSessionCache } from "../plugins/anymodel/scripts/lib/providers/session.mjs";

describe("getSessionId", () => {
  beforeEach(() => {
    _resetSessionCache();
  });

  it("generates a UUID-format session ID", () => {
    const sessionId = getSessionId({});
    assert.ok(sessionId);
    assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns the same session ID on subsequent calls", () => {
    const id1 = getSessionId({});
    const id2 = getSessionId({});
    assert.strictEqual(id1, id2);
  });

  it("respects OPENCODE_SESSION env override", () => {
    const customId = "custom-session-123";
    const env = { OPENCODE_SESSION: customId };
    const sessionId = getSessionId(env);
    assert.strictEqual(sessionId, customId);
  });

  it("respects X_OPENCODE_SESSION env override", () => {
    const customId = "custom-session-456";
    const env = { X_OPENCODE_SESSION: customId };
    const sessionId = getSessionId(env);
    assert.strictEqual(sessionId, customId);
  });

  it("prefers OPENCODE_SESSION over X_OPENCODE_SESSION", () => {
    const env = {
      OPENCODE_SESSION: "priority-session",
      X_OPENCODE_SESSION: "fallback-session"
    };
    const sessionId = getSessionId(env);
    assert.strictEqual(sessionId, "priority-session");
  });

  it("trims whitespace from environment override", () => {
    const env = { OPENCODE_SESSION: "  trimmed-id  " };
    const sessionId = getSessionId(env);
    assert.strictEqual(sessionId, "trimmed-id");
  });

  it("generates new UUID when env override is empty", () => {
    const env = { OPENCODE_SESSION: "   " };
    const sessionId = getSessionId(env);
    assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("buildProviderHeaders", () => {
  beforeEach(() => {
    _resetSessionCache();
  });

  it("builds standard headers for non-OpenCode providers", () => {
    const headers = buildProviderHeaders("zai", "test-api-key");
    assert.strictEqual(headers["content-type"], "application/json");
    assert.strictEqual(headers.authorization, "Bearer test-api-key");
    assert.strictEqual(headers["user-agent"], "anymodel");
    assert.strictEqual(headers["x-opencode-session"], undefined);
  });

  it("includes x-opencode-session header for opencode-go provider", () => {
    const headers = buildProviderHeaders("opencode-go", "test-api-key");
    assert.strictEqual(headers["content-type"], "application/json");
    assert.strictEqual(headers.authorization, "Bearer test-api-key");
    assert.strictEqual(headers["user-agent"], "anymodel");
    assert.ok(headers["x-opencode-session"]);
    assert.match(headers["x-opencode-session"], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("respects custom userAgent option", () => {
    const headers = buildProviderHeaders("zai", "test-api-key", { userAgent: "custom-agent" });
    assert.strictEqual(headers["user-agent"], "custom-agent");
  });

  it("uses env override for opencode-go session ID", () => {
    const env = { OPENCODE_SESSION: "custom-session" };
    const headers = buildProviderHeaders("opencode-go", "test-api-key", { env });
    assert.strictEqual(headers["x-opencode-session"], "custom-session");
  });

  it("uses same session ID across multiple calls", () => {
    const headers1 = buildProviderHeaders("opencode-go", "test-api-key");
    const headers2 = buildProviderHeaders("opencode-go", "test-api-key");
    assert.strictEqual(headers1["x-opencode-session"], headers2["x-opencode-session"]);
  });

  it("does not add session header for ollama provider", () => {
    const headers = buildProviderHeaders("ollama", "test-api-key");
    assert.strictEqual(headers["x-opencode-session"], undefined);
  });
});

describe("_resetSessionCache", () => {
  it("allows generating a new session ID after reset", () => {
    const id1 = getSessionId({});
    _resetSessionCache();
    const id2 = getSessionId({});
    assert.notStrictEqual(id1, id2);
  });
});
