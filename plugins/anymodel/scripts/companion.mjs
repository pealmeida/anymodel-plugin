#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

import { parseArgs } from "./lib/core/args.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  resolveCancelableJob,
  resolveResultJob
} from "./lib/core/job-control.mjs";
import { readJobFile, resolveJobFile, upsertJob, writeJobFile } from "./lib/core/state.mjs";
import { appendLogLine, nowIso } from "./lib/core/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/core/workspace.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderStatusReport,
  renderStoredJobResult
} from "./lib/core/render.mjs";

const COMMANDS = new Set([
  "delegate",
  "review",
  "adversarial-review",
  "status",
  "result",
  "cancel",
  "models",
  "setup",
  "shim"
]);

const TURN_VALUE_OPTIONS = [
  "engine",
  "model",
  "provider",
  "effort",
  "base",
  "scope",
  "bridge",
  "resume",
  "cwd"
];

const TURN_BOOLEAN_OPTIONS = [
  "write",
  "background",
  "wait",
  "fresh",
  "json"
];

const JOB_VALUE_OPTIONS = ["cwd", "max-jobs", "max-progress-lines"];
const JOB_BOOLEAN_OPTIONS = ["all", "json"];

function usage() {
  return `Usage: companion.mjs <command> [options] [prompt]

Commands:
  delegate              Delegate a task to an engine
  review                Run a code review
  adversarial-review    Run a portable adversarial review
  status                Show active and recent jobs
  result                Show a finished job result
  cancel                Cancel an active job
  models                Probe configured model providers
  setup                 Check local engine/provider setup
`;
}

function normalizeRenderedOutput(output) {
  return String(output)
    .replaceAll("/codex:", "/anymodel:")
    .replaceAll("# Codex", "# AnyModel")
    .replaceAll("Codex Task", "AnyModel Task")
    .replaceAll("Codex Review", "AnyModel Review")
    .replaceAll("Codex Status", "AnyModel Status")
    .replaceAll("Codex Job Status", "AnyModel Job Status")
    .replaceAll("Codex Cancel", "AnyModel Cancel")
    .replaceAll("Codex Session ID", "Engine Thread ID")
    .replaceAll("Codex session ID", "Engine thread ID")
    .replaceAll("Resume in Codex", "Resume in engine")
    .replaceAll("Codex jobs", "AnyModel jobs")
    .replaceAll("Codex did not", "Engine did not")
    .replaceAll("Codex Result", "AnyModel Result")
    .replaceAll("codex resume", "engine resume");
}

function writeStdout(value) {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function printJson(value) {
  writeStdout(JSON.stringify(value, null, 2));
}

function parseCommandArgs(argv, config) {
  return parseArgs(argv, {
    aliasMap: {
      e: "engine",
      m: "model",
      b: "base",
      w: "write",
      h: "help",
      ...config.aliasMap
    },
    valueOptions: config.valueOptions,
    booleanOptions: ["help", ...(config.booleanOptions ?? [])]
  });
}

function promptFromPositionals(positionals) {
  return positionals.join(" ").trim();
}

function cwdFromOptions(options) {
  return options.cwd ? String(options.cwd) : process.cwd();
}

async function loadEngineRegistry() {
  try {
    return await import("./lib/engines/index.mjs");
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      String(error.message ?? "").includes("/lib/engines/index.mjs")
    ) {
      return null;
    }
    throw error;
  }
}

async function dispatchTurn(command, parsed) {
  const registry = await loadEngineRegistry();
  if (!registry) {
    return {
      ok: false,
      command,
      status: "not_implemented",
      message: "Engine registry is not available yet at ./lib/engines/index.mjs.",
      options: parsed.options,
      prompt: promptFromPositionals(parsed.positionals)
    };
  }

  const dispatch = registry.dispatchTurn ?? registry.startTurn ?? registry.default?.dispatchTurn;
  if (typeof dispatch !== "function") {
    return {
      ok: false,
      command,
      status: "not_implemented",
      message: "Engine registry loaded, but it does not export dispatchTurn/startTurn yet.",
      options: parsed.options,
      prompt: promptFromPositionals(parsed.positionals)
    };
  }

  return dispatch({
    command,
    cwd: cwdFromOptions(parsed.options),
    options: parsed.options,
    prompt: promptFromPositionals(parsed.positionals)
  });
}

async function handleTurnCommand(command, argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: TURN_VALUE_OPTIONS,
    booleanOptions: TURN_BOOLEAN_OPTIONS
  });

  if (parsed.options.help) {
    writeStdout(usage());
    return;
  }

  const result = await dispatchTurn(command, parsed);
  printJson(result);
}

