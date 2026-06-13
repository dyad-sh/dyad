import { z } from "zod";

import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";

// Shared evidence model for the explore_code sub-agent. A "candidate" is one
// observed code location (a file, optionally a line range) surfaced by a
// read-only tool. The model only ever references candidates by their stable
// id, which is what keeps the final report grounded in real tool output.

export const MAX_OBSERVATION_CHARS = 12_000;
export const MAX_TOTAL_OBSERVATION_CHARS = 60_000;
export const MAX_RANGE_LINES = 120;
export const MAX_INTERNAL_CANDIDATES = 80;

const GREP_CLUSTER_GAP_LINES = 30;
const GREP_CONTEXT_LINES = 20;

export type CandidateSource = "compiler" | "grep" | "read_file" | "list_files";
export type CandidateId = `c${number}`;

export interface CandidateRange {
  start: number;
  end: number;
}

export interface CandidateTraits {
  isTest: boolean;
  isSupport: boolean;
  isGenerated: boolean;
  isDocsExample: boolean;
}

export interface ExplorerCandidate {
  id?: CandidateId;
  path: string;
  range: CandidateRange | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  score: number;
  source: CandidateSource;
  provenance: string[];
  traits: CandidateTraits;
  evidence?: string;
  observedText?: string;
}

export interface SubagentObservation {
  toolName: string;
  args: unknown;
  result: string;
  candidates: ExplorerCandidate[];
}

export const candidateIdSchema = z
  .string()
  .regex(/^c\d+$/)
  .transform((value) => value as CandidateId);

export interface CandidateRegistry {
  register(candidates: ExplorerCandidate[]): ExplorerCandidate[];
}

