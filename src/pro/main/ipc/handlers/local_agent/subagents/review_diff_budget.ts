/**
 * Bounding for the diff that is handed to the reviewer sub-agent.
 *
 * The diff is embedded in the reviewer's assignment, and the assignment is
 * re-sent on every step of the review turn. A large diff therefore costs the
 * same price again on every following request.
 *
 * A plain head/tail truncation is the wrong tool here: it silently deletes
 * whatever sits in the middle of the diff, so whole files can go unreviewed
 * while the reviewer still reports "reviewed". This module keeps WHOLE files
 * while the budget lasts and explicitly names the files it had to leave out,
 * so the reviewer knows what it did not see and can go and fetch it.
 */

/** Maximum characters of diff embedded in a reviewer assignment. */
export const MAX_REVIEW_DIFF_CHARS = 30_000;

export interface BoundedReviewDiff {
  /** The diff excerpt to embed in the assignment. */
  text: string;
  /** Files whose diff section is present in `text`. */
  includedFiles: string[];
  /** Files that were left out because the budget ran out. */
  omittedFiles: string[];
}

const DIFF_HEADER_PREFIX = "diff --git ";

/**
 * Splits a unified diff into per-file sections. The section boundaries are the
 * `diff --git a/<path> b/<path>` headers; a diff without any header is treated
 * as a single unnamed section.
 */
function splitDiffSections(diff: string): string[] {
  const lines = diff.split("\n");
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith(DIFF_HEADER_PREFIX)) {
      starts.push(index);
    }
  }
  if (starts.length === 0) {
    return [diff];
  }
  const sections: string[] = [];
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index];
    const to = index + 1 < starts.length ? starts[index + 1] : lines.length;
    sections.push(lines.slice(from, to).join("\n"));
  }
  return sections;
}

/**
 * Extracts the file path from a `diff --git a/<path> b/<path>` header.
 * Returns null when the header does not carry a usable path.
 */
function diffSectionPath(section: string): string | null {
  const header = section.split("\n", 1)[0];
  if (!header.startsWith(DIFF_HEADER_PREFIX)) {
    return null;
  }
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
  if (!match) {
    return null;
  }
  return match[2] || match[1] || null;
}

function truncateSection(section: string, maxChars: number): string {
  if (section.length <= maxChars) {
    return section;
  }
  const marker =
    "\n\n[... this file's diff was truncated to fit the review budget ...]\n\n";
  const available = Math.max(0, maxChars - marker.length);
  return `${section.slice(0, available)}${marker}`;
}

/**
 * Bounds a diff so it can be embedded in a reviewer assignment.
 *
 * Whole files are kept while the budget lasts. Files that do not fit are
 * listed by name in the returned text so the reviewer can tell exactly what
 * it was not shown.
 */
export function boundReviewDiff(
  diff: string,
  maxChars: number = MAX_REVIEW_DIFF_CHARS,
): BoundedReviewDiff {
  if (diff.length <= maxChars) {
    return {
      text: diff,
      includedFiles: splitDiffSections(diff)
        .map((section) => diffSectionPath(section))
        .filter((path): path is string => Boolean(path)),
      omittedFiles: [],
    };
  }

  const sections = splitDiffSections(diff);
  const included: string[] = [];
  const omitted: string[] = [];
  const kept: string[] = [];
  let used = 0;

  for (const section of sections) {
    const path = diffSectionPath(section);
    if (used + section.length <= maxChars) {
      kept.push(section);
      used += section.length;
      if (path) {
        included.push(path);
      }
      continue;
    }
    // The first section that does not fit is still included (truncated) so
    // the reviewer has something concrete to work with.
    if (kept.length === 0) {
      kept.push(truncateSection(section, maxChars));
      used = maxChars;
      if (path) {
        included.push(path);
      }
      continue;
    }
    if (path) {
      omitted.push(path);
    }
  }

  const omittedNote =
    omitted.length > 0
      ? `\n\n[... ${omitted.length} file(s) were omitted because the diff exceeded the ${maxChars}-character review budget. Re-read them with read_file or git_diff if you need to review them: ${omitted.join(", ")} ...]`
      : "";

  return {
    text: `${kept.join("\n")}${omittedNote}`,
    includedFiles: included,
    omittedFiles: omitted,
  };
}
