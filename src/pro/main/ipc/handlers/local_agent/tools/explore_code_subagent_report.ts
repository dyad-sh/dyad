import { z } from "zod";

import {
  bestObservedQuote,
  candidateIdSchema,
  clampCandidateRange,
  clampRangeForReport,
  formatCandidateRef,
  formatRange,
  getQueryTerms,
  requireCandidateId,
  type CandidateId,
  type ExplorerCandidate,
  type SubagentObservation,
} from "./explore_code_subagent_candidates";
import { getRankedCandidates } from "./explore_code_subagent_candidates";

export type ExploreIntent = "explain" | "locate" | "edit" | "debug";
export type ReportAction =
  | "answer_from_report"
  | "read_targets"
  | "targeted_gap_search"
  | "skip_explore_result";
export type Confidence = "high" | "medium" | "low";

export const MAX_PRIMARY_FILES = 5;
export const MAX_READ_TARGETS = 8;
const MAX_FLOW_LINKS_INPUT = 12;
const MAX_RENDERED_FLOW_LINKS = 4;
const MAX_MACHINE_PATHS = 8;
const MAX_SEARCH_TARGETS = 5;
const MAX_REPORT_CHARS = 8_000;
const MAX_ROLE_CHARS = 40;
const MAX_FACT_CHARS = 120;
const MAX_PURPOSE_CHARS = 64;
const MAX_REPORT_QUERY_CHARS = 110;
const MAX_REPORT_MISSING_CHARS = 220;
const MAX_REPORT_SEARCH_TARGET_CHARS = 140;

// What the model submits. It only points at observed candidate IDs and supplies
// the narrative (role/fact). It does NOT supply quotes (the report builder
// excerpts those from observed source), nor the action/confidence (those are
// derived from the surviving evidence by deriveOutcome).
export const submitReportSchema = z.object({
  primaryCandidateIds: z.array(candidateIdSchema).max(MAX_PRIMARY_FILES),
  flow: z
    .array(
      z.object({
        candidateId: candidateIdSchema,
        role: z
          .string()
          .max(MAX_ROLE_CHARS)
          .describe(
            "Open role label for this step, e.g. entry, UI, handler, state, data/API, persistence, render/output, type, or test.",
          ),
        fact: z
          .string()
          .max(MAX_FACT_CHARS)
          .describe("What this candidate does, tied to the caller's query."),
      }),
    )
    .max(MAX_FLOW_LINKS_INPUT),
  readTargets: z
    .array(
      z.object({
        candidateId: candidateIdSchema,
        purpose: z.string().max(MAX_PURPOSE_CHARS),
      }),
    )
    .max(MAX_READ_TARGETS)
    .optional(),
  missingCoverage: z.array(z.string().max(180)).max(3).optional(),
  searchSuggestions: z
    .array(
      z.object({
        identifier: z
          .string()
          .min(2)
          .max(80)
          .describe("Exact observed identifier or path to search for."),
        scope: z
          .string()
          .min(2)
          .max(120)
          .describe("Glob to search within, e.g. src/**/*.{ts,tsx}"),
      }),
    )
    .max(MAX_SEARCH_TARGETS)
    .optional(),
});

export type ExploreSelection = z.infer<typeof submitReportSchema>;

export interface ResolvedFlowLink {
  candidate: ExplorerCandidate;
  role: string;
  fact: string;
  quote: string;
}

export interface ResolvedReadTarget {
  candidate: ExplorerCandidate;
  purpose: string;
}

export interface ResolvedSelection {
  primary: ExplorerCandidate[];
  flow: ResolvedFlowLink[];
  readTargets: ResolvedReadTarget[];
  missingCoverage: string[];
  searchTargets: string[];
  droppedReasons: string[];
}

export interface Outcome {
  action: ReportAction;
  confidence: Confidence;
}

