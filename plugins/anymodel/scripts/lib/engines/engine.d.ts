/**
 * Engine adapter interface.
 *
 * Each provider harness (Codex, Claude, a built-in "direct" loop, …) implements this so the
 * orchestration layer (`lib/core`) can drive any executor against any model.
 *
 * Derived from ARCHITECTURE.md section 3 (the `TurnCaptureState` normalization in upstream
 * `codex.mjs` is the canonical spec). No runtime dependency: this file is types-only.
 */

/**
 * Result of probing whether an engine is usable on this machine.
 *
 * @property available - `true` when the underlying binary is present and meets version gates.
 * @property detail   - Human-readable explanation: detected version, the missing binary name,
 *                      or why a version gate failed. Surfaced via `/anymodel:setup`.
 */
export interface EngineAvailability {
  available: boolean;
  detail: string;
}

/**
 * Result of checking whether the engine is authenticated.
 *
 * @property loggedIn - `true` when the engine can make a turn right now without further setup.
 * @property detail   - Human-readable explanation of the auth state, e.g. "logged in as …" or
 *                      "run `codex login`".
 */
export interface EngineAuthState {
  loggedIn: boolean;
  detail: string;
}

/**
 * Per-engine capability flags. The orchestration layer uses these to pick fallback paths,
 * e.g. schema-review when `nativeReview` is false, or to refuse `--write` on engines without
 * a real sandbox.
 *
 * @property nativeReview   - `true` when the engine ships a native reviewer command
 *                            (codex: `review/start`). Other engines fall back to the portable
 *                            schema-based adversarial review.
 * @property write          - `true` when the engine can apply edits (sandboxed).
 * @property resume         - `true` when the engine supports thread continuation.
 * @property interrupt      - `true` when an in-flight turn can be cancelled mid-run.
 * @property modelOverride  - `true` when model/provider can be selected per turn.
 */
export interface EngineCapabilities {
  nativeReview: boolean;
  write: boolean;
  resume: boolean;
  interrupt: boolean;
  modelOverride: boolean;
}

/**
 * Sandbox policy for a turn. Mirrors the upstream `approvalPolicy` axis.
 *
 * - `"read-only"`       — may read but never mutate the workspace.
 * - `"workspace-write"` — may edit files inside the workspace root.
 */
export type SandboxPolicy = "read-only" | "workspace-write";

/**
 * A single request to run one agent turn.
 *
 * @property cwd            - Absolute working directory the engine operates in.
 * @property prompt         - The task prompt for the turn.
 * @property model          - Optional model id to override the engine default.
 *                            Honored only when `capabilities().modelOverride` is true.
 * @property provider       - Optional provider id to override the engine default.
 *                            Honored only when `capabilities().modelOverride` is true.
 * @property effort         - Optional reasoning-effort hint (e.g. "low" | "medium" | "high").
 * @property sandbox        - Sandbox policy for the turn.
 * @property outputSchema   - Optional JSON Schema the engine's final message must conform to.
 *                            Drives structured-output turns (e.g. schema reviews).
 * @property threadName     - Optional human-readable name for the thread.
 * @property persistThread  - When true, keep the thread resumable after the turn ends.
 */
export interface TurnRequest {
  cwd: string;
  prompt: string;
  model?: string;
  provider?: string;
  effort?: string;
  sandbox: SandboxPolicy;
  outputSchema?: object;
  threadName?: string;
  persistThread?: boolean;
}

/**
 * Kind discriminator for a normalized {@link TurnEvent}.
 *
 * - `"command"`      — a shell command was executed.
 * - `"fileChange"`   — a file was created, edited, or deleted.
 * - `"reasoning"`    — the engine's chain-of-thought / summary text.
 * - `"agentMessage"` — a user-visible assistant message.
 */
export type TurnEventKind =
  | "command"
  | "fileChange"
  | "reasoning"
  | "agentMessage";

