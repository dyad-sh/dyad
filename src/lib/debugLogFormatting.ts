const DEFAULT_UPDATER_LOG_ISSUE_BODY_LIMIT = 1_200;
const LAST_UPDATER_ERROR_HEADER = "Last updater error (this session):";
const TRUNCATED_MARKER = "[...truncated...]\n";
const NEXT_UPDATER_SECTION_PATTERN =
  /\n\n(?:Squirrel.*\.log \(tail\):|Error reading Squirrel logs:)/g;

function findNextUpdaterSectionStart(
  updaterLogs: string,
  lastErrorStart: number,
): number {
  NEXT_UPDATER_SECTION_PATTERN.lastIndex =
    lastErrorStart + LAST_UPDATER_ERROR_HEADER.length;
  const match = NEXT_UPDATER_SECTION_PATTERN.exec(updaterLogs);
  return match?.index ?? -1;
}

export function formatUpdaterLogsForIssueBody(
  updaterLogs: string,
  maxLength = DEFAULT_UPDATER_LOG_ISSUE_BODY_LIMIT,
): string {
  if (updaterLogs.length <= maxLength) {
    return updaterLogs;
  }

  const lastErrorStart = updaterLogs.indexOf(LAST_UPDATER_ERROR_HEADER);
  if (lastErrorStart === -1) {
    return updaterLogs.slice(-maxLength);
  }

  const nextSectionStart = findNextUpdaterSectionStart(
    updaterLogs,
    lastErrorStart,
  );
  const lastErrorSection =
    nextSectionStart === -1
      ? updaterLogs.slice(lastErrorStart)
      : updaterLogs.slice(lastErrorStart, nextSectionStart);

  if (lastErrorSection.length >= maxLength) {
    return lastErrorSection.slice(0, maxLength);
  }

  const otherSections = [
    updaterLogs.slice(0, lastErrorStart),
    nextSectionStart === -1 ? "" : updaterLogs.slice(nextSectionStart + 2),
  ]
    .join("")
    .trim();

  const separator = "\n\n";
  const remainingLength =
    maxLength -
    TRUNCATED_MARKER.length -
    separator.length -
    lastErrorSection.length;

  if (!otherSections || remainingLength <= 0) {
    return lastErrorSection;
  }

  return `${TRUNCATED_MARKER}${otherSections.slice(-remainingLength)}${separator}${lastErrorSection}`;
}
