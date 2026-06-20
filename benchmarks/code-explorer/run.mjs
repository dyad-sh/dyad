#!/usr/bin/env node
import "dotenv/config";

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { MODEL_PRICING, formatDollars, usageCost } from "./pricing.mjs";

const require = createRequire(import.meta.url);
const eph = require("electron-playwright-helpers");

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CONFIG_PATH = path.join(ROOT, "benchmarks/code-explorer/tasks.json");
const REPOS_DIR = path.join(ROOT, "benchmarks/code-explorer/repos");
const RESULTS_DIR = path.join(ROOT, "benchmark-results/code-explorer");

const { values } = parseArgs({
  options: {
    repos: { type: "string" },
    tasks: { type: "string" },
    repeats: { type: "string", default: "1" },
    "fetch-repos": { type: "boolean", default: false },
    install: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    model: { type: "string", default: "auto" },
    timeout: { type: "string", default: "600000" },
    concurrency: { type: "string", default: "1" },
    "allow-stale-package": { type: "boolean", default: false },
    auth: { type: "string", default: "dyad-pro" },
    "codex-auth-path": { type: "string" },
    "codex-model": { type: "string", default: "gpt-5.5" },
    "retry-from": { type: "string" },
    "resume-from": { type: "string" },
    arms: { type: "string", default: "baseline,explore-v2" },
    "compare-arm": { type: "string" },
    "explore-v1-run": { type: "string" },
    "explore-v1-source-arm": { type: "string" },
  },
});

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const selectedRepos = splitList(values.repos);
const selectedTasks = splitList(values.tasks);
const repeats = Number(values.repeats ?? 1);
const timeoutMs = Number(values.timeout ?? 600_000);
const concurrency = Number(values.concurrency ?? 1);
const authMode = values.auth;
const selectedArms = normalizeSelectedArms(splitList(values.arms));
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error("--repeats must be a positive integer");
}
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("--concurrency must be a positive integer");
}
if (!["dyad-pro", "codex"].includes(authMode)) {
  throw new Error("--auth must be one of: dyad-pro, codex");
}
validateArms(selectedArms);
const primaryCompareArm = resolvePrimaryCompareArm(
  selectedArms,
  values["compare-arm"],
);
const importedArmRows = loadImportedArmRows(config, selectedArms);
const executableArms = new Set(
  [...selectedArms].filter((arm) => !isImportedArm(arm)),
);

if (values["retry-from"] && values["resume-from"]) {
  throw new Error("Use only one of --retry-from or --resume-from");
}

const fullMatrix = buildMatrix(
  config,
  selectedRepos,
  selectedTasks,
  repeats,
  executableArms,
);
const resumedRows = values["resume-from"]
  ? loadResumedRows(fullMatrix, values["resume-from"])
  : [];
const retryPreservedRows = values["retry-from"]
  ? loadRetryPreservedRows(fullMatrix, values["retry-from"])
  : [];
const matrix = values["retry-from"]
  ? buildRetryMatrix(fullMatrix, values["retry-from"])
  : values["resume-from"]
    ? buildResumeMatrix(fullMatrix, values["resume-from"])
    : fullMatrix;

