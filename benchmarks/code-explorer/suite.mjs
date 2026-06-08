#!/usr/bin/env node
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { MODEL_PRICING, formatDollars } from "./pricing.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const RESULTS_DIR = path.join(ROOT, "benchmark-results/code-explorer");
const TASKS_PATH = path.join(ROOT, "benchmarks/code-explorer/tasks.json");
const BENCHMARK_MD = path.join(ROOT, "BENCHMARK.md");
const GENERATED_START = "<!-- CODE_EXPLORER_BENCHMARK_LATEST_START -->";
const GENERATED_END = "<!-- CODE_EXPLORER_BENCHMARK_LATEST_END -->";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "smoke" },
    repos: { type: "string" },
    tasks: { type: "string" },
    repeats: { type: "string", default: "1" },
    timeout: { type: "string", default: "600000" },
    concurrency: { type: "string" },
    model: { type: "string", default: "auto" },
    auth: { type: "string", default: "dyad-pro" },
    "codex-auth-path": { type: "string" },
    "codex-model": { type: "string", default: "gpt-5.5" },
    "retry-from": { type: "string" },
    "skip-build": { type: "boolean", default: false },
    "skip-fetch": { type: "boolean", default: false },
    install: { type: "boolean", default: false },
    "skip-install": { type: "boolean", default: false },
    "allow-stale-package": { type: "boolean", default: false },
    "no-update-benchmark": { type: "boolean", default: false },
    "update-run": { type: "string" },
  },
});

const mode = values.mode;
if (!["smoke", "full", "custom"].includes(mode)) {
  throw new Error("--mode must be one of: smoke, full, custom");
}

const config = JSON.parse(fs.readFileSync(TASKS_PATH, "utf8"));
const beforeRunIds = new Set(listRunIds());

if (values["update-run"]) {
  const runId = values["update-run"];
  if (!fs.existsSync(path.join(RESULTS_DIR, runId, "summary.json"))) {
    throw new Error(`Unknown benchmark run: ${runId}`);
  }
  const previousRunId = findPreviousRunId(runId);
  writePreviousComparison(runId, previousRunId);
  if (!values["no-update-benchmark"]) {
    updateBenchmarkMarkdown(runId, previousRunId);
  }
  console.log(`Updated benchmark report for ${runId}`);
  if (previousRunId) {
    console.log(`Compared with previous run: ${previousRunId}`);
  }
  process.exit(0);
}

if (!values["skip-build"]) {
  run("npm", ["run", "build"]);
}

const args = buildBenchmarkArgs();
run("node", ["benchmarks/code-explorer/run.mjs", ...args]);

const runId = findNewRunId(beforeRunIds);
if (!runId) {
  throw new Error("Benchmark completed but no new result directory was found");
}

const runDir = path.join(RESULTS_DIR, runId);
const previousRunId = findPreviousRunId(runId);
writePreviousComparison(runId, previousRunId);

if (!values["no-update-benchmark"]) {
  updateBenchmarkMarkdown(runId, previousRunId);
}

console.log(`Benchmark suite complete: ${path.relative(ROOT, runDir)}`);
if (previousRunId) {
  console.log(`Compared with previous run: ${previousRunId}`);
}

function buildBenchmarkArgs() {
  const args = [];
  const defaults = defaultSelectionForMode();
  const repos = values.repos ?? defaults.repos;
  const tasks = values.tasks ?? defaults.tasks;
  const concurrency = values.concurrency ?? defaults.concurrency;
  const shouldFetch = !values["skip-fetch"] && defaults.fetchRepos;
  const shouldInstall =
    !values["skip-install"] && (values.install || defaults.install);

  if (repos) args.push("--repos", repos);
  if (tasks) args.push("--tasks", tasks);
  args.push("--repeats", values.repeats);
  args.push("--timeout", values.timeout);
  args.push("--model", values.model);
  args.push("--auth", values.auth);
  if (values["codex-auth-path"]) {
    args.push("--codex-auth-path", values["codex-auth-path"]);
  }
  if (values.auth === "codex") {
    args.push("--codex-model", values["codex-model"]);
  }
  if (values["retry-from"]) {
    args.push("--retry-from", values["retry-from"]);
  }
  args.push("--concurrency", concurrency);
  if (shouldFetch) args.push("--fetch-repos");
  if (shouldInstall) args.push("--install");
  if (values["allow-stale-package"]) args.push("--allow-stale-package");
  return args;
}

function defaultSelectionForMode() {
  if (mode === "smoke") {
    return {
      repos: "excalidraw",
      tasks: "toolbar-flow",
      concurrency: "1",
      fetchRepos: true,
      install: false,
    };
  }
  if (mode === "full") {
    return {
      repos: config.repos.map((repo) => repo.name).join(","),
      tasks: undefined,
      concurrency: "2",
      fetchRepos: true,
      install: false,
    };
  }
  return {
    repos: values.repos,
    tasks: values.tasks,
    concurrency: values.concurrency ?? "1",
    fetchRepos: !values.repos,
    install: false,
  };
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
  }
}

