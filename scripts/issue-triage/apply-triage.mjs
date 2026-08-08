import fs from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueNumber = Number.parseInt(process.env.ISSUE_NUMBER ?? "", 10);
const triagePath = process.env.TRIAGE_OUTPUT_PATH;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  throw new Error("ISSUE_NUMBER must be a positive integer");
}
if (!triagePath) throw new Error("TRIAGE_OUTPUT_PATH is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo)
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

const allowedLabels = new Set([
  "bug",
  "feature request",
  "ux/usability",
  "pro",
  "issue/lang",
  "issue/incomplete",
]);
const issueTypeLabels = new Set(["bug", "feature request", "ux/usability"]);
const allowedConfidence = new Set(["high", "medium", "low"]);

const triage = JSON.parse(fs.readFileSync(triagePath, "utf8"));
if (!triage || typeof triage !== "object" || Array.isArray(triage)) {
  throw new Error("Triage output must be a JSON object");
}

const cleanText = (value, maxLength) =>
  `${value ?? ""}`.replace(/\s+/g, " ").trim().slice(0, maxLength);

const labels = [...new Set(triage.labels ?? [])].map((label) =>
  cleanText(label, 80),
);
if (!Array.isArray(triage.labels)) {
  throw new Error("labels must be an array");
}
for (const label of labels) {
  if (!allowedLabels.has(label)) {
    throw new Error(`Invalid label: ${label}`);
  }
}

const selectedTypes = labels.filter((label) => issueTypeLabels.has(label));
if (selectedTypes.length !== 1) {
  throw new Error("Exactly one issue type label is required");
}

const nonEnglish = triage.nonEnglish === true;
const incomplete = triage.incomplete === true;
if (nonEnglish && !labels.includes("issue/lang")) {
  throw new Error("nonEnglish requires issue/lang label");
}
if (incomplete && !labels.includes("issue/incomplete")) {
  throw new Error("incomplete requires issue/incomplete label");
}

const duplicatesRaw = triage.duplicates ?? [];
if (!Array.isArray(duplicatesRaw)) {
  throw new Error("duplicates must be an array");
}

const duplicates = duplicatesRaw.slice(0, 5).map((duplicate, index) => {
  if (!duplicate || typeof duplicate !== "object" || Array.isArray(duplicate)) {
    throw new Error(`duplicates[${index}] must be an object`);
  }

  const number = Number(duplicate.number);
  if (!Number.isInteger(number) || number <= 0 || number === issueNumber) {
    throw new Error(`duplicates[${index}].number is invalid`);
  }

  const confidence = cleanText(duplicate.confidence, 20).toLowerCase();
  if (!allowedConfidence.has(confidence)) {
    throw new Error(`duplicates[${index}].confidence is invalid`);
  }

  const description = cleanText(duplicate.description, 180);
  if (!description) {
    throw new Error(`duplicates[${index}].description is required`);
  }

  const helpfulSuggestion = cleanText(duplicate.helpfulSuggestion, 220);
  const helpfulCommentUrl = cleanText(duplicate.helpfulCommentUrl, 300);
  if (helpfulSuggestion || helpfulCommentUrl) {
    const expectedPrefix = `https://github.com/${repository}/issues/${number}#issuecomment-`;
    if (!helpfulSuggestion || !helpfulCommentUrl.startsWith(expectedPrefix)) {
      throw new Error(
        `duplicates[${index}] helpful suggestion must include a matching issue comment URL`,
      );
    }
  }

  return {
    number,
    description,
    confidence,
    ...(helpfulSuggestion ? { helpfulSuggestion, helpfulCommentUrl } : {}),
  };
});

const title =
  typeof triage.title === "string" && triage.title.trim()
    ? cleanText(triage.title, 80)
    : null;

const api = async (pathname, options = {}) => {
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
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(
      `GitHub API ${pathname} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }
  return response;
};

if (labels.length > 0) {
  await api(`repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
  console.log(`Applied labels: ${labels.join(", ")}`);
}

if (title) {
  await api(`repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  console.log(`Updated issue title to: ${title}`);
}

const comments = [];
if (nonEnglish) {
  comments.push(
    "Hi! We're only able to respond to issues in English. Please translate your issue with ChatGPT so we can help you. Thanks!",
  );
}
if (incomplete) {
  comments.push(
    "Hi! Please fill in all the fields in the issue so we can help you. A screenshot is very helpful!",
  );
}
if (duplicates.length > 0) {
  const duplicateLines = duplicates.map((duplicate) => {
    const base = `- #${duplicate.number}: ${duplicate.description} (confidence: ${duplicate.confidence})`;
    if (duplicate.helpfulSuggestion) {
      return `${base}\n  You might want to try ${duplicate.helpfulSuggestion} based on this earlier [comment](${duplicate.helpfulCommentUrl}).`;
    }
    return base;
  });
  comments.push(
    [
      "This issue might be a duplicate of existing issues. Please check:",
      "",
      ...duplicateLines,
      "",
      "Feel free to ignore if none of these address your specific case.",
    ].join("\n"),
  );
}

for (const body of comments) {
  await api(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
console.log(`Posted ${comments.length} issue comment(s).`);
