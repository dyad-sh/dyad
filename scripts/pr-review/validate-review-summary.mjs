import crypto from "node:crypto";
import fs from "node:fs";

const contextPath = process.env.CONTEXT_PATH;
const reviewPath = process.env.REVIEW_PATH;
const expectedContextSha = process.env.EXPECTED_CONTEXT_SHA;

if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!reviewPath) throw new Error("REVIEW_PATH is required");
if (!expectedContextSha) throw new Error("EXPECTED_CONTEXT_SHA is required");

const contextRaw = fs.readFileSync(contextPath, "utf8");
const actualContextSha = crypto
  .createHash("sha256")
  .update(contextRaw)
  .digest("hex");
if (actualContextSha !== expectedContextSha) {
  throw new Error("PR review context changed after generation");
}

const summary = fs.readFileSync(reviewPath, "utf8").trim();
if (!summary) {
  throw new Error("Review output file is empty");
}

// Gracefully handle older summaries that predate the Recommendation line.
const recMatch = summary.match(
  /\*\*Recommendation:\s*(auto-fix|human-review|ready)\s*\*\*/,
);
let finalSummary = summary;
if (!recMatch) {
  console.warn(
    "WARNING: Review summary missing **Recommendation:** line; defaulting to human-review",
  );
  const verdictIndex = finalSummary.indexOf("**Verdict:");
  if (verdictIndex !== -1) {
    const lineEnd = finalSummary.indexOf("\n", verdictIndex);
    if (lineEnd !== -1) {
      finalSummary =
        finalSummary.slice(0, lineEnd + 1) +
        "**Recommendation: human-review (default)**\n" +
        finalSummary.slice(lineEnd + 1);
    } else {
      finalSummary += "\n**Recommendation: human-review (default)**";
    }
  } else {
    finalSummary = "**Recommendation: human-review**\n\n" + finalSummary;
  }
}

fs.writeFileSync(reviewPath, finalSummary);
