import { describe, it } from "node:test";
import assert from "node:assert";

import {
  functionToolsOnly,
  flatAssistantContent,
  strictToolAdjacency,
  tolerateEmptyChoicesChunk,
  applyQuirks,
} from "../plugins/anymodel/scripts/lib/providers/quirks.mjs";

describe("functionToolsOnly", () => {
  it("strips non-function tools", () => {
    const payload = {
      tools: [
        { type: "function", function: { name: "read_file" } },
        { type: "web_search", name: "search" },
        { type: "function", function: { name: "write_file" } },
      ],
    };
    const result = functionToolsOnly(payload);
    assert.strictEqual(result.tools.length, 2);
    assert.strictEqual(result.tools[0].type, "function");
    assert.strictEqual(result.tools[1].type, "function");
  });

  it("deletes tools key when all are stripped", () => {
    const payload = {
      tools: [{ type: "web_search", name: "search" }],
    };
    const result = functionToolsOnly(payload);
    assert.strictEqual(result.tools, undefined);
  });

  it("does not mutate the original payload", () => {
    const payload = { tools: [{ type: "function", function: { name: "f" } }] };
    const result = functionToolsOnly(payload);
    assert.notStrictEqual(result, payload);
    assert.notStrictEqual(result.tools, payload.tools);
  });

  it("handles missing tools key", () => {
    const result = functionToolsOnly({ model: "gpt-4" });
    assert.strictEqual(result.tools, undefined);
  });
});

describe("flatAssistantContent", () => {
  it("flattens content arrays of text parts into strings", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    };
    const result = flatAssistantContent(payload);
    assert.strictEqual(result.messages[1].content, "Hello world");
  });

  it("removes assistant messages that become empty", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [] },
        { role: "user", content: "bye" },
      ],
    };
    const result = flatAssistantContent(payload);
    assert.strictEqual(result.messages.length, 2);
    assert.strictEqual(result.messages[0].role, "user");
    assert.strictEqual(result.messages[1].role, "user");
  });

  it("keeps assistant messages with tool_calls even without content", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "f" } }],
        },
      ],
    };
    const result = flatAssistantContent(payload);
    assert.strictEqual(result.messages.length, 2);
    assert.strictEqual(result.messages[1].role, "assistant");
    assert.strictEqual(result.messages[1].content, null);
    assert.ok(result.messages[1].tool_calls);
  });

  it("does not mutate the original payload", () => {
    const payload = { messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] };
    const result = flatAssistantContent(payload);
    assert.notStrictEqual(result, payload);
    assert.notStrictEqual(result.messages, payload.messages);
  });
});

describe("strictToolAdjacency", () => {
  it("moves tool messages next to their matching assistant tool_calls", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "let me check",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather" } }],
        },
        { role: "assistant", content: "some preamble" },
        { role: "tool", tool_call_id: "call_1", content: "sunny" },
      ],
    };
    const result = strictToolAdjacency(payload);
    const roles = result.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ["user", "assistant", "tool", "assistant"]);
  });

  it("keeps orphan tool messages in place", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "orphan", content: "data" },
      ],
    };
    const result = strictToolAdjacency(payload);
    assert.strictEqual(result.messages.length, 2);
    assert.strictEqual(result.messages[1].role, "tool");
  });

  it("handles multiple tool calls from one assistant message", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "f1" } },
            { id: "call_2", type: "function", function: { name: "f2" } },
          ],
        },
        { role: "tool", tool_call_id: "call_2", content: "result2" },
        { role: "tool", tool_call_id: "call_1", content: "result1" },
      ],
    };
    const result = strictToolAdjacency(payload);
    const roles = result.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ["user", "assistant", "tool", "tool"]);
  });
});

describe("tolerateEmptyChoicesChunk", () => {
  it("returns a safe empty-delta chunk for empty choices", () => {
    const chunk = { choices: [], usage: { total_tokens: 5 } };
    const result = tolerateEmptyChoicesChunk(chunk);
    assert.strictEqual(result.choices.length, 1);
    assert.deepStrictEqual(result.choices[0].delta, {});
    assert.strictEqual(result.usage.total_tokens, 5);
  });

  it("returns original chunk when choices has entries", () => {
    const chunk = { choices: [{ delta: { content: "hi" } }] };
    const result = tolerateEmptyChoicesChunk(chunk);
    assert.strictEqual(result, chunk);
  });

  it("handles null/undefined input", () => {
    assert.strictEqual(tolerateEmptyChoicesChunk(null), null);
    assert.strictEqual(tolerateEmptyChoicesChunk(undefined), undefined);
  });
});

describe("applyQuirks", () => {
  it("applies multiple quirks in order", () => {
    const payload = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          tool_calls: [{ id: "call_1", type: "function", function: { name: "f" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
      tools: [
        { type: "function", function: { name: "f" } },
        { type: "web_search", name: "s" },
      ],
    };
    const result = applyQuirks(payload, [
      "function-tools-only",
      "flat-assistant-content",
      "strict-tool-adjacency",
    ]);
    assert.strictEqual(result.tools.length, 1);
    assert.strictEqual(result.messages[1].content, "ok");
    const roles = result.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ["user", "assistant", "tool"]);
  });

  it("handles empty flags array", () => {
    const payload = { model: "gpt-4" };
    const result = applyQuirks(payload, []);
    assert.deepStrictEqual(result, payload);
  });

  it("ignores unknown flags", () => {
    const payload = { model: "gpt-4" };
    const result = applyQuirks(payload, ["unknown-quirk"]);
    assert.deepStrictEqual(result, payload);
  });
});