export function createCandidateRegistry(): CandidateRegistry {
  let nextId = 1;
  const idByKey = new Map<string, CandidateId>();
  return {
    register(candidates) {
      return candidates.map((candidate) => {
        const key = candidateKey(candidate);
        let id = idByKey.get(key);
        if (!id) {
          id = `c${nextId++}` as CandidateId;
          idByKey.set(key, id);
        }
        return { ...candidate, id };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Observation budgeting + annotation
// ---------------------------------------------------------------------------

export function totalObservationChars(
  observations: SubagentObservation[],
): number {
  return observations.reduce(
    (total, observation) => total + observation.result.length,
    0,
  );
}

export function formatObservationResult(
  result: unknown,
  observations: SubagentObservation[],
): string {
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const usedBudget = totalObservationChars(observations);
  const remainingBudget = Math.max(0, MAX_TOTAL_OBSERVATION_CHARS - usedBudget);
  const maxChars = Math.min(
    MAX_OBSERVATION_CHARS,
    remainingBudget > 0 ? remainingBudget : 0,
  );
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  const suffix = "\n[TRUNCATED]";
  if (maxChars <= suffix.length) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`;
}

// Append the observed candidate IDs (with exact quote options the model may
// copy) so the model can reference real evidence instead of inventing paths.
export function annotateObservationResult(
  result: string,
  candidates: ExplorerCandidate[],
): string {
  if (candidates.length === 0) {
    return result;
  }
  const ids = candidates
    .map((candidate) => {
      const quoteHints = getObservedQuoteHints(candidate.observedText);
      const quoteText =
        quoteHints.length > 0
          ? ` | exact source lines: ${quoteHints
              .map((hint) => `"${hint}"`)
              .join(" / ")}`
          : "";
      return `${requireCandidateId(candidate)} ${formatCandidateRef(candidate)}${quoteText}`;
    })
    .slice(0, 40);
  return `${result}\n\nObserved candidate IDs:\n${ids
    .map((entry) => `- [${entry}]`)
    .join("\n")}`;
}

// ---------------------------------------------------------------------------
// Query terms + lightweight evidence summaries
// ---------------------------------------------------------------------------

function getOrderedQueryTerms(query: string): string[] {
  return query
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

export function getQueryTerms(query: string): string[] {
  return [...new Set(getOrderedQueryTerms(query))];
}

function summarizeEvidence(
  result: string,
  queryTerms: string[],
): string | undefined {
  const lines = result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      line,
      index,
      score:
        queryTerms.reduce(
          (score, term) => score + (line.toLowerCase().includes(term) ? 2 : 0),
          0,
        ) +
        (/\b(function|class|const|return|export|async)\b/.test(line) ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map((entry) => truncate(entry.line));
  return lines.length > 0 ? lines.join("; ") : undefined;
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177)}...`;
}

// Rank observed source lines by how "quotable" they are (a real declaration or
// call site rather than a brace or comment). The report builder copies one of
// these verbatim, so the model never has to transcribe a quote itself.
export function getObservedQuoteHints(observedText?: string): string[] {
  if (!observedText) {
    return [];
  }
  const sourceLines = observedText
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\d+\s*/, "")
        .replace(/^line\s+\d+:\s*/i, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => line.length <= 180)
    .filter((line) =>
      /[{}();=]|\b(import|export|class|function|const|return|type|interface)\b/.test(
        line,
      ),
    );
  const scoredLines = sourceLines
    .map((line, index) => ({
      line,
      index,
      score:
        (/\b(export|function|class|const|type|interface)\b/.test(line)
          ? 6
          : 0) +
        (/\b(return|await|import)\b/.test(line) ? 3 : 0) +
        (/[.=]\w+\(/.test(line) ? 2 : 0),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  return [...new Set(scoredLines.map((entry) => entry.line))].slice(0, 5);
}

// Pick the single best verbatim source line for a candidate, preferring one
// whose text overlaps the supplied fact/role so the quote supports the claim.
export function bestObservedQuote(
  candidate: ExplorerCandidate,
  context: string,
): string | null {
  const hints = getObservedQuoteHints(candidate.observedText);
  if (hints.length === 0) {
    return null;
  }
  const contextTerms = getQueryTerms(context);
  if (contextTerms.length === 0) {
    return hints[0];
  }
  const ranked = [...hints]
    .map((line, index) => ({
      line,
      index,
      overlap: contextTerms.filter((term) => line.toLowerCase().includes(term))
        .length,
    }))
    .sort(
      (left, right) => right.overlap - left.overlap || left.index - right.index,
    );
  return ranked[0].line;
}

// ---------------------------------------------------------------------------
// Per-tool candidate extraction
// ---------------------------------------------------------------------------

export function candidatesFromRawExploreCodeResult(
  result: CodeExplorerResult,
): ExplorerCandidate[] {
  return result.files.flatMap((file) =>
    file.windows.map((window) =>
      buildCandidate({
        path: file.path,
        range: { start: window.startLine, end: window.endLine },
        symbols: file.symbols.map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
        })),
        source: "compiler",
        provenance: ["compiler-backed symbol window"],
        evidence: summarizeEvidence(window.lines.join("\n"), [
          ...getQueryTerms(result.query),
          ...getQueryTerms(file.path),
        ]),
        observedText: window.lines.join("\n"),
      }),
    ),
  );
}

export function candidatesFromGrepResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(
    typeof args === "object" && args && "query" in args
      ? String((args as { query?: unknown }).query ?? "")
      : "",
  );
  const refsByPath = new Map<
    string,
    Array<{ lineNumber: number; lineText: string }>
  >();
  for (const line of result.split("\n")) {
    const match = /^([^:\n]+):(\d+):/.exec(line);
    if (!match) {
      continue;
    }
    const path = match[1];
    const lineNumber = Number(match[2]);
    const lineText = line.slice(match[0].length).trim();
    const existing = refsByPath.get(path) ?? [];
    existing.push({ lineNumber, lineText });
    refsByPath.set(path, existing);
  }
  return [...refsByPath.entries()].flatMap(([path, matches]) =>
    clusterGrepMatches(matches).map((cluster) =>
      buildCandidate({
        path,
        range: grepClusterRange(cluster),
        symbols: [],
        source: "grep",
        provenance: ["targeted text match"],
        evidence: cluster
          .slice(0, 3)
          .map((item) => `line ${item.lineNumber}: ${truncate(item.lineText)}`)
          .join("; "),
        observedText: cluster
          .map((item) => `line ${item.lineNumber}: ${item.lineText}`)
          .join("\n"),
        queryTerms,
      }),
    ),
  );
}

function clusterGrepMatches(
  matches: Array<{ lineNumber: number; lineText: string }>,
): Array<Array<{ lineNumber: number; lineText: string }>> {
  const sorted = [...matches].sort((a, b) => a.lineNumber - b.lineNumber);
  const clusters: Array<Array<{ lineNumber: number; lineText: string }>> = [];
  for (const match of sorted) {
    const current = clusters.at(-1);
    const last = current?.at(-1);
    if (
      current &&
      last &&
      match.lineNumber - last.lineNumber <= GREP_CLUSTER_GAP_LINES
    ) {
      current.push(match);
    } else {
      clusters.push([match]);
    }
  }
  return clusters;
}

function grepClusterRange(
  cluster: Array<{ lineNumber: number; lineText: string }>,
): CandidateRange {
  const min = Math.min(...cluster.map((match) => match.lineNumber));
  const max = Math.max(...cluster.map((match) => match.lineNumber));
  const start = Math.max(1, min - GREP_CONTEXT_LINES);
  const paddedEnd = max + GREP_CONTEXT_LINES;
  return {
    start,
    end: Math.min(paddedEnd, start + MAX_RANGE_LINES - 1),
  };
}

export function candidatesFromReadFileResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const readArgs = parseReadFileArgs(args);
  if (!readArgs) {
    return [];
  }
  return [
    buildCandidate({
      path: readArgs.path,
      range:
        readArgs.startLine || readArgs.endLine
          ? {
              start: readArgs.startLine ?? 1,
              end: readArgs.endLine ?? readArgs.startLine ?? 1,
            }
          : null,
      symbols: [],
      source: "read_file",
      provenance: ["source range read directly by the sub-agent"],
      evidence: summarizeEvidence(result, getQueryTerms(readArgs.path)),
      observedText: result,
    }),
  ];
}

function parseReadFileArgs(
  args: unknown,
): { path: string; startLine?: number; endLine?: number } | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const maybeArgs = args as Record<string, unknown>;
  const path = maybeArgs.path;
  if (typeof path !== "string" || !path) {
    return null;
  }
  return {
    path,
    startLine:
      typeof maybeArgs.start_line_one_indexed === "number"
        ? maybeArgs.start_line_one_indexed
        : undefined,
    endLine:
      typeof maybeArgs.end_line_one_indexed_inclusive === "number"
        ? maybeArgs.end_line_one_indexed_inclusive
        : undefined,
  };
}

export function candidatesFromListFilesResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(
    typeof args === "object" && args && "directory" in args
      ? String((args as { directory?: unknown }).directory ?? "")
      : "",
  );
  return result
    .split("\n")
    .map((line) => /^\s*-\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((path): path is string => Boolean(path && !path.endsWith("/")))
    .slice(0, 40)
    .map((path) =>
      buildCandidate({
        path,
        range: null,
        symbols: [],
        source: "list_files",
        provenance: ["candidate path from directory listing"],
        queryTerms,
      }),
    );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function buildCandidate({
  path,
  range,
  symbols,
  source,
  provenance,
  evidence,
  observedText,
  queryTerms = [],
}: {
  path: string;
  range: CandidateRange | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  source: CandidateSource;
  provenance: string[];
  evidence?: string;
  observedText?: string;
  queryTerms?: string[];
}): ExplorerCandidate {
  const traits = getPathTraits(path);
  return {
    path,
    range,
    symbols,
    score: scoreCandidate({
      path,
      range,
      symbols,
      source,
      evidence,
      traits,
      queryTerms,
    }),
    source,
    provenance,
    traits,
    evidence,
    observedText,
  };
}

// Single scoring function shared by extraction and re-ranking. Higher is more
// likely to be the file the caller actually wants.
function scoreCandidate({
  path,
  range,
  symbols,
  source,
  evidence,
  traits,
  queryTerms,
}: {
  path: string;
  range: CandidateRange | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  source: CandidateSource;
  evidence?: string;
  traits: CandidateTraits;
  queryTerms: string[];
}): number {
  const rangeWidth = range ? Math.max(1, range.end - range.start + 1) : 40;
  const basenameHaystack = (path.split("/").at(-1) ?? path).toLowerCase();
  const symbolHaystack = symbols
    .map((symbol) => symbol.name)
    .join(" ")
    .toLowerCase();
  const evidenceHaystack = (evidence ?? "").toLowerCase();
  const basenameMatches = queryTerms.filter((term) =>
    basenameHaystack.includes(term),
  ).length;
  const symbolMatches = queryTerms.filter((term) =>
    symbolHaystack.includes(term),
  ).length;
  const evidenceMatches = queryTerms.filter((term) =>
    evidenceHaystack.includes(term),
  ).length;
  const sourceScore =
    source === "compiler"
      ? 60
      : source === "read_file"
        ? 45
        : source === "grep"
          ? 30
          : 5;
  const supportPenalty =
    traits.isTest || traits.isSupport || traits.isGenerated
      ? -40
      : traits.isDocsExample
        ? -40
        : 0;
  return (
    sourceScore +
    evidenceMatches * 10 +
    symbolMatches * 10 +
    basenameMatches * 6 +
    (rangeWidth <= MAX_RANGE_LINES ? 8 : -20) +
    supportPenalty
  );
}

// ---------------------------------------------------------------------------
// Ranking / dedupe / lookups
// ---------------------------------------------------------------------------

export function getRankedCandidates(
  observations: SubagentObservation[],
  query: string,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(query);
  const seen = new Map<string, ExplorerCandidate>();
  for (const candidate of observations.flatMap(
    (observation) => observation.candidates,
  )) {
    const rescored = {
      ...buildCandidate({ ...candidate, queryTerms }),
      id: candidate.id,
    };
    const key = `${rescored.path}:${formatRange(rescored.range)}`;
    const overlappingKey = findOverlappingCandidateKey(seen, rescored);
    if (overlappingKey) {
      const existing = seen.get(overlappingKey);
      if (existing && shouldReplaceOverlappingCandidate(existing, rescored)) {
        seen.delete(overlappingKey);
        seen.set(key, rescored);
      }
      continue;
    }
    const existing = seen.get(key);
    if (!existing || rescored.score > existing.score) {
      seen.set(key, rescored);
    }
  }
  const ranked = [...seen.values()].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.path.localeCompare(right.path);
  });
  return dedupeOverlappingRankedCandidates(ranked)
    .slice(0, MAX_INTERNAL_CANDIDATES)
    .map((candidate) => {
      if (!candidate.id) {
        throw new Error(
          `Ranked candidate missing stable id: ${candidate.path}`,
        );
      }
      return candidate;
    });
}

// All distinct observed candidates (deduped by stable id), used to resolve the
// IDs the model submits.
export function getObservedCandidates(
  observations: SubagentObservation[],
): ExplorerCandidate[] {
  const candidateById = new Map<CandidateId, ExplorerCandidate>();
  for (const candidate of observations.flatMap(
    (observation) => observation.candidates,
  )) {
    const id = requireCandidateId(candidate);
    if (!candidateById.has(id)) {
      candidateById.set(id, candidate);
    }
  }
  return [...candidateById.values()];
}

function dedupeOverlappingRankedCandidates(
  candidates: ExplorerCandidate[],
): ExplorerCandidate[] {
  const kept: ExplorerCandidate[] = [];
  for (const candidate of candidates) {
    const overlapsKept = kept.some(
      (existing) =>
        existing.path === candidate.path &&
        existing.range &&
        candidate.range &&
        rangesOverlap(existing.range, candidate.range),
    );
    if (!overlapsKept) {
      kept.push(candidate);
    }
  }
  return kept;
}

function findOverlappingCandidateKey(
  seen: Map<string, ExplorerCandidate>,
  candidate: ExplorerCandidate,
): string | null {
  if (!candidate.range) {
    return null;
  }
  for (const [key, existing] of seen) {
    if (
      existing.path === candidate.path &&
      existing.range &&
      rangesOverlap(existing.range, candidate.range)
    ) {
      return key;
    }
  }
  return null;
}

function shouldReplaceOverlappingCandidate(
  existing: ExplorerCandidate,
  candidate: ExplorerCandidate,
): boolean {
  if (candidate.score !== existing.score) {
    return candidate.score > existing.score;
  }
  return rangeWidth(candidate.range) < rangeWidth(existing.range);
}

function rangesOverlap(left: CandidateRange, right: CandidateRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function rangeWidth(range: CandidateRange | null): number {
  return range
    ? Math.max(1, range.end - range.start + 1)
    : Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// Reference formatting
// ---------------------------------------------------------------------------

export function requireCandidateId(candidate: ExplorerCandidate): CandidateId {
  if (!candidate.id) {
    throw new Error(`Candidate missing id: ${candidate.path}`);
  }
  return candidate.id;
}

function candidateKey(candidate: ExplorerCandidate): string {
  return `${candidate.path}:${formatRange(candidate.range)}:${candidate.source}`;
}

export function formatCandidateRef(candidate: ExplorerCandidate): string {
  const range = formatRange(candidate.range);
  return range ? `${candidate.path}:${range}` : candidate.path;
}

export function formatRange(range: CandidateRange | null): string {
  return range ? `${range.start}-${range.end}` : "unknown";
}

export function clampRangeForReport(
  range: CandidateRange | null,
): CandidateRange | null {
  if (!range) {
    return null;
  }
  const start = Math.max(1, range.start);
  const end = Math.max(start, range.end);
  if (end - start + 1 <= MAX_RANGE_LINES) {
    return { start, end };
  }
  return { start, end: start + MAX_RANGE_LINES - 1 };
}

export function clampCandidateRange(
  candidate: ExplorerCandidate,
): ExplorerCandidate {
  return { ...candidate, range: clampRangeForReport(candidate.range) };
}

// ---------------------------------------------------------------------------
// Path traits (generic web-app shape signals; deliberately not query-specific)
// ---------------------------------------------------------------------------

function getPathTraits(path: string): CandidateTraits {
  const normalized = path.toLowerCase();
  return {
    isTest: isTestPath(normalized),
    isSupport: isSupportPath(normalized),
    isGenerated: isGeneratedPath(normalized),
    isDocsExample: isDocsExamplePath(normalized),
  };
}

function isTestPath(path: string): boolean {
  return (
    /\.(test|spec|e2e)\.[tj]sx?$/.test(path) ||
    path.includes("/__tests__/") ||
    path.includes("/test/") ||
    path.includes("/tests/") ||
    path.includes("/e2e/")
  );
}

function isSupportPath(path: string): boolean {
  return (
    path.includes("/__snapshots__/") ||
    path.includes("/fixtures/") ||
    path.includes("/help/") ||
    path.includes("/mocks/") ||
    path.includes("/__mocks__/") ||
    path.includes("/playwright/") ||
    path.includes("/testing/") ||
    path.includes(".stories.") ||
    path.includes("/__stories__/")
  );
}

function isGeneratedPath(path: string): boolean {
  return (
    path.includes("/generated/") ||
    path.includes("/generated-") ||
    path.includes("/generated_") ||
    path.includes("codegen")
  );
}

function isDocsExamplePath(path: string): boolean {
  return (
    path.startsWith("examples/") ||
    path.startsWith("example/") ||
    path.includes("/examples/") ||
    path.includes("/docs/") ||
    path.startsWith("docs/")
  );
}
