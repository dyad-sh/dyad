// Validates the triage decision written by the agent and composes the single
// reporter-facing comment. Pure functions only so they can be unit tested and
// reused by preview.mjs; apply-triage.mjs does the GitHub calls.

export const ISSUE_TYPE_LABELS = ["bug", "feature request", "ux/usability"];
export const ALLOWED_LABELS = [
  ...ISSUE_TYPE_LABELS,
  "pro",
  "issue/lang",
  "issue/incomplete",
];
export const ASSESSMENTS = [
  "likely_dyad_bug",
  "fixed_in_release",
  "external_service",
  "user_app_issue",
  "environment_setup",
  "needs_info",
  "feature_request",
  "question",
  "needs_human",
];
export const RELATED_OUTCOMES = [
  "fixed",
  "resolved_with_workaround",
  "open",
  "closed_without_fix",
];
export const INFO_NEEDED = [
  "description",
  "screenshot",
  "screenshot_not_attached",
  "session_id",
  "version",
];
export const NEEDS_HUMAN_LABEL = "triage/needs-human";
export const FAILED_LABEL = "triage/failed";
export const SIGN_OFF = "Someone from the Dyad team will follow up here.";

const LIMITS = {
  title: 80,
  summary: 400,
  step: 220,
  steps: 4,
  related: 2,
  possiblyRelated: 3,
  relatedNote: 160,
  developerNotes: 1200,
  playbookMatch: 80,
};

const ALLOWED_HOSTS = new Set([
  "www.dyad.sh",
  "dyad.sh",
  "academy.dyad.sh",
  "nodejs.org",
  "www.githubstatus.com",
  "githubstatus.com",
  "status.supabase.com",
]);

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

const INFO_NEEDED_TEXT = {
  description: "Reply with what you were doing and what you saw instead.",
  screenshot: "A screenshot of the error is the fastest way for us to help.",
  screenshot_not_attached:
    "It looks like your screenshot didn't come through. Could you paste it here?",
  session_id:
    "In Dyad, open **Help** > **Upload Chat Session** and paste the session id here so we can see the logs.",
  version:
    "Which version of Dyad are you on, and are you on Windows, Mac, or Linux?",
};

const RELATED_OUTCOME_TEXT = {
  fixed: "fixed",
  resolved_with_workaround: "the steps above resolved it there",
  open: "still open, you can follow it for updates",
  closed_without_fix: "closed",
};
const RELATED_OUTCOME_TEXT_PLURAL = {
  fixed: "both fixed",
  resolved_with_workaround: "the steps above resolved it there",
  open: "both still open, you can follow them for updates",
  closed_without_fix: "both closed",
};

export function isAllowedUrl(raw, repository) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "github.com") {
    const pathname = url.pathname.toLowerCase();
    const repoPath = `/${`${repository ?? ""}`.toLowerCase()}`;
    return (
      repoPath.length > 1 &&
      (pathname === repoPath || pathname.startsWith(`${repoPath}/`))
    );
  }
  return ALLOWED_HOSTS.has(host);
}

/**
 * Strips anything the agent must not be able to post: HTML, @-mentions of
 * anyone but the reporter, and links to hosts outside the allowlist.
 */
export function sanitizeText(
  value,
  { maxLength, author, repository, multiline = false } = {},
) {
  let text = `${value ?? ""}`;
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/\[([^\]]*)\]\((\S+?)\)/g, (match, label, url) =>
    isAllowedUrl(url, repository) ? match : label,
  );
  text = text.replace(/https?:\/\/[^\s<>()[\]]+/gi, (url) => {
    const trimmed = url.replace(/[.,;:!?]+$/, "");
    const tail = url.slice(trimmed.length);
    return (
      (isAllowedUrl(trimmed, repository) ? trimmed : "[link removed]") + tail
    );
  });
  text = text.replace(
    /(^|[^A-Za-z0-9_./])@([A-Za-z0-9][A-Za-z0-9-]{0,38})/g,
    (match, before, name) =>
      author && name.toLowerCase() === author.toLowerCase()
        ? match
        : `${before}${name}`,
  );
  if (multiline) {
    text = text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    text = text.replace(/\s+/g, " ").trim();
  }
  return typeof maxLength === "number" ? text.slice(0, maxLength) : text;
}

function assertArray(value, name) {
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value ?? [];
}