// Resolve the model's candidate IDs against observed evidence. Hallucinated IDs
// are dropped; quotes are excerpted from observed source so they cannot be
// fabricated. Returns null when the model referenced only unknown IDs (so the
// caller can fall back to a deterministic report instead of rendering nothing).
export function resolveSelection({
  selection,
  candidates,
}: {
  selection: ExploreSelection;
  candidates: ExplorerCandidate[];
}): ResolvedSelection | null {
  const candidateById = new Map(
    candidates.map((candidate) => [requireCandidateId(candidate), candidate]),
  );
  const droppedReasons: string[] = [];

  const primary = resolveCandidateIds(
    selection.primaryCandidateIds,
    candidateById,
  ).slice(0, MAX_PRIMARY_FILES);

  const flow = dedupeFlowByRange(
    (selection.flow ?? [])
      .map((link): ResolvedFlowLink | null => {
        const candidate = candidateById.get(link.candidateId);
        if (!candidate) {
          droppedReasons.push(`flow_unknown:${link.candidateId}`);
          return null;
        }
        const quote = bestObservedQuote(candidate, `${link.role} ${link.fact}`);
        if (!quote) {
          droppedReasons.push(`flow_no_quote:${link.candidateId}`);
          return null;
        }
        return { candidate, role: link.role, fact: link.fact, quote };
      })
      .filter((link): link is ResolvedFlowLink => link !== null),
    droppedReasons,
  );

  const readTargets = (selection.readTargets ?? [])
    .map((target): ResolvedReadTarget | null => {
      const candidate = candidateById.get(target.candidateId);
      if (!candidate || !candidate.range) {
        droppedReasons.push(`read_target_unranged:${target.candidateId}`);
        return null;
      }
      return { candidate, purpose: target.purpose };
    })
    .filter((target): target is ResolvedReadTarget => target !== null)
    .slice(0, MAX_READ_TARGETS);

  const searchTargets = (selection.searchSuggestions ?? [])
    .map((suggestion) => renderSearchSuggestion(suggestion))
    .filter((target): target is string => target !== null)
    .slice(0, MAX_SEARCH_TARGETS);
  if ((selection.searchSuggestions ?? []).length > searchTargets.length) {
    droppedReasons.push("search_suggestion_invalid");
  }

  const referencedAnything =
    selection.primaryCandidateIds.length > 0 ||
    (selection.flow ?? []).length > 0 ||
    (selection.readTargets ?? []).length > 0;
  const resolvedAnything =
    primary.length > 0 ||
    flow.length > 0 ||
    readTargets.length > 0 ||
    searchTargets.length > 0;
  // The model pointed at candidates, but every one was hallucinated. Fall back.
  if (referencedAnything && !resolvedAnything) {
    return null;
  }

  return {
    primary,
    flow,
    readTargets,
    missingCoverage: (selection.missingCoverage ?? []).slice(0, 3),
    searchTargets,
    droppedReasons,
  };
}

// Derive the action + confidence from surviving evidence in a single pass. This
// replaces the old multi-stage rewrite cascade: every invariant it enforced
// (edit/debug needs ranges, answer needs flow, gap-search needs targets, skip
// means empty) is true by construction here.
export function deriveOutcome(
  intent: ExploreIntent,
  resolved: ResolvedSelection,
): Outcome {
  const hasFlow = resolved.flow.length > 0;
  const rangedTargets = effectiveReadTargets(resolved);
  const hasRanged = rangedTargets.length > 0;
  const hasSuggestions = resolved.searchTargets.length > 0;
  const hasEvidence = hasFlow || resolved.primary.length > 0 || hasRanged;

  if (!hasEvidence) {
    return hasSuggestions
      ? { action: "targeted_gap_search", confidence: "low" }
      : { action: "skip_explore_result", confidence: "low" };
  }

  if (intent === "edit" || intent === "debug") {
    if (hasRanged) {
      return {
        action: "read_targets",
        confidence: confidenceFor(resolved, hasFlow),
      };
    }
    if (hasSuggestions) {
      return { action: "targeted_gap_search", confidence: "low" };
    }
    return { action: "answer_from_report", confidence: "low" };
  }

  // explain | locate
  if (!hasFlow && resolved.missingCoverage.length > 0 && hasSuggestions) {
    return { action: "targeted_gap_search", confidence: "medium" };
  }
  if (hasFlow) {
    return {
      action: "answer_from_report",
      confidence: confidenceFor(resolved, true),
    };
  }
  if (hasRanged) {
    return { action: "read_targets", confidence: "low" };
  }
  if (hasSuggestions) {
    return { action: "targeted_gap_search", confidence: "low" };
  }
  return { action: "skip_explore_result", confidence: "low" };
}

