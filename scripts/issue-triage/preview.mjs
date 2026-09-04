// Prints the comment the apply script would post for a triage.json, without
// touching GitHub. Use it to review prompt changes against saved decisions:
//
//   node scripts/issue-triage/preview.mjs scripts/issue-triage/examples/node-not-found.json
//   node scripts/issue-triage/preview.mjs tmp/issue-triage/triage.json --author someone --issue 4456
//
// To produce a triage.json for a real issue locally, render the prompt with
// scripts/issue-agent/render-template.mjs and run it through the claude CLI
// with the same environment variables the workflow sets.
import fs from "node:fs";

import {
  composeComment,
  composeFallbackComment,
  FAILED_LABEL,
  NEEDS_HUMAN_LABEL,
  normalizeTriage,
} from "./triage-comment.mjs";

const args = process.argv.slice(2);
const options = {
  author: "reporter",
  issue: 0,
  repo: "dyad-sh/dyad",
  context: null,
};
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--author") options.author = args[++i];
  else if (arg === "--issue") options.issue = Number.parseInt(args[++i], 10);
  else if (arg === "--repo") options.repo = args[++i];
  else if (arg === "--context") options.context = args[++i];
  else positional.push(arg);
}

const triagePath = positional[0];
if (!triagePath) {
  console.error(
    "Usage: node scripts/issue-triage/preview.mjs <triage.json> [--author login] [--issue N] [--repo owner/repo] [--context context.json]",
  );
  process.exit(2);
}

let releases = null;
if (options.context) {
  const context = JSON.parse(fs.readFileSync(options.context, "utf8"));
  releases = Array.isArray(context.releases)
    ? context.releases.map((release) => release.version)
    : null;
}

const raw = JSON.parse(fs.readFileSync(triagePath, "utf8"));
let triage;
try {
  triage = normalizeTriage(raw, {
    issueNumber: options.issue,
    repository: options.repo,
    author: options.author,
    releases,
  });
} catch (error) {
  console.log(`Decision rejected: ${error.message}`);
  console.log(`Labels: ${FAILED_LABEL}`);
  console.log("");
  console.log(composeFallbackComment({ author: options.author }));
  process.exit(1);
}

const labels = [
  ...triage.labels,
  ...(triage.needsHuman ? [NEEDS_HUMAN_LABEL] : []),
];
console.log(`Labels: ${labels.join(", ")}`);
console.log(`Title: ${triage.title ?? "(unchanged)"}`);
console.log("");
console.log(
  composeComment(triage, { author: options.author }) ??
    "(no comment: feature request without an existing route)",
);
