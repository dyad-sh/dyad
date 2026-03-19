import type { GitCommit } from "../git_types";

export interface SupabaseVersionRecord {
  commitHash: string;
  supabaseUndoSql: string | null;
}

export interface SupabaseRollbackPlan {
  status: "ready" | "no_db_changes" | "missing_undo" | "target_not_reachable";
  versionsToUndo: SupabaseVersionRecord[];
  missingUndoVersions: SupabaseVersionRecord[];
  composedUndoSql: string | null;
}

const REVERT_COMMIT_MESSAGE =
  /^Reverted all changes back to version ([a-f0-9]{7,40})$/;

export function buildStoredUndoSql(undoSqlParts: string[]): string | null {
  const normalizedParts = undoSqlParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (normalizedParts.length === 0) {
    return null;
  }

  return [...normalizedParts].reverse().join("\n");
}

export function extractRevertTargetCommitHash(
  commitMessage: string,
): string | null {
  const match = commitMessage.trim().match(REVERT_COMMIT_MESSAGE);
  return match?.[1] ?? null;
}

export function planSupabaseRollback({
  versions,
  commits,
  currentHeadCommitHash,
  targetCommitHash,
}: {
  versions: SupabaseVersionRecord[];
  commits: GitCommit[];
  currentHeadCommitHash: string;
  targetCommitHash: string;
}): SupabaseRollbackPlan {
  if (currentHeadCommitHash === targetCommitHash) {
    return {
      status: "no_db_changes",
      versionsToUndo: [],
      missingUndoVersions: [],
      composedUndoSql: null,
    };
  }

  const commitIndexMap = new Map<string, number>();
  const commitMap = new Map<string, GitCommit>();
  commits.forEach((commit, index) => {
    commitIndexMap.set(commit.oid, index);
    commitMap.set(commit.oid, commit);
  });

  if (!commitMap.has(targetCommitHash)) {
    return {
      status: "target_not_reachable",
      versionsToUndo: [],
      missingUndoVersions: [],
      composedUndoSql: null,
    };
  }

  const versionMap = new Map<string, SupabaseVersionRecord>();
  versions.forEach((version) => {
    versionMap.set(version.commitHash, version);
  });

  const visitedCommits = new Set<string>();
  const versionsToUndo: SupabaseVersionRecord[] = [];
  const missingUndoVersions: SupabaseVersionRecord[] = [];
  let cursorCommitHash = currentHeadCommitHash;

  while (cursorCommitHash !== targetCommitHash) {
    if (visitedCommits.has(cursorCommitHash)) {
      return {
        status: "target_not_reachable",
        versionsToUndo: [],
        missingUndoVersions: [],
        composedUndoSql: null,
      };
    }
    visitedCommits.add(cursorCommitHash);

    const commit = commitMap.get(cursorCommitHash);
    if (!commit) {
      return {
        status: "target_not_reachable",
        versionsToUndo: [],
        missingUndoVersions: [],
        composedUndoSql: null,
      };
    }

    const revertTargetCommitHash = extractRevertTargetCommitHash(
      commit.commit.message,
    );
    if (
      revertTargetCommitHash &&
      commitIndexMap.has(revertTargetCommitHash) &&
      revertTargetCommitHash !== cursorCommitHash
    ) {
      cursorCommitHash = revertTargetCommitHash;
      continue;
    }

    const version = versionMap.get(cursorCommitHash);
    if (version) {
      versionsToUndo.push(version);
      if (!version.supabaseUndoSql) {
        missingUndoVersions.push(version);
      }
    }

    const commitIndex = commitIndexMap.get(cursorCommitHash);
    if (commitIndex === undefined || commitIndex + 1 >= commits.length) {
      return {
        status: "target_not_reachable",
        versionsToUndo: [],
        missingUndoVersions: [],
        composedUndoSql: null,
      };
    }

    cursorCommitHash = commits[commitIndex + 1].oid;
  }

  if (versionsToUndo.length === 0) {
    return {
      status: "no_db_changes",
      versionsToUndo,
      missingUndoVersions: [],
      composedUndoSql: null,
    };
  }

  if (missingUndoVersions.length > 0) {
    return {
      status: "missing_undo",
      versionsToUndo,
      missingUndoVersions,
      composedUndoSql: null,
    };
  }

  return {
    status: "ready",
    versionsToUndo,
    missingUndoVersions: [],
    composedUndoSql: versionsToUndo
      .map((version) => version.supabaseUndoSql!)
      .join("\n"),
  };
}