// Single sufficiency bounce: an explain trace that surfaced no
// implementation-site evidence (a ranged, non-support candidate in the flow)
// should keep exploring rather than answer from adjacent surfaces. Returns a
// short instruction when the gap applies, else null. Used at most once.
export function getExplainSufficiencyGap(
  intent: ExploreIntent,
  resolved: ResolvedSelection,
): string | null {
  if (intent !== "explain") {
    return null;
  }
  const hasImplementationSite = resolved.flow.some(
    (link) =>
      link.candidate.range &&
      !link.candidate.traits.isTest &&
      !link.candidate.traits.isSupport,
  );
  if (hasImplementationSite) {
    return null;
  }
  return "This explain trace has no implementation-site evidence yet. Explore the call sites, handler, or returned/rendered output that produces the requested behavior, then call submit_report again.";
}

function confidenceFor(
  resolved: ResolvedSelection,
  hasFlow: boolean,
): Confidence {
  if (!hasFlow) {
    return "medium";
  }
  const blemished =
    resolved.missingCoverage.length > 0 || resolved.droppedReasons.length > 0;
  return blemished ? "medium" : "high";
}

function effectiveReadTargets(
  resolved: ResolvedSelection,
): ResolvedReadTarget[] {
  if (resolved.readTargets.length > 0) {
    return resolved.readTargets;
  }
  // Fall back to ranged flow candidates so edit/debug always has somewhere to read.
  return resolved.flow
    .filter((link) => link.candidate.range)
    .map((link) => ({ candidate: link.candidate, purpose: link.role }));
}

function resolveCandidateIds(
  ids: CandidateId[],
  candidateById: Map<CandidateId, ExplorerCandidate>,
): ExplorerCandidate[] {
  const resolved: ExplorerCandidate[] = [];
  const seen = new Set<CandidateId>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    const candidate = candidateById.get(id);
    if (!candidate) {
      continue;
    }
    seen.add(id);
    resolved.push(candidate);
  }
  return resolved;
}

function dedupeFlowByRange(
  flow: ResolvedFlowLink[],
  droppedReasons: string[],
): ResolvedFlowLink[] {
  const seen = new Set<string>();
  const kept: ResolvedFlowLink[] = [];
  for (const link of flow) {
    const key = `${link.candidate.path}:${formatRange(link.candidate.range)}`;
    if (seen.has(key)) {
      droppedReasons.push(
        `flow_duplicate_range:${requireCandidateId(link.candidate)}`,
      );
      continue;
    }
    seen.add(key);
    kept.push(link);
  }
  return kept;
}

function renderSearchSuggestion(suggestion: {
  identifier: string;
  scope: string;
}): string | null {
  const identifier = suggestion.identifier.trim();
  const scope = suggestion.scope.trim();
  if (!identifier || /\s/.test(scope)) {
    return null;
  }
  const looksLikeGlob = scope.includes("/") || scope.includes("*");
  const targetsCode = /(?:\.[jt]sx?$|\{[^}]*[jt]sx?[^}]*\})/.test(scope);
  if (!looksLikeGlob || !targetsCode) {
    return null;
  }
  return `query="${identifier}" include="${scope}" literal=true`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RenderedFlowLink extends ResolvedFlowLink {
  ref: string;
}

