#!/usr/bin/env node
import "dotenv/config";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const eph = require("electron-playwright-helpers");

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
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
  },
});

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const selectedRepos = splitList(values.repos);
const selectedTasks = splitList(values.tasks);
const repeats = Number(values.repeats ?? 1);
const timeoutMs = Number(values.timeout ?? 600_000);
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error("--repeats must be a positive integer");
}

const matrix = buildMatrix(config, selectedRepos, selectedTasks, repeats);

if (values["dry-run"]) {
  console.log(
    JSON.stringify({ runId, totalTrials: matrix.length, matrix }, null, 2),
  );
  process.exit(0);
}

if (!process.env.DYAD_PRO_KEY) {
  throw new Error(
    "DYAD_PRO_KEY must be set in .env for Dyad Engine benchmark runs",
  );
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

for (const trial of matrix) {
  const result = await runTrial(trial);
  fs.appendFileSync(resultsPath, JSON.stringify(result) + "\n");
  console.log(
    `${trial.repo.name}/${trial.task.id}/${trial.arm}/repeat-${trial.repeat}: ${result.status}`,
  );
}

writeSummary(runId, resultsPath);

function buildMatrix(config, repoFilter, taskFilter, repeats) {
  const rows = [];
  for (const repo of config.repos) {
    if (repoFilter && !repoFilter.has(repo.name)) continue;
    for (const task of repo.tasks) {
      if (taskFilter && !taskFilter.has(task.id)) continue;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        rows.push({ repo, task, arm: "baseline", repeat });
        rows.push({ repo, task, arm: "explore", repeat });
      }
    }
  }
  return rows;
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
  }
  if (values.install) {
    execFileSync("pnpm", ["install"], {
      cwd: path.join(repoPath, repo.subPath ?? "."),
      stdio: "inherit",
    });
  }
}

async function runTrial(trial) {
  const repoPath = path.join(
    REPOS_DIR,
    trial.repo.name,
    trial.repo.subPath ?? ".",
  );
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
  const env = {
    ...process.env,
    DYAD_BENCHMARK_RUN_ID: benchmarkRunId,
    DYAD_PRO_KEY: process.env.DYAD_PRO_KEY,
    XDG_CONFIG_HOME: xdgConfigHome,
    GIT_CONFIG_GLOBAL: path.join(userDataDir, ".gitconfig"),
    E2E_TEST_BUILD: "true",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "benchmark-placeholder",
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
    const importResult = await withTimeout(
      page.evaluate(
        async ({ repoPath, repoName, apiKey, model, enableCodeExplorer }) => {
          await window.electron.ipcRenderer.invoke("set-user-settings", {
            enableDyadPro: true,
            enableCodeExplorer,
            selectedChatMode: "local-agent",
            selectedModel: { provider: "auto", name: model },
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
          apiKey: process.env.DYAD_PRO_KEY,
          model: values.model,
          enableCodeExplorer: trial.arm === "explore",
        },
      ),
      120_000,
      "settings/import-app",
    );

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
          prompt: trial.task.prompt,
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
    const passedRubric = trial.task.expected.every((term) =>
      finalText.toLowerCase().includes(term.toLowerCase()),
    );
    const metrics = readBenchmarkMetrics(benchmarkRunId);

    return {
      runId: benchmarkRunId,
      status: "ok",
      repo: trial.repo.name,
      task: trial.task.id,
      arm: trial.arm,
      repeat: trial.repeat,
      elapsedMs: Date.now() - startedAt,
      passedRubric,
      ...metrics,
      finalText,
    };
  } catch (error) {
    return {
      runId: benchmarkRunId,
      status: "error",
      repo: trial.repo.name,
      task: trial.task.id,
      arm: trial.arm,
      repeat: trial.repeat,
      elapsedMs: Date.now() - startedAt,
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
    trials: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    errors: rows.filter((row) => row.status !== "ok").length,
    byArm: summarizeBy(rows, "arm"),
    repoDeltas: summarizeRepoDeltas(rows),
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
      `Trials: ${summary.trials}`,
      `OK: ${summary.ok}`,
      `Errors: ${summary.errors}`,
      "",
      "## By Arm",
      "",
      "| Arm | OK | Avg elapsed ms | Total tokens | Tool calls |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...Object.entries(summary.byArm).map(
        ([arm, item]) =>
          `| ${arm} | ${item.ok}/${item.count} | ${Math.round(item.elapsedMs / Math.max(item.count, 1))} | ${item.totalTokens} | ${item.toolCalls} |`,
      ),
      "",
      "## Repo Deltas",
      "",
      "| Repo | Token delta | Tool-call delta | Elapsed delta ms |",
      "| --- | ---: | ---: | ---: |",
      ...summary.repoDeltas.map(
        (item) =>
          `| ${item.repo} | ${item.tokenDelta} | ${item.toolCallDelta} | ${item.elapsedDeltaMs} |`,
      ),
      "",
      "Detailed stream/tool/token events are in `benchmark-results/code-explorer/<trial-run-id>/events.jsonl`.",
    ].join("\n"),
  );
}

function summarizeBy(rows, key) {
  const result = {};
  for (const row of rows) {
    const group = row[key];
    result[group] ??= { count: 0, ok: 0, elapsedMs: 0 };
    result[group].count++;
    if (row.status === "ok") result[group].ok++;
    result[group].elapsedMs += row.elapsedMs ?? 0;
    result[group].totalTokens =
      (result[group].totalTokens ?? 0) + (row.totalTokens ?? 0);
    result[group].toolCalls =
      (result[group].toolCalls ?? 0) + (row.toolCallCount ?? 0);
  }
  return result;
}

function readBenchmarkMetrics(trialRunId) {
  const eventsPath = path.join(RESULTS_DIR, trialRunId, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    return {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCallCount: 0,
      providerStepCount: 0,
      toolCallsByName: {},
    };
  }

  const events = fs
    .readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const streamFinish = events.findLast?.(
    (event) => event.type === "stream_finish",
  );
  const stepEvents = events.filter(
    (event) => event.type === "stream_step_finish",
  );
  const toolEvents = events.filter((event) => event.type === "tool_call_end");
  const toolCallsByName = {};

  for (const event of toolEvents) {
    toolCallsByName[event.toolName] =
      (toolCallsByName[event.toolName] ?? 0) + 1;
  }

  return {
    totalTokens: streamFinish?.usage?.totalTokens ?? 0,
    inputTokens: streamFinish?.usage?.inputTokens ?? 0,
    outputTokens: streamFinish?.usage?.outputTokens ?? 0,
    toolCallCount: toolEvents.length,
    providerStepCount: stepEvents.length,
    toolCallsByName,
  };
}

function summarizeRepoDeltas(rows) {
  const repos = [...new Set(rows.map((row) => row.repo))].sort();
  return repos.map((repo) => {
    const baseline = rows.filter(
      (row) =>
        row.repo === repo && row.arm === "baseline" && row.status === "ok",
    );
    const explore = rows.filter(
      (row) =>
        row.repo === repo && row.arm === "explore" && row.status === "ok",
    );
    return {
      repo,
      tokenDelta: sum(baseline, "totalTokens") - sum(explore, "totalTokens"),
      toolCallDelta:
        sum(baseline, "toolCallCount") - sum(explore, "toolCallCount"),
      elapsedDeltaMs: sum(baseline, "elapsedMs") - sum(explore, "elapsedMs"),
    };
  });
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}
