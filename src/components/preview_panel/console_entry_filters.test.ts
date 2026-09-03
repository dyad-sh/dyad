import { describe, expect, it } from "vitest";

import type { ConsoleEntry } from "@/ipc/types";
import { matchesConsoleEntryFilters } from "./console_entry_filters";

const filters = {
  level: "error",
  type: "client",
  source: "browser",
} as const;

function entry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    appId: 1,
    level: "info",
    type: "server",
    message: "entry",
    timestamp: 1,
    sourceName: "Dyad",
    ...overrides,
  };
}

describe("matchesConsoleEntryFilters", () => {
  it("keeps runtime boundaries visible across mismatched filters", () => {
    expect(
      matchesConsoleEntryFilters(
        entry({ runtimeBoundary: "restart" }),
        filters,
      ),
    ).toBe(true);
  });

  it("applies every filter to ordinary entries", () => {
    expect(matchesConsoleEntryFilters(entry(), filters)).toBe(false);
    expect(
      matchesConsoleEntryFilters(
        entry({ level: "error", type: "client", sourceName: "browser" }),
        filters,
      ),
    ).toBe(true);
  });
});