if (values["dry-run"]) {
  console.log(
    JSON.stringify(
      {
        runId,
        totalTrials:
          matrix.length +
          importedArmRows.length +
          resumedRows.length +
          retryPreservedRows.length,
        liveTrials: matrix.length,
        importedTrials: importedArmRows.length,
        resumedTrials: resumedRows.length + retryPreservedRows.length,
        concurrency,
        imported: importedArmRows.map((row) => ({
          repo: row.repo,
          task: row.task,
          arm: row.arm,
          repeat: row.repeat,
          sourceRunId: row.importedFromRunId,
          sourceArm: row.importedFromArm,
        })),
        resumed: resumedRows.map((row) => ({
          repo: row.repo,
          task: row.task,
          arm: row.arm,
          repeat: row.repeat,
          sourceRunId: row.resumedFromRunId,
        })),
        matrix: matrix.map(enrichTrialForDryRun),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (matrix.length > 0 && authMode === "dyad-pro" && !process.env.DYAD_PRO_KEY) {
  throw new Error(
    "DYAD_PRO_KEY must be set in .env for Dyad Engine benchmark runs",
  );
}

const packageInfo = matrix.length > 0 ? getPackageInfo() : null;
if (packageInfo && !values["allow-stale-package"]) {
  assertPackageFresh(packageInfo);
}

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(REPOS_DIR, { recursive: true });

if (values["fetch-repos"]) {
  for (const repo of config.repos) {
    if (selectedRepos && !selectedRepos.has(repo.name)) continue;
    fetchRepo(repo);
  }
}

const resultsPath = path.join(RESULTS_DIR, runId, "runs.jsonl");
fs.mkdirSync(path.dirname(resultsPath), { recursive: true });

const benchmarkAuth =
  matrix.length > 0
    ? await setupBenchmarkAuth()
    : { mode: authMode, model: values.model };

console.log(
  `Running ${matrix.length} live trial(s), importing ${importedArmRows.length} trial(s), resuming ${resumedRows.length + retryPreservedRows.length} trial(s), with concurrency ${Math.min(concurrency, Math.max(matrix.length, 1))}`,
);
try {
  writeResumedRows(resultsPath, retryPreservedRows);
  writeResumedRows(resultsPath, resumedRows);
  writeImportedRows(resultsPath, importedArmRows);
  await runTrials(matrix, concurrency, resultsPath, benchmarkAuth);
} finally {
  await benchmarkAuth.close?.();
}

writeSummary(runId, resultsPath);

async function runTrials(trials, concurrency, resultsPath, benchmarkAuth) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, trials.length);

  async function runWorker() {
    while (true) {
      const trial = trials[nextIndex++];
      if (!trial) return;

      const result = await runTrial(trial, benchmarkAuth);
      fs.appendFileSync(resultsPath, JSON.stringify(result) + "\n");
      console.log(
        `${trial.repo.name}/${trial.task.id}/${trial.arm}/repeat-${trial.repeat}: ${result.status}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => {
      return runWorker();
    }),
  );
}

function buildMatrix(config, repoFilter, taskFilter, repeats, arms) {
  const rows = [];
  for (const repo of config.repos) {
    if (repoFilter && !repoFilter.has(repo.name)) continue;
    for (const task of repo.tasks) {
      if (taskFilter && !taskFilter.has(task.id)) continue;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        for (const arm of arms) {
          rows.push({ repo, task, arm, repeat });
        }
      }
    }
  }
  return rows;
}

function enrichTrialForDryRun(trial) {
  const importSubPath = selectedImportSubPath(trial);
  const repoPath = path.join(REPOS_DIR, trial.repo.name, importSubPath);
  return {
    ...trial,
    appSubPath: selectedAppSubPath(trial),
    appImportSubPath: importSubPath,
    contextPaths: selectedContextPaths(trial, repoPath),
  };
}

function buildRetryMatrix(expectedRows, retryRunId) {
  const runsPath = path.join(RESULTS_DIR, retryRunId, "runs.jsonl");
  if (!fs.existsSync(runsPath)) {
    throw new Error(`Cannot retry missing benchmark run: ${retryRunId}`);
  }
  const expectedByGroup = new Map(
    expectedRows.map((trial) => [trialGroupKey(trial), trial]),
  );
  const rows = readRunRows(runsPath);
  const failedPairs = new Set(
    rows
      .filter((row) => row.status !== "ok")
      .map((row) => `${row.repo}\0${row.task}\0${row.repeat}`)
      .filter((key) => expectedByGroup.has(key)),
  );
  const retryRows = [];
  for (const key of failedPairs) {
    const trial = expectedByGroup.get(key);
    for (const arm of executableArms) {
      retryRows.push({
        repo: trial.repo,
        task: trial.task,
        arm,
        repeat: trial.repeat,
      });
    }
  }
  return retryRows;
}

function trialGroupKey(trial) {
  return `${trial.repo.name}\0${trial.task.id}\0${trial.repeat}`;
}

function buildResumeMatrix(expectedRows, resumeRunId) {
  const runsPath = path.join(RESULTS_DIR, resumeRunId, "runs.jsonl");
  if (!fs.existsSync(runsPath)) {
    throw new Error(`Cannot resume missing benchmark run: ${resumeRunId}`);
  }

  const completedRows = new Set();
  const sourceRows = readRunRows(runsPath);
  for (const row of sourceRows) {
    if (row.status === "ok") {
      completedRows.add(runRowKey(row));
    }
  }

  return expectedRows.filter((row) => !completedRows.has(trialKey(row)));
}

function loadResumedRows(expectedRows, resumeRunId) {
  const runsPath = path.join(RESULTS_DIR, resumeRunId, "runs.jsonl");
  if (!fs.existsSync(runsPath)) {
    throw new Error(`Cannot resume missing benchmark run: ${resumeRunId}`);
  }

  const expectedKeys = new Set(expectedRows.map(trialKey));
  return readRunRows(runsPath)
    .filter((row) => row.status === "ok" && expectedKeys.has(runRowKey(row)))
    .map((row) => ({
      ...row,
      resumedFromRunId: resumeRunId,
      resumedFromTrialRunId: row.runId,
    }));
}

function loadRetryPreservedRows(expectedRows, retryRunId) {
  const runsPath = path.join(RESULTS_DIR, retryRunId, "runs.jsonl");
  if (!fs.existsSync(runsPath)) {
    throw new Error(`Cannot retry missing benchmark run: ${retryRunId}`);
  }

  const sourceRows = readRunRows(runsPath);
  const failedGroups = new Set(
    sourceRows
      .filter((row) => row.status !== "ok")
      .map((row) => runRowGroupKey(row)),
  );
  const expectedKeys = new Set(expectedRows.map(trialKey));
  return sourceRows
    .filter(
      (row) =>
        row.status === "ok" &&
        expectedKeys.has(runRowKey(row)) &&
        !failedGroups.has(runRowGroupKey(row)),
    )
    .map((row) => ({
      ...row,
      resumedFromRunId: retryRunId,
      resumedFromTrialRunId: row.runId,
    }));
}

function readRunRows(runsPath) {
  const text = fs.readFileSync(runsPath, "utf8").trim();
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runRowKey(row) {
  return `${row.repo}\0${row.task}\0${row.repeat}\0${row.arm}`;
}

function runRowGroupKey(row) {
  return `${row.repo}\0${row.task}\0${row.repeat}`;
}

function trialKey(row) {
  return `${row.repo.name}\0${row.task.id}\0${row.repeat}\0${row.arm}`;
}

function splitList(value) {
  if (!value) return null;
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeSelectedArms(arms) {
  if (!arms) return arms;
  return new Set([...arms].map(normalizeArmAlias));
}

function normalizeArmAlias(arm) {
  if (arm === "explore") return "explore-v2";
  return arm;
}

function validateArms(arms) {
  const allowed = new Set(["baseline", "explore-v1", "explore-v2"]);
  if (!arms || arms.size === 0) {
    throw new Error("--arms must include at least one arm");
  }
  for (const arm of arms) {
    if (!allowed.has(arm)) {
      throw new Error(
        `Unknown benchmark arm: ${arm}. Allowed arms: ${[...allowed].join(", ")}`,
      );
    }
  }
}

function isImportedArm(arm) {
  return arm === "explore-v1";
}

function loadImportedArmRows(config, arms) {
  if (!arms.has("explore-v1")) {
    return [];
  }
  if (!values["explore-v1-run"]) {
    throw new Error(
      "--arms including explore-v1 requires --explore-v1-run <run-id>. V1 is imported from a prior benchmark run so production code can remain V2-only.",
    );
  }

  const sourceRunIds = splitList(values["explore-v1-run"]);
  const sourceRows = readImportedSourceRows(sourceRunIds);
  const sourceArmPriority = values["explore-v1-source-arm"]
    ? [values["explore-v1-source-arm"]]
    : [
        "explore-v1",
        "explore-candidate-followup",
        "explore-candidate",
        "explore",
      ];
  const wantedRows = buildMatrix(
    config,
    selectedRepos,
    selectedTasks,
    repeats,
    new Set(["explore-v1"]),
  );
  const usedSourceRows = new Set();
  return wantedRows.map((trial) => {
    const source = findImportedSourceRow({
      sourceRows,
      sourceArmPriority,
      trial,
      usedSourceRows,
    });
    if (!source) {
      throw new Error(
        `Explore V1 source runs ${[...sourceRunIds].join(", ")} have no matching row for ${trial.repo.name}/${trial.task.id}/repeat-${trial.repeat}. Tried arms: ${sourceArmPriority.join(", ")}`,
      );
    }
    usedSourceRows.add(source.importSourceKey);
    return normalizeImportedExploreV1Row(source, trial.repeat);
  });
}

function readImportedSourceRows(sourceRunIds) {
  const rows = [];
  for (const sourceRunId of sourceRunIds) {
    const sourceRowsPath = path.join(RESULTS_DIR, sourceRunId, "runs.jsonl");
    if (!fs.existsSync(sourceRowsPath)) {
      throw new Error(`Cannot import missing explore-v1 run: ${sourceRunId}`);
    }
    const sourceRows = readRunRows(sourceRowsPath);
    for (const [index, row] of sourceRows.entries()) {
      rows.push({
        ...row,
        importSourceRunId: sourceRunId,
        importSourceIndex: index,
        importSourceKey: `${sourceRunId}\0${index}`,
      });
    }
  }
  return rows;
}

function findImportedSourceRow({
  sourceRows,
  sourceArmPriority,
  trial,
  usedSourceRows,
}) {
  for (const arm of sourceArmPriority) {
    const candidates = sourceRows
      .filter(
        (row) =>
          !usedSourceRows.has(row.importSourceKey) &&
          row.status === "ok" &&
          row.repo === trial.repo.name &&
          row.task === trial.task.id &&
          row.arm === arm,
      )
      .sort(compareImportedSourceRows);
    const exactRepeat = candidates.find((row) => row.repeat === trial.repeat);
    if (exactRepeat) {
      return exactRepeat;
    }
  }
  return null;
}

function compareImportedSourceRows(a, b) {
  return (
    String(a.importSourceRunId).localeCompare(String(b.importSourceRunId)) ||
    (Number(a.repeat) || 0) - (Number(b.repeat) || 0) ||
    (Number(a.importSourceIndex) || 0) - (Number(b.importSourceIndex) || 0)
  );
}

function normalizeImportedExploreV1Row(row, repeat) {
  const sourceMetrics = fs.existsSync(
    path.join(RESULTS_DIR, row.runId, "events.jsonl"),
  )
    ? readBenchmarkMetrics(row.runId)
    : {};
  return {
    ...row,
    ...sourceMetrics,
    runId: `${runId}-${row.repo}-${row.task}-explore-v1-${repeat}-imported`,
    arm: "explore-v1",
    reportMode: "explore-v1",
    repeat,
    importedFromRunId: row.importSourceRunId,
    importedFromArm: row.importedFromArm ?? row.arm,
    importedFromRepeat: row.importedFromRepeat ?? row.repeat,
    importedFromTrialRunId: row.importedFromTrialRunId ?? row.runId,
  };
}

function writeImportedRows(resultsPath, rows) {
  for (const row of rows) {
    fs.appendFileSync(resultsPath, JSON.stringify(row) + "\n");
    console.log(
      `${row.repo}/${row.task}/${row.arm}/repeat-${row.repeat}: imported from ${row.importedFromRunId}/${row.importedFromArm}`,
    );
  }
}

function writeResumedRows(resultsPath, rows) {
  for (const row of rows) {
    fs.appendFileSync(resultsPath, JSON.stringify(row) + "\n");
    console.log(
      `${row.repo}/${row.task}/${row.arm}/repeat-${row.repeat}: resumed from ${row.resumedFromRunId}`,
    );
  }
}

function resolvePrimaryCompareArm(arms, explicitArm) {
  if (explicitArm) {
    const normalizedArm = normalizeArmAlias(explicitArm);
    validateArms(new Set([normalizedArm]));
    if (!arms.has(normalizedArm)) {
      throw new Error(
        `--compare-arm must be included in --arms: ${normalizedArm}`,
      );
    }
    if (normalizedArm === "baseline") {
      throw new Error("--compare-arm must be an explore arm");
    }
    return normalizedArm;
  }
  const exploreArm = arms.has("explore-v2")
    ? "explore-v2"
    : [...arms].find((arm) => isExploreArm(arm));
  if (!exploreArm) {
    throw new Error(
      "--arms must include at least one explore arm when --compare-arm is omitted",
    );
  }
  return exploreArm;
}

function isExploreArm(arm) {
  return arm !== "baseline";
}

function reportModeForArm(arm) {
  return arm === "baseline" ? "baseline" : "explore-v2";
}

async function setupBenchmarkAuth() {
  if (authMode === "dyad-pro") {
    return {
      mode: "dyad-pro",
      apiKey: process.env.DYAD_PRO_KEY,
      model: values.model,
    };
  }

  const codexAuth = readCodexAuth(values["codex-auth-path"]);
  const proxy = await startCodexResponsesProxy({
    accessToken: codexAuth.accessToken,
    accountId: codexAuth.accountId,
    model: values["codex-model"],
  });
  console.log(
    `Using Codex auth for benchmarks via local proxy ${proxy.engineUrl}; engine model requests will be rewritten to ${values["codex-model"]}`,
  );
  return {
    mode: "codex",
    apiKey: "codex-benchmark-local-proxy",
    engineUrl: proxy.engineUrl,
    model: values["codex-model"],
    close: proxy.close,
  };
}

function readCodexAuth(authPath) {
  const resolvedPath = expandHome(authPath ?? "~/.codex/auth.json");
  const auth = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const accessToken = auth.tokens?.access_token;
  const accountId =
    auth.tokens?.account_id ??
    readJwtPayload(accessToken)?.[
      "https://api.openai.com/auth.chatgpt_account_id"
    ];

  if (!accessToken || typeof accessToken !== "string") {
    throw new Error(`Codex auth file ${resolvedPath} is missing access_token`);
  }
  if (!accountId || typeof accountId !== "string") {
    throw new Error(`Codex auth file ${resolvedPath} is missing account_id`);
  }

  return { accessToken, accountId };
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function readJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function startCodexResponsesProxy({ accessToken, accountId, model }) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unsupported benchmark endpoint" }));
      return;
    }

    try {
      if (request.url === "/v1/responses") {
        await handleResponsesProxyRequest({
          request,
          response,
          accessToken,
          accountId,
          model,
        });
        return;
      }
      if (request.url === "/v1/chat/completions") {
        await handleChatCompletionsProxyRequest({
          request,
          response,
          accessToken,
          accountId,
          model,
        });
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unsupported benchmark endpoint" }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Codex benchmark proxy");
  }
  return {
    engineUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function handleResponsesProxyRequest({
  request,
  response,
  accessToken,
  accountId,
  model,
}) {
  const incoming = JSON.parse(await readRequestBody(request));
  const outgoing = normalizeResponsesPayload(incoming, model);
  const upstream = await fetchCodexResponses({
    accessToken,
    accountId,
    outgoing,
  });
  if (await writeUpstreamErrorIfNeeded({ upstream, response, outgoing })) {
    return;
  }
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
  });
  await pipeReadableStream(upstream.body, response);
}

async function handleChatCompletionsProxyRequest({
  request,
  response,
  accessToken,
  accountId,
  model,
}) {
  const incoming = JSON.parse(await readRequestBody(request));
  const outgoing = normalizeChatCompletionPayload(incoming, model);
  const upstream = await fetchCodexResponses({
    accessToken,
    accountId,
    outgoing,
  });
  if (await writeUpstreamErrorIfNeeded({ upstream, response, outgoing })) {
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  await pipeResponsesSseAsChatCompletions(upstream.body, response, model);
}

function normalizeResponsesPayload(incoming, model) {
  const outgoing = {
    ...incoming,
    model,
    instructions: incoming.instructions ?? extractInstructions(incoming.input),
    stream: true,
    store: false,
  };
  delete outgoing.dyad_options;
  delete outgoing.max_output_tokens;
  return outgoing;
}

function normalizeChatCompletionPayload(incoming, model) {
  return {
    model,
    instructions: extractInstructionsFromMessages(incoming.messages),
    input: chatMessagesToResponsesInput(incoming.messages),
    tools: chatToolsToResponsesTools(incoming.tools),
    tool_choice: incoming.tool_choice,
    stream: true,
    store: false,
  };
}

function fetchCodexResponses({ accessToken, accountId, outgoing }) {
  return fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "chatgpt-account-id": accountId,
      originator: "dyad-code-explorer-benchmark",
      "OpenAI-Beta": "responses=experimental",
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(outgoing),
  });
}

async function writeUpstreamErrorIfNeeded({ upstream, response, outgoing }) {
  if (upstream.ok) return false;
  const errorBody = await upstream.text();
  console.error(
    `[codex proxy] upstream ${upstream.status} for keys ${Object.keys(outgoing).sort().join(",")}: ${truncate(errorBody, 1000)}`,
  );
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  });
  response.end(errorBody);
  return true;
}

async function pipeReadableStream(readable, response) {
  if (!readable) {
    response.end();
    return;
  }
  const reader = readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(Buffer.from(value));
  }
  response.end();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function extractInstructions(input) {
  const extracted = Array.isArray(input)
    ? input
        .filter((item) => item?.role === "system" || item?.role === "developer")
        .map((item) => extractContentText(item.content))
        .filter(Boolean)
        .join("\n\n")
        .trim()
    : "";
  return extracted || "You are Dyad's local agent running a benchmark task.";
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.input_text === "string") return part.input_text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractInstructionsFromMessages(messages) {
  const extracted = Array.isArray(messages)
    ? messages
        .filter((message) => message.role === "system")
        .map((message) => extractContentText(message.content))
        .filter(Boolean)
        .join("\n\n")
        .trim()
    : "";
  return extracted || "You are Dyad's local agent running a benchmark task.";
}

function chatMessagesToResponsesInput(messages) {
  if (!Array.isArray(messages)) return [];
  const input = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: extractContentText(message.content),
      });
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments ?? "{}",
        });
      }
      const text = extractContentText(message.content);
      if (!text) continue;
    }
    input.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: extractContentText(message.content),
    });
  }
  return input;
}

function chatToolsToResponsesTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools
    .filter((tool) => tool.type === "function" && tool.function?.name)
    .map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
}

async function pipeResponsesSseAsChatCompletions(readable, response, model) {
  if (!readable) {
    response.end();
    return;
  }

  const id = `chatcmpl-${cryptoRandomId()}`;
  const created = Math.floor(Date.now() / 1000);
  let roleSent = false;
  let buffer = "";
  const toolCallIndexes = new Map();
  let emittedToolCall = false;
  let completedUsage;

  const writeChunk = (delta, finishReason = null) => {
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  };

  const ensureRole = () => {
    if (roleSent) return;
    writeChunk({ role: "assistant" });
    roleSent = true;
  };

  const reader = readable.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSseEventsFromBuffer(buffer);
    buffer = events.remainder;
    for (const event of events.items) {
      handleResponsesEventAsChatChunk({
        event,
        ensureRole,
        writeChunk,
        toolCallIndexes,
        markToolCall: () => {
          emittedToolCall = true;
        },
        setUsage: (usage) => {
          completedUsage = usage;
        },
      });
    }
  }
  const finalEvents = parseSseEventsFromBuffer(buffer + "\n\n");
  for (const event of finalEvents.items) {
    handleResponsesEventAsChatChunk({
      event,
      ensureRole,
      writeChunk,
      toolCallIndexes,
      markToolCall: () => {
        emittedToolCall = true;
      },
      setUsage: (usage) => {
        completedUsage = usage;
      },
    });
  }
  ensureRole();
  writeChunk({}, emittedToolCall ? "tool_calls" : "stop");
  if (completedUsage) {
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [],
        usage: completedUsage,
      })}\n\n`,
    );
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function handleResponsesEventAsChatChunk({
  event,
  ensureRole,
  writeChunk,
  toolCallIndexes,
  markToolCall,
  setUsage,
}) {
  if (!event.data || event.data === "[DONE]") return;
  let parsed;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    return;
  }
  if (event.event === "response.output_text.delta" && parsed.delta) {
    ensureRole();
    writeChunk({ content: parsed.delta });
    return;
  }
  if (event.event === "response.output_item.added") {
    const item = parsed.item;
    if (item?.type !== "function_call") return;
    ensureRole();
    markToolCall();
    const index = toolCallIndexes.size;
    const callId = item.call_id ?? item.id ?? `call_${index}`;
    rememberToolCallIndex(toolCallIndexes, index, [
      parsed.output_index,
      item.id,
      item.call_id,
      callId,
    ]);
    writeChunk({
      tool_calls: [
        {
          index,
          id: callId,
          type: "function",
          function: { name: item.name, arguments: "" },
        },
      ],
    });
    return;
  }
  if (event.event === "response.function_call_arguments.delta") {
    ensureRole();
    const index =
      findToolCallIndex(toolCallIndexes, [
        parsed.output_index,
        parsed.item_id,
        parsed.call_id,
      ]) ?? 0;
    writeChunk({
      tool_calls: [
        {
          index,
          function: { arguments: parsed.delta ?? "" },
        },
      ],
    });
    return;
  }
  if (event.event === "response.completed") {
    const usage = parsed.response?.usage ?? parsed.usage;
    if (usage) setUsage(responsesUsageToChatUsage(usage));
  }
}

function rememberToolCallIndex(toolCallIndexes, index, keys) {
  for (const key of keys) {
    if (key !== undefined && key !== null) {
      toolCallIndexes.set(key, index);
    }
  }
}

function findToolCallIndex(toolCallIndexes, keys) {
  for (const key of keys) {
    if (key === undefined || key === null) continue;
    const index = toolCallIndexes.get(key);
    if (index !== undefined) {
      return index;
    }
  }
  return null;
}

function responsesUsageToChatUsage(usage) {
  const promptTokens = numberOrZero(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens,
  );
  const completionTokens = numberOrZero(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens,
  );
  const cachedTokens = numberOrZero(
    usage.input_tokens_details?.cached_tokens ??
      usage.inputTokenDetails?.cacheReadTokens ??
      usage.prompt_tokens_details?.cached_tokens,
  );
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens:
      numberOrZero(usage.total_tokens ?? usage.totalTokens) ||
      promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
    },
  };
}

function parseSseEventsFromBuffer(buffer) {
  const blocks = buffer.split(/\n\n/);
  const remainder = blocks.pop() ?? "";
  const items = blocks
    .map((block) => {
      let event = "message";
      const data = [];
      for (const line of block.split(/\n/)) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice("data:".length).trimStart());
        }
      }
      return { event, data: data.join("\n") };
    })
    .filter((item) => item.data);
  return { items, remainder };
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 25 * 1024 * 1024) {
        request.destroy(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function fetchRepo(repo) {
  const repoPath = path.join(REPOS_DIR, repo.name);
  if (!fs.existsSync(repoPath)) {
    execFileSync(
      "git",
      ["clone", "--filter=blob:none", repo.gitUrl, repoPath],
      {
        stdio: "inherit",
      },
    );
  } else {
    execFileSync("git", ["fetch", "--depth=1", "origin"], {
      cwd: repoPath,
      stdio: "inherit",
    });
    execFileSync("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd: repoPath,
      stdio: "inherit",
    });
  }
  if (values.install) {
    const installPaths = new Set([
      repo.installPath ?? repo.subPath ?? ".",
      ...repo.tasks.map((task) => task.installPath).filter(Boolean),
    ]);
    for (const installPath of installPaths) {
      installRepoDependencies(path.join(repoPath, installPath));
    }
  }
}

function installRepoDependencies(repoPath) {
  const { command, args } = resolveInstallCommand(repoPath);
  execFileSync(command, args, {
    cwd: repoPath,
    stdio: "inherit",
  });
}

function resolveInstallCommand(repoPath) {
  const packageJsonPath = path.join(repoPath, "package.json");
  let packageManager = "";
  if (fs.existsSync(packageJsonPath)) {
    packageManager =
      JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).packageManager ?? "";
  }

  if (packageManager.startsWith("yarn@")) {
    return { command: "corepack", args: ["yarn", "install", "--immutable"] };
  }
  if (packageManager.startsWith("pnpm@")) {
    return { command: "pnpm", args: ["install"] };
  }
  if (packageManager.startsWith("npm@")) {
    return { command: "npm", args: ["install"] };
  }
  if (packageManager.startsWith("bun@")) {
    return { command: "bun", args: ["install"] };
  }

  if (fs.existsSync(path.join(repoPath, "yarn.lock"))) {
    return { command: "corepack", args: ["yarn", "install", "--immutable"] };
  }
  if (fs.existsSync(path.join(repoPath, "pnpm-lock.yaml"))) {
    return { command: "pnpm", args: ["install"] };
  }
  if (fs.existsSync(path.join(repoPath, "package-lock.json"))) {
    return { command: "npm", args: ["install"] };
  }
  if (fs.existsSync(path.join(repoPath, "bun.lockb"))) {
    return { command: "bun", args: ["install"] };
  }

  return { command: "npm", args: ["install"] };
}

