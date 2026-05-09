import fs from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number.parseInt(process.env.PR_NUMBER ?? "", 10);
const contextPath = process.env.CONTEXT_PATH;
const findingsPath = process.env.FINDINGS_PATH;
const reviewLabel = process.env.REVIEW_LABEL || "Codex";

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isInteger(prNumber) || prNumber <= 0) {
  throw new Error("PR_NUMBER must be a positive integer");
}
if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!findingsPath) throw new Error("FINDINGS_PATH is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo)
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
const findingsPayload = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
const findings = Array.isArray(findingsPayload.findings)
  ? findingsPayload.findings
  : [];
const headSha = context.pullRequest?.headSha;

if (!headSha) {
  throw new Error("PR review context is missing pullRequest.headSha");
}

if (findings.length === 0) {
  console.log("No Codex inline findings to post.");
  process.exit(0);
}

const severityEmoji = {
  HIGH: ":red_circle:",
  MEDIUM: ":yellow_circle:",
};

const sanitizeDetail = (detail) =>
  detail
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/gh[spou]_[A-Za-z0-9_]+/g, "[REDACTED_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);

const comments = findings.map((finding) => {
  const lines = [
    `**${severityEmoji[finding.severity]} ${finding.severity}**`,
    "",
    `**${finding.title}**`,
    "",
    finding.body.trim(),
  ];

  if (finding.suggestion) {
    lines.push("", `:bulb: **Suggestion:** ${finding.suggestion.trim()}`);
  }

  return {
    path: finding.path,
    line: finding.line,
    side: "RIGHT",
    body: lines.join("\n"),
  };
});

const response = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
  {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "dyad-pr-review",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      commit_id: headSha,
      event: "COMMENT",
      body: `${reviewLabel} review: ${findings.length} inline finding(s).`,
      comments,
    }),
  },
);

if (!response.ok) {
  const detail = sanitizeDetail(await response.text());
  if (detail) {
    console.warn(`::warning::Codex inline review post failed: ${detail}`);
  }
  throw new Error(
    `Failed to create Codex review comments: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
  );
}

console.log(`Posted ${comments.length} Codex inline review comment(s).`);
