// Runs in the trusted apply job with a narrowly scoped app token. Reads the
// agent's decision, validates it, and performs the GitHub mutations. If the
// decision is missing or invalid, posts a short fallback comment and marks the
// issue so a person knows the bot had nothing to offer.
import fs from "node:fs";

import {
  composeComment,
  composeFallbackComment,
  FAILED_LABEL,
  NEEDS_HUMAN_LABEL,
  normalizeTriage,
} from "./triage-comment.mjs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueNumber = Number.parseInt(process.env.ISSUE_NUMBER ?? "", 10);
const issueAuthor = (process.env.ISSUE_AUTHOR ?? "").trim() || null;
const triagePath = process.env.TRIAGE_OUTPUT_PATH;
const contextPath = process.env.TRIAGE_CONTEXT_PATH;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  throw new Error("ISSUE_NUMBER must be a positive integer");
}
if (!triagePath) throw new Error("TRIAGE_OUTPUT_PATH is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

// Labels this script may need to create on first use. The workflow token has
// issues:write, which covers label creation.
const LABEL_DEFINITIONS = {
  [NEEDS_HUMAN_LABEL]: {
    color: "D93F0B",
    description:
      "The triage bot could not help with this issue; a person needs to reply",
  },
  [FAILED_LABEL]: {
    color: "B60205",
    description: "The triage bot failed to run on this issue",
  },
};

const api = async (pathname, options = {}, { allowNotFound = false } = {}) => {
  const response = await fetch(`https://api.github.com/${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "dyad-issue-triage",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(
      `GitHub API ${pathname} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }
  return response;
};

async function ensureLabelExists(name) {
  const definition = LABEL_DEFINITIONS[name];
  if (!definition) return;
  const existing = await api(
    `repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
    {},
    { allowNotFound: true },
  );
  if (existing) return;
  await api(`repos/${owner}/${repo}/labels`, {
    method: "POST",
    body: JSON.stringify({ name, ...definition }),
  });
  console.log(`Created label: ${name}`);
}

async function addLabels(labels) {
  if (labels.length === 0) return;
  for (const label of labels) await ensureLabelExists(label);
  await api(`repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
  console.log(`Applied labels: ${labels.join(", ")}`);
}

async function setTitle(title) {
  await api(`repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  console.log(`Updated issue title to: ${title}`);
}

async function postComment(body) {
  await api(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  console.log("Posted issue comment.");
}

function loadReleases() {
  if (!contextPath || !fs.existsSync(contextPath)) return null;
  try {
    const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
    return Array.isArray(context.releases)
      ? context.releases.map((release) => release.version)
      : null;
  } catch (error) {
    console.warn(`::warning::Could not read triage context: ${error.message}`);
    return null;
  }
}

function loadTriage() {
  if (!fs.existsSync(triagePath)) {
    return { ok: false, reason: `${triagePath} is missing` };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(triagePath, "utf8"));
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${error.message}` };
  }
  try {
    const triage = normalizeTriage(raw, {
      issueNumber,
      repository,
      author: issueAuthor,
      releases: loadReleases(),
    });
    return { ok: true, triage };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

const result = loadTriage();
if (!result.ok) {
  console.error(
    `::error::Issue triage produced no usable decision: ${result.reason}`,
  );
  await postComment(composeFallbackComment({ author: issueAuthor }));
  await addLabels([FAILED_LABEL]);
  process.exit(1);
}

const { triage } = result;
await addLabels([
  ...triage.labels,
  ...(triage.needsHuman ? [NEEDS_HUMAN_LABEL] : []),
]);
if (triage.title) await setTitle(triage.title);

const comment = composeComment(triage, { author: issueAuthor });
if (comment) {
  await postComment(comment);
} else {
  console.log("No comment posted: feature request without an existing route.");
}
