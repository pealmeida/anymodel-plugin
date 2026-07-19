import { describe, it } from "node:test";
import assert from "node:assert";

import { parseArgs, splitRawArgumentString } from "../plugins/anymodel/scripts/lib/core/args.mjs";

describe("parseArgs", () => {
  it("parses value options with --key value", () => {
    const { options, positionals } = parseArgs(
      ["--engine", "codex", "--model", "zai/glm-5.2", "fix the test"],
      { valueOptions: ["engine", "model"], booleanOptions: [] }
    );
    assert.strictEqual(options.engine, "codex");
    assert.strictEqual(options.model, "zai/glm-5.2");
    assert.deepStrictEqual(positionals, ["fix the test"]);
  });

  it("parses value options with --key=value", () => {
    const { options } = parseArgs(
      ["--engine=codex", "--model=zai/glm-5.2"],
      { valueOptions: ["engine", "model"], booleanOptions: [] }
    );
    assert.strictEqual(options.engine, "codex");
    assert.strictEqual(options.model, "zai/glm-5.2");
  });

  it("parses boolean flags", () => {
    const { options } = parseArgs(
      ["--write", "--json", "--background"],
      { valueOptions: [], booleanOptions: ["write", "json", "background"] }
    );
    assert.strictEqual(options.write, true);
    assert.strictEqual(options.json, true);
    assert.strictEqual(options.background, true);
  });

  it("parses boolean flags with --flag=false", () => {
    const { options } = parseArgs(
      ["--write=false"],
      { valueOptions: [], booleanOptions: ["write"] }
    );
    assert.strictEqual(options.write, false);
  });

  it("resolves aliases", () => {
    const { options } = parseArgs(
      ["-e", "codex", "-m", "zai/glm-5.2", "-w"],
      {
        aliasMap: { e: "engine", m: "model", w: "write" },
        valueOptions: ["engine", "model"],
        booleanOptions: ["write"]
      }
    );
    assert.strictEqual(options.engine, "codex");
    assert.strictEqual(options.model, "zai/glm-5.2");
    assert.strictEqual(options.write, true);
  });

  it("handles -- separator for passthrough", () => {
    const { options, positionals } = parseArgs(
      ["--engine", "codex", "--", "--not-a-flag", "task"],
      { valueOptions: ["engine"], booleanOptions: [] }
    );
    assert.strictEqual(options.engine, "codex");
    assert.deepStrictEqual(positionals, ["--not-a-flag", "task"]);
  });

  it("throws on missing value for --key", () => {
    assert.throws(() => {
      parseArgs(["--engine"], { valueOptions: ["engine"], booleanOptions: [] });
    }, /Missing value for --engine/);
  });

  it("throws on missing value for short flag", () => {
    assert.throws(() => {
      parseArgs(["-e"], { aliasMap: { e: "engine" }, valueOptions: ["engine"], booleanOptions: [] });
    }, /Missing value for -e/);
  });

  it("treats unknown flags as positionals", () => {
    const { positionals } = parseArgs(
      ["--unknown", "value"],
      { valueOptions: [], booleanOptions: [] }
    );
    assert.deepStrictEqual(positionals, ["--unknown", "value"]);
  });

  it("handles empty argv", () => {
    const { options, positionals } = parseArgs([], { valueOptions: [], booleanOptions: [] });
    assert.deepStrictEqual(options, {});
    assert.deepStrictEqual(positionals, []);
  });
});

describe("splitRawArgumentString", () => {
  it("splits on whitespace", () => {
    assert.deepStrictEqual(
      splitRawArgumentString("--engine codex --write fix the test"),
      ["--engine", "codex", "--write", "fix", "the", "test"]
    );
  });

  it("preserves quoted strings", () => {
    assert.deepStrictEqual(
      splitRawArgumentString('--prompt "fix the flaky test"'),
      ["--prompt", "fix the flaky test"]
    );
  });

  it("preserves single-quoted strings", () => {
    assert.deepStrictEqual(
      splitRawArgumentString("--prompt 'fix it'"),
      ["--prompt", "fix it"]
    );
  });

  it("handles escaped characters", () => {
    assert.deepStrictEqual(
      splitRawArgumentString("path\\ with\\ spaces"),
      ["path with spaces"]
    );
  });

  it("handles empty string", () => {
    assert.deepStrictEqual(splitRawArgumentString(""), []);
  });
});
