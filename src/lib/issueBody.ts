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
 * Every budget in this section is sized so that the worst case -- maximum
 * prose, maximum logs, maximum updater logs, a long title -- still fits.
 * `buildIssueUrl` never truncates; staying under the ceiling is guaranteed by
 * capping the inputs instead, which is what makes the limit visible to the
 * reporter while they type rather than silently after they submit.
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
 * Room the shared budget guarantees to every prose field the form renders.
 *
 * Without it one field can take the whole budget and leave the others with
 * nothing: every keystroke is swallowed, the field stays empty, and on the
 * session form -- where all three are required -- the continue gate then
 * demands text the reporter physically cannot enter. Sized well above the
 * median expected/actual answer, which runs about 25 characters.
 *
 * The guarantee holds regardless of edit order, including clearing a field to
 * reword it. Reserving only for fields that are empty *right now* is not
 * enough: the others grow into the space a field held while it was filled, so
 * clearing it later leaves it with a couple of characters -- less than one CJK
 * character -- and the dead end returns.
 */
export const EMPTY_FIELD_RESERVE = 150;

export type ReportKind = "bug" | "session";

type ProseField = "description" | "expected" | "actual";

/** Only the fields a given form renders reserve anything. */
const PROSE_FIELDS_BY_KIND: Record<ReportKind, readonly ProseField[]> = {
  bug: ["description"],
  session: ["description", "expected", "actual"],
};

/** Titles are short in practice; GitHub's own limit is 256. */
export const TITLE_BUDGET = 150;

/**
 * Tail of the app log carried inline, in encoded characters like every other
 * budget here. Logs are the worst content to measure raw: they are mostly
 * newlines, braces, quotes and colons, which cost 3 each, and they carry file
 * paths, so a non-ASCII home directory or app name multiplies them by 9.
 */
export const LOG_ISSUE_BODY_LIMIT = 1_500;

/** Encoded ceiling applied on top of the updater log's own summarising. */
const UPDATER_LOG_ENCODED_LIMIT = 600;

/**
 * Capture failures put their raw message in the body. Every other input is
 * capped, so leaving this one open would mean the ceiling rests on error
 * strings staying short rather than on anything enforced.
 */
const SCREENSHOT_REASON_LIMIT = 200;

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
// Reporter-supplied fields
// =============================================================================

/** What the reporter typed into the form. */
export interface ReportFields {
  title: string;
  description: string;
  /** Session reports only. */
  expected?: string;
  actual?: string;
}

export const EMPTY_REPORT_FIELDS: ReportFields = {
  title: "",
  description: "",
  expected: "",
  actual: "",
};

/**
 * Prose counted against PROSE_BUDGET. The title is budgeted separately, so a
 * long title never eats into the description.
 */
export function proseLength(fields: ReportFields): number {
  return (
    encodedLength(fields.description) +
    encodedLength(fields.expected ?? "") +
    encodedLength(fields.actual ?? "")
  );
}

/** Prose the reporter has left before the cap stops them. */
export function proseRemaining(fields: ReportFields): number {
  return Math.max(0, PROSE_BUDGET - proseLength(fields));
}

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

/**
 * Applies an edit within `budget`, keeping as much of what was just added as
 * fits and leaving the rest of the field untouched.
 *
 * Only the inserted run is trimmed. Clamping the whole value would drop
 * characters off the far end that the reporter never touched and, in a
 * scrolled textarea, would never see go; refusing the edit outright would mean
 * a paste into the middle of a full field simply does not appear. Trimming the
 * insertion lands what fits wherever it was pasted and touches nothing else.
 */
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
 * Applies one field edit within the shared budget. Returns the resulting
 * fields and whether anything was refused, so the form can show the cap
 * message on the edit that hit it -- including a paste, which lands what fits.
 */
export function applyFieldEdit(
  fields: ReportFields,
  key: ProseField,
  value: string,
  kind: ReportKind,
): { fields: ReportFields; hitCap: boolean } {
  const previous = fields[key] ?? "";
  const others = proseLength(fields) - encodedLength(previous);
  // Held per field rather than all-or-nothing: each other field keeps the part
  // of its reserve it has not already spent. Since
  // `encodedLength(g) + reserveFor(g) === max(encodedLength(g), RESERVE)`,
  // every field can always reach RESERVE whatever order they were edited in.
  const reserved = PROSE_FIELDS_BY_KIND[kind]
    .filter((field) => field !== key)
    .reduce(
      (total, field) =>
        total +
        Math.max(0, EMPTY_FIELD_RESERVE - encodedLength(fields[field] ?? "")),
      0,
    );
  const allowed = Math.max(0, PROSE_BUDGET - others - reserved);
  const result = applyEdit(previous, value, allowed);
  return {
    fields: { ...fields, [key]: result.value },
    hitCap: result.hitCap,
  };
}

