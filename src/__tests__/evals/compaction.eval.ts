/**
 * Compaction quality benchmark (plans/benchmark-compaction.md).
 *
 * Compares candidate compaction models on ~200k-token synthetic AI-coding
 * transcripts using the production compaction prompt + transcript format.
 *
 * Run:
 *   DYAD_PRO_API_KEY=... EVAL_SUITE/EVAL_MODEL not used — this suite is
 *   gated by its own env vars:
 *   CMP_RUN=1 npm run eval -- compaction              (full grid)
 *   CMP_RUN=1 CMP_SMOKE=1 npm run eval -- compaction  (1 fixture x models x 1 rep)
 *   CMP_ONLY=<fixture substr>  CMP_MODELS=gpt-5.6-sol,gpt-5.6-luna
 *   CMP_RESUME=<run-dir[,run-dir]>  CMP_CONCURRENCY=2
 *
 * Wrong answers never fail tests — every run is appended to
 * benchmark-results/compaction/<run>/results.jsonl and summarized in
 * summary.md.
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

import { GPT_5_4, getEvalModel, hasDyadProKey } from "./helpers/get_eval_model";
import {
  loadFixtures,
  loadSpecs,
  validateSpec,
  validateFixture,
  fixtureTranscript,
  runCompaction,
  structuralChecks,
  judgeFactGrid,
  runProbes,
  computeScores,
  type CompactionFixture,
  type FactGridResult,
  type ProbeResult,
  type Scores,
  type StructuralResult,
} from "./helpers/compaction_harness";

const MODELS = (process.env.CMP_MODELS ?? "gpt-5.6-sol,gpt-5.6-luna")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const smoke = process.env.CMP_SMOKE === "1";
const only = process.env.CMP_ONLY;
const optedIn = process.env.CMP_RUN === "1" || smoke;
const REPS = smoke ? 1 : 2;

let fixtures: CompactionFixture[] = [];
try {
  fixtures = loadFixtures();
} catch {
  fixtures = [];
}
if (only) fixtures = fixtures.filter((f) => f.name.includes(only));
if (smoke) fixtures = fixtures.slice(0, 1);

// Big requests: keep engine concurrency low.
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
const gate = createGate(Number(process.env.CMP_CONCURRENCY ?? "2"));

const RUN_ID = `run-${new Date().toISOString().replace(/[:.]/g, "-")}${smoke ? "-smoke" : ""}`;
const RESULTS_ROOT = resolve(
  __dirname,
  "../../../benchmark-results/compaction",
);
const RESULTS_DIR = resolve(RESULTS_ROOT, RUN_ID);

interface RunRecord {
  fixture: string;
  model: string;
  rep: number;
  scores?: Scores;
  structural?: StructuralResult;
  factGrid?: FactGridResult;
  probes?: ProbeResult[];
  input_tokens?: number;
  output_tokens?: number;
  wall_ms?: number;
  summary?: string;
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

function completedJobKeys(): Set<string> {
  const done = new Set<string>();
  for (const dir of (process.env.CMP_RESUME ?? "").split(",").filter(Boolean)) {
    const file = resolve(RESULTS_ROOT, dir, "results.jsonl");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as RunRecord;
        if (!rec.error) {
          done.add(`${rec.fixture}|${rec.model}|${rec.rep}`);
          records.push(rec); // carry into this run's summary
        }
      } catch {
        // skip malformed line
      }
    }
  }
  return done;
}

// ── Spec validation (always runs, no API key needed) ───────────
// The generated transcripts are gitignored, so on a clean checkout the
// fixture-validation block below has nothing to check. The committed
// authoring specs are what CI can and must validate — and their absence is
// a failure, not a skip.

describe("compaction specs validate", () => {
  it("committed specs are present", () => {
    expect(loadSpecs().length).toBeGreaterThan(0);
  });
  for (const { file, spec } of loadSpecs()) {
    it(`${file} is internally consistent`, () => {
      const errors = validateSpec(file, spec);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

// ── Fixture validation (requires locally generated fixtures) ───

describe("compaction fixtures validate", () => {
  if (fixtures.length === 0) {
    it.skip("no generated fixtures present (see AUTHORING.md)", () => {});
  }
  for (const fixture of fixtures) {
    it(`${fixture.name} is internally consistent`, () => {
      const errors = validateFixture(fixture);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

// ── Benchmark ──────────────────────────────────────────────────

const canRun = hasDyadProKey() && fixtures.length > 0 && optedIn;

(canRun ? describe : describe.skip)("compaction quality benchmark", () => {
  beforeAll(() => {
    mkdirSync(RESULTS_DIR, { recursive: true });
  });

  afterAll(() => {
    const summary = summarize(records);
    writeFileSync(resolve(RESULTS_DIR, "summary.md"), summary);
    console.log(`\n${summary}\nResults: ${RESULTS_DIR}`);
  });

  const alreadyDone = completedJobKeys();
  const jobs: { fixture: CompactionFixture; model: string; rep: number }[] = [];
  for (const fixture of fixtures) {
    for (const model of MODELS) {
      for (let rep = 1; rep <= REPS; rep++) {
        if (alreadyDone.has(`${fixture.name}|${model}|${rep}`)) continue;
        jobs.push({ fixture, model, rep });
      }
    }
  }

  for (const job of jobs) {
    const name = `${job.fixture.name} · ${job.model} · rep${job.rep}`;
    it.concurrent(name, async () => {
      const base: RunRecord = {
        fixture: job.fixture.name,
        model: job.model,
        rep: job.rep,
      };
      try {
        await gate(async () => {
          const model = getEvalModel("openai", job.model);
          const run = await runCompaction({ model, fixture: job.fixture });
          const structural = structuralChecks(
            run.summary,
            fixtureTranscript(job.fixture),
          );
          const judgeModel = getEvalModel("openai", GPT_5_4);
          const factGrid = await judgeFactGrid({
            judgeModel,
            fixture: job.fixture,
            summary: run.summary,
          });
          const probes = await runProbes({
            probeModel: judgeModel,
            judgeModel,
            fixture: job.fixture,
            summary: run.summary,
          });
          recordRun({
            ...base,
            scores: computeScores(job.fixture, factGrid, probes),
            structural,
            factGrid,
            probes,
            input_tokens: run.inputTokens,
            output_tokens: run.outputTokens,
            wall_ms: run.wallMs,
            summary: run.summary,
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
    }, 1_200_000);
  }
});

// ── Summary ────────────────────────────────────────────────────

function pctf(x: number): string {
  return `${Math.round(x * 100)}%`;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function summarize(recs: RunRecord[]): string {
  const ok = recs.filter((r) => !r.error && r.scores);
  const errored = recs.filter((r) => r.error);
  const lines: string[] = [
    `# Compaction benchmark — ${RUN_ID}`,
    "",
    `Runs: ${recs.length} (${errored.length} errored) · models: ${MODELS.join(", ")} · fixtures: ${fixtures.length} · reps: ${REPS}`,
    "",
    "| model | n | weighted retention | tier-1 retention | probe score | fact contradictions | trap contradictions | trap misses | halluc. paths | missing sections | mean summary tok | mean wall s |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const model of MODELS) {
    const rs = ok.filter((r) => r.model === model);
    if (!rs.length) continue;
    lines.push(
      `| ${model} | ${rs.length} | ${pctf(mean(rs.map((r) => r.scores!.weightedRetention)))} | ${pctf(mean(rs.map((r) => r.scores!.tier1Retention)))} | ${pctf(mean(rs.map((r) => r.scores!.probeScore)))} | ${rs.reduce((a, r) => a + r.scores!.contradictedFacts, 0)} | ${rs.reduce((a, r) => a + r.scores!.trapContradictions, 0)} | ${rs.reduce((a, r) => a + r.scores!.trapMisses, 0)} | ${rs.reduce((a, r) => a + (r.structural?.hallucinatedPaths.length ?? 0), 0)} | ${rs.reduce((a, r) => a + (r.structural?.missingSections.length ?? 0), 0)} | ${Math.round(mean(rs.map((r) => r.structural?.summaryTokens ?? 0)))} | ${Math.round(mean(rs.map((r) => r.wall_ms ?? 0)) / 1000)} |`,
    );
  }

  lines.push("", "## Weighted retention by fixture", "");
  lines.push(
    `| fixture | ${MODELS.join(" | ")} |`,
    `|---|${MODELS.map(() => "---").join("|")}|`,
  );
  for (const f of [...new Set(ok.map((r) => r.fixture))].sort()) {
    const row = MODELS.map((m) => {
      const rs = ok.filter((r) => r.fixture === f && r.model === m);
      return rs.length
        ? pctf(mean(rs.map((r) => r.scores!.weightedRetention)))
        : "–";
    });
    lines.push(`| ${f} | ${row.join(" | ")} |`);
  }

  lines.push("", "## Probe score by fixture", "");
  lines.push(
    `| fixture | ${MODELS.join(" | ")} |`,
    `|---|${MODELS.map(() => "---").join("|")}|`,
  );
  for (const f of [...new Set(ok.map((r) => r.fixture))].sort()) {
    const row = MODELS.map((m) => {
      const rs = ok.filter((r) => r.fixture === f && r.model === m);
      return rs.length ? pctf(mean(rs.map((r) => r.scores!.probeScore))) : "–";
    });
    lines.push(`| ${f} | ${row.join(" | ")} |`);
  }

  if (errored.length) {
    lines.push("", "## Errors", "");
    for (const r of errored.slice(0, 15)) {
      lines.push(
        `- ${r.fixture} · ${r.model} · rep${r.rep}: ${r.error?.split("\n")[0]}`,
      );
    }
  }
  return lines.join("\n");
}
