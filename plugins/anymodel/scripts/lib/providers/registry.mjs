/**
 * Provider registry loader.
 *
 * Parses registry.toml (a deliberate TOML subset: [providers.<id>] sections,
 * string values, and string arrays that may span lines) without external
 * dependencies. User overrides can be layered later (ARCHITECTURE.md §6).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "registry.toml"
);

function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    if (ch === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[")) {
    const inner = value.slice(1, value.endsWith("]") ? -1 : value.length);
    return inner
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return value.replace(/^"|"$/g, "");
}

/**
 * Parse the TOML-subset registry text into { providers: { id: {...} } }.
 * @param {string} text
 */
export function parseRegistry(text) {
  const providers = {};
  let current = null;
  let pendingKey = null;
  let pendingValue = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    if (pendingKey) {
      pendingValue += ` ${line}`;
      if (line.endsWith("]")) {
        current[pendingKey] = parseValue(pendingValue);
        pendingKey = null;
        pendingValue = "";
      }
      continue;
    }

    const section = line.match(/^\[providers\.([A-Za-z0-9_-]+)\]$/);
    if (section) {
      current = {};
      providers[section[1]] = current;
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv && current) {
      const [, key, raw] = kv;
      if (raw.trim().startsWith("[") && !raw.trim().endsWith("]")) {
        pendingKey = key;
        pendingValue = raw;
        continue;
      }
      current[key] = parseValue(raw);
    }
  }
  return { providers };
}

/** Load the shipped registry (cached). */
let cachedRegistry = null;
export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  if (cachedRegistry && registryPath === DEFAULT_REGISTRY_PATH) return cachedRegistry;
  const parsed = parseRegistry(fs.readFileSync(registryPath, "utf8"));
  if (registryPath === DEFAULT_REGISTRY_PATH) cachedRegistry = parsed;
  return parsed;
}

/**
 * Resolve a model spec like "zai/glm-5.2" to its registry provider.
 * @returns {{ providerId: string, provider: object } | null} null when the
 *   model has no registered provider prefix (i.e. it is engine-native).
 */
export function resolveModelProvider(modelSpec, registry = loadRegistry()) {
  const spec = String(modelSpec ?? "").trim();
  const slash = spec.indexOf("/");
  if (slash <= 0) return null;
  const prefix = spec.slice(0, slash);
  const provider = registry.providers?.[prefix];
  return provider ? { providerId: prefix, provider } : null;
}

/** Test-only providers routed through the local bridge (no registry entry). */
export const BRIDGE_TEST_PREFIXES = new Set(["mock", "self"]);

/**
 * True when the model spec should be routed through the local bridge proxy
 * (a registry provider prefix or a bridge test route).
 */
export function isBridgeModel(modelSpec, registry = loadRegistry()) {
  if (resolveModelProvider(modelSpec, registry)) return true;
  const spec = String(modelSpec ?? "").trim();
  const slash = spec.indexOf("/");
  return slash > 0 && BRIDGE_TEST_PREFIXES.has(spec.slice(0, slash));
}