function handleStatus(argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: JOB_VALUE_OPTIONS,
    booleanOptions: JOB_BOOLEAN_OPTIONS
  });

  if (parsed.options.help) {
    writeStdout("Usage: companion.mjs status [--all] [job-id]\n");
    return;
  }

  const cwd = cwdFromOptions(parsed.options);
  const maxJobs = parsed.options["max-jobs"] ? Number.parseInt(parsed.options["max-jobs"], 10) : undefined;
  const maxProgressLines = parsed.options["max-progress-lines"]
    ? Number.parseInt(parsed.options["max-progress-lines"], 10)
    : undefined;
  const reference = parsed.positionals[0] ?? null;

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference, { maxProgressLines });
    if (parsed.options.json) {
      printJson(snapshot);
      return;
    }
    writeStdout(normalizeRenderedOutput(renderJobStatusReport(snapshot.job)));
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, {
    all: Boolean(parsed.options.all),
    maxJobs,
    maxProgressLines
  });
  if (parsed.options.json) {
    printJson(snapshot);
    return;
  }
  writeStdout(normalizeRenderedOutput(renderStatusReport(snapshot)));
}

function handleResult(argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: JOB_VALUE_OPTIONS,
    booleanOptions: ["json"]
  });

  if (parsed.options.help) {
    writeStdout("Usage: companion.mjs result [job-id]\n");
    return;
  }

  const cwd = cwdFromOptions(parsed.options);
  const reference = parsed.positionals[0] ?? null;
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const jobFile = resolveJobFile(workspaceRoot, job.id);
  const storedJob = fs.existsSync(jobFile) ? readJobFile(jobFile) : job;

  if (parsed.options.json) {
    printJson({ workspaceRoot, job, storedJob });
    return;
  }

  writeStdout(normalizeRenderedOutput(renderStoredJobResult(job, storedJob)));
}

function cancelProcess(job) {
  if (!job.pid) {
    return "No process id was recorded for this job.";
  }

  try {
    process.kill(job.pid, "SIGTERM");
    return `Sent SIGTERM to process ${job.pid}.`;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return `Process ${job.pid} was not running.`;
    }
    throw error;
  }
}

function handleCancel(argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  if (parsed.options.help) {
    writeStdout("Usage: companion.mjs cancel [job-id]\n");
    return;
  }

  const cwd = cwdFromOptions(parsed.options);
  const reference = parsed.positionals[0] ?? null;
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);
  const jobFile = resolveJobFile(workspaceRoot, job.id);
  const storedJob = fs.existsSync(jobFile) ? readJobFile(jobFile) : job;
  const cancelDetail = cancelProcess(storedJob);
  const completedAt = nowIso();
  const cancelledJob = {
    ...storedJob,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    updatedAt: completedAt,
    cancelDetail
  };

  writeJobFile(workspaceRoot, job.id, cancelledJob);
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    cancelDetail
  });
  appendLogLine(cancelledJob.logFile, `Cancelled: ${cancelDetail}`);

  if (parsed.options.json) {
    printJson({ workspaceRoot, job: cancelledJob });
    return;
  }

  writeStdout(normalizeRenderedOutput(renderCancelReport(cancelledJob)));
}

async function handleModelsOrSetup(command, argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: ["cwd", "engine", "provider"],
    booleanOptions: ["json"]
  });

  if (parsed.options.help) {
    writeStdout(`Usage: companion.mjs ${command} [--engine <id>] [--provider <id>]\n`);
    return;
  }

  if (command === "models") {
    await handleModels(parsed);
    return;
  }
  if (command === "setup") {
    await handleSetupCommand(parsed);
    return;
  }

  const registry = await loadEngineRegistry();
  const payload = {
    ok: false,
    command,
    status: "not_implemented",
    message: registry
      ? "Engine registry loaded, but setup/model probing is not implemented yet."
      : "Engine registry is not available yet at ./lib/engines/index.mjs.",
    workspaceRoot: resolveWorkspaceRoot(cwdFromOptions(parsed.options)),
    options: parsed.options
  };

  if (parsed.options.json) {
    printJson(payload);
    return;
  }

  writeStdout(`# AnyModel ${command === "models" ? "Models" : "Setup"}

Status: not implemented

${payload.message}
`);
}