function listRunIds() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((entry) => /^run-\d{4}-/.test(entry))
    .filter((entry) =>
      fs.existsSync(path.join(RESULTS_DIR, entry, "summary.json")),
    )
    .sort();
}

function findNewRunId(beforeRunIds) {
  return listRunIds()
    .filter((runId) => !beforeRunIds.has(runId))
    .at(-1);
}

function findPreviousRunId(currentRunId) {
  return listRunIds()
    .filter((runId) => runId !== currentRunId)
    .at(-1);
}

function writePreviousComparison(runId, previousRunId) {
  if (!previousRunId) return;
  const current = readSummary(runId);
  const previous = readSummary(previousRunId);
  const markdown = [
    `# Code Explorer Benchmark Comparison`,
    "",
    `Current: \`${runId}\``,
    `Previous: \`${previousRunId}\``,
    "",
    "## By Arm",
    "",
    "| Arm | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Elapsed delta ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...["baseline", "explore"].map((arm) => {
      const now = current.byArm?.[arm] ?? {};
      const before = previous.byArm?.[arm] ?? {};
      return `| ${arm} | ${(now.mainTotalTokens ?? 0) - (before.mainTotalTokens ?? 0)} | ${(now.subagentTotalTokens ?? 0) - (before.subagentTotalTokens ?? 0)} | ${(now.totalTokens ?? 0) - (before.totalTokens ?? 0)} | ${formatDollars((now.costUsd ?? 0) - (before.costUsd ?? 0))} | ${(now.mainToolCalls ?? 0) - (before.mainToolCalls ?? 0)} | ${(now.subagentToolCalls ?? 0) - (before.subagentToolCalls ?? 0)} | ${(now.toolCalls ?? 0) - (before.toolCalls ?? 0)} | ${(now.elapsedMs ?? 0) - (before.elapsedMs ?? 0)} |`;
    }),
    "",
    "## Current Task Deltas",
    "",
    taskDeltasTable(current),
    "",
  ].join("\n");
  fs.writeFileSync(
    path.join(RESULTS_DIR, runId, "comparison-to-previous.md"),
    markdown,
  );
}

function updateBenchmarkMarkdown(runId, previousRunId) {
  const summary = readSummary(runId);
  const generated = [
    GENERATED_START,
    "## Latest Generated Benchmark Run",
    "",
    `Run: \`${runId}\``,
    previousRunId ? `Compared with previous run: \`${previousRunId}\`` : "",
    "",
    `Trials: ${summary.trials}`,
    `OK: ${summary.ok}`,
    `Errors: ${summary.errors}`,
    "",
    "### By Arm",
    "",
    `Pricing assumption: primary \`${MODEL_PRICING.primary.model}\` input/cached/output = $${MODEL_PRICING.primary.inputPerMillion}/$${MODEL_PRICING.primary.cachedInputPerMillion}/$${MODEL_PRICING.primary.outputPerMillion} per 1M; value \`${MODEL_PRICING.value.model}\` input/cached/output = $${MODEL_PRICING.value.inputPerMillion}/$${MODEL_PRICING.value.cachedInputPerMillion}/$${MODEL_PRICING.value.outputPerMillion} per 1M.`,
    "",
    "| Arm | OK | Explore available | Explore used | Primary uncached input | Primary cached input | Primary output | Primary total | Primary cost | Value uncached input | Value cached input | Value output | Value total | Value cost | Combined total | Combined cost | Primary tool calls | Value tool calls | Total tool calls | Avg elapsed ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.byArm ?? {}).map(([arm, item]) => {
      return `| ${arm} | ${item.ok}/${item.count} | ${item.exploreCodeAvailable ?? 0}/${item.count} | ${item.exploreCodeUsed ?? 0}/${item.count} | ${item.mainUncachedInputTokens ?? 0} | ${item.mainCachedInputTokens ?? 0} | ${item.mainOutputTokens ?? 0} | ${item.mainTotalTokens ?? 0} | ${formatDollars(item.mainCostUsd)} | ${item.subagentUncachedInputTokens ?? 0} | ${item.subagentCachedInputTokens ?? 0} | ${item.subagentOutputTokens ?? 0} | ${item.subagentTotalTokens ?? 0} | ${formatDollars(item.subagentCostUsd)} | ${item.totalTokens ?? 0} | ${formatDollars(item.costUsd)} | ${item.mainToolCalls ?? 0} | ${item.subagentToolCalls ?? 0} | ${item.toolCalls ?? 0} | ${Math.round((item.elapsedMs ?? 0) / Math.max(item.count ?? 1, 1))} |`;
    }),
    "",
    "### Quality Metrics",
    "",
    "| Arm | Rubric pass | Expected-term coverage | File refs | Line-range refs | Final chars |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.byArm ?? {}).map(([arm, item]) => {
      return `| ${arm} | ${item.rubricPassCount ?? 0}/${item.ok ?? 0} | ${formatRatio(item.expectedTermCoverageSum, item.expectedTermCoverageCount)} | ${item.fileReferenceCount ?? 0} | ${item.lineRangeReferenceCount ?? 0} | ${item.finalTextChars ?? 0} |`;
    }),
    "",
    "### Explore Code Availability",
    "",
    "| Arm | Disabled reasons |",
    "| --- | --- |",
    ...Object.entries(summary.byArm ?? {}).map(([arm, item]) => {
      return `| ${arm} | ${formatReasons(item.exploreCodeDisabledReasons)} |`;
    }),
    "",
    "### Explore Task Cohorts",
    "",
    exploreTaskCohortsTable(summary),
    "",
    "### Task Deltas",
    "",
    taskDeltasTable(summary),
    GENERATED_END,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const current = fs.existsSync(BENCHMARK_MD)
    ? fs.readFileSync(BENCHMARK_MD, "utf8")
    : "# Code Explorer Benchmark\n";
  const pattern = new RegExp(
    `${escapeRegExp(GENERATED_START)}[\\s\\S]*?${escapeRegExp(GENERATED_END)}\\n?`,
  );
  const next = pattern.test(current)
    ? current.replace(pattern, generated)
    : `${current.trimEnd()}\n\n${generated}`;
  fs.writeFileSync(BENCHMARK_MD, next.endsWith("\n") ? next : `${next}\n`);
}

