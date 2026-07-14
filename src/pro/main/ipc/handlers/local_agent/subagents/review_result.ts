import { z } from "zod";

const findingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  path: z.string().min(1).max(500),
  line: z.number().int().positive().max(10_000_000).optional(),
  title: z.string().min(1).max(200),
  impact: z.string().min(1).max(2_000),
  remediation: z.string().min(1).max(2_000),
});

const reviewerOutputSchema = z
  .object({
    status: z.enum(["findings", "no_findings", "partial"]),
    findings: z.array(findingSchema).max(100),
    summary: z.string().min(1).max(2_000),
  })
  .superRefine((value, context) => {
    if (value.status === "findings" && value.findings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: "findings status requires at least one finding",
      });
    }
    if (value.status === "no_findings" && value.findings.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: "no_findings status requires an empty findings array",
      });
    }
  });

export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

export interface ParsedReviewResult extends ReviewerOutput {
  findingCount: number;
  report: string;
  parseError?: string;
}

export const STRUCTURED_REVIEW_INSTRUCTIONS = `Return JSON only, with this exact shape:
{"status":"findings|no_findings|partial","findings":[{"severity":"critical|high|medium|low","path":"reviewed/file.ts","line":123,"title":"short title","impact":"concrete impact","remediation":"specific remediation"}],"summary":"short summary"}
Only report actionable defects introduced by the reviewed diff. Paths must exactly match a reviewed file. Use status "no_findings" only with an empty findings array. Use status "partial" if you cannot fully review the target.`;

/**
 * Parses Reviewer output as untrusted data. Invalid or out-of-scope output can
 * never be interpreted as a clean review; it becomes a partial review instead.
 */
export function parseReviewResult(
  rawOutput: string,
  reviewedFiles: readonly string[],
): ParsedReviewResult {
  try {
    const parsedJson: unknown = JSON.parse(stripJsonFence(rawOutput));
    const parsed = reviewerOutputSchema.parse(parsedJson);
    const allowedPaths = new Set(reviewedFiles);
    const invalidPath = parsed.findings.find(
      (finding) => !allowedPaths.has(finding.path),
    );
    if (invalidPath) {
      throw new Error(`Finding path was not reviewed: ${invalidPath.path}`);
    }

    return {
      ...parsed,
      findingCount: parsed.findings.length,
      report: renderReviewReport(parsed),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid review JSON";
    const partial: ReviewerOutput = {
      status: "partial",
      findings: [],
      summary: "The reviewer returned an invalid structured result.",
    };
    return {
      ...partial,
      findingCount: 0,
      report: renderReviewReport(partial),
      parseError: message.slice(0, 1_000),
    };
  }
}

export function renderReviewReport(result: ReviewerOutput): string {
  const findings = result.findings.map((finding, index) => {
    const location = `${finding.path}${finding.line ? `:${finding.line}` : ""}`;
    return `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title} (${location})\nImpact: ${finding.impact}\nRemediation: ${finding.remediation}`;
  });
  return [result.summary, ...findings].join("\n\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}
