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
  /** Full commit the user is on. */
  head: string;
  /** Full remote branch tip after the push, or null when it could not be read. */
  remoteTip: string | null;
  /** Whether the remote branch tip changed during this sync. */
  remoteMoved: boolean;
  commitsPushed: number | null;
  files: PushedFileCounts | null;
  uncommittedFiles: number;
  commitsNotOnRemote: number;
}

export function classifyPushOutcome(facts: PushFacts): PushOutcome {
  const headOnRemote =
    facts.remoteTip !== null && facts.remoteTip === facts.head;
  if (headOnRemote) {
    if (facts.remoteMoved) return "pushed";
    return facts.uncommittedFiles > 0 ? "uncommitted-changes" : "up-to-date";
  }
  if (facts.currentBranch === null) return "detached-head";
  if (facts.currentBranch !== facts.pushedBranch) return "wrong-branch";
  // The remote tip could not be read: nothing to compare against, so trust
  // the exit code rather than alarm every repository with an unusual remote.
  if (facts.remoteTip === null) return "pushed";
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
  const missing = plural(summary.commitsNotOnRemote, "commit");
  const isAre = summary.commitsNotOnRemote === 1 ? "is" : "are";
  // What the sync did to the pushed branch, for the outcomes where the user's
  // own work went nowhere: a repeat click pushes nothing, and must say so.
  const pushedBranchStatus =
    summary.commitsPushed !== null && summary.commitsPushed > 0
      ? `Dyad pushed ${plural(summary.commitsPushed, "commit")} to ${branch}.`
      : `${branch} was already up to date.`;
  switch (summary.outcome) {
    case "pushed": {
      const message = `Successfully pushed to ${providerLabel}!`;
      if (summary.commitsPushed === null) {
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
    case "wrong-branch":
      return {
        kind: "warning",
        message: `You're working on ${summary.currentBranch}, but Dyad syncs ${branch}.`,
        detail:
          `${pushedBranchStatus} ${missing} on ${summary.currentBranch} ` +
          `${isAre} not on ${providerLabel}.`,
      };
    case "detached-head":
      return {
        kind: "warning",
        message: "You're not on a branch, so your latest work wasn't pushed.",
        detail: `${pushedBranchStatus} ${missing} ${isAre} not on ${providerLabel}.`,
      };
    case "unverified":
      return {
        kind: "warning",
        message: `Sync finished, but your latest commit is not on ${providerLabel}.`,
        detail:
          `Your ${branch} is at ${summary.head}; ${providerLabel}'s ${branch} is at ` +
          `${summary.remoteTip ?? "an unknown commit"}.`,
      };
  }
}
