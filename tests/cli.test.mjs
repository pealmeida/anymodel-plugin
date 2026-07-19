import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(__dirname, "../plugins/anymodel/scripts/companion.mjs");

function runCompanion(args = [], env = {}) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10000,
  });
}

describe("companion.mjs CLI", () => {
  describe("help and usage", () => {
    it("prints usage with --help", () => {
      const result = runCompanion(["--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
      assert.ok(result.stdout.includes("delegate"));
      assert.ok(result.stdout.includes("review"));
      assert.ok(result.stdout.includes("status"));
    });

    it("prints usage with -h", () => {
      const result = runCompanion(["-h"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });

    it("prints usage with no arguments", () => {
      const result = runCompanion([]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });

    it("errors on unknown command", () => {
      const result = runCompanion(["nonexistent"]);
      assert.notStrictEqual(result.status, 0);
      assert.ok(result.stderr.includes("Unknown command"));
    });
  });

  describe("models", () => {
    it("returns JSON with --json flag", () => {
      const result = runCompanion(["models", "--json"]);
      assert.strictEqual(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.command, "models");
      assert.ok(Array.isArray(parsed.providers));
    });

    it("returns human-readable output without --json", () => {
      const result = runCompanion(["models"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("AnyModel Providers"));
    });

    it("filters by provider with --provider flag", () => {
      const result = runCompanion(["models", "--provider", "zai", "--json"]);
      assert.strictEqual(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.ok(Array.isArray(parsed.providers));
      for (const p of parsed.providers) {
        assert.strictEqual(p.providerId, "zai");
      }
    });

    it("prints help with --help", () => {
      const result = runCompanion(["models", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("setup", () => {
    it("returns JSON with --json flag", () => {
      const result = runCompanion(["setup", "--json"]);
      assert.strictEqual(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.command, "setup");
      assert.ok(Array.isArray(parsed.engines));
    });

    it("returns human-readable output without --json", () => {
      const result = runCompanion(["setup"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("AnyModel Setup"));
      assert.ok(result.stdout.includes("Engines:"));
    });

    it("prints help with --help", () => {
      const result = runCompanion(["setup", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("status", () => {
    it("returns JSON with --json flag", () => {
      const result = runCompanion(["status", "--json"]);
      assert.strictEqual(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.sessionRuntime);
      assert.ok(Array.isArray(parsed.running));
      assert.ok(Array.isArray(parsed.recent));
    });

    it("returns human-readable output without --json", () => {
      const result = runCompanion(["status"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("AnyModel Status"));
    });

    it("prints help with --help", () => {
      const result = runCompanion(["status", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("result", () => {
    it("errors when no job id is provided", () => {
      const result = runCompanion(["result"]);
      assert.notStrictEqual(result.status, 0);
    });

    it("prints help with --help", () => {
      const result = runCompanion(["result", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("cancel", () => {
    it("errors when no job id is provided and no active jobs", () => {
      const result = runCompanion(["cancel"]);
      assert.notStrictEqual(result.status, 0);
    });

    it("prints help with --help", () => {
      const result = runCompanion(["cancel", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("delegate", () => {
    it("produces output (may fail without API keys)", () => {
      const result = runCompanion(["delegate", "--json", "--engine", "direct", "--model", "zai/glm-5.2", "hello"]);
      const output = result.stdout || result.stderr;
      assert.ok(output.length > 0, "should produce some output");
    });

    it("prints help with --help", () => {
      const result = runCompanion(["delegate", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("review", () => {
    it("produces output (may fail without API keys)", () => {
      const result = runCompanion(["review", "--json", "--engine", "direct", "--model", "zai/glm-5.2"]);
      const output = result.stdout || result.stderr;
      assert.ok(output.length > 0, "should produce some output");
    });

    it("prints help with --help", () => {
      const result = runCompanion(["review", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("adversarial-review", () => {
    it("produces output (may fail without API keys)", () => {
      const result = runCompanion(["adversarial-review", "--json", "--engine", "direct", "--model", "zai/glm-5.2"]);
      const output = result.stdout || result.stderr;
      assert.ok(output.length > 0, "should produce some output");
    });

    it("prints help with --help", () => {
      const result = runCompanion(["adversarial-review", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("shim", () => {
    it("prints help with --help", () => {
      const result = runCompanion(["shim", "--help"]);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes("Usage:"));
    });
  });

  describe("output normalization", () => {
    it("normalizes Codex branding in error messages", () => {
      const result = runCompanion(["nonexistent"]);
      assert.notStrictEqual(result.status, 0);
      assert.ok(!result.stderr.includes("/codex:"));
    });
  });
});
