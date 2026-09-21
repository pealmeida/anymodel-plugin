/**
 * Provider session management — stable session IDs for OpenCode and similar providers.
 *
 * OpenCode Go requires an `x-opencode-session` header on all chat requests (Zen/Go plan).
 * This module generates a stable UUID per process or respects environment overrides.
 */
import crypto from "node:crypto";

let cachedSessionId = null;

/**
 * Get or generate a session ID for the current process.
 * Generates once per process, then caches. Respects env overrides.
 *
 * @param {object} [env=process.env]
 * @returns {string} A UUID-format session ID.
 */
export function getSessionId(env = process.env) {
  const override = env.OPENCODE_SESSION || env.X_OPENCODE_SESSION;
  if (override && typeof override === "string" && override.trim()) {
    return override.trim();
  }

  if (!cachedSessionId) {
    cachedSessionId = crypto.randomUUID();
  }
  return cachedSessionId;
}

/**
 * Build provider-specific request headers.
 * Adds standard headers plus any quirk-based headers (e.g. x-opencode-session).
 *
 * @param {string} providerId - Registry key (e.g. "opencode-go").
 * @param {string} apiKey - Provider API key (for Authorization header).
 * @param {object} [opts]
 * @param {string} [opts.userAgent="anymodel"] - User-Agent value.
 * @param {object} [opts.env=process.env] - Environment for session ID lookups.
 * @returns {Record<string, string>} Headers object.
 */
export function buildProviderHeaders(providerId, apiKey, { userAgent = "anymodel", env = process.env } = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "user-agent": userAgent
  };

  if (providerId === "opencode-go") {
    headers["x-opencode-session"] = getSessionId(env);
  }

  return headers;
}

/**
 * Reset the cached session ID (for testing only).
 * @internal
 */
export function _resetSessionCache() {
  cachedSessionId = null;
}
