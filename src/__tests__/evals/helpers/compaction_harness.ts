/**
 * Compaction-benchmark harness (plans/benchmark-compaction.md).
 *
 * Runs the PRODUCTION compaction surface — COMPACTION_SYSTEM_PROMPT over a
 * formatAsTranscript() transcript — against candidate models, then scores the
 * resulting summary three ways:
 *   1. structural checks (sections, mechanical file-path hallucination check)
 *   2. fact-grid judging against the fixture's ground-truth manifest
 *   3. downstream continuation probes answered from the summary alone
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { generateText, type LanguageModel } from "./pi_eval_compat";

import { COMPACTION_SYSTEM_PROMPT } from "@/prompts/compaction_system_prompt";
import {
  formatAsTranscript,
  type CompactionMessage,
} from "@/ipc/handlers/compaction/compaction_storage";
import { estimateTokens } from "@/ipc/utils/token_utils";

// ── Fixture types ──────────────────────────────────────────────

export interface FixtureFact {
  id: string;
  tier: 1 | 2 | 3;
  category: string;
  statement: string;
  evidence: string;
}

export interface FixtureTrap {
  id: string;
  statement: string;
  supersededEvidence: string;
  oldPhase: string;
  currentEvidence: string;
  newPhase: string;
}

export interface FixtureProbe {
  id: string;
  question: string;
  expected: string;
}

export interface CompactionFixture {
  name: string;
  domain: string;
  facts: FixtureFact[];
  traps: FixtureTrap[];
  probes: FixtureProbe[];
  messages: CompactionMessage[];
}

const FIXTURES_DIR = resolve(__dirname, "../fixtures/compaction");
const SPECS_DIR = resolve(FIXTURES_DIR, "specs");

/**
 * Authoring spec for generate.mjs (see AUTHORING.md). Loosely typed on
 * purpose — validateSpec() reports shape problems as readable errors instead
 * of letting a parse-level type mismatch throw.
 */
export interface CompactionSpec {
  name?: string;
  domain?: string;
  phases?: {
    id?: string;
    goal?: string;
    turns?: number;
    factIds?: string[];
    bulk?: { asset?: string; path?: string; count?: number }[];
  }[];
  facts?: Partial<FixtureFact>[];
  traps?: Partial<FixtureTrap>[];
  probes?: Partial<FixtureProbe>[];
}