function taskDeltasTable(summary) {
  const rows = summary.taskDeltas ?? [];
  if (rows.length === 0) return "_No task deltas available._";
  return [
    "| Repo | Task | App subpath | Explore status | Explore available | Explore used | Disabled reasons | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Quality delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Provider-step delta | Elapsed delta ms | Arm winner |",
    "| --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((item) => {
      return `| ${item.repo} | ${item.task} | ${item.appSubPath ?? "unknown"} | ${item.exploreStatus ?? exploreTaskStatus(item)} | ${item.exploreCodeAvailable ?? 0}/${item.exploreCount ?? 0} | ${item.exploreCodeUsed ?? 0}/${item.exploreCount ?? 0} | ${formatReasons(item.exploreCodeDisabledReasons)} | ${item.primaryTokenDelta ?? 0} | ${item.valueTokenDelta ?? 0} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${formatSigned(item.qualityScoreDelta)} | ${item.primaryToolCallDelta ?? 0} | ${item.valueToolCallDelta ?? 0} | ${item.toolCallDelta} | ${item.providerStepDelta} | ${item.elapsedDeltaMs} | ${item.winner} |`;
    }),
  ].join("\n");
}

function exploreTaskCohortsTable(summary) {
  const rows =
    summary.exploreTaskCohorts ?? summarizeExploreTaskCohorts(summary);
  if (rows.length === 0) return "_No explore task cohort data available._";
  return [
    "| Cohort | Tasks | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Elapsed delta ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((item) => {
      return `| ${item.status} | ${item.tasks} | ${item.primaryTokenDelta ?? 0} | ${item.valueTokenDelta ?? 0} | ${item.tokenDelta ?? 0} | ${formatDollars(item.costDeltaUsd ?? 0)} | ${item.primaryToolCallDelta ?? 0} | ${item.valueToolCallDelta ?? 0} | ${item.toolCallDelta ?? 0} | ${item.elapsedDeltaMs ?? 0} |`;
    }),
  ].join("\n");
}

function summarizeExploreTaskCohorts(summary) {
  const rows = summary.taskDeltas ?? [];
  const statuses = [
    "available-used",
    "partially-used",
    "available-unused",
    "unavailable",
  ];
  return statuses.map((status) => {
    const cohort = rows.filter((row) => exploreTaskStatus(row) === status);
    return {
      status,
      tasks: cohort.length,
      primaryTokenDelta: sum(cohort, "primaryTokenDelta"),
      valueTokenDelta: sum(cohort, "valueTokenDelta"),
      tokenDelta: sum(cohort, "tokenDelta"),
      costDeltaUsd: sum(cohort, "costDeltaUsd"),
      primaryToolCallDelta: sum(cohort, "primaryToolCallDelta"),
      valueToolCallDelta: sum(cohort, "valueToolCallDelta"),
      toolCallDelta: sum(cohort, "toolCallDelta"),
      elapsedDeltaMs: sum(cohort, "elapsedDeltaMs"),
    };
  });
}

function exploreTaskStatus(item) {
  const exploreCount = item.exploreCount ?? 0;
  const exploreCodeAvailable = item.exploreCodeAvailable ?? 0;
  const exploreCodeUsed = item.exploreCodeUsed ?? 0;
  if (exploreCount === 0 || exploreCodeAvailable === 0) return "unavailable";
  if (exploreCodeUsed === 0) return "available-unused";
  if (exploreCodeAvailable < exploreCount || exploreCodeUsed < exploreCount) {
    return "partially-used";
  }
  return "available-used";
}

function readSummary(runId) {
  return JSON.parse(
    fs.readFileSync(path.join(RESULTS_DIR, runId, "summary.json"), "utf8"),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatReasons(reasons = {}) {
  const entries = Object.entries(reasons);
  if (entries.length === 0) return "-";
  return entries.map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function formatRatio(sumValue = 0, count = 0) {
  if (!count) return "-";
  return (sumValue / count).toFixed(2);
}

function formatSigned(value = 0) {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