async function runTrial(trial, benchmarkAuth) {
  const appSubPath = selectedAppSubPath(trial);
  const importSubPath = selectedImportSubPath(trial);
  const repoPath = path.join(REPOS_DIR, trial.repo.name, importSubPath);
  if (!fs.existsSync(repoPath)) {
    throw new Error(
      `Missing repo path ${repoPath}. Run with --fetch-repos first.`,
    );
  }

  const benchmarkRunId = `${runId}-${trial.repo.name}-${trial.task.id}-${trial.arm}-${trial.repeat}`;
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dyad-code-bench-"),
  );
  const xdgConfigHome = path.join(userDataDir, "xdg-config");
  fs.mkdirSync(xdgConfigHome, { recursive: true });
  const latestBuild = eph.findLatestBuild();
  const appInfo = eph.parseElectronApp(latestBuild);
  const startedAt = Date.now();
  let contextPaths = [];
  const env = {
    ...process.env,
    DYAD_BENCHMARK_RUN_ID: benchmarkRunId,
    DYAD_PRO_KEY: benchmarkAuth.apiKey,
    XDG_CONFIG_HOME: xdgConfigHome,
    GIT_CONFIG_GLOBAL: path.join(userDataDir, ".gitconfig"),
    E2E_TEST_BUILD: "true",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "benchmark-placeholder",
    ...(benchmarkAuth.engineUrl && {
      DYAD_ENGINE_URL: benchmarkAuth.engineUrl,
    }),
  };

  let electronApp;
  try {
    logTrial(trial, "launching packaged Dyad");
    electronApp = await withTimeout(
      electron.launch({
        args: [
          appInfo.main,
          "--enable-logging",
          `--user-data-dir=${userDataDir}`,
        ],
        executablePath: appInfo.executable,
        env,
      }),
      60_000,
      "launching packaged Dyad",
    );
    electronApp.process().stdout?.on("data", (data) => {
      console.log(`[electron stdout] ${data.toString().trim()}`);
    });
    electronApp.process().stderr?.on("data", (data) => {
      console.error(`[electron stderr] ${data.toString().trim()}`);
    });
    electronApp.on("window", (page) => {
      console.log(`[electron window] ${page.url()}`);
    });
    const page = await withTimeout(
      electronApp.firstWindow({ timeout: 120_000 }),
      120_000,
      "waiting for first Electron window",
    );
    await page.waitForLoadState("domcontentloaded");

    logTrial(trial, "configuring settings and importing app");
    contextPaths = selectedContextPaths(trial, repoPath);
    const importResult = await withTimeout(
      page.evaluate(
        async ({
          repoPath,
          repoName,
          apiKey,
          selectedModel,
          enableCodeExplorer,
        }) => {
          await window.electron.ipcRenderer.invoke("set-user-settings", {
            enableDyadPro: true,
            enableCodeExplorer,
            selectedChatMode: "local-agent",
            selectedModel,
            providerSettings: {
              auto: {
                apiKey: { value: apiKey },
              },
            },
          });
          return window.electron.ipcRenderer.invoke("import-app", {
            path: repoPath,
            appName: `bench-${repoName}`,
            skipCopy: true,
          });
        },
        {
          repoPath,
          repoName: `${trial.repo.name}-${trial.arm}-${trial.repeat}`,
          apiKey: benchmarkAuth.apiKey,
          selectedModel: selectedBenchmarkModel(benchmarkAuth),
          enableCodeExplorer: isExploreArm(trial.arm),
        },
      ),
      120_000,
      "settings/import-app",
    );
    if (contextPaths.length > 0) {
      await withTimeout(
        page.evaluate(
          async ({ appId, contextPaths }) => {
            await window.electron.ipcRenderer.invoke("set-context-paths", {
              appId,
              chatContext: {
                contextPaths: contextPaths.map((globPath) => ({ globPath })),
                smartContextAutoIncludes: [],
                excludePaths: [],
              },
            });
          },
          {
            appId: importResult.appId,
            contextPaths,
          },
        ),
        30_000,
        "set-context-paths",
      );
    }

    logTrial(trial, `starting chat ${importResult.chatId}`);
    await withTimeout(
      page.evaluate(
        ({ chatId, prompt, timeoutMs }) =>
          new Promise((resolve, reject) => {
            let unsubscribeEnd;
            let unsubscribeError;
            const timer = setTimeout(() => {
              cleanup();
              reject(new Error(`chat stream timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const cleanup = () => {
              clearTimeout(timer);
              unsubscribeEnd?.();
              unsubscribeError?.();
            };
            const getPayload = (first, second) => second ?? first;
            unsubscribeEnd = window.electron.ipcRenderer.on(
              "chat:response:end",
              (first, second) => {
                const payload = getPayload(first, second);
                if (payload.chatId !== chatId) return;
                cleanup();
                resolve(payload);
              },
            );
            unsubscribeError = window.electron.ipcRenderer.on(
              "chat:response:error",
              (first, second) => {
                const payload = getPayload(first, second);
                if (payload.chatId !== chatId) return;
                cleanup();
                reject(new Error(payload.error || "chat stream failed"));
              },
            );
            window.electron.ipcRenderer
              .invoke("chat:stream", {
                chatId,
                prompt,
                requestedChatMode: "local-agent",
              })
              .catch((error) => {
                cleanup();
                reject(error);
              });
          }),
        {
          chatId: importResult.chatId,
          prompt: buildBenchmarkPrompt(trial),
          timeoutMs,
        },
      ),
      timeoutMs + 15_000,
      "chat stream",
    );

    logTrial(trial, "reading final chat");
    const chat = await page.evaluate((chatId) => {
      return window.electron.ipcRenderer.invoke("get-chat", chatId);
    }, importResult.chatId);
    const finalText = chat.messages?.at(-1)?.content ?? "";
    const visibleFinalText = visibleAnswerText(finalText);
    const passedRubric = trial.task.expected.every((term) =>
      visibleFinalText.toLowerCase().includes(term.toLowerCase()),
    );
    const quality = scoreFinalText(visibleFinalText, trial.task.expected);
    const metrics = readBenchmarkMetrics(benchmarkRunId);

    return {
      runId: benchmarkRunId,
      status: "ok",
      repo: trial.repo.name,
      appSubPath,
      appImportSubPath: importSubPath,
      contextPaths,
      task: trial.task.id,
      arm: trial.arm,
      reportMode: reportModeForArm(trial.arm),
      repeat: trial.repeat,
      elapsedMs: Date.now() - startedAt,
      passedRubric,
      ...quality,
      authMode: benchmarkAuth.mode,
      engineModel: benchmarkAuth.model,
      ...metrics,
      finalText,
    };
  } catch (error) {
    return {
      runId: benchmarkRunId,
      status: "error",
      repo: trial.repo.name,
      appSubPath,
      appImportSubPath: importSubPath,
      contextPaths,
      task: trial.task.id,
      arm: trial.arm,
      reportMode: reportModeForArm(trial.arm),
      repeat: trial.repeat,
      elapsedMs: Date.now() - startedAt,
      authMode: benchmarkAuth.mode,
      engineModel: benchmarkAuth.model,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await withTimeout(
      electronApp?.close() ?? Promise.resolve(),
      15_000,
      "closing Electron app",
    ).catch(() => {
      electronApp?.process()?.kill("SIGKILL");
    });
    killProcessesForUserDataDir(userDataDir);
  }
}

function selectedBenchmarkModel(benchmarkAuth) {
  if (benchmarkAuth.mode === "codex") {
    return { provider: "openai", name: benchmarkAuth.model };
  }
  return { provider: "auto", name: values.model };
}

function selectedAppSubPath(trial) {
  return trial.task.subPath ?? trial.repo.subPath ?? ".";
}

function selectedImportSubPath(trial) {
  return (
    trial.task.importSubPath ??
    trial.repo.importSubPath ??
    selectedAppSubPath(trial)
  );
}

function selectedContextPaths(trial, repoPath) {
  const configured = trial.task.contextPaths ?? trial.repo.contextPaths;
  if (Array.isArray(configured)) {
    return configured.map(String).filter(Boolean);
  }

  const appSubPath = selectedAppSubPath(trial);
  const importSubPath = selectedImportSubPath(trial);
  if (appSubPath === "." || importSubPath === appSubPath) {
    return [];
  }
  return uniqueStrings([
    contextGlob(appSubPath),
    ...discoverRelatedWorkspaceContextPaths(repoPath, appSubPath),
  ]);
}

function discoverRelatedWorkspaceContextPaths(repoPath, appSubPath) {
  const packageDirs = discoverWorkspacePackageDirs(repoPath);
  if (packageDirs.length === 0) {
    return [];
  }

  const referenced = referencedWorkspacePackageDirs({
    repoPath,
    appSubPath,
    packageDirs,
  });
  const selected =
    referenced.length > 0 ? referenced : sharedWorkspaceDirs(packageDirs);
  return selected
    .filter((dir) => dir !== "." && dir !== appSubPath)
    .slice(0, 8)
    .map(contextGlob);
}

function referencedWorkspacePackageDirs({ repoPath, appSubPath, packageDirs }) {
  const pathEntries = readFocusedTsconfigPathEntries(repoPath, appSubPath);
  if (pathEntries.length === 0) {
    return [];
  }

  const packageByName = new Map(
    packageDirs
      .map((dir) => [readPackageName(path.join(repoPath, dir)), dir])
      .filter(([name]) => Boolean(name)),
  );
  const referenced = new Set();

  for (const { value, baseSubPath } of pathEntries) {
    const packageFromScopedName = scopedPackageName(value);
    if (packageFromScopedName && packageByName.has(packageFromScopedName)) {
      addContextPackageDir(
        referenced,
        packageByName.get(packageFromScopedName),
      );
    }

    const resolved = resolveTsconfigTarget(repoPath, baseSubPath, value);
    if (!resolved) continue;
    const containingPackage = packageDirs.find(
      (dir) => resolved === dir || resolved.startsWith(`${dir}/`),
    );
    if (containingPackage) {
      addContextPackageDir(referenced, containingPackage);
    }
  }

  return [...referenced].sort();
}

function addContextPackageDir(referenced, dir) {
  if (dir && isImplementationPackageDir(dir)) {
    referenced.add(dir);
  }
}

function readFocusedTsconfigPathEntries(repoPath, appSubPath) {
  for (const configName of ["tsconfig.app.json", "tsconfig.json"]) {
    const configPath = path.join(repoPath, appSubPath, configName);
    if (fs.existsSync(configPath)) {
      return readTsconfigPathEntries(repoPath, configPath, new Set());
    }
  }
  return [];
}

function readTsconfigPathEntries(repoPath, configPath, seen) {
  const resolvedConfigPath = path.resolve(configPath);
  if (seen.has(resolvedConfigPath)) {
    return [];
  }
  seen.add(resolvedConfigPath);

  const config = readJsonFile(resolvedConfigPath);
  if (!config) {
    return [];
  }

  const entries = [];
  const extendsPath = resolveTsconfigExtendsPath(
    path.dirname(resolvedConfigPath),
    config.extends,
  );
  if (extendsPath) {
    entries.push(...readTsconfigPathEntries(repoPath, extendsPath, seen));
  }

  const baseSubPath =
    normalizeRelativePath(
      path.relative(repoPath, path.dirname(resolvedConfigPath)),
    ) || ".";
  for (const [alias, targets] of Object.entries(
    config.compilerOptions?.paths ?? {},
  )) {
    entries.push({ value: alias, baseSubPath });
    if (Array.isArray(targets)) {
      for (const target of targets) {
        entries.push({ value: target, baseSubPath });
      }
    }
  }
  return entries;
}

function resolveTsconfigExtendsPath(baseDir, extendsValue) {
  if (typeof extendsValue !== "string" || !extendsValue.startsWith(".")) {
    return null;
  }

  const resolved = path.resolve(baseDir, extendsValue);
  const candidates = path.extname(resolved)
    ? [resolved]
    : [`${resolved}.json`, path.join(resolved, "tsconfig.json")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveTsconfigTarget(repoPath, appSubPath, value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("@")) return null;

  const beforeGlob = value.split("*")[0].replace(/\/+$/g, "");
  if (!beforeGlob || !beforeGlob.startsWith(".")) {
    return null;
  }

  const absolute = path.resolve(repoPath, appSubPath, beforeGlob);
  const relative = normalizeRelativePath(path.relative(repoPath, absolute));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return relative || ".";
}

function scopedPackageName(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(@[^/\s]+\/[^/*\s]+)/);
  return match?.[1] ?? null;
}

function discoverWorkspacePackageDirs(repoPath) {
  const patterns = uniqueStrings([
    ...workspacePatternsFromPackageJson(repoPath),
    ...workspacePatternsFromPnpmWorkspace(repoPath),
  ]);
  const dirs = [];
  for (const pattern of patterns) {
    for (const dir of expandWorkspacePattern(repoPath, pattern)) {
      if (!dirs.includes(dir)) {
        dirs.push(dir);
      }
    }
  }
  return dirs.sort((left, right) => left.localeCompare(right));
}

function workspacePatternsFromPackageJson(repoPath) {
  const packageJson = readJsonFile(path.join(repoPath, "package.json"));
  const workspaces = packageJson?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces;
  }
  if (Array.isArray(workspaces?.packages)) {
    return workspaces.packages;
  }
  return [];
}

function workspacePatternsFromPnpmWorkspace(repoPath) {
  const workspacePath = path.join(repoPath, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) {
    return [];
  }

  const patterns = [];
  let inPackages = false;
  for (const rawLine of fs.readFileSync(workspacePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (inPackages && !rawLine.startsWith(" ") && !rawLine.startsWith("-")) {
      break;
    }
    const match = line.match(/^-\s*['"]?([^'"]+)['"]?$/);
    if (inPackages && match && !match[1].startsWith("!")) {
      patterns.push(match[1]);
    }
  }
  return patterns;
}

function expandWorkspacePattern(repoPath, pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.startsWith("!")) {
    return [];
  }
  const normalized = normalizeRelativePath(pattern.replace(/\/+$/g, ""));
  if (!normalized.includes("*")) {
    return packageDirIfExists(repoPath, normalized);
  }
  if (!normalized.endsWith("/*") || normalized.includes("**")) {
    return [];
  }

  const parent = normalized.slice(0, -"/*".length);
  const parentPath = path.join(repoPath, parent);
  if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(parentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) =>
      packageDirIfExists(
        repoPath,
        normalizeRelativePath(path.join(parent, entry.name)),
      ),
    );
}

function packageDirIfExists(repoPath, relativeDir) {
  const packagePath = path.join(repoPath, relativeDir, "package.json");
  return fs.existsSync(packagePath) ? [relativeDir] : [];
}

function sharedWorkspaceDirs(packageDirs) {
  return packageDirs
    .filter(isImplementationPackageDir)
    .filter((dir) =>
      /(?:^|\/)(?:ui|components|lib|shared|utils?|types|config|api|trpc|features|prisma)(?:$|\/)/i.test(
        dir,
      ),
    )
    .slice(0, 6);
}

function isImplementationPackageDir(dir) {
  return !/(?:^|\/)(?:docs?|examples?|storybook|playground|e2e|tests?|testing)(?:$|\/)/i.test(
    dir,
  );
}

function readPackageName(packageDir) {
  return readJsonFile(path.join(packageDir, "package.json"))?.name ?? null;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function stripJsonComments(text) {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += char;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    }
  }

  return result;
}

function contextGlob(relativePath) {
  return `${relativePath.replace(/\/+$/g, "")}/**/*`;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatSubPath(value) {
  return value || ".";
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "-";
  }
  return values.join("<br>");
}

function buildBenchmarkPrompt(trial) {
  const appSubPath = selectedAppSubPath(trial);
  if (appSubPath === ".") {
    return trial.task.prompt;
  }
  return [
    trial.task.prompt,
    "",
    `Benchmark focus: start in \`${appSubPath}\`, and include related workspace packages when they are part of the implementation flow.`,
  ].join("\n");
}

function logTrial(trial, message) {
  console.log(
    `[${trial.repo.name}/${trial.task.id}/${trial.arm}/repeat-${trial.repeat}] ${message}`,
  );
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function killProcessesForUserDataDir(userDataDir) {
  try {
    execFileSync("pkill", ["-f", userDataDir], { stdio: "ignore" });
  } catch {
    // pkill exits non-zero when no processes match.
  }
}

function writeSummary(runId, resultsPath) {
  const rows = fs
    .readFileSync(resultsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const summary = {
    runId,
    metadata: buildRunMetadata(packageInfo),
    trials: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    errors: rows.filter((row) => row.status !== "ok").length,
    primaryCompareArm,
    byArm: summarizeBy(rows, "arm"),
    armDeltas: summarizeArmDeltas(rows),
    taskArmDeltas: summarizeTaskArmDeltas(rows),
    exploreV2VsV1: summarizeArmPairDelta(rows, "explore-v1", "explore-v2"),
    exploreV2Acceptance: evaluateExploreV2Acceptance(rows),
    repoDeltas: summarizeRepoDeltas(rows, primaryCompareArm),
    exploreTaskCohorts: summarizeExploreTaskCohorts(rows, primaryCompareArm),
    taskDeltas: summarizeTaskDeltas(rows, primaryCompareArm),
    answerComparisons: summarizeAnswerComparisons(rows, primaryCompareArm),
  };
  const outDir = path.dirname(resultsPath);
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "summary.md"),
    [
      `# Code Explorer Benchmark ${runId}`,
      "",
      "## Metadata",
      "",
      `- Git SHA: ${summary.metadata.gitSha}`,
      `- Git dirty: ${summary.metadata.gitDirty ? "yes" : "no"}`,
      `- Package path: \`${summary.metadata.packagePath}\``,
      `- Package newest mtime: ${summary.metadata.packageNewestMtime}`,
      `- Source newest mtime: ${summary.metadata.sourceNewestMtime}`,
      `- Command: \`${summary.metadata.command}\``,
      `- Auth mode: ${summary.metadata.authMode}`,
      ...(summary.metadata.codexModel
        ? [`- Codex backend model: ${summary.metadata.codexModel}`]
        : []),
      "",
      `Trials: ${summary.trials}`,
      `OK: ${summary.ok}`,
      `Errors: ${summary.errors}`,
      `Primary compare arm: ${summary.primaryCompareArm}`,
      "",
      "## By Arm",
      "",
      `Pricing: primary \`${MODEL_PRICING.primary.model}\` input/cached/output = $${MODEL_PRICING.primary.inputPerMillion}/$${MODEL_PRICING.primary.cachedInputPerMillion}/$${MODEL_PRICING.primary.outputPerMillion} per 1M; value \`${MODEL_PRICING.value.model}\` input/cached/output = $${MODEL_PRICING.value.inputPerMillion}/$${MODEL_PRICING.value.cachedInputPerMillion}/$${MODEL_PRICING.value.outputPerMillion} per 1M.`,
      "",
      "| Arm | OK | Avg elapsed ms | Explore available | Explore used | Usable explore reports | Post-report broad searches | Post-report reads | Off-target post-report reads | Fact unverified | Continuations | Primary uncached input | Primary cached input | Primary output | Primary total | Primary cost | Value uncached input | Value cached input | Value output | Value total | Value cost | Subagent report chars | Raw observation chars | Report/raw ratio | Combined total | Combined cost | Primary tool calls | Value tool calls | Total tool calls |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(summary.byArm).map(
        ([arm, item]) =>
          `| ${arm} | ${item.ok}/${item.count} | ${Math.round(item.elapsedMs / Math.max(item.count, 1))} | ${item.exploreCodeAvailable}/${item.count} | ${item.exploreCodeUsed}/${item.count} | ${item.usableExploreReports} | ${item.postReportMainBroadSearchCalls} | ${item.postReportMainReadFileCalls} | ${item.postReportMainReadFileOutsideTargets} | ${item.factUnverifiedCount} | ${item.validationContinuationCount} | ${item.mainUncachedInputTokens} | ${item.mainCachedInputTokens} | ${item.mainOutputTokens} | ${item.mainTotalTokens} | ${formatDollars(item.mainCostUsd)} | ${item.subagentUncachedInputTokens} | ${item.subagentCachedInputTokens} | ${item.subagentOutputTokens} | ${item.subagentTotalTokens} | ${formatDollars(item.subagentCostUsd)} | ${item.subagentReportChars} | ${item.subagentRawObservationChars} | ${formatRatio(item.subagentReportChars, item.subagentRawObservationChars)} | ${item.totalTokens} | ${formatDollars(item.costUsd)} | ${item.mainToolCalls} | ${item.subagentToolCalls} | ${item.toolCalls} |`,
      ),
      "",
      "## Arm Deltas Vs Baseline",
      "",
      "| Arm | Completed pairs | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Post-report broad-search delta | Off-target read delta | Provider-step delta | Elapsed delta ms |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.armDeltas.map(
        (item) =>
          `| ${item.arm} | ${item.pairs} | ${item.primaryTokenDelta} | ${item.valueTokenDelta} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${item.primaryToolCallDelta} | ${item.valueToolCallDelta} | ${item.toolCallDelta} | ${item.postReportBroadSearchDelta} | ${item.postReportOffTargetReadDelta} | ${item.providerStepDelta} | ${item.elapsedDeltaMs} |`,
      ),
      "",
      "## Task Arm Deltas Vs Baseline",
      "",
      "| Repo | Task | Arm | Completed pairs | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Quality delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Post-report broad-search delta | Off-target read delta | Provider-step delta | Elapsed delta ms |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.taskArmDeltas.map(
        (item) =>
          `| ${item.repo} | ${item.task} | ${item.arm} | ${item.pairs} | ${item.primaryTokenDelta} | ${item.valueTokenDelta} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${formatSigned(item.qualityScoreDelta)} | ${item.primaryToolCallDelta} | ${item.valueToolCallDelta} | ${item.toolCallDelta} | ${item.postReportBroadSearchDelta} | ${item.postReportOffTargetReadDelta} | ${item.providerStepDelta} | ${item.elapsedDeltaMs} |`,
      ),
      "",
      "## Explore V2 Vs V1",
      "",
      "Positive deltas mean V2 used less than imported V1 for that metric, except quality where positive means V2 scored higher.",
      "",
      "| Completed pairs | Main uncached input delta | Post-report broad-search delta | Off-target read delta | Post-report broad exploration delta | Quality delta | Total token delta | Spend delta | Total tool-call delta |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      `| ${summary.exploreV2VsV1.pairs} | ${summary.exploreV2VsV1.primaryTokenDelta} | ${summary.exploreV2VsV1.postReportBroadSearchDelta} | ${summary.exploreV2VsV1.postReportOffTargetReadDelta} | ${summary.exploreV2VsV1.postReportBroadExplorationDelta} | ${formatSigned(summary.exploreV2VsV1.qualityScoreDelta)} | ${summary.exploreV2VsV1.tokenDelta} | ${formatDollars(summary.exploreV2VsV1.costDeltaUsd)} | ${summary.exploreV2VsV1.toolCallDelta} |`,
      "",
      "## Explore V2 Acceptance",
      "",
      `Status: ${summary.exploreV2Acceptance.passed ? "passed" : "not passed"}`,
      "",
      "| Check | Value | Required |",
      "| --- | ---: | ---: |",
      `| paired held-out tasks | ${summary.exploreV2Acceptance.pairedTaskCount} | >=8 |`,
      `| minimum paired repeats per task | ${summary.exploreV2Acceptance.minPairedRepeatsPerTask} | >=3 |`,
      `| V1 source arms | ${formatList(summary.exploreV2Acceptance.v1SourceArms)} | explore-candidate-followup |`,
      `| quality delta | ${formatSigned(summary.exploreV2Acceptance.qualityScoreDelta)} | >=0 |`,
      `| main uncached input delta | ${summary.exploreV2Acceptance.primaryTokenDelta} | >0 |`,
      `| post-report broad exploration delta | ${summary.exploreV2Acceptance.postReportBroadExplorationDelta} | >0 |`,
      "",
      ...(summary.exploreV2Acceptance.reasons.length > 0
        ? [
            "Reasons:",
            "",
            ...summary.exploreV2Acceptance.reasons.map(
              (reason) => `- ${reason}`,
            ),
            "",
          ]
        : []),
      "",
      "## Quality Metrics",
      "",
      "| Arm | Rubric pass | Expected-term coverage | File refs | Line-range refs | Final chars |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(summary.byArm).map(
        ([arm, item]) =>
          `| ${arm} | ${item.rubricPassCount}/${item.ok} | ${formatRatio(item.expectedTermCoverageSum, item.expectedTermCoverageCount)} | ${item.fileReferenceCount} | ${item.lineRangeReferenceCount} | ${item.finalTextChars} |`,
      ),
      "",
      "## Explore Code Availability",
      "",
      "| Arm | Disabled reasons |",
      "| --- | --- |",
      ...Object.entries(summary.byArm).map(
        ([arm, item]) =>
          `| ${arm} | ${formatReasons(item.exploreCodeDisabledReasons)} |`,
      ),
      "",
      `## Explore Task Cohorts (${summary.primaryCompareArm} vs baseline)`,
      "",
      "| Cohort | Tasks | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Elapsed delta ms |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.exploreTaskCohorts.map(
        (item) =>
          `| ${item.status} | ${item.tasks} | ${item.primaryTokenDelta} | ${item.valueTokenDelta} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${item.primaryToolCallDelta} | ${item.valueToolCallDelta} | ${item.toolCallDelta} | ${item.elapsedDeltaMs} |`,
      ),
      "",
      `## Repo Deltas (${summary.primaryCompareArm} vs baseline)`,
      "",
      "| Repo | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Elapsed delta ms |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...summary.repoDeltas.map(
        (item) =>
          `| ${item.repo} | ${item.primaryTokenDelta} | ${item.valueTokenDelta} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${item.primaryToolCallDelta} | ${item.valueToolCallDelta} | ${item.toolCallDelta} | ${item.elapsedDeltaMs} |`,
      ),
      "",
      `## Task Deltas (${summary.primaryCompareArm} vs baseline)`,
      "",
      "| Repo | Task | App subpath | Import subpath | Context paths | Explore status | Explore available | Explore used | Disabled reasons | Primary uncached input delta | Value token delta | Combined token delta | Spend delta | Quality delta | Primary tool-call delta | Value tool-call delta | Total tool-call delta | Provider-step delta | Elapsed delta ms | Arm winner |",
      "| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...summary.taskDeltas.map(
        (item) =>
          `| ${item.repo} | ${item.task} | ${item.appSubPath} | ${item.appImportSubPath} | ${formatList(item.contextPaths)} | ${item.exploreStatus} | ${item.exploreCodeAvailable}/${item.exploreCount} | ${item.exploreCodeUsed}/${item.exploreCount} | ${formatReasons(item.exploreCodeDisabledReasons)} | ${item.primaryTokenDelta} | ${item.valueTokenDelta} | ${item.tokenDelta} | ${formatDollars(item.costDeltaUsd)} | ${formatSigned(item.qualityScoreDelta)} | ${item.primaryToolCallDelta} | ${item.valueToolCallDelta} | ${item.toolCallDelta} | ${item.providerStepDelta} | ${item.elapsedDeltaMs} | ${item.winner} |`,
      ),
      "",
      `## Final Answer Comparison (${summary.primaryCompareArm} vs baseline)`,
      "",
      "| Repo | Task | Verdict | Expected-term coverage delta | Quality delta | File refs delta | Line-range refs delta | Final chars delta | Notes |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...summary.answerComparisons.map(
        (item) =>
          `| ${item.repo} | ${item.task} | ${item.verdict} | ${formatSigned(item.expectedTermCoverageDelta, 2)} | ${formatSigned(item.qualityScoreDelta)} | ${item.fileReferenceDelta} | ${item.lineRangeReferenceDelta} | ${item.finalTextCharsDelta} | ${item.notes} |`,
      ),
      "",
      "Detailed stream/tool/token events are in `benchmark-results/code-explorer/<trial-run-id>/events.jsonl`.",
    ].join("\n"),
  );
}

