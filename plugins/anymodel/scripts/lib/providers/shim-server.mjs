/**
 * Local Responses→Chat shim HTTP server (Phase 2, ARCHITECTURE.md §5).
 *
 * Exposes a Responses-API endpoint (`POST /v1/responses`) that translates each
 * request into a chat-completions call against the registry-resolved provider,
 * then translates the upstream chat SSE back into Responses API events. Pure
 * node:http + global fetch — no external dependencies.
 */
import http from "node:http";

import { buildChatRequest, ChatToResponsesTranslator } from "./shim.mjs";
import { resolveModelProvider, loadRegistry } from "./registry.mjs";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(res, status, message, type = "invalid_request_error", extra = {}) {
  sendJson(res, status, { error: { message, type, ...extra } });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Strip the provider prefix (`zai/glm-5.2` -> `glm-5.2`). */
function upstreamModelOf(modelSpec) {
  const spec = String(modelSpec ?? "").trim();
  const slash = spec.indexOf("/");
  return slash > 0 ? spec.slice(slash + 1) : spec;
}

/**
 * Parse a single SSE data frame, returning parsed JSON or null when the line
 * is not data-bearing (e.g. `[DONE]`, comments, or malformed JSON).
 */
function parseDataLine(line, log) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch (err) {
    log?.debug?.("shim: skipping non-JSON SSE data", { data, err: String(err) });
    return null;
  }
}

async function streamResponses(upstream, res, model, log) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const translator = new ChatToResponsesTranslator({ model });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const writeEvent = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const processBlock = (block) => {
    for (const line of block.split(/\r?\n/)) {
      const chunk = parseDataLine(line, log);
      if (chunk) for (const event of translator.feed(chunk)) writeEvent(event);
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop();
    for (const frame of frames) processBlock(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);

  for (const event of translator.finish()) writeEvent(event);
  res.end();
}

async function handleResponses(req, res, { env, log }) {
  const raw = await readRequestBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    sendError(res, 400, "Request body is not valid JSON.");
    return;
  }

  const registry = loadRegistry();
  const resolved = resolveModelProvider(body.model, registry);
  if (!resolved) {
    sendError(res, 400, `Unknown model prefix: ${String(body.model ?? "")}.`, "invalid_request_error", { param: "model" });
    return;
  }
  const { providerId, provider } = resolved;
  const upstreamModel = upstreamModelOf(body.model);

  const apiKey = env[provider.env_key];
  if (!apiKey) {
    sendError(res, 503, `Missing API key for provider "${providerId}" (env var ${provider.env_key}).`, "server_error");
    return;
  }

  const chatReq = buildChatRequest(body, { ...provider, id: providerId }, upstreamModel);
  const url = String(provider.base_url).replace(/\/$/, "") + "/chat/completions";
  const controller = new AbortController();

  const onClose = () => controller.abort();
  req.on("close", onClose);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "user-agent": "anymodel-shim"
      },
      body: JSON.stringify(chatReq),
      signal: controller.signal
    });
  } catch (err) {
    req.off("close", onClose);
    if (controller.signal.aborted) {
      try { res.end(); } catch { /* client gone */ }
      return;
    }
    sendError(res, 502, `Upstream request failed: ${err?.message ?? String(err)}`, "server_error");
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    req.off("close", onClose);
    let errBody;
    try {
      errBody = JSON.parse(text);
    } catch {
      errBody = { error: { message: text || upstream.statusText, type: "upstream_error", code: upstream.status } };
    }
    sendJson(res, upstream.status, errBody);
    return;
  }

  try {
    if (chatReq.stream) {
      await streamResponses(upstream, res, body.model, log);
    } else {
      const text = await upstream.text();
      const chatRes = JSON.parse(text);
      sendJson(res, 200, ChatToResponsesTranslator.fromChatResponse(chatRes, body.model));
    }
  } catch (err) {
    if (controller.signal.aborted) {
      try { res.end(); } catch { /* client gone */ }
      return;
    }
    if (!res.headersSent) {
      sendError(res, 502, `Translation failure: ${err?.message ?? String(err)}`, "server_error");
    } else {
      try { res.end(); } catch { /* stream already torn down */ }
    }
  } finally {
    req.off("close", onClose);
  }
}

/**
 * Start the local shim HTTP server.
 *
 * The server translates Responses-API requests (`POST /v1/responses`) into
 * provider chat-completions calls and translates the upstream SSE back into
 * Responses-API events. `GET /health` returns `{ok:true}`. Unknown routes
 * reply with 404 JSON. Client disconnects abort the in-flight upstream fetch.
 *
 * @param {{ port?: number, host?: string, env?: Record<string,string>, log?: object }} [opts]
 * @param {number} [opts.port=4001] Listen port.
 * @param {string} [opts.host="127.0.0.1"] Listen host.
 * @param {Record<string,string>} [opts.env=process.env] Source for provider API keys.
 * @param {object} [opts.log] Optional structured logger (e.g. pino); only `debug` is used.
 * @returns {import("node:http").Server} The started HTTP server.
 */
export function startShimServer({ port = 4001, host = "127.0.0.1", env = process.env, log } = {}) {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    try {
      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && pathname === "/v1/responses") {
        await handleResponses(req, res, { env, log });
        return;
      }
      sendError(res, 404, `Not found: ${req.method} ${pathname}`, "not_found");
    } catch (err) {
      if (!res.headersSent) {
        sendError(res, 500, `Internal error: ${err?.message ?? String(err)}`, "server_error");
      } else {
        try { res.end(); } catch { /* socket gone */ }
      }
    }
  });

  server.listen(port, host);
  return server;
}

export default startShimServer;