export function buildReport({
  query,
  intent,
  resolved,
  outcome,
}: {
  query: string;
  intent: ExploreIntent;
  resolved: ResolvedSelection;
  outcome: Outcome;
}): { text: string; machine: ReportMachine } {
  const renderedFlow = getRenderedFlowLinks(resolved.flow);
  const renderedPathSet = new Set<string>();
  const lines: string[] = [
    "## explore_code report",
    `Query: "${truncateInline(query, MAX_REPORT_QUERY_CHARS)}" | Intent: ${intent} | Confidence: ${outcome.confidence} | Action: ${outcome.action}`,
    "",
    "Flow:",
  ];
  if (renderedFlow.length === 0) {
    lines.push("none");
  } else {
    renderedFlow.forEach((link, index) => {
      renderedPathSet.add(link.candidate.path);
      lines.push(
        `${index + 1}. ${link.ref} (${truncateInline(link.role, MAX_ROLE_CHARS)}) - ${truncateInline(link.fact, MAX_FACT_CHARS)}`,
        `> ${link.quote}`,
      );
    });
  }
  lines.push("");

  if (
    outcome.action === "answer_from_report" &&
    resolved.missingCoverage.length === 0
  ) {
    lines.push("Missing: none");
  } else {
    const missingText =
      outcome.action === "skip_explore_result"
        ? "explorer found nothing relevant; proceed without it"
        : resolved.missingCoverage.length > 0
          ? resolved.missingCoverage.join("; ")
          : "none";
    lines.push(
      `Missing: ${truncateInline(missingText, MAX_REPORT_MISSING_CHARS)}`,
    );
  }

  const renderedReadTargets =
    outcome.action === "read_targets" ? effectiveReadTargets(resolved) : [];
  if (renderedReadTargets.length > 0) {
    const flowIndexByPath = new Map(
      renderedFlow.map((link, index) => [link.candidate.path, index + 1]),
    );
    lines.push(
      "Read targets:",
      ...renderedReadTargets.map((target) => {
        const flowIndex = flowIndexByPath.get(target.candidate.path);
        if (flowIndex) {
          return `flow ${flowIndex} - ${truncateInline(target.purpose, MAX_PURPOSE_CHARS)}`;
        }
        renderedPathSet.add(target.candidate.path);
        return `${formatCandidateRef(clampCandidateRange(target.candidate))} - ${truncateInline(target.purpose, MAX_PURPOSE_CHARS)}`;
      }),
    );
  }

  const machinePathCandidates = getMachinePathCandidates({
    primary: resolved.primary,
    flow: resolved.flow,
    readTargets: renderedReadTargets,
  });

  if (
    outcome.action === "targeted_gap_search" &&
    resolved.searchTargets.length > 0
  ) {
    const searchTargetRefs = buildSearchTargetRefs(renderedFlow);
    const searchTargets = resolved.searchTargets.map((target) =>
      truncateInline(
        renderSearchTarget(target, searchTargetRefs),
        MAX_REPORT_SEARCH_TARGET_CHARS,
      ),
    );
    for (const candidate of machinePathCandidates) {
      if (searchTargets.some((target) => target.includes(candidate.path))) {
        renderedPathSet.add(candidate.path);
      }
    }
    lines.push("Search targets:", ...searchTargets);
  }

  const remainingPathCandidates = machinePathCandidates.filter(
    (candidate) => !renderedPathSet.has(candidate.path),
  );
  if (remainingPathCandidates.length > 0) {
    lines.push(
      "Paths:",
      ...remainingPathCandidates.map((candidate) =>
        formatCandidateRef(clampCandidateRange(candidate)),
      ),
    );
  }

  const machine: ReportMachine = {
    action: outcome.action,
    confidence: outcome.confidence,
    paths: machinePathCandidates.map((candidate) => ({
      path: candidate.path,
      range: formatRange(clampRangeForReport(candidate.range)),
    })),
  };
  lines.push("", "```json", JSON.stringify(machine), "```");
  return { text: clampReportLength(lines.join("\n")), machine };
}

export interface ReportMachine {
  action: ReportAction;
  confidence: Confidence;
  paths: Array<{ path: string; range: string }>;
}

