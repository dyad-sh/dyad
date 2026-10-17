/**
 * Pure helpers for the push summary: deciding the outcome from measured git
 * facts, and wording the banner for it. No IPC, Electron, or git here; the
 * main process measures, this file interprets, and the transition displays.
 */

import type {
  GithubOpsBanner,
  PushOutcome,
  PushSummary,
  PushedFileCounts,
} from "./state";

/** Git facts a sync measured, before the outcome is decided. */
export interface PushFacts {
  pushedBranch: string;
  currentBranch: string | null;
  /** False when the branch could not be read, so null above means unknown. */
  branchKnown: boolean;
  /** Full commit the user is on. */
  head: string;
  /** Full remote branch tip after the push, or null when it could not be read. */
  remoteTip: string | null;
  /** Whether the remote branch tip changed during this sync. */
  remoteMoved: boolean;
  /** Commits the push added to the remote branch; null when unmeasurable. */
  commitsPushed: number | null;
  files: PushedFileCounts | null;
  uncommittedFiles: number;
  /** Commits reachable from HEAD that the remote branch does not have. */
  commitsNotOnRemote: number;
}

export function classifyPushOutcome(facts: PushFacts): PushOutcome {
  // A branch mismatch is reported before anything else, even when every
  // commit so far is on the remote, since the next commit on the branch the
  // user is on would not be synced.
  if (facts.branchKnown) {
    if (facts.currentBranch === null) return "detached-head";
    if (facts.currentBranch !== facts.pushedBranch) return "wrong-branch";
  }
  if (facts.remoteTip !== null && facts.remoteTip === facts.head) {
    if (facts.remoteMoved) return "pushed";
    return facts.uncommittedFiles > 0 ? "uncommitted-changes" : "up-to-date";
  }
  // An unreadable branch or remote tip is reported as unknown, never as a
  // specific diagnosis the readings cannot support.
  if (!facts.branchKnown || facts.remoteTip === null) return "unverified";
  // HEAD is behind the remote tip, so everything local is already there.
  if (facts.commitsNotOnRemote === 0) {
    return facts.uncommittedFiles > 0 ? "uncommitted-changes" : "up-to-date";
  }
  return "unverified";
}

export function summarizePush(facts: PushFacts): PushSummary {
  return {
    outcome: classifyPushOutcome(facts),
    pushedBranch: facts.pushedBranch,
    currentBranch: facts.currentBranch,
    commitsPushed: facts.commitsPushed,
    files: facts.files,
    uncommittedFiles: facts.uncommittedFiles,
    commitsNotOnRemote: facts.commitsNotOnRemote,
    head: abbreviate(facts.head),
    remoteTip: facts.remoteTip === null ? null : abbreviate(facts.remoteTip),
  };
}

function abbreviate(commit: string): string {
  return commit.slice(0, 7);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeFiles(files: PushedFileCounts): string {
  const parts: string[] = [];
  if (files.added > 0) parts.push(`${plural(files.added, "file")} added`);
  if (files.modified > 0) parts.push(`${files.modified} modified`);
  if (files.deleted > 0) parts.push(`${files.deleted} deleted`);
  if (files.renamed > 0) parts.push(`${files.renamed} renamed`);
  return parts.join(", ");
}

function sentences(...parts: Array<string | null>): string | undefined {
  const text = parts.filter((part) => part).join(" ");
  return text || undefined;
}

/**
 * The banner for a completed push: a one-line headline in `message`, and the
 * measured specifics in `detail`, which the connector renders smaller
 * underneath. The "Successfully pushed to <provider>!" headline is kept
 * verbatim when something was pushed, since tests and page objects look for it.
 */
export function describePushSummary(
  summary: PushSummary,
  providerLabel: string,
): Pick<GithubOpsBanner, "kind" | "message" | "detail"> {
  const branch = summary.pushedBranch;
  const missing = summary.commitsNotOnRemote;
  // Counted against the synced branch on the remote: the commits may exist
  // there under another name, so the branch is named rather than the host.
  const missingSentence =
    missing > 0
      ? `${plural(missing, "commit")} ${missing === 1 ? "is" : "are"} not on ${providerLabel}'s ${branch}.`
      : null;
  // What the sync did to the pushed branch, for the outcomes where the user's
  // own work went nowhere. A repeat click pushes nothing and must say so; an
  // unknown count says nothing rather than guessing.
  const pushedBranchStatus =
    summary.commitsPushed === null
      ? null
      : summary.commitsPushed > 0
        ? `Dyad pushed ${plural(summary.commitsPushed, "commit")} to ${branch}.`
        : `${branch} was already up to date.`;
  switch (summary.outcome) {
    case "pushed": {
      const message = `Successfully pushed to ${providerLabel}!`;
      if (!summary.commitsPushed) {
        return { kind: "success", message };
      }
      const files =
        summary.files && describeFiles(summary.files)
          ? `: ${describeFiles(summary.files)}`
          : "";
      return {
        kind: "success",
        message,
        detail: `${plural(summary.commitsPushed, "commit")} on ${branch}${files}.`,
      };
    }
    case "up-to-date":
      return {
        kind: "success",
        message: `${providerLabel} is already up to date.`,
        detail: `Your latest commit on ${branch} was already on ${providerLabel}.`,
      };
    case "uncommitted-changes":
      return {
        kind: "warning",
        message: `${providerLabel} is up to date, but you have uncommitted changes.`,
        detail:
          `${plural(summary.uncommittedFiles, "changed file")} ` +
          `${summary.uncommittedFiles === 1 ? "hasn't" : "haven't"} been committed yet, ` +
          `so ${summary.uncommittedFiles === 1 ? "it isn't" : "they aren't"} on ${branch}.`,
      };
    case "wrong-branch": {
      const current = summary.currentBranch;
      return {
        kind: "warning",
        message: `You're working on ${current}, but Dyad syncs ${branch}.`,
        detail: sentences(
          pushedBranchStatus,
          missing > 0
            ? `${plural(missing, "commit")} on ${current} ${missing === 1 ? "is" : "are"} not on ${providerLabel}'s ${branch}.`
            : `Everything on ${current} is already on ${providerLabel}'s ${branch}, but new commits on ${current} won't be synced.`,
        ),
      };
    }
    case "detached-head": {
      const detail = sentences(pushedBranchStatus, missingSentence);
      return {
        kind: "warning",
        message:
          missing > 0
            ? "You're not on a branch, so your latest work wasn't pushed."
            : "You're not on a branch, so new commits won't be synced.",
        ...(detail ? { detail } : {}),
      };
    }
    case "unverified":
      if (summary.remoteTip === null || !summary.head) {
        return {
          kind: "warning",
          message: "Dyad couldn't confirm the push.",
          detail:
            summary.remoteTip === null
              ? `Git reported success, but ${providerLabel}'s ${branch} couldn't be read afterwards.`
              : "Git reported success, but your current commit couldn't be read afterwards.",
        };
      }
      return {
        kind: "warning",
        message: `Sync finished, but your latest commit is not on ${providerLabel}.`,
        detail: `Your ${branch} is at ${summary.head}; ${providerLabel}'s ${branch} is at ${summary.remoteTip}.`,
      };
  }
}
