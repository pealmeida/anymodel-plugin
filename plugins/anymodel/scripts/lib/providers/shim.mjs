/**
 * Responses→Chat translation core (Phase 2, ARCHITECTURE.md §4).
 *
 * Codex speaks the OpenAI Responses API (`wire_api = "responses"`). Most
 * providers speak chat-completions. This module converts:
 *   - a Responses API request  -> a chat-completions request (per provider,
 *     with the quirk pipeline applied), and
 *   - a chat-completions SSE stream -> Responses API SSE events.
 *
 * The event sequence mirrors what Codex accepts (captured from live traffic):
 *   response.created -> response.in_progress
 *   -> [message]      output_item.added -> content_part.added
 *                     -> output_text.delta* -> content_part.done -> output_item.done
 *   -> [function call] output_item.added -> function_call_arguments.delta*
 *                     -> function_call_arguments.done -> output_item.done
 *   -> response.completed (full output array + usage)
 * Data-only SSE frames (`data: {"type": ...}`) are sufficient — no `event:` lines.
 */
import crypto from "node:crypto";

import { applyQuirks, tolerateEmptyChoicesChunk } from "./quirks.mjs";

function rid(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function contentPartsToString(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && typeof p === "object" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/**
 * Convert Responses API `input` items (+ `instructions`) into chat messages.
 * Roles: developer -> system. reasoning items are dropped. function_call /
 * function_call_output become assistant tool_calls / tool messages.
 */
export function inputItemsToMessages(instructions, input) {
  const messages = [];
  if (instructions && String(instructions).trim()) {
    messages.push({ role: "system", content: String(instructions) });
  }

  const items = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : Array.isArray(input) ? input : [];

  for (const item of items) {
    const type = item?.type ?? "message";
    if (type === "function_call") {
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id: item.call_id ?? item.id ?? rid("call"),
            type: "function",
            function: { name: item.name ?? "", arguments: item.arguments ?? "" }
          }
        ]
      });
      continue;
    }
    if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? item.id ?? "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "")
      });
      continue;
    }
    if (type === "reasoning") continue;
    if (type === "message") {
      const role = item.role === "developer" ? "system" : item.role ?? "user";
      const content = contentPartsToString(item.content);
      messages.push({ role, content });
    }
  }
  return messages;
}

/** Convert Responses-format tools to chat tools; non-function tools are dropped. */
export function toolsToChatTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const chatTools = tools
    .filter((t) => t && t.type === "function")
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.parameters ?? { type: "object", properties: {} }
      }
    }));
  return chatTools.length > 0 ? chatTools : undefined;
}

/**
 * Build the upstream chat-completions request for a provider.
 * @param {object} req - Responses API request body.
 * @param {{ id: string, quirks?: string[] }} provider - Registry entry (id + quirks).
 * @param {string} upstreamModel - Model id with the provider prefix stripped.
 */
export function buildChatRequest(req, provider, upstreamModel) {
  let payload = {
    model: upstreamModel,
    messages: inputItemsToMessages(req.instructions, req.input),
    stream: Boolean(req.stream)
  };
  const tools = toolsToChatTools(req.tools);
  if (tools) {
    payload.tools = tools;
    if (req.tool_choice && typeof req.tool_choice === "string") payload.tool_choice = req.tool_choice;
    if (typeof req.parallel_tool_calls === "boolean") payload.parallel_tool_calls = req.parallel_tool_calls;
  }
  if (typeof req.max_output_tokens === "number") payload.max_tokens = req.max_output_tokens;
  if (typeof req.temperature === "number") payload.temperature = req.temperature;
  if (payload.stream) payload.stream_options = { include_usage: true };

  // Always-on hygiene quirks plus the provider's registry flags.
  const flags = new Set(["flat-assistant-content", "strict-tool-adjacency", ...(provider?.quirks ?? [])]);
  payload = applyQuirks(payload, [...flags]);
  return payload;
}

/**
 * Stateful translator: feed parsed chat-completions stream chunks, receive
 * Responses API events (objects; caller serializes to SSE).
 */
export class ChatToResponsesTranslator {
  constructor({ model }) {
    this.model = model;
    this.responseId = rid("resp");
    this.outputIndex = -1;
    this.mode = null; // "text" | "tool"
    this.textItemId = null;
    this.textBuffer = "";
    this.toolCalls = []; // accumulating {itemId, callId, name, args}
    this.currentToolIndex = null;
    this.completedItems = [];
    this.usage = null;
    this.started = false;
  }