export function loadSpecs(): { file: string; spec: CompactionSpec }[] {
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".spec.json"));
  return files
    .map((file) => ({
      file,
      spec: JSON.parse(
        readFileSync(resolve(SPECS_DIR, file), "utf-8"),
      ) as CompactionSpec,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Keyless validation of a committed authoring spec — the checks generate.mjs
 * enforces at generation time, plus the AUTHORING.md contract, so CI catches
 * broken specs even though the generated transcripts themselves are
 * gitignored.
 */
export function validateSpec(file: string, spec: CompactionSpec): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  if (spec.name !== file.replace(/\.spec\.json$/, ""))
    err(`name "${spec.name}" does not match filename ${file}`);
  if (!spec.domain?.trim()) err("missing domain");

  const phases = spec.phases ?? [];
  const facts = spec.facts ?? [];
  const traps = spec.traps ?? [];
  const probes = spec.probes ?? [];
  if (phases.length === 0) err("no phases");
  if (facts.length < 8) err(`expected >=8 facts, got ${facts.length}`);
  if (probes.length !== 3)
    err(`expected exactly 3 probes, got ${probes.length}`);
  if (traps.length < 1) err("expected at least 1 trap");

  const phaseIds = new Set(phases.map((p) => p.id));
  const factIds = new Set<string>();
  for (const f of facts) {
    if (!f.id) {
      err("fact missing id");
      continue;
    }
    if (factIds.has(f.id)) err(`duplicate fact id ${f.id}`);
    factIds.add(f.id);
    if (![1, 2, 3].includes(f.tier as number))
      err(`${f.id}: bad tier ${f.tier}`);
    if (!f.statement?.trim()) err(`${f.id}: missing statement`);
    // Evidence is matched verbatim by the generator and by fixture
    // validation, so it must be printable ASCII (AUTHORING.md).
    if (!f.evidence?.trim()) err(`${f.id}: missing evidence`);
    else if (!/^[\x20-\x7E]+$/.test(f.evidence))
      err(`${f.id}: evidence contains non-ASCII/control characters`);
  }

  const plantedFactIds = new Set(phases.flatMap((p) => p.factIds ?? []));
  for (const id of plantedFactIds) {
    if (!factIds.has(id)) err(`phase references unknown fact ${id}`);
  }
  for (const id of factIds) {
    if (!plantedFactIds.has(id)) err(`fact ${id} not assigned to any phase`);
  }

  for (const t of traps) {
    if (!t.id) {
      err("trap missing id");
      continue;
    }
    if (!t.statement?.trim()) err(`${t.id}: missing statement`);
    for (const [key, phase] of [
      ["oldPhase", t.oldPhase],
      ["newPhase", t.newPhase],
    ] as const) {
      if (!phase || !phaseIds.has(phase))
        err(`${t.id}: ${key} "${phase}" is not a phase id`);
    }
    for (const [key, ev] of [
      ["supersededEvidence", t.supersededEvidence],
      ["currentEvidence", t.currentEvidence],
    ] as const) {
      if (!ev?.trim()) err(`${t.id}: missing ${key}`);
      else if (!/^[\x20-\x7E]+$/.test(ev))
        err(`${t.id}: ${key} contains non-ASCII/control characters`);
    }
  }

  for (const p of probes) {
    if (!p.id) err("probe missing id");
    if (!p.question?.trim()) err(`${p.id}: missing question`);
    if (!p.expected?.trim()) err(`${p.id}: missing expected`);
  }

  // The size amplifier (fillerCycle in generate.mjs) needs bulk assets to
  // reach the token band.
  const bulks = phases.flatMap((p) => p.bulk ?? []);
  if (bulks.length < 1) err("no bulk assets — amplification cannot run");

  return errors;
}

export function loadFixtures(): CompactionFixture[] {
  const files = readdirSync(FIXTURES_DIR).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".stats.json"),
  );
  return files
    .map(
      (f) =>
        JSON.parse(
          readFileSync(resolve(FIXTURES_DIR, f), "utf-8"),
        ) as CompactionFixture,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fixtureTranscript(fixture: CompactionFixture): string {
  // chatId is only embedded in the transcript header; constant is fine.
  return formatAsTranscript(fixture.messages, 1);
}

/** Structural sanity of a fixture — run as a plain test, no API key needed. */
export function validateFixture(fixture: CompactionFixture): string[] {
  const errors: string[] = [];
  const transcript = fixtureTranscript(fixture);
  const tokens = estimateTokens(transcript);
  if (tokens < 150_000 || tokens > 220_000)
    errors.push(`est transcript tokens ${tokens} outside [150k, 220k]`);
  for (const f of fixture.facts) {
    if (![1, 2, 3].includes(f.tier)) errors.push(`${f.id}: bad tier ${f.tier}`);
    if (!transcript.includes(f.evidence))
      errors.push(`${f.id}: evidence not found in transcript`);
  }
  for (const t of fixture.traps) {
    if (!transcript.includes(t.supersededEvidence))
      errors.push(`${t.id}: superseded evidence not in transcript`);
    if (!transcript.includes(t.currentEvidence))
      errors.push(`${t.id}: current evidence not in transcript`);
  }
  if (fixture.probes.length !== 3)
    errors.push(`expected 3 probes, got ${fixture.probes.length}`);
  if (fixture.facts.length < 8)
    errors.push(`expected >=8 facts, got ${fixture.facts.length}`);
  return errors;
}

// ── 1. Summary generation (the model under test) ───────────────

export interface SummaryRun {
  summary: string;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
}

export async function runCompaction(opts: {
  model: LanguageModel;
  fixture: CompactionFixture;
}): Promise<SummaryRun> {
  const transcript = fixtureTranscript(opts.fixture);
  const start = Date.now();
  // Mirrors compaction_handler.ts: COMPACTION_SYSTEM_PROMPT + this exact
  // user-message framing.
  const result = await generateText({
    model: opts.model,
    system: COMPACTION_SYSTEM_PROMPT,
    prompt: `Please summarize the following conversation:\n\n${transcript}`,
    maxRetries: 2,
  });
  return {
    summary: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    wallMs: Date.now() - start,
  };
}

// ── 2. Structural checks ───────────────────────────────────────

export interface StructuralResult {
  missingSections: string[];
  pathsInSummary: number;
  hallucinatedPaths: string[];
  summaryTokens: number;
}

const REQUIRED_SECTIONS = [
  "## Key Decisions Made",
  "## Code Changes Completed",
  "## Current Task State",
];

export function structuralChecks(
  summary: string,
  transcript: string,
): StructuralResult {
  const missingSections = REQUIRED_SECTIONS.filter((s) => !summary.includes(s));
  // Multi-segment paths with a file extension, e.g. src/lib/store.ts.
  const pathRe = /\b[\w.-]+(?:\/[\w.-]+)+\.[a-z]{1,5}\b/g;
  const paths = [...new Set(summary.match(pathRe) ?? [])];
  const hallucinatedPaths = paths.filter((p) => !transcript.includes(p));
  return {
    missingSections,
    pathsInSummary: paths.length,
    hallucinatedPaths,
    summaryTokens: estimateTokens(summary),
  };
}

// ── 3. Fact-grid judging ───────────────────────────────────────

export type FactVerdict = "preserved" | "partial" | "absent" | "contradicted";
export type TrapVerdict = "correct" | "missing" | "contradicted";

export interface FactGridResult {
  facts: { id: string; verdict: FactVerdict; reason: string }[];
  traps: { id: string; verdict: TrapVerdict; reason: string }[];
}

const FACT_JUDGE_SYSTEM = `You grade whether a summary of a long AI-coding conversation preserved specific ground-truth items. You see ONLY the summary and the items — judge strictly on what the summary itself conveys to a reader who has no other context.

For each FACT, verdict is one of:
- "preserved": the summary conveys the fact's substance (exact wording not required; exact file paths, error strings, and identifiers ARE required when the fact hinges on them)
- "partial": recognizably present but missing a load-bearing detail
- "absent": not conveyed
- "contradicted": the summary asserts something incompatible with the fact

For each TRAP (a superseded/abandoned direction), verdict is one of:
- "correct": summary either presents the old direction explicitly as superseded/abandoned/ruled-out, or omits it entirely while the current direction is presented correctly
- "missing": summary omits BOTH the old and the current direction
- "contradicted": summary presents the old/abandoned direction as if it were current or still true

Output STRICT JSON, no markdown fences:
{"facts":[{"id":"F1","verdict":"preserved","reason":"<=20 words"}],"traps":[{"id":"T1","verdict":"correct","reason":"<=20 words"}]}
Include every fact and trap id exactly once.`;

export async function judgeFactGrid(opts: {
  judgeModel: LanguageModel;
  fixture: CompactionFixture;
  summary: string;
}): Promise<FactGridResult> {
  const factsBlock = opts.fixture.facts
    .map((f) => `${f.id} [${f.category}, tier ${f.tier}]: ${f.statement}`)
    .join("\n");
  const trapsBlock = opts.fixture.traps
    .map((t) => `${t.id}: ${t.statement}`)
    .join("\n");
  const user = `SUMMARY UNDER TEST:\n${opts.summary}\n\nFACTS:\n${factsBlock}\n\nTRAPS:\n${trapsBlock || "(none)"}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateText({
      model: opts.judgeModel,
      system: FACT_JUDGE_SYSTEM,
      prompt: user,
      maxRetries: 2,
    });
    try {
      const parsed = parseJsonLoose(result.text) as FactGridResult;
      const gotFacts = new Set((parsed.facts ?? []).map((f) => f.id));
      const gotTraps = new Set((parsed.traps ?? []).map((t) => t.id));
      const missing = [
        ...opts.fixture.facts.filter((f) => !gotFacts.has(f.id)),
        ...opts.fixture.traps.filter((t) => !gotTraps.has(t.id)),
      ];
      if (missing.length > 0)
        throw new Error(
          `judge omitted ids: ${missing.map((m) => m.id).join(",")}`,
        );
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`fact-grid judge failed after 3 attempts: ${lastErr}`);
}

// ── 4. Downstream continuation probes ──────────────────────────

export type ProbeVerdict = "correct" | "partial" | "incorrect";

export interface ProbeResult {
  id: string;
  answer: string;
  verdict: ProbeVerdict;
  reason: string;
}

const PROBE_SYSTEM = `You are an AI coding agent resuming a long pair-programming session that was compacted. The summary below is your ONLY memory of the session — you cannot see the original conversation or the codebase. Answer the user's question from the summary alone, concretely and briefly. If the summary genuinely does not contain the answer, say exactly what is missing instead of guessing.`;

const PROBE_JUDGE_SYSTEM = `You grade an answer that was produced using only a conversation summary. Compare the answer to the expected ground truth. Verdicts:
- "correct": the answer's substance matches the expected content (extra correct detail is fine)
- "partial": on the right track but missing or muddling a load-bearing element
- "incorrect": wrong, fabricated, or the answer says the information is unavailable when it was expected to be preserved

Output STRICT JSON, no fences: {"verdict":"correct","reason":"<=25 words"}`;

export async function runProbes(opts: {
  probeModel: LanguageModel;
  judgeModel: LanguageModel;
  fixture: CompactionFixture;
  summary: string;
}): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const probe of opts.fixture.probes) {
    const answerRes = await generateText({
      model: opts.probeModel,
      system: PROBE_SYSTEM,
      prompt: `SESSION SUMMARY:\n${opts.summary}\n\nUSER QUESTION: ${probe.question}`,
      maxRetries: 2,
    });
    const answer = answerRes.text;
    let verdict: ProbeVerdict = "incorrect";
    let reason = "judge unparseable";
    for (let attempt = 0; attempt < 3; attempt++) {
      const judged = await generateText({
        model: opts.judgeModel,
        system: PROBE_JUDGE_SYSTEM,
        prompt: `QUESTION: ${probe.question}\n\nEXPECTED: ${probe.expected}\n\nANSWER UNDER TEST:\n${answer}`,
        maxRetries: 2,
      });
      try {
        const parsed = parseJsonLoose(judged.text) as {
          verdict: ProbeVerdict;
          reason: string;
        };
        if (!["correct", "partial", "incorrect"].includes(parsed.verdict))
          throw new Error(`bad verdict ${parsed.verdict}`);
        verdict = parsed.verdict;
        reason = parsed.reason;
        break;
      } catch {
        // retry
      }
    }
    results.push({ id: probe.id, answer, verdict, reason });
  }
  return results;
}

// ── Scoring ────────────────────────────────────────────────────

const TIER_WEIGHT: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const VERDICT_CREDIT: Record<FactVerdict, number> = {
  preserved: 1,
  partial: 0.5,
  absent: 0,
  contradicted: 0,
};

export interface Scores {
  weightedRetention: number; // 0..1
  tier1Retention: number; // 0..1, tier-1 facts only
  contradictedFacts: number;
  trapContradictions: number;
  trapMisses: number;
  probeScore: number; // 0..1 (correct=1, partial=0.5)
}

export function computeScores(
  fixture: CompactionFixture,
  grid: FactGridResult,
  probes: ProbeResult[],
): Scores {
  const byId = new Map(grid.facts.map((f) => [f.id, f.verdict]));
  let num = 0;
  let den = 0;
  let t1num = 0;
  let t1den = 0;
  for (const f of fixture.facts) {
    const w = TIER_WEIGHT[f.tier] ?? 1;
    const credit = VERDICT_CREDIT[byId.get(f.id) ?? "absent"] ?? 0;
    num += w * credit;
    den += w;
    if (f.tier === 1) {
      t1num += credit;
      t1den += 1;
    }
  }
  const probeCredit: Record<ProbeVerdict, number> = {
    correct: 1,
    partial: 0.5,
    incorrect: 0,
  };
  return {
    weightedRetention: den ? num / den : 0,
    tier1Retention: t1den ? t1num / t1den : 0,
    contradictedFacts: grid.facts.filter((f) => f.verdict === "contradicted")
      .length,
    trapContradictions: grid.traps.filter((t) => t.verdict === "contradicted")
      .length,
    trapMisses: grid.traps.filter((t) => t.verdict === "missing").length,
    probeScore: probes.length
      ? probes.reduce((a, p) => a + probeCredit[p.verdict], 0) / probes.length
      : 0,
  };
}

// ── util ───────────────────────────────────────────────────────

export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf("}");
  if (end >= 0) t = t.slice(0, end + 1);
  return JSON.parse(t);
}