function parseIssueNumber(value, name, issueNumber) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (number === issueNumber) {
    throw new Error(`${name} must not reference the current issue`);
  }
  return number;
}

/**
 * Turns the raw JSON written by the agent into a validated decision. Throws on
 * anything malformed so the caller can fall back to a safe comment.
 *
 * `releases` is the list of published version strings (no leading "v"). Pass
 * null when it is unknown; a version-shaped string is then accepted.
 */
export function normalizeTriage(
  raw,
  { issueNumber, repository, author, releases = null },
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Triage output must be a JSON object");
  }
  if (raw.triageFailed === true) {
    throw new Error(`Agent reported failure: ${raw.reason ?? "no reason"}`);
  }
  const text = (value, maxLength, multiline = false) =>
    sanitizeText(value, { maxLength, author, repository, multiline });

  if (!Array.isArray(raw.labels)) throw new Error("labels must be an array");
  const labels = [...new Set(raw.labels.map((label) => text(label, 80)))];
  for (const label of labels) {
    if (!ALLOWED_LABELS.includes(label)) {
      throw new Error(`Invalid label: ${label}`);
    }
  }
  const typeLabels = labels.filter((label) =>
    ISSUE_TYPE_LABELS.includes(label),
  );
  if (typeLabels.length !== 1) {
    throw new Error("Exactly one issue type label is required");
  }

  const nonEnglish = raw.nonEnglish === true;
  const incomplete = raw.incomplete === true;
  if (nonEnglish && !labels.includes("issue/lang")) {
    throw new Error("nonEnglish requires issue/lang label");
  }
  if (incomplete && !labels.includes("issue/incomplete")) {
    throw new Error("incomplete requires issue/incomplete label");
  }

  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? text(raw.title, LIMITS.title)
      : null;

  const assessment = text(raw.assessment, 40);
  if (!ASSESSMENTS.includes(assessment)) {
    throw new Error(`Invalid assessment: ${assessment || "(missing)"}`);
  }

  const summary = text(raw.summary, LIMITS.summary);
  if (!summary && assessment !== "feature_request") {
    throw new Error("summary is required");
  }

  const steps = assertArray(raw.steps, "steps")
    .map((step) => text(step, LIMITS.step))
    .filter(Boolean)
    .slice(0, LIMITS.steps);

  let fixedIn = null;
  if (raw.fixedIn && typeof raw.fixedIn === "object") {
    const version = text(raw.fixedIn.version, 40).replace(/^v/i, "");
    if (!RELEASE_VERSION_PATTERN.test(version)) {
      throw new Error(`fixedIn.version is not a version: ${version}`);
    }
    if (
      Array.isArray(releases) &&
      releases.length > 0 &&
      !releases.includes(version)
    ) {
      throw new Error(`fixedIn.version ${version} is not a published release`);
    }
    fixedIn = {
      version,
      url: `https://www.dyad.sh/docs/releases/${version}`,
    };
  }
  if (assessment === "fixed_in_release" && !fixedIn) {
    throw new Error("fixed_in_release requires fixedIn.version");
  }

  const related = assertArray(raw.related, "related")
    .slice(0, LIMITS.related)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`related[${index}] must be an object`);
      }
      const number = parseIssueNumber(
        entry.number,
        `related[${index}].number`,
        issueNumber,
      );
      const outcome = text(entry.outcome, 40);
      if (!RELATED_OUTCOMES.includes(outcome)) {
        throw new Error(`related[${index}].outcome is invalid`);
      }
      const note = text(entry.note, LIMITS.relatedNote);
      return { number, outcome, ...(note ? { note } : {}) };
    });

  const possiblyRelated = assertArray(raw.possiblyRelated, "possiblyRelated")
    .slice(0, LIMITS.possiblyRelated)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`possiblyRelated[${index}] must be an object`);
      }
      const number = parseIssueNumber(
        entry.number,
        `possiblyRelated[${index}].number`,
        issueNumber,
      );
      const note = text(entry.note, LIMITS.relatedNote);
      return { number, ...(note ? { note } : {}) };
    });

  const infoNeeded = [
    ...new Set(
      assertArray(raw.infoNeeded, "infoNeeded").map((v) => text(v, 40)),
    ),
  ];
  for (const item of infoNeeded) {
    if (!INFO_NEEDED.includes(item)) {
      throw new Error(`Invalid infoNeeded entry: ${item}`);
    }
  }

  const developerNotes = text(raw.developerNotes, LIMITS.developerNotes, true);
  const playbookMatch = text(raw.playbookMatch, LIMITS.playbookMatch) || null;

  return {
    labels,
    nonEnglish,
    incomplete,
    title,
    filedFromApp: raw.filedFromApp === true,
    assessment,
    summary,
    steps,
    fixedIn,
    related,
    possiblyRelated,
    infoNeeded,
    developerNotes,
    playbookMatch,
    needsHuman: assessment === "needs_human",
  };
}