function getPackageInfo() {
  const latestBuild = eph.findLatestBuild();
  return {
    path: latestBuild,
    newestMtimeMs: newestMtimeMs(latestBuild),
  };
}

function assertPackageFresh(packageInfo) {
  const source = getSourceFreshness();
  if (!packageInfo.path || !fs.existsSync(packageInfo.path)) {
    throw new Error(
      "Packaged Electron app is missing. Run `npm run build` before benchmarking.",
    );
  }
  if (source.newestMtimeMs > packageInfo.newestMtimeMs) {
    throw new Error(
      [
        "Packaged Electron app is older than source files that affect the app.",
        `Package newest mtime: ${new Date(packageInfo.newestMtimeMs).toISOString()} (${packageInfo.path})`,
        `Source newest mtime: ${new Date(source.newestMtimeMs).toISOString()} (${source.path})`,
        "Run `npm run build` first, or pass `--allow-stale-package` only for intentional stale-package diagnostics.",
      ].join("\n"),
    );
  }
}

function buildRunMetadata(packageInfo) {
  const source = getSourceFreshness();
  return {
    gitSha: gitOutput(["rev-parse", "HEAD"]) ?? "unknown",
    gitDirty: (gitOutput(["status", "--porcelain"]) ?? "").trim().length > 0,
    packagePath: packageInfo ? path.relative(ROOT, packageInfo.path) : null,
    packageNewestMtime: packageInfo
      ? new Date(packageInfo.newestMtimeMs).toISOString()
      : null,
    sourceNewestMtime: new Date(source.newestMtimeMs).toISOString(),
    sourceNewestPath: source.path,
    command: [
      "node",
      "benchmarks/code-explorer/run.mjs",
      ...process.argv.slice(2),
    ].join(" "),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    model: values.model,
    authMode,
    codexModel: authMode === "codex" ? values["codex-model"] : undefined,
    timeoutMs,
    concurrency,
    repos: selectedRepos ? [...selectedRepos].sort() : "all",
    tasks: selectedTasks ? [...selectedTasks].sort() : "all",
    repeats,
    resumedFromRun: values["resume-from"],
    importedExploreV1Run: values["explore-v1-run"],
    importedExploreV1SourceArm: values["explore-v1-source-arm"],
  };
}

