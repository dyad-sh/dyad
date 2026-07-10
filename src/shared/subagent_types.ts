/**
 * Shared types for sub-agent runs (Code Explorer today; Reviewer etc. later).
 *
 * A sub-agent run is transported to the renderer as a `<dyad-subagent>` custom
 * tag whose body is NDJSON: one JSON-encoded SubagentEvent per line. NDJSON is
 * used (instead of a single JSON blob) because the tag body streams
 * incrementally — every complete line is parseable at any point mid-stream and
 * the trailing partial line is simply ignored until it completes.
 *
 * The tag body is UI-only; the tool result returned to the parent model is
 * unchanged by any of this.
 */

// -- Generic sub-agent events ------------------------------------------------

export type SubagentType = "code-explorer";

export interface SubagentMetaEvent {
  kind: "meta";
  /** Human-readable run title, e.g. the exploration query. */
  title: string;
}

export interface SubagentStepEvent {
  kind: "step";
  /** 1-indexed step number. */
  index: number;
  toolName: string;
  /** One-line human-readable summary, e.g. `grep "refreshToken" → 7 matches`. */
  summary: string;
  /** Optional expandable detail (args/result excerpt, truncated by sender). */
  detail?: string;
  status: "done" | "error";
}

export interface SubagentOutputEvent {
  kind: "output";
  /** One-line result summary for cards/chips, e.g. "high confidence · 4 files". */
  summary: string;
  /** Agent-type-specific structured output (ExplorerOutputData for code-explorer). */
  data: unknown;
}

export type SubagentEvent =
  | SubagentMetaEvent
  | SubagentStepEvent
  | SubagentOutputEvent;

export interface ParsedSubagentBody {
  meta: SubagentMetaEvent | null;
  steps: SubagentStepEvent[];
  output: SubagentOutputEvent | null;
}

/**
 * Parse an NDJSON sub-agent tag body. Tolerant of a trailing partial line
 * (mid-stream) and of unknown/corrupt lines — both are skipped.
 */
export function parseSubagentEvents(body: string): ParsedSubagentBody {
  const result: ParsedSubagentBody = { meta: null, steps: [], output: null };
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const kind = (event as { kind?: unknown }).kind;
    if (kind === "meta") {
      result.meta = event as SubagentMetaEvent;
    } else if (kind === "step") {
      const step = event as SubagentStepEvent;
      if (typeof step.summary === "string") {
        result.steps.push(step);
      }
    } else if (kind === "output") {
      const output = event as SubagentOutputEvent;
      if (typeof output.summary === "string") {
        result.output = output;
      }
    }
  }
  return result;
}

// -- Code Explorer structured output ------------------------------------------

export type ExploreIntent = "explain" | "locate" | "edit" | "debug";
export type ExploreAction =
  | "answer_from_report"
  | "read_targets"
  | "targeted_gap_search"
  | "skip_explore_result";
export type ExploreConfidence = "high" | "medium" | "low";

export interface ExplorerFlowEntry {
  path: string;
  /** Line range like "12-48", or null when no range was observed. */
  range: string | null;
  role: string;
  fact: string;
  quote: string;
}

export interface ExplorerReadTarget {
  path: string;
  range: string | null;
  purpose: string;
}

/** Structured final output of a code-explorer run (SubagentOutputEvent.data). */
export interface ExplorerOutputData {
  query: string;
  intent: ExploreIntent;
  confidence: ExploreConfidence;
  action: ExploreAction;
  flow: ExplorerFlowEntry[];
  readTargets: ExplorerReadTarget[];
  missing: string[];
  searchTargets: string[];
}

export function isExplorerOutputData(
  data: unknown,
): data is ExplorerOutputData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<ExplorerOutputData>;
  return (
    typeof candidate.confidence === "string" &&
    typeof candidate.action === "string" &&
    Array.isArray(candidate.flow) &&
    Array.isArray(candidate.readTargets)
  );
}
