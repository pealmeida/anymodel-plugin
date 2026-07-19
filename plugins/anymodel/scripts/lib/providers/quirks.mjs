/**
 * Quirk transform utilities for OpenAI chat-completion payloads.
 * All functions are pure and operate on a shallow copy of the payload.
 * See ARCHITECTURE.md section 4 for the origin of each quirk.
 */

/**
 * Strip any tool objects whose `type` is not "function".
 * @param {object} payload - Chat-completion request body.
 * @returns {object} New payload containing only function-type tools.
 */
export function functionToolsOnly(payload) {
  const clone = { ...payload };
  if (Array.isArray(clone.tools)) {
    clone.tools = clone.tools.filter((t) => t && t.type === "function");
    if (clone.tools.length === 0) {
      delete clone.tools;
    }
  }
  return clone;
}

/**
 * Flatten assistant message `content` arrays of text parts into a single string.
 * Removes assistant messages that become empty (no text and no tool_calls).
 * @param {object} payload - Chat-completion request body.
 * @returns {object} New payload with flattened assistant content.
 */
export function flatAssistantContent(payload) {
  const clone = { ...payload };
  if (!Array.isArray(clone.messages)) return clone;
  const newMessages = [];
  for (const msg of clone.messages) {
    if (msg.role !== "assistant") {
      newMessages.push(msg);
      continue;
    }
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((c) => c && typeof c === "object" && c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
      if (text || hasToolCalls) {
        const newMsg = { ...msg, role: "assistant" };
        if (text) {
          newMsg.content = text;
        } else {
          delete newMsg.content;
        }
        newMessages.push(newMsg);
      }
    } else {
      const hasContent = typeof msg.content === "string" && msg.content.trim().length > 0;
      if (hasContent || hasToolCalls) newMessages.push(msg);
    }
  }
  clone.messages = newMessages;
  return clone;
}

/**
 * Reorder tool-role messages to appear directly after the assistant message
 * whose `tool_calls` contain the matching `tool_call_id`.
 * Orphan tool messages (no matching assistant) keep their original position.
 * @param {object} payload - Chat-completion request body.
 * @returns {object} New payload with strict tool adjacency.
 */
export function strictToolAdjacency(payload) {
  const clone = { ...payload };
  if (!Array.isArray(clone.messages)) return clone;
  const msgs = clone.messages;
  const toolByCallId = new Map();
  for (const m of msgs) {
    if (m.role === "tool" && m.tool_call_id && !toolByCallId.has(m.tool_call_id)) {
      toolByCallId.set(m.tool_call_id, m);
    }
  }
  const consumed = new Set();
  const result = [];
  for (const msg of msgs) {
    if (msg.role === "tool") {
      if (!consumed.has(msg)) result.push(msg); // orphan: keep in place
      continue;
    }
    result.push(msg);
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const toolMsg = tc && tc.id ? toolByCallId.get(tc.id) : undefined;
        if (toolMsg && !consumed.has(toolMsg)) {
          result.push(toolMsg);
          consumed.add(toolMsg);
        }
      }
    }
  }
  clone.messages = result;
  return clone;
}

/**
 * When a streaming chunk has no `choices` entries, return an empty-delta chunk
 * instead of letting downstream code index choices[0].
 * @param {object} chunk - A streamed chunk from the OpenAI API.
 * @returns {object} Original chunk, or a safe empty-delta variant.
 */
export function tolerateEmptyChoicesChunk(chunk) {
  if (!chunk || typeof chunk !== "object") return chunk;
  if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) {
    return { ...chunk, choices: [{ index: 0, delta: {} }] };
  }
  return chunk;
}

/**
 * Apply a set of payload quirks based on registry flag identifiers.
 * Stream-chunk quirks (empty-choices-chunks) are applied at the stream layer,
 * not here.
 * @param {object} payload - Original chat-completion payload.
 * @param {string[]} flags - Quirk flag names from the provider registry.
 * @returns {object} Transformed payload.
 */
export function applyQuirks(payload, flags = []) {
  const map = {
    "function-tools-only": functionToolsOnly,
    "flat-assistant-content": flatAssistantContent,
    "strict-tool-adjacency": strictToolAdjacency,
  };
  let result = payload;
  for (const f of flags) {
    const fn = map[f];
    if (fn) result = fn(result);
  }
  return result;
}

export default {
  functionToolsOnly,
  flatAssistantContent,
  strictToolAdjacency,
  tolerateEmptyChoicesChunk,
  applyQuirks,
};
