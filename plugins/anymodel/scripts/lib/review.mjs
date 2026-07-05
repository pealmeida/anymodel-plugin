/**
 * Engine-agnostic review orchestration (ARCHITECTURE.md §5).
 *
 * - `review` on an engine with nativeReview (codex): built-in reviewer via
 *   review/start, mapped from the git target.
 * - `review` on other engines, and `adversarial-review` everywhere: portable
 *   schema review — adversarial prompt template + review-output JSON schema,
 *   read-only sandbox.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./core/git.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./core/prompts.mjs";
import { parseStructuredOutput, readOutputSchema } from "./core/codex.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW_SCHEMA_PATH = path.join(PLUGIN_ROOT, "schemas", "review-output.schema.json");

export function loadReviewSchema() {
  return readOutputSchema(REVIEW_SCHEMA_PATH);
}

/** Resolve the git review target for --base/--scope options. */
export function resolveTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  return resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
}

/** Map a git target to the codex native reviewer's target parameter. */
export function toNativeReviewTarget(target) {
  if (target.mode === "working-tree") return { type: "uncommittedChanges" };
  if (target.mode === "branch") return { type: "baseBranch", branch: target.baseRef };
  return null;
}

/**
 * Build the portable schema-review request: prompt + schema.
 * When `inlineSchema` is true (engines without native outputSchema support,
 * e.g. claude -p), the schema contract is appended to the prompt instead.
 */
export function buildSchemaReview(cwd, target, { focusText = "", reviewKind = "Adversarial Review", inlineSchema = false } = {}) {
  const context = collectReviewContext(cwd, target);
  const template = loadPromptTemplate(PLUGIN_ROOT, "adversarial-review");
  let prompt = interpolateTemplate(template, {
    REVIEW_KIND: reviewKind,
    TARGET_LABEL: context.target?.label ?? target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
  const schema = loadReviewSchema();
  if (inlineSchema) {
    prompt += `\n\nRespond with ONLY a JSON object (no markdown fences) matching this JSON schema:\n${JSON.stringify(schema)}\n`;
  }
  return {
    prompt,
    outputSchema: inlineSchema ? null : schema,
    context
  };
}

/** Parse an engine's final message as structured review output. */
export function parseReviewOutput(finalMessage, fallback = {}) {
  const text = String(finalMessage ?? "").trim();
  const candidates = [text];
  // Tolerate engines that wrap JSON in markdown fences despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) candidates.push(fenced[1].trim());
  // Last resort: widest brace span.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  let firstAttempt = null;
  for (const candidate of candidates) {
    const parsed = parseStructuredOutput(candidate, fallback);
    firstAttempt = firstAttempt ?? parsed;
    if (parsed.parsed) return parsed;
  }
  return firstAttempt ?? parseStructuredOutput(text, fallback);
}