  #responseEnvelope(status) {
    return {
      id: this.responseId,
      object: "response",
      model: this.model,
      status,
      output: status === "completed" ? this.completedItems : [],
      usage: this.usage
    };
  }

  start() {
    this.started = true;
    return [
      { type: "response.created", response: this.#responseEnvelope("in_progress") },
      { type: "response.in_progress", response: this.#responseEnvelope("in_progress") }
    ];
  }

  #closeTextItem(events) {
    if (this.mode !== "text") return;
    const item = {
      type: "message",
      id: this.textItemId,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: this.textBuffer, annotations: [] }]
    };
    events.push(
      { type: "response.content_part.done", item_id: this.textItemId, output_index: this.outputIndex, content_index: 0, part: { type: "output_text", text: this.textBuffer, annotations: [] } },
      { type: "response.output_item.done", output_index: this.outputIndex, item }
    );
    this.completedItems.push(item);
    this.mode = null;
    this.textItemId = null;
    this.textBuffer = "";
  }

  #closeToolItem(events, index) {
    const tc = this.toolCalls[index];
    if (!tc || tc.closed) return;
    tc.closed = true;
    const item = {
      type: "function_call",
      id: tc.itemId,
      call_id: tc.callId,
      name: tc.name,
      arguments: tc.args,
      status: "completed"
    };
    events.push(
      { type: "response.function_call_arguments.done", item_id: tc.itemId, output_index: tc.outputIndex, arguments: tc.args },
      { type: "response.output_item.done", output_index: tc.outputIndex, item }
    );
    this.completedItems.push(item);
  }

  /** Feed one parsed chat stream chunk; returns Responses events to emit. */
  feed(rawChunk) {
    const events = [];
    if (!this.started) events.push(...this.start());

    const chunk = tolerateEmptyChoicesChunk(rawChunk);
    if (chunk.usage && typeof chunk.usage === "object") {
      this.usage = {
        input_tokens: chunk.usage.prompt_tokens ?? 0,
        output_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? 0
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) return events;
    const delta = choice.delta ?? {};

    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (this.mode === "tool" && this.currentToolIndex != null) {
        this.#closeToolItem(events, this.currentToolIndex);
        this.mode = null;
      }
      if (this.mode !== "text") {
        this.mode = "text";
        this.outputIndex += 1;
        this.textItemId = rid("msg");
        events.push(
          { type: "response.output_item.added", output_index: this.outputIndex, item: { type: "message", id: this.textItemId, role: "assistant", status: "in_progress", content: [] } },
          { type: "response.content_part.added", item_id: this.textItemId, output_index: this.outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }
        );
      }
      this.textBuffer += delta.content;
      events.push({ type: "response.output_text.delta", item_id: this.textItemId, output_index: this.outputIndex, content_index: 0, delta: delta.content });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = tc.index ?? 0;
        if (!this.toolCalls[index]) {
          this.#closeTextItem(events);
          if (this.currentToolIndex != null && this.currentToolIndex !== index) {
            this.#closeToolItem(events, this.currentToolIndex);
          }
          this.mode = "tool";
          this.currentToolIndex = index;
          this.outputIndex += 1;
          this.toolCalls[index] = {
            itemId: rid("fc"),
            callId: tc.id ?? rid("call"),
            name: tc.function?.name ?? "",
            args: "",
            outputIndex: this.outputIndex,
            closed: false
          };
          events.push({
            type: "response.output_item.added",
            output_index: this.outputIndex,
            item: { type: "function_call", id: this.toolCalls[index].itemId, call_id: this.toolCalls[index].callId, name: this.toolCalls[index].name, arguments: "", status: "in_progress" }
          });
        }
        const entry = this.toolCalls[index];
        if (tc.id && !entry.callId.startsWith("call")) entry.callId = tc.id;
        if (tc.function?.name && !entry.name) entry.name = tc.function.name;
        const argDelta = tc.function?.arguments ?? "";
        if (argDelta) {
          entry.args += argDelta;
          events.push({ type: "response.function_call_arguments.delta", item_id: entry.itemId, output_index: entry.outputIndex, delta: argDelta });
        }
      }
    }

    if (choice.finish_reason) {
      this.#closeTextItem(events);
      for (let i = 0; i < this.toolCalls.length; i += 1) {
        if (this.toolCalls[i]) this.#closeToolItem(events, i);
      }
      this.mode = null;
    }
    return events;
  }

  /** Emit the terminal event (call after the upstream stream ends). */
  finish() {
    const events = [];
    this.#closeTextItem(events);
    for (let i = 0; i < this.toolCalls.length; i += 1) {
      if (this.toolCalls[i]) this.#closeToolItem(events, i);
    }
    events.push({ type: "response.completed", response: this.#responseEnvelope("completed") });
    return events;
  }

  /** Build a non-streaming Responses API response from a full chat response. */
  static fromChatResponse(chatResponse, model) {
    const translator = new ChatToResponsesTranslator({ model });
    const message = chatResponse.choices?.[0]?.message ?? {};
    if (typeof message.content === "string" && message.content) {
      translator.completedItems.push({
        type: "message",
        id: rid("msg"),
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: message.content, annotations: [] }]
      });
    }
    for (const tc of message.tool_calls ?? []) {
      translator.completedItems.push({
        type: "function_call",
        id: rid("fc"),
        call_id: tc.id ?? rid("call"),
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "",
        status: "completed"
      });
    }
    if (chatResponse.usage) {
      translator.usage = {
        input_tokens: chatResponse.usage.prompt_tokens ?? 0,
        output_tokens: chatResponse.usage.completion_tokens ?? 0,
        total_tokens: chatResponse.usage.total_tokens ?? 0
      };
    }
    return translator.#responseEnvelope("completed");
  }
}