function getSourceFreshness() {
  const candidates = [
    "src",
    "workers",
    "shared",
    "package.json",
    "package-lock.json",
    "forge.config.ts",
    "tsconfig.app.json",
    "tsconfig.json",
  ];
  let newest = { newestMtimeMs: 0, path: "" };
  for (const candidate of candidates) {
    const absolute = path.join(ROOT, candidate);
    if (!fs.existsSync(absolute)) continue;
    const item = newestPathMtime(absolute);
    if (item.newestMtimeMs > newest.newestMtimeMs) {
      newest = item;
    }
  }
  return newest;
}

function newestPathMtime(targetPath) {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return {
      newestMtimeMs: stat.mtimeMs,
      path: path.relative(ROOT, targetPath),
    };
  }
  let newest = {
    newestMtimeMs: stat.mtimeMs,
    path: path.relative(ROOT, targetPath),
  };
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = newestPathMtime(path.join(targetPath, entry.name));
    if (child.newestMtimeMs > newest.newestMtimeMs) {
      newest = child;
    }
  }
  return newest;
}

function newestMtimeMs(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return 0;
  return newestPathMtime(targetPath).newestMtimeMs;
}

function gitOutput(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function summarizeBy(rows, key) {
  const result = {};
  for (const row of rows) {
    const group = row[key];
    result[group] ??= { count: 0, ok: 0, elapsedMs: 0 };
    result[group].count++;
    if (row.status === "ok") result[group].ok++;
    result[group].elapsedMs += row.elapsedMs ?? 0;
    result[group].rubricPassCount =
      (result[group].rubricPassCount ?? 0) + (row.passedRubric ? 1 : 0);
    result[group].expectedTermCoverageSum =
      (result[group].expectedTermCoverageSum ?? 0) +
      (row.expectedTermCoverage ?? 0);
    result[group].expectedTermCoverageCount =
      (result[group].expectedTermCoverageCount ?? 0) +
      (row.status === "ok" ? 1 : 0);
    result[group].fileReferenceCount =
      (result[group].fileReferenceCount ?? 0) + (row.fileReferenceCount ?? 0);
    result[group].lineRangeReferenceCount =
      (result[group].lineRangeReferenceCount ?? 0) +
      (row.lineRangeReferenceCount ?? 0);
    result[group].finalTextChars =
      (result[group].finalTextChars ?? 0) + (row.finalTextChars ?? 0);
    result[group].qualityScore =
      (result[group].qualityScore ?? 0) + (row.qualityScore ?? 0);
    result[group].inputTokens =
      (result[group].inputTokens ?? 0) + (row.inputTokens ?? 0);
    result[group].cachedInputTokens =
      (result[group].cachedInputTokens ?? 0) + (row.cachedInputTokens ?? 0);
    result[group].uncachedInputTokens =
      (result[group].uncachedInputTokens ?? 0) + (row.uncachedInputTokens ?? 0);
    result[group].outputTokens =
      (result[group].outputTokens ?? 0) + (row.outputTokens ?? 0);
    result[group].totalTokens =
      (result[group].totalTokens ?? 0) + (row.totalTokens ?? 0);
    result[group].mainInputTokens =
      (result[group].mainInputTokens ?? 0) + (row.mainInputTokens ?? 0);
    result[group].mainCachedInputTokens =
      (result[group].mainCachedInputTokens ?? 0) +
      (row.mainCachedInputTokens ?? 0);
    result[group].mainUncachedInputTokens =
      (result[group].mainUncachedInputTokens ?? 0) +
      (row.mainUncachedInputTokens ?? 0);
    result[group].mainOutputTokens =
      (result[group].mainOutputTokens ?? 0) + (row.mainOutputTokens ?? 0);
    result[group].mainTotalTokens =
      (result[group].mainTotalTokens ?? 0) + (row.mainTotalTokens ?? 0);
    result[group].subagentInputTokens =
      (result[group].subagentInputTokens ?? 0) + (row.subagentInputTokens ?? 0);
    result[group].subagentCachedInputTokens =
      (result[group].subagentCachedInputTokens ?? 0) +
      (row.subagentCachedInputTokens ?? 0);
    result[group].subagentUncachedInputTokens =
      (result[group].subagentUncachedInputTokens ?? 0) +
      (row.subagentUncachedInputTokens ?? 0);
    result[group].subagentOutputTokens =
      (result[group].subagentOutputTokens ?? 0) +
      (row.subagentOutputTokens ?? 0);
    result[group].subagentTotalTokens =
      (result[group].subagentTotalTokens ?? 0) + (row.subagentTotalTokens ?? 0);
    result[group].subagentReportChars =
      (result[group].subagentReportChars ?? 0) + (row.subagentReportChars ?? 0);
    result[group].subagentRawObservationChars =
      (result[group].subagentRawObservationChars ?? 0) +
      (row.subagentRawObservationChars ?? 0);
    result[group].mainCostUsd =
      (result[group].mainCostUsd ?? 0) + (row.mainCostUsd ?? 0);
    result[group].subagentCostUsd =
      (result[group].subagentCostUsd ?? 0) + (row.subagentCostUsd ?? 0);
    result[group].costUsd = (result[group].costUsd ?? 0) + (row.costUsd ?? 0);
    result[group].exploreCodeAvailable =
      (result[group].exploreCodeAvailable ?? 0) +
      (row.exploreCodeAvailable ? 1 : 0);
    result[group].exploreCodeUsed =
      (result[group].exploreCodeUsed ?? 0) + (row.exploreCodeUsed ? 1 : 0);
    result[group].exploreCodeDisabledReasons = mergeReasonCounts(
      result[group].exploreCodeDisabledReasons,
      row.exploreCodeDisabledReasons,
    );
    result[group].toolCalls =
      (result[group].toolCalls ?? 0) + (row.toolCallCount ?? 0);
    result[group].mainToolCalls =
      (result[group].mainToolCalls ?? 0) + (row.mainToolCallCount ?? 0);
    result[group].subagentToolCalls =
      (result[group].subagentToolCalls ?? 0) + (row.subagentToolCallCount ?? 0);
    result[group].postReportMainBroadSearchCalls =
      (result[group].postReportMainBroadSearchCalls ?? 0) +
      (row.postReportMainBroadSearchCalls ?? 0);
    result[group].postReportMainReadFileCalls =
      (result[group].postReportMainReadFileCalls ?? 0) +
      (row.postReportMainReadFileCalls ?? 0);
    result[group].postReportMainReadFileOutsideTargets =
      (result[group].postReportMainReadFileOutsideTargets ?? 0) +
      (row.postReportMainReadFileOutsideTargets ?? 0);
    result[group].usableExploreReports =
      (result[group].usableExploreReports ?? 0) +
      (row.usableExploreReports ?? 0);
    result[group].factUnverifiedCount =
      (result[group].factUnverifiedCount ?? 0) + (row.factUnverifiedCount ?? 0);
    result[group].validationContinuationCount =
      (result[group].validationContinuationCount ?? 0) +
      (row.validationContinuationCount ?? 0);
  }
  return result;
}

function readBenchmarkMetrics(trialRunId) {
  const eventsPath = path.join(RESULTS_DIR, trialRunId, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    return {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      mainTotalTokens: 0,
      mainInputTokens: 0,
      mainCachedInputTokens: 0,
      mainUncachedInputTokens: 0,
      mainOutputTokens: 0,
      subagentTotalTokens: 0,
      subagentInputTokens: 0,
      subagentCachedInputTokens: 0,
      subagentUncachedInputTokens: 0,
      subagentOutputTokens: 0,
      mainCostUsd: 0,
      subagentCostUsd: 0,
      costUsd: 0,
      toolCallCount: 0,
      mainToolCallCount: 0,
      subagentToolCallCount: 0,
      providerStepCount: 0,
      mainProviderStepCount: 0,
      subagentProviderStepCount: 0,
      toolCallsByName: {},
      mainToolCallsByName: {},
      subagentToolCallsByName: {},
      exploreCodeAvailable: false,
      exploreCodeUsed: false,
      exploreCodeDisabledReasons: {},
      subagentReportChars: 0,
      subagentRawObservationChars: 0,
      subagentCompressionRatio: 0,
      postReportMainBroadSearchCalls: 0,
      postReportMainReadFileCalls: 0,
      postReportMainReadFileOutsideTargets: 0,
      usableExploreReports: 0,
      factUnverifiedCount: 0,
      validationContinuationCount: 0,
    };
  }

  const events = fs
    .readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const stepEvents = events.filter(
    (event) => event.type === "stream_step_finish",
  );
  const toolEvents = events.filter((event) => event.type === "tool_call_end");
  const toolCallsByName = {};
  const mainToolCallsByName = {};
  const subagentToolCallsByName = {};
  const availabilityEvents = events.filter(
    (event) =>
      event.type === "tool_availability" && event.toolName === "explore_code",
  );

  for (const event of toolEvents) {
    toolCallsByName[event.toolName] =
      (toolCallsByName[event.toolName] ?? 0) + 1;
    const phaseToolCallsByName =
      getEventPhase(event) === "explore_code_subagent"
        ? subagentToolCallsByName
        : mainToolCallsByName;
    phaseToolCallsByName[event.toolName] =
      (phaseToolCallsByName[event.toolName] ?? 0) + 1;
  }

  const mainStepEvents = stepEvents.filter(
    (event) => getEventPhase(event) === "main",
  );
  const subagentStepEvents = stepEvents.filter(
    (event) => getEventPhase(event) === "explore_code_subagent",
  );
  const mainUsage = aggregateUsage(
    mainStepEvents.length > 0
      ? mainStepEvents
      : events.filter(
          (event) =>
            event.type === "stream_finish" && getEventPhase(event) === "main",
        ),
  );
  const subagentUsage = aggregateUsage(
    subagentStepEvents.length > 0
      ? subagentStepEvents
      : events.filter(
          (event) =>
            event.type === "stream_finish" &&
            getEventPhase(event) === "explore_code_subagent",
        ),
  );
  const allUsage = addUsage(mainUsage, subagentUsage);
  const mainCostUsd = usageCost(mainUsage, MODEL_PRICING.primary);
  const subagentCostUsd = usageCost(subagentUsage, MODEL_PRICING.value);
  const mainToolEvents = toolEvents.filter(
    (event) => getEventPhase(event) === "main",
  );
  const subagentToolEvents = toolEvents.filter(
    (event) => getEventPhase(event) === "explore_code_subagent",
  );
  const subagentFinishEvents = events.filter(
    (event) =>
      event.type === "subagent_finish" &&
      getEventPhase(event) === "explore_code_subagent",
  );
  const subagentReportChars = sumEventField(
    subagentFinishEvents,
    "reportChars",
  );
  const subagentRawObservationChars = sumEventField(
    subagentFinishEvents,
    "rawObservationChars",
  );
  const usableExploreReports = subagentFinishEvents.filter((event) =>
    isUsableExploreReport(event),
  ).length;
  const firstUsableExploreMainEndIndex = events.findIndex(
    (event) =>
      event.type === "tool_call_end" &&
      getEventPhase(event) === "main" &&
      event.toolName === "explore_code" &&
      hasUsableExploreReport(event.resultPreview),
  );
  const firstExploreMainEndIndex = events.findIndex(
    (event) =>
      event.type === "tool_call_end" &&
      getEventPhase(event) === "main" &&
      event.toolName === "explore_code",
  );
  const reportedReadTargets =
    firstUsableExploreMainEndIndex >= 0
      ? extractExploreReportReadTargets(
          events[firstUsableExploreMainEndIndex].resultPreview,
        )
      : [];
  const reportedSearchTargets =
    firstUsableExploreMainEndIndex >= 0
      ? extractExploreReportSearchTargets(
          events[firstUsableExploreMainEndIndex].resultPreview,
        )
      : [];
  const postReportMainToolEvents =
    firstExploreMainEndIndex >= 0
      ? events
          .slice(firstExploreMainEndIndex + 1)
          .filter(
            (event) =>
              event.type === "tool_call_start" &&
              getEventPhase(event) === "main",
          )
      : [];
  const postReportMainBroadSearchCalls = postReportMainToolEvents.filter(
    (event) => isBroadPostReportSearchEvent(event, reportedSearchTargets),
  ).length;
  const postReportReadFileEvents = postReportMainToolEvents.filter(
    (event) => event.toolName === "read_file",
  );
  const postReportMainReadFileOutsideTargets = postReportReadFileEvents.filter(
    (event) => !isReadFileEventWithinTargets(event, reportedReadTargets),
  ).length;
  const factUnverifiedCount = sumEventField(
    subagentFinishEvents,
    "factUnverifiedCount",
  );
  const validationContinuationCount = events.filter(
    (event) =>
      getEventPhase(event) === "explore_code_subagent" &&
      (event.type === "validation_continuation_finish" ||
        (event.type === "submit_report_result" &&
          event.continuationRequested === true)),
  ).length;
  return {
    totalTokens: allUsage.totalTokens,
    inputTokens: allUsage.inputTokens,
    cachedInputTokens: allUsage.cachedInputTokens,
    uncachedInputTokens: allUsage.uncachedInputTokens,
    outputTokens: allUsage.outputTokens,
    mainTotalTokens: mainUsage.totalTokens,
    mainInputTokens: mainUsage.inputTokens,
    mainCachedInputTokens: mainUsage.cachedInputTokens,
    mainUncachedInputTokens: mainUsage.uncachedInputTokens,
    mainOutputTokens: mainUsage.outputTokens,
    subagentTotalTokens: subagentUsage.totalTokens,
    subagentInputTokens: subagentUsage.inputTokens,
    subagentCachedInputTokens: subagentUsage.cachedInputTokens,
    subagentUncachedInputTokens: subagentUsage.uncachedInputTokens,
    subagentOutputTokens: subagentUsage.outputTokens,
    mainCostUsd,
    subagentCostUsd,
    costUsd: mainCostUsd + subagentCostUsd,
    toolCallCount: toolEvents.length,
    mainToolCallCount: mainToolEvents.length,
    subagentToolCallCount: subagentToolEvents.length,
    providerStepCount: stepEvents.length,
    mainProviderStepCount: mainStepEvents.length,
    subagentProviderStepCount: subagentStepEvents.length,
    toolCallsByName,
    mainToolCallsByName,
    subagentToolCallsByName,
    exploreCodeAvailable: availabilityEvents.some((event) => event.enabled),
    exploreCodeUsed: (mainToolCallsByName.explore_code ?? 0) > 0,
    exploreCodeDisabledReasons: countAvailabilityReasons(availabilityEvents),
    subagentReportChars,
    subagentRawObservationChars,
    subagentCompressionRatio:
      subagentRawObservationChars > 0
        ? subagentReportChars / subagentRawObservationChars
        : 0,
    postReportMainBroadSearchCalls,
    postReportMainReadFileCalls: postReportReadFileEvents.length,
    postReportMainReadFileOutsideTargets,
    usableExploreReports,
    factUnverifiedCount,
    validationContinuationCount,
  };
}

function isUsableExploreReport(event) {
  const confidence = String(event.renderedConfidence ?? "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function hasUsableExploreReport(report) {
  const metadata = extractExploreReportMetadata(report);
  return metadata.confidence === "high" || metadata.confidence === "medium";
}

function extractExploreReportReadTargets(report) {
  const metadata = extractExploreReportMetadata(report);
  const targets = [];
  for (const target of metadata.readTargets) {
    if (!target.path) continue;
    targets.push({
      path: target.path,
      range: parseLineRange(target.range),
    });
  }
  for (const target of extractRenderedExploreReportReadTargets(report)) {
    if (!target.path) continue;
    targets.push(target);
  }
  return targets;
}

function extractRenderedExploreReportReadTargets(report) {
  if (typeof report !== "string") {
    return [];
  }
  const flowTargets = extractRenderedExploreReportFlowTargets(report);
  const targets = [];
  const lines = report.split(/\r?\n/);
  const readTargetsIndex = lines.findIndex(
    (line) => line.trim() === "Read targets:",
  );
  if (readTargetsIndex === -1) {
    return targets;
  }
  for (let index = readTargetsIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line === "```json" || /^[A-Z][A-Za-z ]+:/.test(line)) {
      break;
    }
    const flowMatch = /^flow\s+(\d+)\s+-\s+/.exec(line);
    if (flowMatch) {
      const flowTarget = flowTargets.get(Number(flowMatch[1]));
      if (flowTarget) {
        targets.push(flowTarget);
      }
      continue;
    }
    const refMatch = /^(.+?):(\d+-\d+)\s+-\s+/.exec(line);
    if (refMatch) {
      targets.push({
        path: refMatch[1],
        range: parseLineRange(refMatch[2]),
      });
    }
  }
  return targets;
}

function extractRenderedExploreReportFlowTargets(report) {
  const targets = new Map();
  const lines = report.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(\d+)\.\s+(.+?):(\d+-\d+)\s+\(/.exec(line.trim());
    if (!match) {
      continue;
    }
    targets.set(Number(match[1]), {
      path: match[2],
      range: parseLineRange(match[3]),
    });
  }
  return targets;
}

function extractExploreReportSearchTargets(report) {
  if (typeof report !== "string") {
    return [];
  }
  const targets = [];
  const lines = report.split(/\r?\n/);
  const searchTargetsIndex = lines.findIndex(
    (line) => line.trim() === "Search targets:",
  );
  if (searchTargetsIndex === -1) {
    return targets;
  }
  for (let index = searchTargetsIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line === "```json" || /^[A-Z][A-Za-z ]+:/.test(line)) {
      break;
    }
    const query = parseQuotedField(line, "query");
    const include = parseQuotedField(line, "include");
    const literalMatch = /\bliteral=(true|false)\b/.exec(line);
    if (query && include) {
      targets.push({
        query,
        include,
        literal:
          literalMatch?.[1] === "true"
            ? true
            : literalMatch?.[1] === "false"
              ? false
              : null,
      });
    }
  }
  return targets;
}