/**
 * Lifecycle phase a {@link TurnEvent} belongs to.
 *
 * - `"start"`   — turn began.
 * - `"update"`  — incremental progress.
 * - `"error"`   — a non-fatal or fatal error.
 * - `"complete"` — turn finished.
 */
export type TurnEventPhase = "start" | "update" | "error" | "complete";

/**
 * A single normalized event emitted during a turn. The orchestration layer renders these
 * uniformly regardless of which engine produced them.
 *
 * @property phase  - Lifecycle phase of the event.
 * @property message- Human-readable event text.
 * @property kind   - Discriminator describing what the event represents.
 * @property detail - Engine-specific structured payload (command string, file path, etc.).
 *                    Shape varies by `kind`; callers should treat it as opaque unless they
 *                    branch on `kind`.
 */
export interface TurnEvent {
  phase: TurnEventPhase;
  message: string;
  kind: TurnEventKind;
  detail?: unknown;
}

/**
 * Callback invoked by the engine as it produces events. Implementations must be safe to call
 * synchronously from the engine's event loop.
 */
export type TurnEventSink = (event: TurnEvent) => void;

/**
 * Final outcome of a turn.
 *
 * @property status             - Terminal status: `"success"` | `"error"` | `"interrupted"`.
 * @property finalMessage       - The engine's final user-facing message (may conform to
 *                                `TurnRequest.outputSchema` when one was supplied).
 * @property reasoningSummary   - Captured reasoning/chain-of-thought summaries.
 * @property touchedFiles       - Absolute or workspace-relative paths the turn modified.
 * @property threadRef          - Engine-opaque handle for resuming the thread.
 * @property turnRef            - Engine-opaque handle identifying this specific turn.
 * @property stderr             - Captured stderr text, if any (surfaced for diagnostics).
 */
export interface TurnResult {
  status: "success" | "error" | "interrupted";
  finalMessage: string;
  reasoningSummary: string[];
  touchedFiles: string[];
  threadRef: string;
  turnRef: string;
  stderr?: string;
}

/**
 * An engine adapter. One implementation per harness (codex, claude, direct, …).
 *
 * Methods are async because every engine is fundamentally an out-of-process or network
 * client, even when it happens to be synchronous today.
 */
export interface Engine {
  /** Stable identifier, e.g. `"codex"` | `"claude"` | `"direct"`. */
  id: string;

  /**
   * Probe whether the engine is usable on this machine: binary present, version gates met.
   * Must not throw; failures are reported via `available: false`.
   *
   * @param cwd - Working directory the detection runs in.
   */
  detect(cwd: string): Promise<EngineAvailability>;

  /**
   * Check whether the engine is authenticated and ready to run a turn. Must not throw.
   *
   * @param cwd - Working directory the auth check runs in.
   */
  auth(cwd: string): Promise<EngineAuthState>;

  /** Report the engine's static capability flags. */
  capabilities(): EngineCapabilities;

  /**
   * Start a new turn (fresh thread).
   *
   * @param req     - The turn request.
   * @param onEvent - Sink for normalized events emitted during the turn.
   */
  startTurn(req: TurnRequest, onEvent: TurnEventSink): Promise<TurnResult>;

  /**
   * Resume an existing thread. Honored only when `capabilities().resume` is true.
   *
   * @param threadRef - Handle returned in a prior {@link TurnResult}.
   * @param req       - The turn request.
   * @param onEvent   - Sink for normalized events emitted during the turn.
   */
  resumeTurn(threadRef: string, req: TurnRequest, onEvent: TurnEventSink): Promise<TurnResult>;

  /**
   * Interrupt an in-flight turn. Honored only when `capabilities().interrupt` is true.
   *
   * @param threadRef - Handle of the running thread.
   * @param turnRef   - Handle of the running turn.
   */
  interrupt(threadRef: string, turnRef: string): Promise<void>;
}
