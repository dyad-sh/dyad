import { describe, expect, it } from "vitest";
import type { GitCommit } from "@/ipc/git_types";
import {
  buildStoredUndoSql,
  planSupabaseRollback,
} from "@/ipc/utils/supabase_rollback_utils";

function makeCommit(oid: string, message = oid): GitCommit {
  return {
    oid,
    commit: {
      message,
      author: {
        timestamp: 0,
      },
    },
  };
}

const c0 = "0000000";
const c1 = "1111111";
const c2 = "2222222";
const c3 = "3333333";
const c4 = "4444444";
const c5 = "5555555";
const r0 = "aaaaaa0";
const r1 = "aaaaaa1";

describe("buildStoredUndoSql", () => {
  it("reverses per-turn SQL blocks so the latest query is undone first", () => {
    expect(buildStoredUndoSql(["UNDO_FIRST;", "UNDO_SECOND;"])).toBe(
      "UNDO_SECOND;\nUNDO_FIRST;",
    );
  });

  it("returns null when every part is blank", () => {
    expect(buildStoredUndoSql(["  ", "\n"])).toBeNull();
  });
});

describe("planSupabaseRollback", () => {
  it("collects undo SQL from newest to oldest on a straight history", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: "UNDO_C2;" },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [makeCommit(c3), makeCommit(c2), makeCommit(c1), makeCommit(c0)],
      currentHeadCommitHash: c3,
      targetCommitHash: c0,
    });

    expect(plan).toMatchObject({
      status: "ready",
      composedUndoSql: "UNDO_C3;\nUNDO_C2;\nUNDO_C1;",
    });
    expect(plan.versionsToUndo.map((version) => version.commitHash)).toEqual([
      c3,
      c2,
      c1,
    ]);
  });

  it("jumps to the restored target after a revert commit", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: "UNDO_C2;" },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [
        makeCommit(r1, `Reverted all changes back to version ${c1}`),
        makeCommit(c3),
        makeCommit(c2),
        makeCommit(c1),
        makeCommit(c0),
      ],
      currentHeadCommitHash: r1,
      targetCommitHash: c0,
    });

    expect(plan).toMatchObject({
      status: "ready",
      composedUndoSql: "UNDO_C1;",
    });
    expect(plan.versionsToUndo.map((version) => version.commitHash)).toEqual([
      c1,
    ]);
  });

  it("keeps following the restored state across later code-only commits", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: "UNDO_C2;" },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [
        makeCommit(c4, "code-only change"),
        makeCommit(r1, `Reverted all changes back to version ${c1}`),
        makeCommit(c3),
        makeCommit(c2),
        makeCommit(c1),
        makeCommit(c0),
      ],
      currentHeadCommitHash: c4,
      targetCommitHash: c0,
    });

    expect(plan).toMatchObject({
      status: "ready",
      composedUndoSql: "UNDO_C1;",
    });
    expect(plan.versionsToUndo.map((version) => version.commitHash)).toEqual([
      c1,
    ]);
  });

  it("does not re-undo versions that were already removed by an earlier revert", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c5, supabaseUndoSql: "UNDO_C5;" },
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: "UNDO_C2;" },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [
        makeCommit(c5),
        makeCommit(r0, `Reverted all changes back to version ${c0}`),
        makeCommit(c3),
        makeCommit(c2),
        makeCommit(c1),
        makeCommit(c0),
      ],
      currentHeadCommitHash: c5,
      targetCommitHash: c0,
    });

    expect(plan).toMatchObject({
      status: "ready",
      composedUndoSql: "UNDO_C5;",
    });
    expect(plan.versionsToUndo.map((version) => version.commitHash)).toEqual([
      c5,
    ]);
  });

  it("refuses partial rollback when an intermediate version is missing undo SQL", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: null },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [makeCommit(c3), makeCommit(c2), makeCommit(c1), makeCommit(c0)],
      currentHeadCommitHash: c3,
      targetCommitHash: c0,
    });

    expect(plan.status).toBe("missing_undo");
    expect(plan.composedUndoSql).toBeNull();
    expect(
      plan.missingUndoVersions.map((version) => version.commitHash),
    ).toEqual([c2]);
  });

  it("marks the target as unreachable when the current DB state was restored past it", () => {
    const plan = planSupabaseRollback({
      versions: [
        { commitHash: c3, supabaseUndoSql: "UNDO_C3;" },
        { commitHash: c2, supabaseUndoSql: "UNDO_C2;" },
        { commitHash: c1, supabaseUndoSql: "UNDO_C1;" },
      ],
      commits: [
        makeCommit(r1, `Reverted all changes back to version ${c1}`),
        makeCommit(c3),
        makeCommit(c2),
        makeCommit(c1),
        makeCommit(c0),
      ],
      currentHeadCommitHash: r1,
      targetCommitHash: c2,
    });

    expect(plan).toMatchObject({
      status: "target_not_reachable",
      composedUndoSql: null,
    });
  });
});
