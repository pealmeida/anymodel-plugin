import { describe, it } from "node:test";
import assert from "node:assert";

import { engineIds, listEngines, getEngine } from "../plugins/anymodel/scripts/lib/engines/index.mjs";

describe("engineIds", () => {
  it("returns the ordered list of engine ids", () => {
    const ids = engineIds();
    assert.ok(Array.isArray(ids));
    assert.ok(ids.includes("codex"));
    assert.ok(ids.includes("claude"));
    assert.ok(ids.includes("direct"));
    assert.strictEqual(ids[0], "codex");
  });

  it("returns a frozen array", () => {
    const ids = engineIds();
    assert.throws(() => { ids.push("new"); }, TypeError);
  });
});

describe("listEngines", () => {
  it("returns entries for all registered engines", () => {
    const engines = listEngines();
    assert.strictEqual(engines.length, 3);
    const ids = engines.map((e) => e.id);
    assert.deepStrictEqual(ids, ["codex", "claude", "direct"]);
  });

  it("reports codex adapter as available (file exists)", () => {
    const engines = listEngines();
    const codex = engines.find((e) => e.id === "codex");
    assert.ok(codex);
    assert.strictEqual(codex.available, true);
  });

  it("reports claude adapter as available (file exists)", () => {
    const engines = listEngines();
    const claude = engines.find((e) => e.id === "claude");
    assert.ok(claude);
    assert.strictEqual(claude.available, true);
  });

  it("reports direct adapter as available (file exists)", () => {
    const engines = listEngines();
    const direct = engines.find((e) => e.id === "direct");
    assert.ok(direct);
    assert.strictEqual(direct.available, true);
  });
});

describe("getEngine", () => {
  it("loads the codex engine adapter", async () => {
    const module = await getEngine("codex");
    assert.ok(module);
    assert.ok(module.default);
    assert.strictEqual(module.default.id, "codex");
  });

  it("loads the claude engine adapter", async () => {
    const module = await getEngine("claude");
    assert.ok(module);
    assert.ok(module.default);
    assert.strictEqual(module.default.id, "claude");
  });

  it("loads the direct engine adapter", async () => {
    const module = await getEngine("direct");
    assert.ok(module);
    assert.ok(module.default);
    assert.strictEqual(module.default.id, "direct");
  });

  it("throws for unknown engine id", async () => {
    await assert.rejects(
      () => getEngine("nonexistent"),
      /unknown engine: nonexistent/
    );
  });

  it("caches loaded modules", async () => {
    const first = await getEngine("codex");
    const second = await getEngine("codex");
    assert.strictEqual(first, second);
  });

  it("all engines implement the Engine interface", async () => {
    for (const id of engineIds()) {
      const module = await getEngine(id);
      const engine = module.default;
      assert.strictEqual(typeof engine.id, "string", `${id}: missing id`);
      assert.strictEqual(typeof engine.detect, "function", `${id}: missing detect`);
      assert.strictEqual(typeof engine.auth, "function", `${id}: missing auth`);
      assert.strictEqual(typeof engine.capabilities, "function", `${id}: missing capabilities`);
      assert.strictEqual(typeof engine.startTurn, "function", `${id}: missing startTurn`);
      assert.strictEqual(typeof engine.resumeTurn, "function", `${id}: missing resumeTurn`);
      assert.strictEqual(typeof engine.interrupt, "function", `${id}: missing interrupt`);
    }
  });

  it("all engines report honest capabilities", async () => {
    for (const id of engineIds()) {
      const module = await getEngine(id);
      const engine = module.default;
      const caps = engine.capabilities();
      assert.strictEqual(typeof caps.nativeReview, "boolean", `${id}: nativeReview`);
      assert.strictEqual(typeof caps.write, "boolean", `${id}: write`);
      assert.strictEqual(typeof caps.resume, "boolean", `${id}: resume`);
      assert.strictEqual(typeof caps.interrupt, "boolean", `${id}: interrupt`);
      assert.strictEqual(typeof caps.modelOverride, "boolean", `${id}: modelOverride`);
    }
  });

  it("direct engine detect returns available when fetch exists", async () => {
    const module = await getEngine("direct");
    const engine = module.default;
    const result = await engine.detect();
    assert.strictEqual(result.available, typeof globalThis.fetch === "function");
  });

  it("direct engine auth reports provider readiness", async () => {
    const module = await getEngine("direct");
    const engine = module.default;
    const result = await engine.auth();
    assert.strictEqual(typeof result.loggedIn, "boolean");
    assert.strictEqual(typeof result.detail, "string");
  });
});
