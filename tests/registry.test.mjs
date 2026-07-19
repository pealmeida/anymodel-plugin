import { describe, it } from "node:test";
import assert from "node:assert";

import { parseRegistry, loadRegistry, resolveModelProvider, isBridgeModel, BRIDGE_TEST_PREFIXES } from "../plugins/anymodel/scripts/lib/providers/registry.mjs";

describe("parseRegistry", () => {
  it("parses a single provider section", () => {
    const text = `
[providers.zai]
base_url = "https://api.z.ai/v4"
env_key  = "ZAI_API_KEY"
wire     = "chat"
quirks   = ["function-tools-only", "flat-assistant-content"]
`;
    const result = parseRegistry(text);
    assert.ok(result.providers.zai);
    assert.strictEqual(result.providers.zai.base_url, "https://api.z.ai/v4");
    assert.strictEqual(result.providers.zai.env_key, "ZAI_API_KEY");
    assert.strictEqual(result.providers.zai.wire, "chat");
    assert.deepStrictEqual(result.providers.zai.quirks, ["function-tools-only", "flat-assistant-content"]);
  });

  it("parses multiple providers", () => {
    const text = `
[providers.zai]
base_url = "https://api.z.ai/v4"
env_key  = "ZAI_API_KEY"

[providers.ollama]
base_url = "https://ollama.com/v1"
env_key  = "OLLAMA_API_KEY"
`;
    const result = parseRegistry(text);
    assert.strictEqual(Object.keys(result.providers).length, 2);
    assert.ok(result.providers.zai);
    assert.ok(result.providers.ollama);
  });

  it("handles multi-line array values", () => {
    const text = `
[providers.opencode-go]
base_url = "https://opencode.ai/zen/go/v1"
env_key  = "OPENCODE_API_KEY"
quirks   = ["function-tools-only", "flat-assistant-content",
            "empty-choices-chunks"]
`;
    const result = parseRegistry(text);
    assert.deepStrictEqual(result.providers["opencode-go"].quirks, [
      "function-tools-only",
      "flat-assistant-content",
      "empty-choices-chunks"
    ]);
  });

  it("strips inline comments", () => {
    const text = `
[providers.zai]
base_url = "https://api.z.ai/v4" # the base endpoint
env_key  = "ZAI_API_KEY"
`;
    const result = parseRegistry(text);
    assert.strictEqual(result.providers.zai.base_url, "https://api.z.ai/v4");
  });

  it("handles empty quirks array", () => {
    const text = `
[providers.ollama]
base_url = "https://ollama.com/v1"
env_key  = "OLLAMA_API_KEY"
quirks   = []
`;
    const result = parseRegistry(text);
    assert.deepStrictEqual(result.providers.ollama.quirks, []);
  });

  it("returns empty providers for empty input", () => {
    const result = parseRegistry("");
    assert.deepStrictEqual(result.providers, {});
  });
});

describe("loadRegistry", () => {
  it("loads the shipped registry.toml", () => {
    const registry = loadRegistry();
    assert.ok(registry.providers);
    assert.ok(registry.providers.zai);
    assert.ok(registry.providers.ollama);
    assert.ok(registry.providers["opencode-go"]);
    assert.strictEqual(registry.providers.zai.env_key, "ZAI_API_KEY");
  });
});

describe("resolveModelProvider", () => {
  it("resolves zai/glm-5.2 to the zai provider", () => {
    const result = resolveModelProvider("zai/glm-5.2");
    assert.ok(result);
    assert.strictEqual(result.providerId, "zai");
    assert.strictEqual(result.provider.env_key, "ZAI_API_KEY");
  });

  it("resolves ollama/qwen3-coder to the ollama provider", () => {
    const result = resolveModelProvider("ollama/qwen3-coder");
    assert.ok(result);
    assert.strictEqual(result.providerId, "ollama");
  });

  it("returns null for unprefixed models", () => {
    assert.strictEqual(resolveModelProvider("gpt-4"), null);
    assert.strictEqual(resolveModelProvider(""), null);
    assert.strictEqual(resolveModelProvider("claude-sonnet"), null);
  });

  it("returns null for unknown prefixes", () => {
    assert.strictEqual(resolveModelProvider("unknown/model"), null);
  });
});

describe("isBridgeModel", () => {
  it("returns true for registry-prefixed models", () => {
    assert.strictEqual(isBridgeModel("zai/glm-5.2"), true);
    assert.strictEqual(isBridgeModel("ollama/qwen3-coder"), true);
  });

  it("returns true for bridge test prefixes", () => {
    assert.strictEqual(isBridgeModel("mock/echo"), true);
    assert.strictEqual(isBridgeModel("self/loopback"), true);
  });

  it("returns false for unprefixed models", () => {
    assert.strictEqual(isBridgeModel("gpt-4"), false);
    assert.strictEqual(isBridgeModel(""), false);
  });

  it("returns false for unknown prefixes", () => {
    assert.strictEqual(isBridgeModel("unknown/model"), false);
  });
});

describe("BRIDGE_TEST_PREFIXES", () => {
  it("contains mock and self", () => {
    assert.ok(BRIDGE_TEST_PREFIXES.has("mock"));
    assert.ok(BRIDGE_TEST_PREFIXES.has("self"));
  });
});