async function handleShim(argv) {
  const parsed = parseCommandArgs(argv, {
    valueOptions: ["port", "host", "env-file"],
    booleanOptions: []
  });
  if (parsed.options.help) {
    writeStdout("Usage: companion.mjs shim [--port 4001] [--host 127.0.0.1] [--env-file <path>]\n");
    return;
  }
  const env = { ...process.env };
  if (parsed.options["env-file"]) {
    const text = fs.readFileSync(parsed.options["env-file"], "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && m[2] !== "") env[m[1]] = m[2];
    }
  }
  const { startShimServer } = await import("./lib/providers/shim-server.mjs");
  const port = parsed.options.port ? Number.parseInt(parsed.options.port, 10) : 4001;
  const host = parsed.options.host ?? "127.0.0.1";
  startShimServer({ port, host, env, log: (msg) => process.stderr.write(`[shim] ${msg}\n`) });
  process.stderr.write(`[shim] listening on http://${host}:${port}/v1\n`);
}


async function handleModels(parsed) {
  const { loadRegistry } = await import("./lib/providers/registry.mjs");
  const { probeAllProviders } = await import("./lib/providers/probe.mjs");
  const registry = loadRegistry();
  let results = await probeAllProviders(registry, process.env);
  if (parsed.options.provider) {
    results = results.filter((r) => r.providerId === parsed.options.provider);
  }
  if (parsed.options.json) {
    printJson({ ok: true, command: "models", providers: results });
    return;
  }
  const lines = ["# AnyModel Providers", ""];
  for (const r of results) {
    lines.push(`## ${r.providerId} ${r.ok ? "✓" : "✗"}${r.keyPresent ? "" : " (no API key set)"}`);
    if (r.ok) {
      lines.push(r.models.join(", "));
    } else if (r.error) {
      lines.push(`error: ${r.error}`);
    }
    lines.push("");
  }
  writeStdout(lines.join("\n"));
}

async function handleSetupCommand(parsed) {
  const registryModule = await loadEngineRegistry();
  const engines = [];
  for (const { id, available } of registryModule.listEngines()) {
    if (!available) {
      engines.push({ id, available: false, detail: "adapter not implemented" });
      continue;
    }
    try {
      const module = await registryModule.getEngine(id);
      const engine = module.default ?? module;
      const detect = await engine.detect(cwdFromOptions(parsed.options));
      const auth = detect.available ? await engine.auth(cwdFromOptions(parsed.options)) : null;
      engines.push({ id, available: detect.available, detail: detect.detail, auth });
    } catch (error) {
      engines.push({ id, available: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const os = await import("node:os");
  const path = await import("node:path");
  let codexConfig = "";
  try {
    codexConfig = fs.readFileSync(
      path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml"),
      "utf8"
    );
  } catch {
    codexConfig = "";
  }
  const bridgeProvidersConfigured = {
    litellm: /\[model_providers\.litellm\]/.test(codexConfig),
    anymodel: /\[model_providers\.anymodel\]/.test(codexConfig)
  };

  let bridges = { litellm: false, builtin: false };
  try {
    const { checkBridgeHealth } = await import("./lib/providers/probe.mjs");
    bridges = await checkBridgeHealth(process.env);
  } catch {
    // probe module missing: leave both false
  }

  const payload = { ok: true, command: "setup", engines, bridgeProvidersConfigured, bridges };
  if (parsed.options.json) {
    printJson(payload);
    return;
  }
  const lines = ["# AnyModel Setup", "", "Engines:"];
  for (const e of engines) {
    lines.push(`- ${e.id}: ${e.available ? "available" : "unavailable"} (${e.detail ?? ""})${e.auth ? ` — ${e.auth.detail}` : ""}`);
  }
  lines.push("", "Bridge providers in codex config:");
  lines.push(`- litellm: ${bridgeProvidersConfigured.litellm ? "configured" : "MISSING"} (proxy ${bridges.litellm ? "up" : "down"})`);
  lines.push(`- anymodel: ${bridgeProvidersConfigured.anymodel ? "configured" : "MISSING"} (shim ${bridges.builtin ? "up" : "down"})`);
  lines.push("");
  writeStdout(lines.join("\n"));
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    writeStdout(usage());
    return;
  }

  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command "${command}".\n\n${usage()}`);
  }

  if (command === "delegate" || command === "review" || command === "adversarial-review") {
    await handleTurnCommand(command, rest);
    return;
  }

  if (command === "shim") {
    await handleShim(rest);
    return;
  }

  if (command === "status") {
    handleStatus(rest);
    return;
  }

  if (command === "result") {
    handleResult(rest);
    return;
  }

  if (command === "cancel") {
    handleCancel(rest);
    return;
  }

  await handleModelsOrSetup(command, rest);
}

main().catch((error) => {
  process.stderr.write(`${normalizeRenderedOutput(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
