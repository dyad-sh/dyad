import { type SystemDebugInfo } from "@/ipc/types";
import { type UserBudgetInfo } from "@/ipc/types/system";
import { type ModelSelection, type UserSettings } from "@/lib/schemas";
import {
  LAST_UPDATER_ERROR_HEADER,
  formatUpdaterLogsForIssueBody,
} from "@/lib/debugLogFormatting";

/**
 * What happened when we offered to take a screenshot. Recorded in the issue
 * body so a maintainer can tell an issue with no image from a reporter who
 * declined, and so the two cases can be counted separately after the fact.
 */
export type ScreenshotStatus = "captured" | "declined" | "capture-failed";

export interface ScreenshotOutcome {
  status: ScreenshotStatus;
  /** Failure message from takeScreenshot, only set for "capture-failed". */
  reason?: string;
}

// =============================================================================
// Size budget
// =============================================================================

/**
 * The report is handed to GitHub as a prefilled URL, so the whole body has to
 * survive percent-encoding inside a query string. Measured against
 * github.com/dyad-sh/dyad/issues/new: requests are served up to ~6,860
 * characters, answer 500 from there to ~8,000, and 414 beyond that. The
 * ceiling below leaves ~5% of headroom under the observed cliff.
 *
 * The large budgets -- prose, logs, updater logs, the title -- are sized so
 * that all of them at maximum still fit, and that case is pinned by tests.
 * The per-field caps are a backstop rather than part of that sum: every
 * diagnostic field is capped so that no single one can push the body over,
 * which is what the per-field tests pin. Nine saturating at once would go
 * over, and no machine reports values like that -- in practice only a
 * non-ASCII Windows node path comes close to its cap. `buildIssueUrl` never truncates -- the inputs are capped instead,
 * which is what makes the limit visible to the reporter while they type
 * rather than silently after they submit.
 *
 * The budgets below are counted in ENCODED characters, not in characters
 * typed, because that is the unit the ceiling is measured in and the two are
 * far apart: a CJK character costs 9, an emoji 12, and ordinary punctuation
 * (newline, quote, brace, colon) 3 each. Counting raw string length would let
 * a reporter writing Chinese -- or pasting a stack trace -- build a URL three
 * to nine times over the ceiling while the counter still showed room left.
 */
export const ISSUE_URL_CEILING = 6_500;

/** Shared by every prose field on the form, not per field. */
export const PROSE_BUDGET = 2_000;

/**
 * Tail of the app log carried inline, in encoded characters like every other
 * budget here. Logs are the worst content to measure raw: they are mostly
 * newlines, braces, quotes and colons, which cost 3 each, and they carry file
 * paths, so a non-ASCII home directory or app name multiplies them by 9.
 */
export const LOG_ISSUE_BODY_LIMIT = 2_000;

/**
 * Cap for diagnostics that come from user-controlled strings: a custom model
 * id, a provider name, a path under a home directory. Without it these are the
 * only inputs to the body with no bound, and the model name appears twice.
 */
const DIAGNOSTIC_FIELD_LIMIT = 120;

/** Encoded ceiling applied on top of the updater log's own summarising. */
const UPDATER_LOG_ENCODED_LIMIT = 600;

/**
 * Capture failures put their raw message in the body. Every other input is
 * capped, so leaving this one open would mean the ceiling rests on error
 * strings staying short rather than on anything enforced.
 */
export const SCREENSHOT_REASON_LIMIT = 200;

/**
 * Cost of a string in the query string ISSUE_URL_CEILING is measured against.
 * URLSearchParams rather than encodeURIComponent: they disagree on spaces
 * (`+` against `%20`), and over-counting every space would quietly cut an
 * English reporter's budget by around a sixth.
 */
function encodedLength(value: string): number {
  return new URLSearchParams({ v: value }).toString().length - "v=".length;
}

/**
 * Longest suffix of `value` that still fits `budget` once encoded. Logs are
 * kept from the end, because the most recent lines are the ones that explain
 * what the reporter just hit.
 */
