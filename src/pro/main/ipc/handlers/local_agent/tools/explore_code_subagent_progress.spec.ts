import { describe, expect, it } from "vitest";

import type {
  CandidateId,
  ExplorerCandidate,
} from "./explore_code_subagent_candidates";
import { formatExploreStepSummary } from "./explore_code_subagent_progress";

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

describe("formatExploreStepSummary", () => {
  it("formats compact summaries for common sub-agent tools", () => {
    expect(
      formatExploreStepSummary({
        toolName: "explore_code",
        args: { query: "create booking flow" },
        result: "",
        candidates: [createCandidate("c1")],
      }),
    ).toBe('explore_code "create booking flow" → 1 candidate');

    expect(
      formatExploreStepSummary({
        toolName: "grep",
        args: { query: "handleSubmit", include_pattern: "src/**/*.ts" },
        result: "",
        candidates: [createCandidate("c2"), createCandidate("c3")],
      }),
    ).toBe('grep "handleSubmit" in src/**/*.ts → 2 candidates');

    expect(
      formatExploreStepSummary({
        toolName: "read_file",
        args: {
          path: "src/App.tsx",
          start_line_one_indexed: 10,
          end_line_one_indexed_inclusive: 40,
        },
        result: "",
        candidates: [],
      }),
    ).toBe("read_file src/App.tsx:10-40 → 0 candidates");
  });

  it("truncates very long queries", () => {
    const longQuery = "a".repeat(100);
    const summary = formatExploreStepSummary({
      toolName: "explore_code",
      args: { query: longQuery },
      result: "",
      candidates: [],
    });

    expect(summary).toContain(`${"a".repeat(71)}…`);
    expect(summary).not.toContain(longQuery);
  });

  it("omits the candidate suffix for failed observations", () => {
    const summary = formatExploreStepSummary({
      toolName: "grep",
      args: { query: "term" },
      result: "Tool grep failed: boom",
      candidates: [],
    });

    expect(summary).toBe('grep "term"');
  });
});
