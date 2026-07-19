import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";

import { startShimServer } from "../plugins/anymodel/scripts/lib/providers/shim-server.mjs";

let server;
let baseUrl;

before(async () => {
  server = startShimServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.on("listening", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) server.close();
});

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: body ? { "content-type": "application/json" } : {},
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("shim-server", () => {
  describe("GET /health", () => {
    it("returns ok: true", async () => {
      const { status, data } = await request("GET", "/health");
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(data, { ok: true });
    });
  });

  describe("POST /v1/responses", () => {
    it("returns 400 for invalid JSON body", async () => {
      const { status, data } = await request("POST", "/v1/responses", "not json");
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("returns 400 for unknown model prefix", async () => {
      const { status, data } = await request("POST", "/v1/responses", {
        model: "unknown/gpt-4",
        input: "hello",
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
      assert.ok(data.error.message.includes("Unknown model prefix"));
    });

    it("returns 503 when API key is missing", async () => {
      const { status, data } = await request("POST", "/v1/responses", {
        model: "zai/glm-5.2",
        input: "hello",
      });
      assert.strictEqual(status, 503);
      assert.ok(data.error);
      assert.ok(data.error.message.includes("Missing API key"));
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for unknown GET", async () => {
      const { status, data } = await request("GET", "/unknown");
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });

    it("returns 404 for unknown POST", async () => {
      const { status, data } = await request("POST", "/unknown");
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });
  });
});