function extractExploreReportMetadata(report) {
  if (typeof report !== "string") {
    return {
      confidence: null,
      readTargets: [],
    };
  }
  const jsonText = /```json\s*([\s\S]*?)\s*```/.exec(report)?.[1];
  if (!jsonText) {
    return {
      confidence: parseReportHeaderValue(report, "Confidence"),
      readTargets: [],
    };
  }
  try {
    const parsed = JSON.parse(jsonText);
    return {
      confidence:
        typeof parsed.confidence === "string"
          ? parsed.confidence.toLowerCase()
          : parseReportHeaderValue(report, "Confidence"),
      readTargets: Array.isArray(parsed.readTargets)
        ? parsed.readTargets.filter(
            (target) => target && typeof target === "object",
          )
        : [],
    };
  } catch {
    return {
      confidence: parseReportHeaderValue(report, "Confidence"),
      readTargets: [],
    };
  }
}

function parseReportHeaderValue(report, key) {
  const match = new RegExp(`${key}:\\s*([^|\\n]+)`).exec(report);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

function isReadFileEventWithinTargets(event, targets) {
  if (targets.length === 0) {
    return false;
  }
  const args = parsePreviewJson(event.argsPreview);
  const filePath = typeof args?.path === "string" ? args.path : null;
  if (!filePath) {
    return false;
  }
  const start =
    typeof args.start_line_one_indexed === "number"
      ? args.start_line_one_indexed
      : null;
  const end =
    typeof args.end_line_one_indexed_inclusive === "number"
      ? args.end_line_one_indexed_inclusive
      : null;
  if (start === null && end === null) {
    return targets.some((target) => target.path === filePath);
  }
  const readRange = {
    start: start ?? 1,
    end: end ?? start ?? 1,
  };
  return targets.some((target) => {
    if (target.path !== filePath) {
      return false;
    }
    if (!target.range) {
      return true;
    }
    return (
      readRange.start >= target.range.start && readRange.end <= target.range.end
    );
  });
}

function isSearchEventWithinTargets(event, targets) {
  if (event.toolName !== "grep" || targets.length === 0) {
    return false;
  }
  const args = parsePreviewJson(event.argsPreview);
  const query = typeof args?.query === "string" ? args.query : null;
  const include =
    typeof args?.include_pattern === "string" ? args.include_pattern : null;
  const literal = typeof args?.literal === "boolean" ? args.literal : null;
  if (!query || !include) {
    return false;
  }
  return targets.some(
    (target) =>
      target.query === query &&
      target.include === include &&
      (target.literal === null || target.literal === literal),
  );
}

function isBroadPostReportSearchEvent(event, targets) {
  if (event.toolName === "grep") {
    return !isSearchEventWithinTargets(event, targets);
  }
  if (event.toolName !== "list_files") {
    return false;
  }
  const args = parsePreviewJson(event.argsPreview);
  const directory =
    typeof args?.directory === "string"
      ? normalizeGlobPrefix(args.directory)
      : "";
  if (!args?.recursive) {
    return false;
  }
  if (!directory) {
    return true;
  }
  return !targets.some((target) =>
    normalizeGlobPrefix(target.include).startsWith(directory),
  );
}

function normalizeGlobPrefix(value) {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/\/?\*\*.*$/, "")
    .replace(/\/?\*.*$/, "")
    .replace(/\/$/, "");
}

