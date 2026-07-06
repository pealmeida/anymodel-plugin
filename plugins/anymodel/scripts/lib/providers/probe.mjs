/**
 * Provider probe: lightweight health/liveliness checks and model-list discovery
 * with no external dependencies. Used by the `anymodel diagnose` CLI command
 * to verify connectivity and list available models per provider.
 */

/**
 * Issue a GET with the given fetch options and an AbortController timeout.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a single provider's /models endpoint and return available model IDs.
 *
 * @param {string} providerId - Registry key (e.g. "zai", "ollama").
 * @param {object} provider - Provider definition from registry.toml.
 * @param {object} [env=process.env] - Environment to read API keys from.
 * @returns {Promise<{providerId: string, ok: boolean, keyPresent: boolean,
 *   models: string[], error: string|null}>}
 */
export async function listProviderModels(providerId, provider, env = process.env) {
  const keyPresent = Boolean(env[provider.env_key]);
  const result = { providerId, ok: false, keyPresent, models: [], error: null };

  if (!keyPresent) {
    result.error = `Missing env var ${provider.env_key}`;
    return result;
  }

  try {
    const res = await fetchWithTimeout(
      `${provider.base_url}/models`,
      {
        headers: {
          Authorization: `Bearer ${env[provider.env_key]}`,
          "User-Agent": "anymodel-probe",
        },
      },
      15000
    );

    if (!res.ok) {
      result.error = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
      return result;
    }

    const data = await res.json();
    result.models = (data?.data ?? []).map((m) => m.id).filter(Boolean);
    result.ok = true;
  } catch (err) {
    if (err.name === "AbortError") {
      result.error = "Timeout after 15s";
    } else {
      result.error = err.message ?? String(err);
    }
  }

  return result;
}

/**
 * Run listProviderModels for every provider in the registry concurrently.
 *
 * @param {{ providers: Record<string, object> }} registry - Parsed registry
 *   object (from registry.mjs parseRegistry / loadRegistry).
 * @param {object} [env=process.env]
 * @returns {Promise<Array<{providerId: string, ok: boolean, keyPresent: boolean,
 *   models: string[], error: string|null}>>}
 */
export function probeAllProviders(registry, env = process.env) {
  const tasks = Object.entries(registry.providers ?? {}).map(
    ([id, provider]) => listProviderModels(id, provider, env)
  );
  return Promise.all(tasks);
}

/**
 * Check whether the local litellm and built-in bridges are alive.
 *
 * @param {object} [_env=process.env]
 * @returns {Promise<{litellm: boolean, builtin: boolean}>}
 */
export async function checkBridgeHealth(_env = process.env) {
  const check = async (url) => {
    try {
      const res = await fetchWithTimeout(url, {}, 3000);
      return res.ok;
    } catch {
      return false;
    }
  };

  const [litellm, builtin] = await Promise.all([
    check("http://127.0.0.1:4000/health/liveliness"),
    check("http://127.0.0.1:4001/health"),
  ]);

  return { litellm, builtin };
}
