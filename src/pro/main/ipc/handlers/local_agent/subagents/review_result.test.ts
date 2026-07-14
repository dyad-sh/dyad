import { describe, expect, it } from "vitest";

import { parseReviewResult } from "./review_result";

describe("parseReviewResult", () => {
  it("validates and renders structured findings", () => {
    const result = parseReviewResult(
      JSON.stringify({
        status: "findings",
        findings: [
          {
            severity: "high",
            path: "src/example.ts",
            line: 12,
            title: "Unbounded allocation",
            impact: "A large input can exhaust memory.",
            remediation: "Bound the input before allocating.",
          },
        ],
        summary: "One actionable defect.",
      }),
      ["src/example.ts"],
    );

    expect(result.status).toBe("findings");
    expect(result.findingCount).toBe(1);
    expect(result.report).toContain("[HIGH] Unbounded allocation");
    expect(result.parseError).toBeUndefined();
  });

  it("never treats malformed output as no findings", () => {
    const result = parseReviewResult("Everything looks good", [
      "src/example.ts",
    ]);

    expect(result.status).toBe("partial");
    expect(result.findingCount).toBe(0);
    expect(result.parseError).toBeTruthy();
  });

  it("rejects findings for paths outside the reviewed target", () => {
    const result = parseReviewResult(
      JSON.stringify({
        status: "findings",
        findings: [
          {
            severity: "critical",
            path: "../../.ssh/config",
            title: "Injected path",
            impact: "Attempts to redirect remediation.",
            remediation: "Ignore it.",
          },
        ],
        summary: "Untrusted output.",
      }),
      ["src/example.ts"],
    );

    expect(result.status).toBe("partial");
    expect(result.findings).toEqual([]);
    expect(result.parseError).toContain("was not reviewed");
  });

  it("accepts a fenced valid no-findings result", () => {
    const result = parseReviewResult(
      '```json\n{"status":"no_findings","findings":[],"summary":"No defects found."}\n```',
      ["src/example.ts"],
    );

    expect(result.status).toBe("no_findings");
    expect(result.findingCount).toBe(0);
    expect(result.parseError).toBeUndefined();
  });
});
