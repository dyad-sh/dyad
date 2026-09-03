import type { ConsoleEntry } from "@/ipc/types";

export function matchesConsoleEntryFilters(
  entry: ConsoleEntry,
  filters: {
    level: "all" | ConsoleEntry["level"];
    type: "all" | ConsoleEntry["type"];
    source: string;
  },
): boolean {
  if (entry.runtimeBoundary) return true;
  if (filters.level !== "all" && entry.level !== filters.level) return false;
  if (filters.type !== "all" && entry.type !== filters.type) return false;
  if (
    filters.source &&
    filters.source !== "all" &&
    entry.sourceName !== filters.source
  ) {
    return false;
  }
  return true;
}