export function applyTitleEdit(
  fields: ReportFields,
  value: string,
): { fields: ReportFields; hitCap: boolean } {
  const result = applyEdit(fields.title, value, TITLE_BUDGET);
  return {
    fields: { ...fields, title: result.value },
    hitCap: result.hitCap,
  };
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

/** Falls back to the old placeholder so an untitled report is still filable. */
export function formatIssueTitle(kind: ReportKind, title: string): string {
  const prefix = kind === "bug" ? "[bug]" : "[session report]";
  const trimmed = title.trim();
  return trimmed
    ? `${prefix} ${trimmed}`
    : `${prefix} ${kind === "bug" ? "<WRITE TITLE HERE>" : "<add title>"}`;
}

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

function formatSettingsLines(
  settings: UserSettings | null,
  selectedModel: ModelSelection | null,
): string {
  if (!settings) return "Settings not available";
  const model = selectedModel ?? settings.selectedModel;
  return [
    `- Selected Model: ${model.provider}:${model.name}`,
    `- Chat Mode: ${settings.selectedChatMode ?? "default"}`,
    `- Auto Approve Changes: ${settings.autoApproveChanges ?? "n/a"}`,
    `- Dyad Pro Enabled: ${settings.enableDyadPro ?? "n/a"}`,
    `- Effort Level: ${selectedModel?.effortLevel ?? "medium"}`,
    `- Runtime Mode: ${settings.runtimeMode2 ?? "n/a"}`,
    `- Release Channel: ${settings.releaseChannel ?? "n/a"}`,
  ].join("\n");
}

function formatSystemInfoSection(
  debugInfo: SystemDebugInfo,
  userBudget: UserBudgetInfo | undefined,
): string {
  return `## System Information
- Dyad Version: ${debugInfo.dyadVersion}
- Platform: ${debugInfo.platform}
- Architecture: ${debugInfo.architecture}
- Node Version: ${debugInfo.nodeVersion || "n/a"}
- PNPM Version: ${debugInfo.pnpmVersion || "n/a"}
- Node Path: ${debugInfo.nodePath || "n/a"}
- Pro User ID: ${userBudget?.redactedUserId || "n/a"}
- Telemetry ID: ${debugInfo.telemetryId || "n/a"}
- Model: ${debugInfo.selectedLanguageModel || "n/a"}`;
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
export function formatDiagnosticsSections({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
}: {
  debugInfo: SystemDebugInfo;
  settings: UserSettings | null;
  selectedModel: ModelSelection | null;
  userBudget: UserBudgetInfo | undefined;
}): string {
  return `${formatSystemInfoSection(debugInfo, userBudget)}

## Settings
${formatSettingsLines(settings, selectedModel)}

${formatLogsSection(debugInfo)}`;
}

interface CommonBodyParams {
  debugInfo: SystemDebugInfo;
  settings: UserSettings | null;
  /** Effort-aware model for this chat, falling back to the global setting. */
  selectedModel: ModelSelection | null;
  userBudget: UserBudgetInfo | undefined;
  screenshot: ScreenshotOutcome;
  fields: ReportFields;
}

export function buildBugReportBody({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
  screenshot,
  fields,
}: CommonBodyParams): string {
  return `\
<!-- Please fill in all fields in English -->

${formatSection(
  "## Bug Description (required)",
  "<!-- Please describe the issue you're experiencing and how to reproduce it -->",
  fields.description,
)}

## Screenshot (recommended)
<!-- Screenshot of the bug -->
${formatScreenshotStatusLine(screenshot)}

${formatDiagnosticsSections({ debugInfo, settings, selectedModel, userBudget })}
`;
}

export function buildSessionReportBody({
  debugInfo,
  settings,
  selectedModel,
  userBudget,
  screenshot,
  fields,
  sessionId,
}: CommonBodyParams & { sessionId: string }): string {
  return `\
<!-- Please fill in all fields in English -->

Session ID: ${sessionId}
Session Schema: v2.0
Pro User ID: ${userBudget?.redactedUserId || "n/a"}

${formatSection(
  "## Issue Description (required)",
  "<!-- Please describe the issue you're experiencing -->",
  fields.description,
)}

${formatSection(
  "## Expected Behavior (required)",
  "<!-- What did you expect to happen? -->",
  fields.expected ?? "",
)}

${formatSection(
  "## Actual Behavior (required)",
  "<!-- What actually happened? -->",
  fields.actual ?? "",
)}

## Screenshot (recommended)
<!-- Screenshot of the issue -->
${formatScreenshotStatusLine(screenshot)}

${formatDiagnosticsSections({ debugInfo, settings, selectedModel, userBudget })}
`;
}

/** Used when getSystemDebugInfo fails, so the report still reaches GitHub. */
export function buildBugReportFallbackBody({
  screenshot,
  fields,
}: {
  screenshot: ScreenshotOutcome;
  fields: ReportFields;
}): string {
  return `\
<!-- Please fill in all fields in English -->

${formatSection(
  "## Bug Description (required)",
  "<!-- Please describe the issue you're experiencing and how to reproduce it -->",
  fields.description,
)}

## Screenshot (recommended)
<!-- Screenshot of the bug -->
${formatScreenshotStatusLine(screenshot)}
`;
}

/** Used when getSystemDebugInfo fails, so the session ID still reaches GitHub. */
export function buildSessionReportFallbackBody({
  userBudget,
  screenshot,
  fields,
  sessionId,
}: {
  userBudget: UserBudgetInfo | undefined;
  screenshot: ScreenshotOutcome;
  fields: ReportFields;
  sessionId: string;
}): string {
  return `Session ID: ${sessionId}
Session Schema: v2.0
Pro User ID: ${userBudget?.redactedUserId || "n/a"}

${formatSection(
  "## Issue Description (required)",
  "<!-- Please describe the issue you're experiencing -->",
  fields.description,
)}

${formatSection(
  "## Expected Behavior (required)",
  "<!-- What did you expect to happen? -->",
  fields.expected ?? "",
)}

${formatSection(
  "## Actual Behavior (required)",
  "<!-- What actually happened? -->",
  fields.actual ?? "",
)}

${formatScreenshotStatusLine(screenshot)}`;
}
