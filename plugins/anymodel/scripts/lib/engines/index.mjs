/**
 * Engine registry.
 *
 * Maps a stable engine id to its adapter module (`codex.mjs`, `claude.mjs`, `direct.mjs`, …).
 * Modules are imported lazily on first use so that an unimplemented or broken adapter never
 * blocks startup, and so `listEngines()` can report availability without importing anything.
 *
 * See ARCHITECTURE.md section 3. No external dependencies — Node's dynamic `import()` is the
 * only mechanism used.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

/**
 * Engine id → adapter module filename (relative to this file).
 *
 * Order is significant: it is the order returned by {@link listEngines}. Add new engines here.
 */
const ENGINE_MODULES = {
  codex: "codex.mjs",
  claude: "claude.mjs",
  direct: "direct.mjs"
};

const ENGINE_IDS = Object.freeze(Object.keys(ENGINE_MODULES));

/** Cache of already-imported adapter modules, keyed by engine id. */
const moduleCache = new Map();

/**
 * Resolve the absolute path of an engine's adapter module.
 * @param {string} id - Engine id.
 * @returns {string} Absolute filesystem path to the adapter `.mjs`.
 */
function modulePathFor(id) {
  return path.join(path.dirname(new URL(import.meta.url).pathname), ENGINE_MODULES[id]);
}

/**
 * Check whether an engine's adapter module file exists on disk.
 *
 * @param {string} id - Engine id.
 * @returns {boolean} `true` when the adapter file is present.
 */
function moduleExists(id) {
  try {
    return fs.existsSync(modulePathFor(id));
  } catch {
    return false;
  }
}

/**
 * Convert a native filesystem path to a `file://` URL safe for dynamic `import()`.
 * @param {string} filePath - Absolute path.
 * @returns {string} `file://` URL string.
 */
function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

/**
 * Lazily load an engine adapter by id.
 *
 * Imports the adapter module on first request and caches it. Throws a clear error when:
 *   - the id is unknown, or
 *   - the adapter module file does not exist yet.
 *
 * @param {string} id - Engine id (e.g. `"codex"`, `"claude"`, `"direct"`).
 * @returns {Promise<{ default: object }>} The imported adapter module. Callers are expected to
 *   use the module's default export as the {@link Engine} implementation.
 * @throws {Error} `'unknown engine: <id>'` when the id is not registered.
 * @throws {Error} `'engine not implemented: <id> (<path>)'` when the adapter file is missing.
 */
export async function getEngine(id) {
  if (!ENGINE_MODULES.hasOwnProperty(id)) {
    throw new Error(`unknown engine: ${id}`);
  }

  const cached = moduleCache.get(id);
  if (cached) {
    return cached;
  }

  const modulePath = modulePathFor(id);
  if (!moduleExists(id)) {
    throw new Error(`engine not implemented: ${id} (${modulePath})`);
  }

  const imported = await import(toFileUrl(modulePath));
  moduleCache.set(id, imported);
  return imported;
}

/**
 * List all registered engines with their availability.
 *
 * Availability reflects only whether the adapter module file is present — it does not probe
 * the underlying binary or auth state. Use the adapter's `detect()` / `auth()` methods for
 * runtime readiness. No module is imported by this call.
 *
 * @returns {Array<{ id: string, available: boolean }>} One entry per registered engine, in
 *   registration order.
 */
export function listEngines() {
  return ENGINE_IDS.map((id) => ({ id, available: moduleExists(id) }));
}

/**
 * The immutable, ordered list of registered engine ids.
 * @returns {readonly string[]}
 */
export function engineIds() {
  return ENGINE_IDS;
}
