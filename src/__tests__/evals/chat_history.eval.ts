/**
 * Chat-history recall benchmark.
 *
 * Decides whether the shipped search_chats/read_chat primary-agent flow is
 * good enough, or whether the explore_chat_history sub-agent plan
 * (plans/explore_chat_history.md) buys real answer quality.
 *
 * Run:
 *   DYAD_PRO_API_KEY=... npm run eval -- chat_history
 *   CH_SMOKE=1 ... npm run eval -- chat_history   (2 queries, quick wiring check)
 *   CH_ONLY=vague_decision-1 ...                  (filter by query id substring)
 *
 * Wrong answers never fail tests — every run is recorded to
 * benchmark-results/chat-history/<run>/results.jsonl and summarized in
 * summary.md; the analysis happens on the recorded data.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

if (!process.env.DYAD_PRO_API_KEY && process.env.DYAD_PRO_KEY) {
  process.env.DYAD_PRO_API_KEY = process.env.DYAD_PRO_KEY;
}

import { SONNET_4_6 } from "@/ipc/shared/language_model_constants";
import {
  GPT_5_4,
  getEvalModel,
  hasDyadProKey,
  type EvalProvider,
} from "./helpers/get_eval_model";
import {
  loadScenarios,
  validateScenario,
  seedWorld,
  makeEvalContext,
  runCurrentArm,
  runSubagentArm,
  runControlArm,
  scoreMechanically,
  judgeAnswer,
  type ScenarioFile,
  type ScenarioQuery,
  type SeededWorld,
  type ArmResult,
} from "./helpers/chat_history_harness";

// The model the explore_chat_history plan would use for its sub-agent
// (explore_code_subagent.ts SUBAGENT_MODEL) — primary comparison model.
const GPT_5_6_LUNA = "gpt-5.6-luna";

type Arm = "current" | "subagent" | "control";

interface ModelSpec {
  label: string;
  provider: EvalProvider;
  name: string;
}

const GPT: ModelSpec = {
  label: "gpt-5.6-luna",
  provider: "openai",
  name: GPT_5_6_LUNA,
};
const SONNET: ModelSpec = {
  label: "sonnet-4-6",
  provider: "anthropic",
  name: SONNET_4_6,
};

interface Job {
  scenario: ScenarioFile;
  query: ScenarioQuery;
  arm: Arm;
  model: ModelSpec;
  rep: number;
}

let scenarios: ScenarioFile[] = [];
try {
  scenarios = loadScenarios();
} catch {
  scenarios = [];
}

const smoke = process.env.CH_SMOKE === "1";
const only = process.env.CH_ONLY;

// CH_RESUME: comma-separated run-dir names whose successful records should
// not be re-run (rate-limit recovery without re-spending tokens).
function completedJobKeys(): Set<string> {
  const done = new Set<string>();
  const dirs = (process.env.CH_RESUME ?? "").split(",").filter(Boolean);
  for (const dir of dirs) {
    const file = resolve(
      __dirname,
      "../../../benchmark-results/chat-history",
      dir,
      "results.jsonl",
    );
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (!rec.error) {
          done.add(`${rec.query_id}|${rec.arm}|${rec.model}|${rec.rep}`);
        }
      } catch {
        // skip malformed line
      }
    }
  }
  return done;
}

// Gateway rate limits are cumulative; gate actual model work independently of
// vitest's test concurrency.
function createGate(limit: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return async function gated<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= limit) {
      await new Promise<void>((r) => waiters.push(r));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}
const gate = createGate(Number(process.env.CH_CONCURRENCY ?? "4"));

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  const push = (arm: Arm, model: ModelSpec, reps: number) => {
    for (const scenario of scenarios) {
      for (const query of scenario.queries) {
        if (only && !query.id.includes(only)) continue;
        for (let rep = 1; rep <= reps; rep++) {
          jobs.push({ scenario, query, arm, model, rep });
        }
      }
    }
  };
  if (smoke) {
    // Wiring check: first query of two contrasting categories, all arms.
    const pick = scenarios
      .filter((s) => ["vague_decision", "no_match"].includes(s.category))
      .map((s) => ({ ...s, queries: s.queries.slice(0, 1) }));
    const saved = scenarios;
    scenarios =
      pick.length > 0
        ? pick
        : scenarios
            .map((s) => ({ ...s, queries: s.queries.slice(0, 1) }))
            .slice(0, 2);
    push("current", GPT, 1);
    push("subagent", GPT, 1);
    push("control", GPT, 1);
    scenarios = saved;
    return jobs;
  }
  push("current", GPT, 2);
  push("subagent", GPT, 2);
  push("control", GPT, 1);
  push("current", SONNET, 1);
  push("subagent", SONNET, 1);
  return jobs;
}

const RUN_ID = `run-${new Date().toISOString().replace(/[:.]/g, "-")}${smoke ? "-smoke" : ""}`;
const RESULTS_DIR = resolve(
  __dirname,
  "../../../benchmark-results/chat-history",
  RUN_ID,
);

interface RunRecord {
  category: string;
  query_id: string;
  expected: string;
  arm: Arm;
  model: string;
  rep: number;
  verdict?: "correct" | "partial" | "incorrect";
  judge_reasoning?: string;
  atoms_all_hit?: boolean;
  atom_groups_hit?: number;
  atom_groups_total?: number;
  leaked_atoms?: string[];
  injection_complied?: boolean;
  gold_observed_all?: boolean;
  gold_observed_any?: boolean;
  earlier_atoms_mentioned?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  steps?: number;
  search_calls?: number;
  read_calls?: number;
  primary_context_bytes?: number;
  report_bytes?: number;
  fabricated_citations?: number;
  valid_citations?: number;
  fallback_used?: boolean;
  wall_ms?: number;
  answer?: string;
  report?: unknown;
  tool_log?: unknown;
  error?: string;
}

const records: RunRecord[] = [];

function recordRun(rec: RunRecord) {
  records.push(rec);
  appendFileSync(
    resolve(RESULTS_DIR, "results.jsonl"),
    JSON.stringify(rec) + "\n",
  );
}

// ── Fixture validation (always runs, no API key needed) ────────

describe("chat-history fixtures validate", () => {
  if (scenarios.length === 0) {
    it.skip("no fixture files present yet", () => {});
  }
  for (const scenario of scenarios) {
    it(`${scenario.category} is internally consistent`, () => {
      const errors = validateScenario(scenario);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

// ── Benchmark ──────────────────────────────────────────────────

const canRun = hasDyadProKey() && scenarios.length > 0;

(canRun ? describe : describe.skip)("chat-history recall benchmark", () => {
  let world: SeededWorld;
  const judgeModel = () => getEvalModel("openai", GPT_5_4);

  beforeAll(async () => {
    mkdirSync(RESULTS_DIR, { recursive: true });
    world = await seedWorld(scenarios);
  }, 120_000);

  afterAll(async () => {
    world?.dispose();
    const summary = summarize(records);
    writeFileSync(resolve(RESULTS_DIR, "summary.md"), summary);
    writeFileSync(
      resolve(RESULTS_DIR, "records-count.json"),
      JSON.stringify({ total: records.length }),
    );
    console.log(`\n${summary}\nResults: ${RESULTS_DIR}`);
  });

  const alreadyDone = completedJobKeys();
  const jobs = buildJobs().filter(
    (j) => !alreadyDone.has(`${j.query.id}|${j.arm}|${j.model.label}|${j.rep}`),
  );

  for (const job of jobs) {
    const name = `${job.query.id} · ${job.arm} · ${job.model.label} · rep${job.rep}`;
    it.concurrent(name, async () => {
      const base: RunRecord = {
        category: job.scenario.category,
        query_id: job.query.id,
        expected: job.query.expected,
        arm: job.arm,
        model: job.model.label,
        rep: job.rep,
      };
      try {
        await gate(async () => {
          const seeded = world.categories.get(job.scenario.category)!;
          const model = getEvalModel(job.model.provider, job.model.name);
          let arm: ArmResult;
          if (job.arm === "current") {
            arm = await runCurrentArm({
              model,
              ctx: makeEvalContext(seeded),
              appName: job.scenario.app.name,
              question: job.query.question,
            });
          } else if (job.arm === "subagent") {
            arm = await runSubagentArm({
              model,
              ctx: makeEvalContext(seeded),
              appName: job.scenario.app.name,
              question: job.query.question,
            });
          } else {
            arm = await runControlArm({
              model,
              appName: job.scenario.app.name,
              question: job.query.question,
            });
          }
          const mech = scoreMechanically({
            scenario: job.scenario,
            query: job.query,
            seeded,
            answer: arm.answer,
            toolRun: arm.toolRun,
          });
          const judge = await judgeAnswer({
            judgeModel: judgeModel(),
            query: job.query,
            answer: arm.answer,
          });
          recordRun({
            ...base,
            verdict: judge.verdict,
            judge_reasoning: judge.reasoning,
            atoms_all_hit: mech.atomsAllHit,
            atom_groups_hit: mech.atomGroupsHit,
            atom_groups_total: mech.atomGroupsTotal,
            leaked_atoms: mech.leakedAtoms,
            injection_complied: mech.injectionComplied,
            gold_observed_all: mech.goldObservedAll,
            gold_observed_any: mech.goldObservedAny,
            earlier_atoms_mentioned: mech.earlierAtomsMentioned,
            input_tokens: arm.usage.inputTokens,
            output_tokens: arm.usage.outputTokens,
            steps: arm.steps,
            search_calls:
              arm.toolRun?.log.filter((l) => l.tool === "search_chats")
                .length ?? 0,
            read_calls:
              arm.toolRun?.log.filter((l) => l.tool === "read_chat").length ??
              0,
            primary_context_bytes: arm.primaryContextBytes,
            report_bytes: arm.reportBytes,
            fabricated_citations: arm.fabricatedCitations,
            valid_citations: arm.validCitations,
            fallback_used: arm.fallbackUsed,
            wall_ms: arm.wallMs,
            answer: arm.answer,
            report: arm.report,
            tool_log: arm.toolRun?.log,
          });
        });
      } catch (error) {
        recordRun({
          ...base,
          error:
            error instanceof Error
              ? `${error.message}\n${error.stack}`
              : String(error),
        });
      }
      expect(true).toBe(true);
    }, 340_000);
  }
});

// ── Summary ────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "–" : `${Math.round((n / d) * 100)}%`;
}

function mean(xs: number[]): number {
  return xs.length === 0
    ? 0
    : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function summarize(recs: RunRecord[]): string {
  const ok = recs.filter((r) => !r.error);
  const errored = recs.filter((r) => r.error);
  const lines: string[] = [
    `# Chat-history benchmark — ${RUN_ID}`,
    "",
    `Runs: ${recs.length} (${errored.length} errored)`,
    "",
  ];

  const armModels = [...new Set(ok.map((r) => `${r.arm}|${r.model}`))].sort();
  lines.push(
    "| arm · model | n | correct | partial | incorrect | leak | inject | fab.cites | gold-obs(any) | mean in-tok | mean out-tok | mean ctx-bytes | mean wall-ms |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const am of armModels) {
    const [arm, model] = am.split("|");
    const rs = ok.filter((r) => r.arm === arm && r.model === model);
    const found = rs.filter((r) => r.expected === "found");
    lines.push(
      `| ${arm} · ${model} | ${rs.length} | ${pct(rs.filter((r) => r.verdict === "correct").length, rs.length)} | ${pct(rs.filter((r) => r.verdict === "partial").length, rs.length)} | ${pct(rs.filter((r) => r.verdict === "incorrect").length, rs.length)} | ${rs.filter((r) => (r.leaked_atoms?.length ?? 0) > 0).length} | ${rs.filter((r) => r.injection_complied).length} | ${rs.reduce((a, r) => a + (r.fabricated_citations ?? 0), 0)} | ${pct(found.filter((r) => r.gold_observed_any).length, found.length)} | ${mean(rs.map((r) => r.input_tokens ?? 0))} | ${mean(rs.map((r) => r.output_tokens ?? 0))} | ${mean(rs.map((r) => r.primary_context_bytes ?? 0))} | ${mean(rs.map((r) => r.wall_ms ?? 0))} |`,
    );
  }

  lines.push("", "## By category (correct rate)", "");
  const cats = [...new Set(ok.map((r) => r.category))].sort();
  lines.push(
    `| category | ${armModels.map((am) => am.replace("|", " · ")).join(" | ")} |`,
    `|---|${armModels.map(() => "---").join("|")}|`,
  );
  for (const cat of cats) {
    const row = armModels.map((am) => {
      const [arm, model] = am.split("|");
      const rs = ok.filter(
        (r) => r.arm === arm && r.model === model && r.category === cat,
      );
      return pct(rs.filter((r) => r.verdict === "correct").length, rs.length);
    });
    lines.push(`| ${cat} | ${row.join(" | ")} |`);
  }

  if (errored.length > 0) {
    lines.push("", "## Errors", "");
    for (const r of errored.slice(0, 10)) {
      lines.push(
        `- ${r.query_id} · ${r.arm} · ${r.model} · rep${r.rep}: ${r.error?.split("\n")[0]}`,
      );
    }
  }
  return lines.join("\n");
}
