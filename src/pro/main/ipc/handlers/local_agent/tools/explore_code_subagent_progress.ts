import type { SubagentObservation } from "./explore_code_subagent_candidates";

const MAX_QUERY_CHARS = 72;

/**
 * One-line human-readable summary of a single sub-agent observation, e.g.
 * `grep "handleSubmit" in src → 2 candidates`. Used as the step summary in
 * the streamed <dyad-subagent> events.
 */
export function formatExploreStepSummary(
  observation: SubagentObservation,
): string {
  return `${formatObservationSummary(observation)}${formatCandidateSuffix(observation)}`;
}

export function isObservationFailure(result: string): boolean {
  return (
    result.includes("budget exhausted") ||
    result.startsWith("Tool ") ||
    result.startsWith("Sub-agent read-only tool budget")
  );
}

function formatCandidateSuffix(observation: SubagentObservation): string {
  const count = observation.candidates.length;
  if (count === 0 && isObservationFailure(observation.result)) {
    return "";
  }
  return ` → ${count} candidate${count === 1 ? "" : "s"}`;
}

function formatObservationSummary(observation: SubagentObservation): string {
  const args = observation.args;
  switch (observation.toolName) {
    case "explore_code": {
      const query = readStringField(args, "query");
      return query ? `explore_code ${quote(truncate(query))}` : "explore_code";
    }
    case "grep": {
      const query = readStringField(args, "query");
      const include = readStringField(args, "include_pattern");
      const base = query ? `grep ${quote(truncate(query))}` : "grep";
      return include ? `${base} in ${include}` : base;
    }
    case "read_file": {
      const path = readStringField(args, "path");
      const start = readNumberField(args, "start_line_one_indexed");
      const end = readNumberField(args, "end_line_one_indexed_inclusive");
      if (!path) {
        return "read_file";
      }
      if (start != null && end != null) {
        return `read_file ${path}:${start}-${end}`;
      }
      if (start != null) {
        return `read_file ${path}:${start}`;
      }
      return `read_file ${path}`;
    }
    case "list_files": {
      const directory = readStringField(args, "directory");
      const recursive = readBooleanField(args, "recursive");
      if (directory) {
        return recursive
          ? `list_files ${directory} (recursive)`
          : `list_files ${directory}`;
      }
      return recursive ? "list_files (recursive)" : "list_files";
    }
    default:
      return observation.toolName;
  }
}

function readStringField(args: unknown, field: string): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberField(args: unknown, field: string): number | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

function readBooleanField(args: unknown, field: string): boolean {
  if (!args || typeof args !== "object") {
    return false;
  }
  return (args as Record<string, unknown>)[field] === true;
}

function truncate(text: string): string {
  if (text.length <= MAX_QUERY_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_QUERY_CHARS - 1)}…`;
}

function quote(text: string): string {
  return `"${text}"`;
}