function clampTailToEncoded(value: string, budget: number): string {
  if (encodedLength(value) <= budget) return value;
  const points = Array.from(value);
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodedLength(points.slice(points.length - mid).join("")) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return points.slice(points.length - lo).join("");
}

/**
 * Longest prefix of `value` that still fits `budget` once encoded. Steps over
 * code points rather than UTF-16 units so a surrogate pair is never split:
 * half an emoji encodes as U+FFFD, which corrupts the text and costs more than
 * the character it replaced.
 */
function clampToEncoded(value: string, budget: number): string {
  if (encodedLength(value) <= budget) return value;
  const points = Array.from(value);
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodedLength(points.slice(0, mid).join("")) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return points.slice(0, lo).join("");
}

// =============================================================================
// The reporter's description
// =============================================================================

/**
 * Splits an edit into the run that was just added and the text around it, by
 * common prefix and suffix. Compared over code points so the boundaries never
 * land inside a surrogate pair.
 */
function splitEdit(previous: string, value: string) {
  const before = Array.from(previous);
  const after = Array.from(value);
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    head: after.slice(0, start).join(""),
    inserted: after.slice(start, after.length - end).join(""),
    tail: after.slice(after.length - end).join(""),
  };
}

function applyEdit(
  previous: string,
  value: string,
  budget: number,
): { value: string; hitCap: boolean } {
  if (encodedLength(value) <= budget) return { value, hitCap: false };
  const { head, inserted, tail } = splitEdit(previous, value);
  const room = budget - encodedLength(head) - encodedLength(tail);
  return {
    value: head + clampToEncoded(inserted, Math.max(0, room)) + tail,
    hitCap: true,
  };
}

/**
 * Applies an edit to the description within the budget, keeping as much of
 * what was just added as fits and leaving the rest of the field alone.
 *
 * Only the inserted run is trimmed. Clamping the whole value would drop
 * characters off the far end that the reporter never touched and, in a
 * scrolled textarea, would never see go; refusing the edit outright would mean
 * a paste into the middle of a full field simply does not appear.
 */
export function applyDescriptionEdit(
  previous: string,
  value: string,
): { value: string; hitCap: boolean } {
  return applyEdit(previous, value, PROSE_BUDGET);
}

/**
 * The least a description can weigh and still be worth filing. Counted in
 * weight rather than characters, because a character is worth far more in
 * some scripts than others -- see `describesSomething`.
 */
export const MIN_DESCRIPTION_LENGTH = 10;

/**
 * Scripts where one code point carries far more than a Latin letter -- a
 * complete report is far shorter than the same report in English. Counting raw
 * characters would turn away "预览一片空白" while accepting "it crashed".
 *
 * Letters only. The kana blocks also hold marks that carry no meaning on
 * their own -- the middle dot, the prolonged sound mark -- and weighting
 * those would let a run of them through the gate.
 */
const DENSE_SCRIPT =
  /[\u3041-\u3096\u30a1-\u30fa\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uff66-\uff6f\uff71-\uff9d\u{20000}-\u{2a6df}]/u;

/** What one character of `description` is worth against the minimum. */
const DENSE_CHARACTER_WEIGHT = 3;

export function describesSomething(description: string): boolean {
  let weight = 0;
  for (const character of description.trim()) {
    weight += DENSE_SCRIPT.test(character) ? DENSE_CHARACTER_WEIGHT : 1;
    if (weight >= MIN_DESCRIPTION_LENGTH) return true;
  }
  return false;
}

// =============================================================================
// URL
// =============================================================================

export const GITHUB_ISSUES_BASE =
  "https://github.com/dyad-sh/dyad/issues/new" as const;

/** Builds the prefilled issue URL. Never truncates -- see ISSUE_URL_CEILING. */
export function buildIssueUrl({
  title,
  labels,
  body,
}: {
  title: string;
  labels: string[];
  body: string;
}): string {
  const qs = new URLSearchParams({
    title,
    labels: labels.join(","),
    body,
  });
  return `${GITHUB_ISSUES_BASE}?${qs.toString()}`;
}

