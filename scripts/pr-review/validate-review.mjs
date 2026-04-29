import crypto from "node:crypto";
import fs from "node:fs";

const contextPath = process.env.CONTEXT_PATH;
const findingsPath = process.env.FINDINGS_PATH;
const reviewPath = process.env.REVIEW_PATH;
const expectedContextSha = process.env.EXPECTED_CONTEXT_SHA;

if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!findingsPath) throw new Error("FINDINGS_PATH is required");
if (!reviewPath) throw new Error("REVIEW_PATH is required");
if (!expectedContextSha) throw new Error("EXPECTED_CONTEXT_SHA is required");

const contextRaw = fs.readFileSync(contextPath, "utf8");
const context = JSON.parse(contextRaw);
const actualContextSha = crypto
  .createHash("sha256")
  .update(contextRaw)
  .digest("hex");
if (actualContextSha !== expectedContextSha) {
  throw new Error("PR review context changed after generation");
}

const summary = fs.readFileSync(reviewPath, "utf8").trim();
const recMatch = summary.match(
  /\*\*Recommendation:\s*(auto-fix|human-review|ready)\s*\*\*/,
);
if (!summary) {
  throw new Error("Review output file is empty");
}
if (!fs.existsSync(findingsPath)) {
  throw new Error("Findings output file is missing");
}

const filesByPath = new Map(
  (context.files ?? []).map((file) => [file.path, file]),
);

const lineInRanges = (line, ranges) =>
  Array.isArray(ranges) &&
  ranges.some(
    (range) =>
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      line >= range.start &&
      line <= range.end,
  );

const warning = (message) => {
  console.warn(`::warning::${message}`);
};

const parseSummaryIssues = (value) => {
  const issuesHeader = value.match(
    /(^|\n)### Issues Summary\s*\n\n([\s\S]*?)(?:\n<details>|\n---|\n:white_check_mark:|$)/,
  );
  if (!issuesHeader) {
    return [];
  }

  const lines = issuesHeader[2]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 3) continue;

    const severity = cells[0]
      .replace(/^:[^:]+:\s*/, "")
      .trim()
      .toUpperCase();
    const locationMatch = cells[1].match(/^`([^`:]+(?:\/[^`:]+)*):(\d+)`$/);
    if (!locationMatch) continue;

    rows.push({
      severity,
      path: locationMatch[1],
      line: Number(locationMatch[2]),
      title: cells[2],
    });
  }

  return rows;
};

const findingsRaw = fs.readFileSync(findingsPath, "utf8").trim();
if (!findingsRaw) {
  throw new Error("Findings output file is empty");
}
const findingsPayload = JSON.parse(findingsRaw);
if (!findingsPayload || typeof findingsPayload !== "object") {
  throw new Error("Findings output must be a JSON object");
}
if (!Array.isArray(findingsPayload.findings)) {
  throw new Error("Findings output must include a findings array");
}

const rawFindings = findingsPayload.findings;
const normalizedFindings = [];
const seenKeys = new Set();

for (const [index, finding] of rawFindings.entries()) {
  if (!finding || typeof finding !== "object") {
    warning(`Skipping finding ${index}: entry must be an object`);
    continue;
  }

  const severity = `${finding.severity ?? ""}`.trim().toUpperCase();
  if (severity !== "HIGH" && severity !== "MEDIUM") {
    warning(
      `Skipping finding ${index}: invalid severity "${finding.severity}"`,
    );
    continue;
  }

  const path = `${finding.path ?? ""}`.trim();
  const file = filesByPath.get(path);
  if (!file) {
    warning(`Skipping finding ${index}: unknown changed file "${path}"`);
    continue;
  }

  const lineRaw = `${finding.line ?? ""}`.trim();
  const line = /^\d+$/.test(lineRaw) ? Number(lineRaw) : Number.NaN;
  if (!Number.isInteger(line) || line <= 0) {
    warning(`Skipping finding ${index}: invalid line "${finding.line}"`);
    continue;
  }
  if (!lineInRanges(line, file.commentableLineRanges)) {
    warning(
      `Skipping finding ${index}: non-commentable line ${line} in ${path}`,
    );
    continue;
  }

  const title = `${finding.title ?? ""}`.trim();
  const body = `${finding.body ?? ""}`.trim();
  const suggestion =
    typeof finding.suggestion === "string" ? finding.suggestion.trim() : "";

  if (!title) {
    warning(`Skipping finding ${index}: missing title`);
    continue;
  }
  if (!body) {
    warning(`Skipping finding ${index}: missing body`);
    continue;
  }

  const dedupeKey = `${severity}:${path}:${line}:${title}`;
  if (seenKeys.has(dedupeKey)) {
    warning(`Skipping finding ${index}: duplicate ${dedupeKey}`);
    continue;
  }
  seenKeys.add(dedupeKey);

  normalizedFindings.push({
    severity,
    path,
    line,
    title,
    body,
    ...(suggestion ? { suggestion } : {}),
  });
}

const hasExplicitRecommendation = Boolean(recMatch);
const recommendation = recMatch?.[1] ?? "human-review";
const highFindings = normalizedFindings.filter(
  (finding) => finding.severity === "HIGH",
);
if (recommendation === "ready" && highFindings.length > 0) {
  throw new Error("Review summary says ready but findings include HIGH issues");
}
if (
  hasExplicitRecommendation &&
  (recommendation === "auto-fix" || recommendation === "human-review") &&
  highFindings.length === 0
) {
  throw new Error(
    `Review summary says ${recommendation} but findings do not include HIGH issues`,
  );
}
if (
  normalizedFindings.length > 0 &&
  summary.includes(":white_check_mark: No significant issues found.")
) {
  throw new Error(
    "Review summary says no significant issues found but findings were emitted",
  );
}

const summaryIssues = parseSummaryIssues(summary);
if (normalizedFindings.length > 0 && summaryIssues.length === 0) {
  throw new Error(
    "Review summary emitted actionable findings but is missing an Issues Summary table",
  );
}

if (summaryIssues.length > 0) {
  const summaryKeys = new Set(
    summaryIssues.map(
      (issue) => `${issue.severity}:${issue.path}:${issue.line}:${issue.title}`,
    ),
  );
  const findingKeys = new Set(
    normalizedFindings.map(
      (finding) =>
        `${finding.severity}:${finding.path}:${finding.line}:${finding.title}`,
    ),
  );

  for (const finding of normalizedFindings) {
    const key = `${finding.severity}:${finding.path}:${finding.line}:${finding.title}`;
    if (!summaryKeys.has(key)) {
      throw new Error(
        `Review summary is missing Issues Summary row for finding ${key}`,
      );
    }
  }

  for (const issue of summaryIssues) {
    const key = `${issue.severity}:${issue.path}:${issue.line}:${issue.title}`;
    if (!findingKeys.has(key)) {
      throw new Error(
        `Findings JSON is missing entry for Issues Summary row ${key}`,
      );
    }
  }
}

fs.writeFileSync(
  findingsPath,
  JSON.stringify({ findings: normalizedFindings }, null, 2) + "\n",
);
