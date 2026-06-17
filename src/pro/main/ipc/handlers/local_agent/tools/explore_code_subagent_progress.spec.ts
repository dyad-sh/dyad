import { describe, expect, it } from "vitest";

import type {
  CandidateId,
  ExplorerCandidate,
  SubagentObservation,
} from "./explore_code_subagent_candidates";
import { formatExploreProgressLog } from "./explore_code_subagent_progress";

function createCandidate(id: CandidateId): ExplorerCandidate {
  return {
    id,
    path: "src/App.tsx",
    range: null,
    symbols: [],
    score: 1,
    source: "grep",
    provenance: [],
    traits: {
      isTest: false,
      isSupport: false,
      isGenerated: false,
      isDocsExample: false,
    },
  };
}

describe("formatExploreProgressLog", () => {
  it("returns a placeholder when there are no observations yet", () => {
    expect(formatExploreProgressLog([])).toBe("Exploring...");
  });

  it("formats a compact step log for common sub-agent tools", () => {
    const observations: SubagentObservation[] = [
      {
        toolName: "explore_code",
        args: { query: "create booking flow" },
        result: "",
        candidates: [createCandidate("c1")],
      },
      {
        toolName: "grep",
        args: { query: "handleSubmit", include_pattern: "src/**/*.ts" },
        result: "",
        candidates: [createCandidate("c2"), createCandidate("c3")],
      },
      {
        toolName: "read_file",
        args: {
          path: "src/App.tsx",
          start_line_one_indexed: 10,
          end_line_one_indexed_inclusive: 40,
        },
        result: "",
        candidates: [],
      },
    ];

    const log = formatExploreProgressLog(observations);

    expect(log).toContain("Exploring...");
    expect(log).toContain(
      '1. explore_code "create booking flow" → 1 candidate',
    );
    expect(log).toContain(
      '2. grep "handleSubmit" in src/**/*.ts → 2 candidates',
    );
    expect(log).toContain("3. read_file src/App.tsx:10-40 → 0 candidates");
  });

  it("truncates very long queries", () => {
    const longQuery = "a".repeat(100);
    const log = formatExploreProgressLog([
      {
        toolName: "explore_code",
        args: { query: longQuery },
        result: "",
        candidates: [],
      },
    ]);

    expect(log).toContain(`${"a".repeat(71)}…`);
    expect(log).not.toContain(longQuery);
  });

  it("shows only the most recent steps when the log is long", () => {
    const observations = Array.from({ length: 35 }, (_, index) => ({
      toolName: "grep",
      args: { query: `term-${index}` },
      result: "",
      candidates: [],
    }));

    const log = formatExploreProgressLog(observations);

    expect(log).toContain("showing last 30 of 35 steps");
    expect(log).not.toContain("term-0");
    expect(log).toContain('grep "term-34"');
  });
});
