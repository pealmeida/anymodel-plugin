import { describe, it } from "node:test";
import assert from "node:assert";

import {
  inputItemsToMessages,
  toolsToChatTools,
  buildChatRequest,
  ChatToResponsesTranslator,
} from "../plugins/anymodel/scripts/lib/providers/shim.mjs";

describe("inputItemsToMessages", () => {
  it("turns instructions into a system message", () => {
    const messages = inputItemsToMessages("Be helpful", [
      { type: "message", role: "user", content: "hi" },
    ]);
    assert.deepStrictEqual(messages, [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("maps developer role to system", () => {
    const messages = inputItemsToMessages(undefined, [
      { type: "message", role: "developer", content: "sys" },
    ]);
    assert.deepStrictEqual(messages, [{ role: "system", content: "sys" }]);
  });

  it("converts function_call to assistant tool_calls with matching call_id", () => {
    const messages = inputItemsToMessages(undefined, [
      {
        type: "function_call",
        call_id: "call_123",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      },
    ]);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].role, "assistant");
    assert.strictEqual(messages[0].tool_calls[0].id, "call_123");
    assert.strictEqual(messages[0].tool_calls[0].type, "function");
    assert.strictEqual(messages[0].tool_calls[0].function.name, "get_weather");
    assert.strictEqual(
      messages[0].tool_calls[0].function.arguments,
      '{"city":"NYC"}'
    );
  });

  it("converts function_call_output to a tool message", () => {
    const messages = inputItemsToMessages(undefined, [
      {
        type: "function_call_output",
        call_id: "call_123",
        output: "sunny",
      },
    ]);
    assert.deepStrictEqual(messages, [
      { role: "tool", tool_call_id: "call_123", content: "sunny" },
    ]);
  });

  it("drops reasoning items", () => {
    const messages = inputItemsToMessages(undefined, [
      { type: "message", role: "user", content: "hi" },
      { type: "reasoning", reasoning: "..." },
    ]);
    assert.deepStrictEqual(messages, [{ role: "user", content: "hi" }]);
  });
});

describe("toolsToChatTools", () => {
  it("converts function tools and drops non-function tools", () => {
    const tools = [
      { type: "function", name: "foo", description: "A foo", parameters: { type: "object", properties: {} } },
      { type: "web_search", name: "bar" },
    ];
    const chatTools = toolsToChatTools(tools);
    assert.strictEqual(chatTools.length, 1);
    assert.strictEqual(chatTools[0].type, "function");
    assert.strictEqual(chatTools[0].function.name, "foo");
  });

  it("returns undefined for an empty tools array", () => {
    assert.strictEqual(toolsToChatTools([]), undefined);
  });

  it("returns undefined for non-array input", () => {
    assert.strictEqual(toolsToChatTools(null), undefined);
    assert.strictEqual(toolsToChatTools(undefined), undefined);
  });
});

describe("buildChatRequest", () => {
  it("moves tool messages next to matching assistant tool_calls", () => {
    const req = {
      instructions: "Be helpful",
      input: [
        { type: "message", role: "user", content: "hi" },
        {
          type: "function_call",
          call_id: "call_123",
          name: "get_weather",
          arguments: '{"city":"NYC"}',
        },
        { type: "message", role: "assistant", content: "ok" },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: "sunny",
        },
      ],
      stream: false,
    };
    const payload = buildChatRequest(req, { id: "openai" }, "gpt-4");
    const roles = payload.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ["system", "user", "assistant", "tool", "assistant"]);
    const toolMsg = payload.messages.find((m) => m.role === "tool");
    assert.strictEqual(toolMsg.tool_call_id, "call_123");
  });

  it("includes stream_options include_usage when streaming", () => {
    const req = {
      input: "hello",
      stream: true,
    };
    const payload = buildChatRequest(req, { id: "openai" }, "gpt-4");
    assert.deepStrictEqual(payload.stream_options, { include_usage: true });
  });
});

describe("ChatToResponsesTranslator", () => {
  it("text deltas emit created, output_item.added, output_text.delta; finish completes with full text", () => {
    const translator = new ChatToResponsesTranslator({ model: "m" });
    const events = translator.feed({ choices: [{ delta: { content: "Hello " } }] });
    events.push(...translator.feed({ choices: [{ delta: { content: "world" } }] }));
    events.push(...translator.finish());

    const types = events.map((e) => e.type);
    assert.strictEqual(types[0], "response.created");
    assert.strictEqual(types[1], "response.in_progress");
    assert.strictEqual(types[2], "response.output_item.added");
    assert.strictEqual(types[3], "response.content_part.added");
    assert.strictEqual(types[4], "response.output_text.delta");
    assert.strictEqual(types[5], "response.output_text.delta");
    assert.ok(types.includes("response.completed"));

    const completed = events.find((e) => e.type === "response.completed");
    assert.strictEqual(completed.response.output.length, 1);
    assert.strictEqual(completed.response.output[0].content[0].text, "Hello world");
  });

  it("tool_call deltas emit function_call events with concatenated arguments", () => {
    const argPart1 = '{"city":';
    const argPart2 = '"NYC"}';
    const translator = new ChatToResponsesTranslator({ model: "m" });
    const events = [];
    events.push(
      ...translator.feed({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_abc", function: { name: "get_weather" } }],
            },
          },
        ],
      })
    );
    events.push(
      ...translator.feed({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argPart1 } }] } }],
      })
    );
    events.push(
      ...translator.feed({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argPart2 } }] } }],
      })
    );
    events.push(...translator.feed({ choices: [{ finish_reason: "tool_calls" }] }));

    const added = events.find((e) => e.type === "response.output_item.added");
    assert.strictEqual(added.item.type, "function_call");
    assert.strictEqual(added.item.name, "get_weather");
    assert.strictEqual(added.item.call_id, "call_abc");

    const argDeltas = events
      .filter((e) => e.type === "response.function_call_arguments.delta")
      .map((e) => e.delta)
      .join("");
    assert.strictEqual(argDeltas, '{"city":"NYC"}');

    const completed = events.find((e) => e.type === "response.output_item.done");
    assert.strictEqual(completed.item.arguments, '{"city":"NYC"}');
  });

  it("empty choices array does not throw", () => {
    const translator = new ChatToResponsesTranslator({ model: "m" });
    assert.doesNotThrow(() => {
      translator.feed({ choices: [] });
    });
  });

  it("usage chunk maps prompt/completion tokens to input/output tokens", () => {
    const translator = new ChatToResponsesTranslator({ model: "m" });
    translator.feed({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 13, total_tokens: 20 } });
    assert.deepStrictEqual(translator.usage, {
      input_tokens: 7,
      output_tokens: 13,
      total_tokens: 20,
    });
  });
});