function parseQuotedField(line, field) {
  const match = new RegExp(`${field}="([^"]*)"`).exec(line);
  return match?.[1] ?? null;
}

function parseLineRange(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2]),
  };
}

function parsePreviewJson(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sumEventField(events, field) {
  return events.reduce(
    (total, event) => total + (Number(event[field]) || 0),
    0,
  );
}

function countAvailabilityReasons(events) {
  const result = {};
  for (const event of events) {
    if (event.enabled) continue;
    const reason = event.reason ?? "unknown";
    result[reason] = (result[reason] ?? 0) + 1;
  }
  return result;
}

function mergeReasonCounts(a = {}, b = {}) {
  const result = { ...a };
  for (const [reason, count] of Object.entries(b)) {
    result[reason] = (result[reason] ?? 0) + count;
  }
  return result;
}

function formatReasons(reasons = {}) {
  const entries = Object.entries(reasons);
  if (entries.length === 0) return "-";
  return entries.map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

function getEventPhase(event) {
  return event.phase ?? "main";
}

function aggregateUsage(events) {
  return events.reduce(
    (total, event) => addUsage(total, normalizeUsage(event.usage)),
    emptyUsage(),
  );
}

function normalizeUsage(usage) {
  if (!usage) return emptyUsage();
  const inputTokens = numberOrZero(usage.inputTokens);
  const cachedInputTokens = cachedInputTokenCount(usage);
  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: Math.max(inputTokens - cachedInputTokens, 0),
    outputTokens: numberOrZero(usage.outputTokens),
    totalTokens: numberOrZero(usage.totalTokens),
  };
}

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

function cachedInputTokenCount(usage) {
  return numberOrZero(
    usage.cachedInputTokens ??
      usage.inputTokenDetails?.cacheReadTokens ??
      usage.raw?.input_tokens_details?.cached_tokens ??
      usage.raw?.prompt_tokens_details?.cached_tokens,
  );
}

function summarizeArmDeltas(rows) {
  const arms = [...new Set(rows.map((row) => row.arm))]
    .filter((arm) => arm !== "baseline")
    .sort();
  return arms.map((arm) => {
    const pairs = [];
    for (const row of rows) {
      if (row.arm !== arm || row.status !== "ok") {
        continue;
      }
      const baseline = rows.find(
        (candidate) =>
          candidate.arm === "baseline" &&
          candidate.status === "ok" &&
          candidate.repo === row.repo &&
          candidate.task === row.task &&
          candidate.repeat === row.repeat,
      );
      if (baseline) {
        pairs.push({ baseline, compare: row });
      }
    }
    return {
      arm,
      pairs: pairs.length,
      primaryTokenDelta: sumPairs(pairs, "mainUncachedInputTokens"),
      valueTokenDelta: sumPairs(pairs, "subagentTotalTokens"),
      tokenDelta: sumPairs(pairs, "totalTokens"),
      costDeltaUsd: sumPairs(pairs, "costUsd"),
      primaryToolCallDelta: sumPairs(pairs, "mainToolCallCount"),
      valueToolCallDelta: sumPairs(pairs, "subagentToolCallCount"),
      toolCallDelta: sumPairs(pairs, "toolCallCount"),
      postReportBroadSearchDelta: sumPairs(
        pairs,
        "postReportMainBroadSearchCalls",
      ),
      postReportOffTargetReadDelta: sumPairs(
        pairs,
        "postReportMainReadFileOutsideTargets",
      ),
      providerStepDelta: sumPairs(pairs, "providerStepCount"),
      elapsedDeltaMs: sumPairs(pairs, "elapsedMs"),
    };
  });
}

function summarizeTaskArmDeltas(rows) {
  const keys = [
    ...new Set(
      rows
        .filter((row) => row.arm !== "baseline")
        .map((row) => `${row.repo}\0${row.task}\0${row.arm}`),
    ),
  ].sort();
  return keys.map((key) => {
    const [repo, task, arm] = key.split("\0");
    const pairs = [];
    for (const row of rows) {
      if (
        row.repo !== repo ||
        row.task !== task ||
        row.arm !== arm ||
        row.status !== "ok"
      ) {
        continue;
      }
      const baseline = rows.find(
        (candidate) =>
          candidate.arm === "baseline" &&
          candidate.status === "ok" &&
          candidate.repo === row.repo &&
          candidate.task === row.task &&
          candidate.repeat === row.repeat,
      );
      if (baseline) {
        pairs.push({ baseline, compare: row });
      }
    }
    return {
      repo,
      task,
      arm,
      pairs: pairs.length,
      primaryTokenDelta: sumPairs(pairs, "mainUncachedInputTokens"),
      valueTokenDelta: sumPairs(pairs, "subagentTotalTokens"),
      tokenDelta: sumPairs(pairs, "totalTokens"),
      costDeltaUsd: sumPairs(pairs, "costUsd"),
      qualityScoreDelta: averagePairDelta(pairs, "qualityScore"),
      primaryToolCallDelta: sumPairs(pairs, "mainToolCallCount"),
      valueToolCallDelta: sumPairs(pairs, "subagentToolCallCount"),
      toolCallDelta: sumPairs(pairs, "toolCallCount"),
      postReportBroadSearchDelta: sumPairs(
        pairs,
        "postReportMainBroadSearchCalls",
      ),
      postReportOffTargetReadDelta: sumPairs(
        pairs,
        "postReportMainReadFileOutsideTargets",
      ),
      providerStepDelta: sumPairs(pairs, "providerStepCount"),
      elapsedDeltaMs: sumPairs(pairs, "elapsedMs"),
    };
  });
}

function summarizeArmPairDelta(rows, baselineArm, compareArm) {
  const pairs = [];
  for (const row of rows) {
    if (row.arm !== compareArm || row.status !== "ok") {
      continue;
    }
    const baseline = rows.find(
      (candidate) =>
        candidate.arm === baselineArm &&
        candidate.status === "ok" &&
        candidate.repo === row.repo &&
        candidate.task === row.task &&
        candidate.repeat === row.repeat,
    );
    if (baseline) {
      pairs.push({ baseline, compare: row });
    }
  }
  return {
    baselineArm,
    compareArm,
    pairs: pairs.length,
    primaryTokenDelta: sumPairs(pairs, "mainUncachedInputTokens"),
    valueTokenDelta: sumPairs(pairs, "subagentTotalTokens"),
    tokenDelta: sumPairs(pairs, "totalTokens"),
    costDeltaUsd: sumPairs(pairs, "costUsd"),
    primaryToolCallDelta: sumPairs(pairs, "mainToolCallCount"),
    valueToolCallDelta: sumPairs(pairs, "subagentToolCallCount"),
    toolCallDelta: sumPairs(pairs, "toolCallCount"),
    postReportBroadSearchDelta: sumPairs(
      pairs,
      "postReportMainBroadSearchCalls",
    ),
    postReportOffTargetReadDelta: sumPairs(
      pairs,
      "postReportMainReadFileOutsideTargets",
    ),
    postReportBroadExplorationDelta:
      sumPairs(pairs, "postReportMainBroadSearchCalls") +
      sumPairs(pairs, "postReportMainReadFileOutsideTargets"),
    qualityScoreDelta: averagePairDelta(pairs, "qualityScore"),
    providerStepDelta: sumPairs(pairs, "providerStepCount"),
    elapsedDeltaMs: sumPairs(pairs, "elapsedMs"),
  };
}

function evaluateExploreV2Acceptance(rows) {
  const delta = summarizeArmPairDelta(rows, "explore-v1", "explore-v2");
  const pairedRepeatsByTask = new Map();
  const v1SourceArms = new Set();
  for (const row of rows) {
    if (row.arm !== "explore-v2" || row.status !== "ok") {
      continue;
    }
    const v1 = rows.find(
      (candidate) =>
        candidate.arm === "explore-v1" &&
        candidate.status === "ok" &&
        candidate.repo === row.repo &&
        candidate.task === row.task &&
        candidate.repeat === row.repeat,
    );
    if (!v1) {
      continue;
    }
    v1SourceArms.add(v1.importedFromArm ?? v1.reportMode ?? "unknown");
    const key = `${row.repo}/${row.task}`;
    const repeats = pairedRepeatsByTask.get(key) ?? new Set();
    repeats.add(row.repeat);
    pairedRepeatsByTask.set(key, repeats);
  }

  const pairedTaskCount = pairedRepeatsByTask.size;
  const minPairedRepeatsPerTask =
    pairedTaskCount === 0
      ? 0
      : Math.min(
          ...[...pairedRepeatsByTask.values()].map((repeats) => repeats.size),
        );
  const reasons = [];
  if (pairedTaskCount < 8) {
    reasons.push(`only ${pairedTaskCount} paired tasks; need at least 8`);
  }
  if (minPairedRepeatsPerTask < 3) {
    reasons.push(
      `minimum paired repeats per task is ${minPairedRepeatsPerTask}; need at least 3`,
    );
  }
  const invalidV1SourceArms = [...v1SourceArms]
    .filter(
      (arm) =>
        ![
          "explore",
          "explore-candidate",
          "explore-candidate-followup",
          "explore-v1",
        ].includes(arm),
    )
    .sort();
  if (invalidV1SourceArms.length > 0) {
    reasons.push(
      `explore-v1 imports used non-candidate-followup source arms: ${invalidV1SourceArms.join(", ")}`,
    );
  }
  if (delta.qualityScoreDelta < 0) {
    reasons.push(
      `quality delta is ${formatSigned(delta.qualityScoreDelta)}; V2 must be >= V1`,
    );
  }
  if (delta.primaryTokenDelta <= 0) {
    reasons.push(
      `main uncached input delta is ${delta.primaryTokenDelta}; V2 must decrease it versus V1`,
    );
  }
  if (delta.postReportBroadExplorationDelta <= 0) {
    reasons.push(
      `post-report broad exploration delta is ${delta.postReportBroadExplorationDelta}; V2 must decrease broad grep/list_files or off-target read_file calls versus V1`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    pairedTaskCount,
    minPairedRepeatsPerTask,
    v1SourceArms: [...v1SourceArms].sort(),
    qualityScoreDelta: delta.qualityScoreDelta,
    primaryTokenDelta: delta.primaryTokenDelta,
    postReportBroadSearchDelta: delta.postReportBroadSearchDelta,
    postReportOffTargetReadDelta: delta.postReportOffTargetReadDelta,
    postReportBroadExplorationDelta: delta.postReportBroadExplorationDelta,
  };
}

function sumPairs(pairs, field) {
  return pairs.reduce(
    (total, pair) =>
      total + ((pair.baseline[field] ?? 0) - (pair.compare[field] ?? 0)),
    0,
  );
}

function averagePairDelta(pairs, field) {
  if (pairs.length === 0) return 0;
  return (
    pairs.reduce(
      (total, pair) =>
        total + ((pair.compare[field] ?? 0) - (pair.baseline[field] ?? 0)),
      0,
    ) / pairs.length
  );
}

function summarizeRepoDeltas(rows, compareArm) {
  const repos = [...new Set(rows.map((row) => row.repo))].sort();
  return repos.map((repo) => {
    const baseline = rows.filter(
      (row) =>
        row.repo === repo && row.arm === "baseline" && row.status === "ok",
    );
    const explore = rows.filter(
      (row) =>
        row.repo === repo && row.arm === compareArm && row.status === "ok",
    );
    return {
      repo,
      primaryTokenDelta:
        sum(baseline, "mainUncachedInputTokens") -
        sum(explore, "mainUncachedInputTokens"),
      valueTokenDelta:
        sum(baseline, "subagentTotalTokens") -
        sum(explore, "subagentTotalTokens"),
      tokenDelta: sum(baseline, "totalTokens") - sum(explore, "totalTokens"),
      costDeltaUsd: sum(baseline, "costUsd") - sum(explore, "costUsd"),
      primaryToolCallDelta:
        sum(baseline, "mainToolCallCount") - sum(explore, "mainToolCallCount"),
      valueToolCallDelta:
        sum(baseline, "subagentToolCallCount") -
        sum(explore, "subagentToolCallCount"),
      toolCallDelta:
        sum(baseline, "toolCallCount") - sum(explore, "toolCallCount"),
      elapsedDeltaMs: sum(baseline, "elapsedMs") - sum(explore, "elapsedMs"),
    };
  });
}

function summarizeExploreTaskCohorts(rows, compareArm) {
  const taskDeltas = summarizeTaskDeltas(rows, compareArm);
  const statuses = [
    "available-used",
    "partially-used",
    "available-unused",
    "unavailable",
  ];
  return statuses.map((status) => {
    const cohort = taskDeltas.filter((row) => row.exploreStatus === status);
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

function summarizeTaskDeltas(rows, compareArm) {
  const keys = [
    ...new Set(rows.map((row) => `${row.repo}\0${row.task}`)),
  ].sort();
  return keys.map((key) => {
    const [repo, task] = key.split("\0");
    const baseline = rows.filter(
      (row) =>
        row.repo === repo &&
        row.task === task &&
        row.arm === "baseline" &&
        row.status === "ok",
    );
    const explore = rows.filter(
      (row) =>
        row.repo === repo &&
        row.task === task &&
        row.arm === compareArm &&
        row.status === "ok",
    );
    const exploreCodeDisabledReasons = explore.reduce(
      (counts, row) =>
        mergeReasonCounts(counts, row.exploreCodeDisabledReasons),
      {},
    );
    const tokenDelta =
      sum(baseline, "totalTokens") - sum(explore, "totalTokens");
    const primaryTokenDelta =
      sum(baseline, "mainUncachedInputTokens") -
      sum(explore, "mainUncachedInputTokens");
    const valueTokenDelta =
      sum(baseline, "subagentTotalTokens") -
      sum(explore, "subagentTotalTokens");
    const toolCallDelta =
      sum(baseline, "toolCallCount") - sum(explore, "toolCallCount");
    const primaryToolCallDelta =
      sum(baseline, "mainToolCallCount") - sum(explore, "mainToolCallCount");
    const valueToolCallDelta =
      sum(baseline, "subagentToolCallCount") -
      sum(explore, "subagentToolCallCount");
    const providerStepDelta =
      sum(baseline, "providerStepCount") - sum(explore, "providerStepCount");
    const elapsedDeltaMs =
      sum(baseline, "elapsedMs") - sum(explore, "elapsedMs");
    const costDeltaUsd = sum(baseline, "costUsd") - sum(explore, "costUsd");
    const qualityScoreDelta =
      average(explore, "qualityScore") - average(baseline, "qualityScore");
    const exploreCodeAvailable = explore.filter(
      (row) => row.exploreCodeAvailable,
    ).length;
    const exploreCodeUsed = explore.filter((row) => row.exploreCodeUsed).length;
    return {
      repo,
      task,
      appSubPath:
        explore[0]?.appSubPath ?? baseline[0]?.appSubPath ?? "unknown",
      appImportSubPath: formatSubPath(
        explore[0]?.appImportSubPath ?? baseline[0]?.appImportSubPath,
      ),
      contextPaths: explore[0]?.contextPaths ?? baseline[0]?.contextPaths ?? [],
      exploreCount: explore.length,
      exploreCodeAvailable,
      exploreCodeUsed,
      exploreCodeDisabledReasons,
      exploreStatus: exploreTaskStatus({
        exploreCount: explore.length,
        exploreCodeAvailable,
        exploreCodeUsed,
      }),
      primaryTokenDelta,
      valueTokenDelta,
      tokenDelta,
      costDeltaUsd,
      qualityScoreDelta,
      primaryToolCallDelta,
      valueToolCallDelta,
      toolCallDelta,
      providerStepDelta,
      elapsedDeltaMs,
      winner: chooseTaskWinner({
        primaryTokenDelta,
        primaryToolCallDelta,
        costDeltaUsd,
      }),
    };
  });
}

function summarizeAnswerComparisons(rows, compareArm) {
  const keys = [
    ...new Set(rows.map((row) => `${row.repo}\0${row.task}`)),
  ].sort();
  return keys.map((key) => {
    const [repo, task] = key.split("\0");
    const baseline = rows.filter(
      (row) =>
        row.repo === repo &&
        row.task === task &&
        row.arm === "baseline" &&
        row.status === "ok",
    );
    const explore = rows.filter(
      (row) =>
        row.repo === repo &&
        row.task === task &&
        row.arm === compareArm &&
        row.status === "ok",
    );
    const expectedTermCoverageDelta =
      average(explore, "expectedTermCoverage") -
      average(baseline, "expectedTermCoverage");
    const qualityScoreDelta =
      average(explore, "qualityScore") - average(baseline, "qualityScore");
    const fileReferenceDelta =
      Math.round(average(explore, "fileReferenceCount")) -
      Math.round(average(baseline, "fileReferenceCount"));
    const lineRangeReferenceDelta =
      Math.round(average(explore, "lineRangeReferenceCount")) -
      Math.round(average(baseline, "lineRangeReferenceCount"));
    const finalTextCharsDelta =
      Math.round(average(explore, "finalTextChars")) -
      Math.round(average(baseline, "finalTextChars"));
    return {
      repo,
      task,
      verdict: chooseAnswerVerdict({
        baselineCount: baseline.length,
        exploreCount: explore.length,
        expectedTermCoverageDelta,
        qualityScoreDelta,
      }),
      expectedTermCoverageDelta,
      qualityScoreDelta,
      fileReferenceDelta,
      lineRangeReferenceDelta,
      finalTextCharsDelta,
      notes: answerComparisonNotes({
        baselineCount: baseline.length,
        exploreCount: explore.length,
        compareArm,
        expectedTermCoverageDelta,
        qualityScoreDelta,
        fileReferenceDelta,
        lineRangeReferenceDelta,
        finalTextCharsDelta,
      }),
    };
  });
}

function chooseAnswerVerdict({
  baselineCount,
  exploreCount,
  expectedTermCoverageDelta,
  qualityScoreDelta,
}) {
  if (baselineCount === 0 || exploreCount === 0) {
    return "incomplete";
  }
  if (expectedTermCoverageDelta >= 0.25) {
    return "explore";
  }
  if (expectedTermCoverageDelta <= -0.25) {
    return "baseline";
  }
  if (qualityScoreDelta >= 8) {
    return "explore";
  }
  if (qualityScoreDelta <= -8) {
    return "baseline";
  }
  return "tie";
}

function answerComparisonNotes({
  baselineCount,
  exploreCount,
  compareArm,
  expectedTermCoverageDelta,
  qualityScoreDelta,
  fileReferenceDelta,
  lineRangeReferenceDelta,
  finalTextCharsDelta,
}) {
  if (baselineCount === 0 || exploreCount === 0) {
    return `only ${baselineCount} baseline / ${exploreCount} ${compareArm} completed`;
  }
  const notes = [];
  if (expectedTermCoverageDelta !== 0) {
    notes.push("expected-term coverage changed");
  }
  if (Math.abs(qualityScoreDelta) >= 8) {
    notes.push("quality-score separation");
  }
  if (fileReferenceDelta !== 0 || lineRangeReferenceDelta !== 0) {
    notes.push("reference density changed");
  }
  if (Math.abs(finalTextCharsDelta) >= 2000) {
    notes.push("answer length changed substantially");
  }
  return notes.length > 0 ? notes.join("; ") : "no material rubric difference";
}

function chooseTaskWinner({
  primaryTokenDelta,
  primaryToolCallDelta,
  costDeltaUsd,
}) {
  if (primaryTokenDelta > 0 && primaryToolCallDelta >= 0 && costDeltaUsd >= 0) {
    return "explore";
  }
  if (primaryTokenDelta < 0 && primaryToolCallDelta <= 0 && costDeltaUsd <= 0) {
    return "baseline";
  }
  return "mixed";
}

function scoreFinalText(finalText, expectedTerms) {
  const answerText = visibleAnswerText(finalText);
  const lower = answerText.toLowerCase();
  const matchedExpectedTerms = expectedTerms.filter((term) =>
    lower.includes(term.toLowerCase()),
  ).length;
  const expectedTermCoverage =
    expectedTerms.length === 0
      ? 1
      : matchedExpectedTerms / expectedTerms.length;
  const fileReferenceCount = countMatches(
    answerText,
    /\b(?:[\w@()[\].-]+\/)+[\w@()[\].-]+\.(?:ts|tsx|js|jsx|css|scss|json|md)\b/g,
  );
  const lineRangeReferenceCount = countMatches(
    answerText,
    /\b(?:[\w@()[\].-]+\/)+[\w@()[\].-]+\.(?:ts|tsx|js|jsx|css|scss|json|md):\d+(?:-\d+)?\b/g,
  );
  const finalTextChars = answerText.length;
  const qualityScore =
    expectedTermCoverage * 100 +
    Math.min(fileReferenceCount, 30) +
    Math.min(lineRangeReferenceCount * 2, 40);
  return {
    matchedExpectedTerms,
    expectedTermCount: expectedTerms.length,
    expectedTermCoverage,
    fileReferenceCount,
    lineRangeReferenceCount,
    finalTextChars,
    qualityScore,
  };
}

function visibleAnswerText(finalText) {
  return finalText
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<dyad-[\s\S]*?<\/dyad-[^>]+>/g, "")
    .replace(/<dyad-[^>]+\/>/g, "")
    .trim();
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

function exploreTaskStatus({
  exploreCount,
  exploreCodeAvailable,
  exploreCodeUsed,
}) {
  if (exploreCount === 0 || exploreCodeAvailable === 0) return "unavailable";
  if (exploreCodeUsed === 0) return "available-unused";
  if (exploreCodeAvailable < exploreCount || exploreCodeUsed < exploreCount) {
    return "partially-used";
  }
  return "available-used";
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function average(rows, key) {
  return rows.length === 0 ? 0 : sum(rows, key) / rows.length;
}

function formatRatio(sumValue = 0, count = 0) {
  if (!count) return "-";
  return (sumValue / count).toFixed(2);
}

function formatSigned(value = 0, digits = 1) {
  return value > 0 ? `+${value.toFixed(digits)}` : value.toFixed(digits);
}