/**
 * GitHub's title field. Left as a placeholder on purpose: the triage bot
 * rewrites it from the body, and a reporter can edit it on GitHub before
 * submitting.
 */
export const ISSUE_TITLE = "[bug] <WRITE TITLE HERE>";

// =============================================================================
// Body
// =============================================================================

/** Stable prefix so published issues can be counted with a GitHub search. */
const SCREENSHOT_STATUS_PREFIX = "Screenshot status:";

export function formatScreenshotStatusLine(outcome: ScreenshotOutcome): string {
  switch (outcome.status) {
    case "captured":
      return `${SCREENSHOT_STATUS_PREFIX} captured (reporter captured a screenshot in Dyad; if no image is attached, ask them to paste it)`;
    case "declined":
      return `${SCREENSHOT_STATUS_PREFIX} declined`;
    case "capture-failed":
      return outcome.reason
        ? `${SCREENSHOT_STATUS_PREFIX} capture-failed (${clampToEncoded(
            outcome.reason,
            SCREENSHOT_REASON_LIMIT,
          )})`
        : `${SCREENSHOT_STATUS_PREFIX} capture-failed`;
  }
}

/**
 * Keeps the template hint when a field is blank, so an issue filed without a
 * description still reads as an unfilled form rather than an empty heading.
 */
function formatSection(heading: string, hint: string, value: string): string {
  const trimmed = value.trim();
  return `${heading}\n${trimmed || hint}`;
}

/** Holds one diagnostics line to its cap. */
function field(value: string): string {
  return clampToEncoded(value, DIAGNOSTIC_FIELD_LIMIT);
}

function formatSettingsLines(
  settings: UserSettings | null,
  selectedModel: ModelSelection | null,
): string {
  if (!settings) return "Settings not available";
  const model = selectedModel ?? settings.selectedModel;
  return [
    `- Selected Model: ${field(`${model.provider}:${model.name}`)}`,
    `- Chat Mode: ${field(settings.selectedChatMode ?? "default")}`,
    `- Auto Approve Changes: ${settings.autoApproveChanges ?? "n/a"}`,
    `- Dyad Pro Enabled: ${settings.enableDyadPro ?? "n/a"}`,
    `- Effort Level: ${field(selectedModel?.effortLevel ?? "medium")}`,
    `- Runtime Mode: ${field(settings.runtimeMode2 ?? "n/a")}`,
    `- Release Channel: ${field(settings.releaseChannel ?? "n/a")}`,
  ].join("\n");
}

function formatSystemInfoSection(
  debugInfo: SystemDebugInfo,
  userBudget: UserBudgetInfo | undefined,
): string {
  return `## System Information
- Dyad Version: ${field(debugInfo.dyadVersion)}
- Platform: ${field(debugInfo.platform)}
- Architecture: ${field(debugInfo.architecture)}
- Node Version: ${field(debugInfo.nodeVersion || "n/a")}
- PNPM Version: ${field(debugInfo.pnpmVersion || "n/a")}
- Node Path: ${field(debugInfo.nodePath || "n/a")}
- Pro User ID: ${field(userBudget?.redactedUserId || "n/a")}
- Telemetry ID: ${field(debugInfo.telemetryId || "n/a")}
- Model: ${field(debugInfo.selectedLanguageModel || "n/a")}`;
}

/**
 * Holds the updater section to the encoded budget without cutting away the
 * error it exists to carry.
 *
 * formatUpdaterLogsForIssueBody leaves the important text at a different end
 * depending on which branch it took: leading, when the error section alone
 * overflows and it returns that section head-first; trailing, when it
 * assembles the Squirrel tail and appends the error section after it, and also
 * when it found no error header and fell back to the most recent lines. Only
 * the first case starts with the header, so that is what picks the direction.
 * Its own budget is counted in raw characters while this one is encoded, so
 * this fires for most real Windows logs rather than as a rare backstop.
 */
