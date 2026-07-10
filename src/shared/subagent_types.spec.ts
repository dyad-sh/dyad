import { describe, expect, it } from "vitest";

import { isExplorerOutputData, parseSubagentEvents } from "./subagent_types";

describe("parseSubagentEvents", () => {
  it("parses meta, steps, and output events", () => {
    const body = [
      JSON.stringify({ kind: "meta", title: "auth flow" }),
      JSON.stringify({
        kind: "step",
        index: 1,
        toolName: "grep",
        summary: 'grep "token" → 3 candidates',
        status: "done",
      }),
      JSON.stringify({
        kind: "output",
        summary: "high confidence · 2 files",
        data: { confidence: "high" },
      }),
    ].join("\n");

    const parsed = parseSubagentEvents(body);
    expect(parsed.meta?.title).toBe("auth flow");
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].summary).toBe('grep "token" → 3 candidates');
    expect(parsed.output?.summary).toBe("high confidence · 2 files");
  });

  it("ignores a trailing partial line while streaming", () => {
    const body =
      JSON.stringify({
        kind: "step",
        index: 1,
        toolName: "grep",
        summary: "grep",
        status: "done",
      }) + '\n{"kind":"step","index":2,"toolNam';

    const parsed = parseSubagentEvents(body);
    expect(parsed.steps).toHaveLength(1);
  });

  it("ignores blank, corrupt, and unknown-kind lines", () => {
    const body = [
      "",
      "not json at all",
      JSON.stringify({ kind: "mystery", foo: 1 }),
      JSON.stringify({ kind: "step", index: 1, summary: "ok", status: "done" }),
    ].join("\n");

    const parsed = parseSubagentEvents(body);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.meta).toBeNull();
    expect(parsed.output).toBeNull();
  });

  it("keeps the last output when multiple output events appear", () => {
    const body = [
      JSON.stringify({ kind: "output", summary: "first", data: null }),
      JSON.stringify({ kind: "output", summary: "second", data: null }),
    ].join("\n");

    expect(parseSubagentEvents(body).output?.summary).toBe("second");
  });
});

describe("isExplorerOutputData", () => {
  it("accepts a well-formed explorer output", () => {
    expect(
      isExplorerOutputData({
        query: "q",
        intent: "locate",
        confidence: "high",
        action: "read_targets",
        flow: [],
        readTargets: [],
        missing: [],
        searchTargets: [],
      }),
    ).toBe(true);
  });

  it("rejects null and unshaped data", () => {
    expect(isExplorerOutputData(null)).toBe(false);
    expect(isExplorerOutputData({ confidence: "high" })).toBe(false);
  });
});