function renderSteps(label, steps) {
  if (steps.length === 1) return [`**${label}:** ${steps[0]}`];
  return [`**${label}:**`, ...steps.map((step, i) => `${i + 1}. ${step}`)];
}

function stepsWithUpdate(triage) {
  if (!triage.fixedIn) return triage.steps;
  const alreadyMentionsDownload = triage.steps.some((step) =>
    /dyad\.sh\/download/i.test(step),
  );
  if (alreadyMentionsDownload) return triage.steps;
  const update = `Update to Dyad ${triage.fixedIn.version} or newer from https://www.dyad.sh/download, which includes the fix ([release notes](${triage.fixedIn.url})).`;
  return [update, ...triage.steps].slice(0, LIMITS.steps);
}

function renderRelated(related) {
  const sameOutcome =
    related.length > 1 &&
    related.every(
      (entry) => !entry.note && entry.outcome === related[0].outcome,
    );
  if (sameOutcome) {
    const numbers = related.map((entry) => `#${entry.number}`).join(" and ");
    return `${numbers} (${RELATED_OUTCOME_TEXT_PLURAL[related[0].outcome]})`;
  }
  return related
    .map(
      ({ number, outcome, note }) =>
        `#${number} (${note || RELATED_OUTCOME_TEXT[outcome]})`,
    )
    .join(" · ");
}

function renderTeamNotes(triage) {
  const lines = [
    "<details>",
    "<summary>Notes for the Dyad team</summary>",
    "",
    triage.developerNotes || "- No notes from the automatic first look.",
    `- Assessment: ${triage.assessment} · Playbook: ${triage.playbookMatch ?? "no match"}`,
  ];
  if (triage.possiblyRelated.length > 0) {
    const items = triage.possiblyRelated
      .map((entry) =>
        entry.note ? `#${entry.number} (${entry.note})` : `#${entry.number}`,
      )
      .join(", ");
    lines.push(`- Possibly related: ${items}`);
  }
  lines.push("</details>");
  return lines;
}

/**
 * Returns the comment body, or null when nothing should be posted (a feature
 * request with no existing route to offer).
 */
export function composeComment(triage, { author } = {}) {
  const greeting = author ? `@${author}` : "there";

  if (triage.assessment === "feature_request") {
    if (triage.steps.length === 0) return null;
    return [
      `Hi ${greeting}, thanks for the suggestion. We've logged it as a feature request.`,
      "",
      ...renderSteps("In the meantime", triage.steps),
      "",
      ...renderTeamNotes(triage),
    ].join("\n");
  }

  const lines = [
    `Hi ${greeting}, thanks for ${triage.filedFromApp ? "sending this from Dyad" : "the report"}.`,
  ];
  if (triage.nonEnglish) {
    lines.push(
      "",
      "We can only respond in English. Please translate your issue (ChatGPT works well for this) so we can help.",
    );
  }
  if (triage.summary) {
    lines.push("", `**What's going on:** ${triage.summary}`);
  }
  const steps = stepsWithUpdate(triage);
  if (steps.length > 0) {
    lines.push("", ...renderSteps("What you can do now", steps));
  }
  if (triage.related.length > 0) {
    lines.push(
      "",
      `**Others with the same problem:** ${renderRelated(triage.related)}`,
    );
  }
  const info = triage.infoNeeded
    .map((item) => INFO_NEEDED_TEXT[item])
    .join(" ");
  if (info) {
    lines.push("", `**To help us fix it:** ${info}`);
  }
  lines.push("", SIGN_OFF, "", ...renderTeamNotes(triage));
  return lines.join("\n");
}

export function composeFallbackComment({ author } = {}) {
  const greeting = author ? `@${author}` : "there";
  return `Hi ${greeting}, thanks for the report. Our automatic first look didn't complete, so someone from the Dyad team will take a look directly.`;
}