// Deterministic fallback when the model never produced a usable selection
// (e.g. it stopped early, or referenced only hallucinated IDs). Keeps the same
// external shape so the parent + cache parse it identically.
export function buildDeterministicReport({
  query,
  intent,
  observations,
}: {
  query: string;
  intent: ExploreIntent;
  observations: SubagentObservation[];
}): string {
  const candidates = getRankedCandidates(observations, query);
  const primary = candidates.slice(0, MAX_PRIMARY_FILES);
  const readTargets = primary.filter((candidate) => candidate.range);
  const action: ReportAction =
    readTargets.length > 0 ? "read_targets" : "targeted_gap_search";
  const machine: ReportMachine = {
    action,
    confidence: "low",
    paths: primary.map((candidate) => ({
      path: candidate.path,
      range: formatRange(clampRangeForReport(candidate.range)),
    })),
  };
  const searchTargets =
    action === "targeted_gap_search" ? getQueryTerms(query) : [];
  const toolNames =
    [...new Set(observations.map((observation) => observation.toolName))].join(
      ", ",
    ) || "none";
  return clampReportLength(
    [
      "## explore_code report",
      `Query: "${query}" | Intent: ${intent} | Confidence: low | Action: ${action}`,
      "",
      "Flow:",
      primary.length > 0
        ? primary
            .map(
              (candidate, index) =>
                `${index + 1}. ${formatCandidateRef(clampCandidateRange(candidate))} (observed) - ${candidate.provenance.join("; ")}`,
            )
            .join("\n")
        : "none",
      "",
      `Missing: ${
        primary.length > 0
          ? "submit_report was not called"
          : `no relevant candidates; tools used: ${toolNames}`
      }`,
      readTargets.length > 0
        ? [
            "Read targets:",
            ...readTargets.map(
              (candidate) =>
                `flow ${primary.indexOf(candidate) + 1} - observed fallback target`,
            ),
          ].join("\n")
        : "",
      searchTargets.length > 0
        ? ["Search targets:", ...searchTargets].join("\n")
        : "",
      "",
      "```json",
      JSON.stringify(machine),
      "```",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

function getRenderedFlowLinks(flow: ResolvedFlowLink[]): RenderedFlowLink[] {
  const seenPaths = new Set<string>();
  const rendered: RenderedFlowLink[] = [];
  for (const link of flow) {
    const ref = seenPaths.has(link.candidate.path)
      ? `same file:${formatRange(clampRangeForReport(link.candidate.range))}`
      : formatCandidateRef(clampCandidateRange(link.candidate));
    seenPaths.add(link.candidate.path);
    rendered.push({ ...link, ref });
    if (rendered.length >= MAX_RENDERED_FLOW_LINKS) {
      break;
    }
  }
  return rendered;
}

function buildSearchTargetRefs(
  renderedFlow: RenderedFlowLink[],
): Map<string, string> {
  const refs = new Map<string, string>();
  renderedFlow.forEach((link, index) => {
    if (!refs.has(link.candidate.path)) {
      refs.set(link.candidate.path, `flow ${index + 1}`);
    }
  });
  return refs;
}

function renderSearchTarget(
  target: string,
  pathRefs: Map<string, string>,
): string {
  let rendered = target;
  for (const [filePath, ref] of pathRefs) {
    rendered = rendered.replace(new RegExp(escapeRegExp(filePath), "g"), ref);
  }
  return rendered.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMachinePathCandidates({
  primary,
  flow,
  readTargets,
}: {
  primary: ExplorerCandidate[];
  flow: ResolvedFlowLink[];
  readTargets: ResolvedReadTarget[];
}): ExplorerCandidate[] {
  const candidates: ExplorerCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...primary,
    ...flow.map((link) => link.candidate),
    ...readTargets.map((target) => target.candidate),
  ]) {
    const key = `${candidate.path}:${formatRange(candidate.range)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates.slice(0, MAX_MACHINE_PATHS);
}

function truncateInline(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function clampReportLength(report: string): string {
  if (report.length <= MAX_REPORT_CHARS) {
    return report;
  }
  const suffix = "\n[TRUNCATED: report exceeded density budget]";
  const jsonMatch = /\n```json\n[\s\S]*?\n```$/.exec(report);
  if (!jsonMatch) {
    return `${report.slice(0, MAX_REPORT_CHARS - suffix.length)}${suffix}`;
  }
  const jsonBlock = jsonMatch[0];
  const prefixBudget = MAX_REPORT_CHARS - jsonBlock.length - suffix.length;
  if (prefixBudget <= 0) {
    return `${report.slice(0, MAX_REPORT_CHARS - suffix.length)}${suffix}`;
  }
  const prefix = report.slice(0, jsonMatch.index);
  return `${prefix.slice(0, prefixBudget)}${suffix}${jsonBlock}`;
}