function clampUpdaterLogs(formatted: string): string {
  if (encodedLength(formatted) <= UPDATER_LOG_ENCODED_LIMIT) return formatted;
  // lastIndexOf, not startsWith: the assembled branch appends the error
  // section after the Squirrel tail, so the header is not first there.
  const errorStart = formatted.lastIndexOf(LAST_UPDATER_ERROR_HEADER);
  if (errorStart === -1) {
    return clampTailToEncoded(formatted, UPDATER_LOG_ENCODED_LIMIT);
  }
  const errorSection = formatted.slice(errorStart);
  // When the error fits, keep it whole and spend what is left on the lines
  // before it. When it does not, keep its head: the exception type and
  // message lead it, and a stack with no exception on it says nothing.
  return encodedLength(errorSection) <= UPDATER_LOG_ENCODED_LIMIT
    ? clampTailToEncoded(formatted, UPDATER_LOG_ENCODED_LIMIT)
    : clampToEncoded(errorSection, UPDATER_LOG_ENCODED_LIMIT);
}

function formatLogsSection(debugInfo: SystemDebugInfo): string {
  // Keep the logs small: the issue body travels in the GitHub URL, and the
  // budget above assumes both of these sections are capped.
  const updaterSection = debugInfo.updaterLogs
    ? `

## Auto-Updater Logs
\`\`\`
${clampUpdaterLogs(formatUpdaterLogsForIssueBody(debugInfo.updaterLogs))}
\`\`\``
    : "";
  return `## Logs
\`\`\`
${clampTailToEncoded(debugInfo.logs, LOG_ISSUE_BODY_LIMIT) || "No logs available"}
\`\`\`${updaterSection}`;
}

/**
 * Everything the report carries that the reporter did not type.
 *
 * Exported so the form's disclosure renders the same text the body sends
 * rather than a hand-maintained summary of it. Two copies drifted twice while
 * this was being built, which is why this is a function and not a comment.
 */
export interface Diagnostics {
  debugInfo: SystemDebugInfo;
  settings: UserSettings | null;
  selectedModel: ModelSelection | null;
  userBudget: UserBudgetInfo | undefined;
}

export function formatDiagnosticsSections({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
}: Diagnostics): string {
  return `${formatSystemInfoSection(debugInfo, userBudget)}

## Settings
${formatSettingsLines(settings, selectedModel)}

${formatLogsSection(debugInfo)}`;
}

export interface IssueBodyParams {
  description: string;
  screenshot: ScreenshotOutcome;
  /**
   * System information, settings and logs. Null when the reporter unticked
   * the box, "unavailable" when they asked for it but it could not be read --
   * a maintainer needs to tell those two apart.
   */
  diagnostics: Diagnostics | "unavailable" | null;
  /** Set when a chat session was uploaded alongside the report. */
  sessionId: string | null;
  /** Shown so a maintainer knows a Pro reporter filed this. */
  redactedUserId?: string;
}

export function buildIssueBody({
  description,
  screenshot,
  diagnostics,
  sessionId,
  redactedUserId,
}: IssueBodyParams): string {
  const sections = [
    "<!-- Please fill in all fields in English -->",
    "",
    formatSection(
      "## What happened (required)",
      "<!-- Please describe the issue you're experiencing -->",
      description,
    ),
    "",
    "## Screenshot",
    formatScreenshotStatusLine(screenshot),
  ];

  if (sessionId) {
    sections.push(
      "",
      "## Chat session",
      `Session ID: ${field(sessionId)}`,
      "Session Schema: v2.0",
      `Pro User ID: ${field(redactedUserId || "n/a")}`,
    );
  }

  if (diagnostics === "unavailable") {
    sections.push(
      "",
      "## System Information",
      "Not available when the report was filed.",
    );
  } else if (diagnostics) {
    sections.push("", formatDiagnosticsSections(diagnostics));
  } else {
    sections.push("", "## System Information", "Not included by the reporter.");
  }

  return sections.join("\n") + "\n";
}
