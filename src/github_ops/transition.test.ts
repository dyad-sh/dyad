import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  assertAllCommandsProducible,
  assertAllStatesReachable,
  commandsOf,
  exploreReachableStates,
  ignoreReasonOf,
} from "@/state_machines/testing";
import {
  INITIAL_GITHUB_OPS_STATE,
  type GithubOperation,
  type GithubOpsEvent,
  type GithubOpsCommand,
  type GithubOpsState,
} from "./state";
import { transition } from "./transition";
import { MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH } from "./error_message";
import { GithubOpsRemoteSnapshotSchema } from "./transport";

const REPRESENTATIVE_OPS: readonly GithubOperation[] = [
  { type: "push", mode: "normal" },
  { type: "push", mode: "lease" },
  { type: "pull" },
  { type: "fetch" },
  { type: "rebase" },
  { type: "rebase-continue" },
  { type: "rebase-abort" },
  { type: "merge-abort" },
  { type: "merge", branch: "feature" },
  { type: "switch", branch: "feature" },
  {
    type: "create-branch",
    name: "feature",
    from: "main",
    thenSwitch: true,
  },
  { type: "delete-branch", branch: "old" },
  { type: "rename-branch", oldBranch: "old", newBranch: "new" },
  { type: "disconnect" },
  {
    type: "connect-repo",
    mode: "existing",
    owner: "dyad",
    repo: "app",
    branch: "main",
    thenAutoPush: true,
  },
];
const STATE_KINDS = [
  "idle",
  "running",
  "conflicted",
  "rebase-paused",
  "switch-blocked",
] as const satisfies readonly GithubOpsState["type"][];
const COMMAND_KINDS = [
  "run-op",
  "probe-git-state",
  "probe-conflicts",
  "invalidate-branches",
  "refresh-app",
  "notify",
  "start-conflict-resolution",
] as const satisfies readonly GithubOpsCommand["type"][];

function explorationStateKey(state: GithubOpsState): string {
  return JSON.stringify(state, (key, value) =>
    key === "verificationAttempt" && value !== undefined ? 1 : value,
  );
}

function eventsFor(state: GithubOpsState): readonly GithubOpsEvent[] {
  const activeOp =
    state.type === "running"
      ? state.op
      : ({ type: "push", mode: "normal" } satisfies GithubOperation);
  return [
    ...REPRESENTATIVE_OPS.map(
      (op): GithubOpsEvent => ({ type: "OP_REQUESTED", op }),
    ),
    { type: "OP_SUCCEEDED", op: activeOp },
    {
      type: "OP_FAILED",
      op: activeOp,
      failure: {
        kind: "conflict",
        message: "conflict",
        code: "MERGE_CONFLICT",
      },
    },
    {
      type: "OP_FAILED",
      op: activeOp,
      failure: {
        kind: "conflict",
        message: "rebase paused",
        code: "REBASE_IN_PROGRESS",
      },
    },
    {
      type: "OP_FAILED",
      op: activeOp,
      failure: {
        kind: "conflict",
        message: "merge paused",
        code: "MERGE_IN_PROGRESS",
      },
    },
    {
      type: "OP_FAILED",
      op: activeOp,
      failure: { kind: "unknown", message: "failed" },
    },
    { type: "CONFLICTS", files: ["src/a.ts"] },
    { type: "CONFLICTS", files: [] },
    { type: "GIT_STATE", mergeInProgress: false, rebaseInProgress: false },
    { type: "GIT_STATE", mergeInProgress: true, rebaseInProgress: false },
    { type: "GIT_STATE", mergeInProgress: false, rebaseInProgress: true },
    { type: "ABORT_AND_SWITCH_CONFIRMED" },
    { type: "BLOCKED_DISMISSED" },
    { type: "RESOLVE_WITH_AI_STARTED" },
    { type: "CONFLICT_RESOLUTION_STARTED", chatId: 42 },
    ...(state.type === "conflicted" && state.resolution === "resolving"
      ? ([
          {
            type: "CONFLICT_RESOLUTION_FINISHED",
            chatId: state.resolutionChatId ?? 42,
          },
        ] satisfies GithubOpsEvent[])
      : []),
    ...(state.type === "conflicted" && state.resolution === "checking"
      ? ([
          {
            type: "CONFLICT_VERIFICATION_FAILED",
            verificationAttempt: state.verificationAttempt ?? 1,
            message: "Could not verify the resolved conflicts",
          },
        ] satisfies GithubOpsEvent[])
      : []),
    { type: "BANNER_DISMISSED" },
    { type: "RETRY_CONFLICT_VERIFICATION" },
    { type: "RECONCILE_REQUESTED" },
  ];
}

describe("github_ops transition", () => {
  it("reaches every state and produces every command kind", () => {
    const options = {
      initialState: INITIAL_GITHUB_OPS_STATE,
      events: eventsFor,
      transition,
      stateKey: explorationStateKey,
      maxStates: 2_000,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind: (state) => state.type,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command) => command.type,
    });
  });

  it("is total over the reachable composite and recovery graph", () => {
    const graph = exploreReachableStates({
      initialState: INITIAL_GITHUB_OPS_STATE,
      events: eventsFor,
      transition,
      stateKey: explorationStateKey,
      maxStates: 2_000,
    });
    const states = graph.nodes.map(({ state }) => state);

    expect(states.some((state) => state.type === "conflicted")).toBe(true);
    expect(states.some((state) => state.type === "rebase-paused")).toBe(true);
    expect(states.some((state) => state.type === "switch-blocked")).toBe(true);
    expect(
      states.some(
        (state) =>
          state.type === "running" &&
          state.op.type === "rebase" &&
          state.next?.type === "push",
      ),
    ).toBe(true);
    expect(
      states.some(
        (state) =>
          state.type === "running" &&
          state.op.type === "create-branch" &&
          state.next?.type === "switch",
      ),
    ).toBe(true);

    for (const state of states) {
      for (const event of eventsFor(state)) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        try {
          assertReferenceStability(
            state,
            result,
            (left, right) => JSON.stringify(left) === JSON.stringify(right),
          );
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} for ${JSON.stringify({ state, event, result })}`,
          );
        }
      }
    }
  });

  it("ignores user-enqueued work while an operation is running", () => {
    const running = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: { type: "push", mode: "normal" },
    }).state;
    const result = transition(running, {
      type: "OP_REQUESTED",
      op: { type: "pull" },
    });

    expect(result.state).toBe(running);
    expect(ignoreReasonOf(result)).toBe("op-in-flight");
  });

  it("sequences reconciliation so rebase provenance reaches conflicts", () => {
    const reconcile = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "RECONCILE_REQUESTED",
    });
    expect(commandsOf(reconcile)).toEqual([{ type: "probe-git-state" }]);

    const gitState = transition(reconcile.state, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: true,
    });
    expect(gitState.state.type).toBe("rebase-paused");
    expect(commandsOf(gitState)).toEqual([{ type: "probe-conflicts" }]);

    const conflicts = transition(gitState.state, {
      type: "CONFLICTS",
      files: ["src/conflicted.ts"],
    });
    expect(conflicts.state).toMatchObject({
      type: "conflicted",
      origin: { type: "rebase" },
    });
  });

  it("updates reconciled conflict provenance when git reports a rebase", () => {
    const conflicted: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "reconcile" },
      banner: null,
    };

    const result = transition(conflicted, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: true,
    });

    expect(result.state).toEqual({
      ...conflicted,
      origin: { type: "rebase" },
    });
    expect(commandsOf(result)).toEqual([{ type: "probe-conflicts" }]);
  });

  it("replaces stale success context when reconciliation finds a paused rebase", () => {
    const result = transition(
      {
        type: "idle",
        banner: { kind: "success", message: "Successfully pushed to GitHub!" },
      },
      {
        type: "GIT_STATE",
        mergeInProgress: false,
        rebaseInProgress: true,
      },
    );

    expect(result.state).toMatchObject({
      type: "rebase-paused",
      banner: {
        kind: "error",
        code: "REBASE_IN_PROGRESS",
      },
    });
    expect(commandsOf(result)).toEqual([{ type: "probe-conflicts" }]);
  });

  it.each([
    { type: "rebase" },
    { type: "rebase-continue" },
    { type: "rebase-abort" },
  ] satisfies readonly GithubOperation[])(
    "reconciles recovery after an uncoded $type failure",
    (op) => {
      const running = transition(INITIAL_GITHUB_OPS_STATE, {
        type: "OP_REQUESTED",
        op,
      }).state;
      const failed = transition(running, {
        type: "OP_FAILED",
        op,
        failure: { kind: "unknown", message: "git failed" },
      });

      expect(failed.state).toMatchObject({
        type: "idle",
        banner: { kind: "error", message: "git failed" },
      });
      expect(commandsOf(failed)).toEqual([
        { type: "notify", kind: "error", message: "git failed" },
        { type: "probe-git-state" },
      ]);

      const reconciled = transition(failed.state, {
        type: "GIT_STATE",
        mergeInProgress: false,
        rebaseInProgress: true,
      });
      expect(reconciled.state.type).toBe("rebase-paused");
      expect(commandsOf(reconciled)).toEqual([{ type: "probe-conflicts" }]);
    },
  );

  it("retains conflicts until AI conflict resolution has actually started", () => {
    const conflicted: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: null,
    };

    const started = transition(conflicted, {
      type: "RESOLVE_WITH_AI_STARTED",
    });

    expect(started.state).toBe(conflicted);
    expect(commandsOf(started)).toEqual([
      {
        type: "start-conflict-resolution",
        files: conflicted.files,
      },
    ]);
  });

  it("moves a resolved sync conflict to an explicit continuation state", () => {
    const conflicted: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      banner: null,
    };

    const resolving = transition(conflicted, {
      type: "CONFLICT_RESOLUTION_STARTED",
      chatId: 42,
    });
    expect(resolving.state).toEqual({
      ...conflicted,
      resolution: "resolving",
      resolutionChatId: 42,
    });

    const reconciling = transition(resolving.state, {
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 42,
    });
    expect(commandsOf(reconciling)).toEqual([
      { type: "probe-git-state", verificationAttempt: 1 },
    ]);
    const checkedGitState = transition(reconciling.state, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: false,
      verificationAttempt: 1,
    });
    const ready = transition(checkedGitState.state, {
      type: "CONFLICTS",
      files: [],
      verificationAttempt: 1,
    });
    expect(ready.state).toEqual({
      ...conflicted,
      resolution: "ready-to-sync",
      resolutionChatId: 42,
      verificationAttempt: 1,
    });

    const continued = transition(ready.state, {
      type: "OP_REQUESTED",
      op: { type: "push", mode: "normal" },
    });
    expect(continued.state).toMatchObject({
      type: "running",
      op: { type: "push", mode: "normal" },
    });
  });

  it("keeps ambient clean probes in resolving until the chat finishes", () => {
    const resolving: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "resolving",
      banner: null,
    };

    const result = transition(resolving, { type: "CONFLICTS", files: [] });

    expect(result.state).toBe(resolving);
    expect(ignoreReasonOf(result)).toBe("no-change");
  });

  it("rejects completion from an older conflict-resolution chat", () => {
    const resolving: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "resolving",
      resolutionChatId: 42,
      banner: null,
    };

    const result = transition(resolving, {
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 41,
    });

    expect(result.state).toBe(resolving);
    expect(ignoreReasonOf(result)).toBe("stale-op");
  });

  it("offers an explicit retry when conflict verification fails", () => {
    const checking: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "checking",
      resolutionChatId: 42,
      verificationAttempt: 1,
      banner: null,
    };

    const failed = transition(checking, {
      type: "CONFLICT_VERIFICATION_FAILED",
      verificationAttempt: 1,
      message: "temporary Git-state failure",
    });
    expect(failed.state).toEqual({
      ...checking,
      resolution: "verification-failed",
      verificationError: "temporary Git-state failure",
    });
    expect(commandsOf(failed)).toEqual([]);

    const ambientProbe = transition(failed.state, {
      type: "CONFLICTS",
      files: [],
    });
    expect(ambientProbe.state).toBe(failed.state);
    expect(ignoreReasonOf(ambientProbe)).toBe("no-change");

    const retry = transition(failed.state, {
      type: "RETRY_CONFLICT_VERIFICATION",
    });
    expect(retry.state).toEqual({
      ...checking,
      verificationAttempt: 2,
      verificationError: undefined,
    });
    expect(commandsOf(retry)).toEqual([
      { type: "probe-git-state", verificationAttempt: 2 },
    ]);
  });

  it("rejects results from an older verification attempt", () => {
    const checking: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "checking",
      resolutionChatId: 42,
      verificationAttempt: 2,
      banner: null,
    };
    const staleEvents: GithubOpsEvent[] = [
      {
        type: "CONFLICT_VERIFICATION_FAILED",
        verificationAttempt: 1,
        message: "stale failure",
      },
      {
        type: "GIT_STATE",
        mergeInProgress: false,
        rebaseInProgress: false,
        verificationAttempt: 1,
      },
      { type: "CONFLICTS", files: [], verificationAttempt: 1 },
    ];

    for (const event of staleEvents) {
      const result = transition(checking, event);
      expect(result.state).toBe(checking);
      expect(ignoreReasonOf(result)).toBe("stale-op");
    }
  });

  it("continues an active rebase before pushing resolved changes", () => {
    const checking: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "rebase" },
      resolution: "checking",
      banner: null,
    };
    const gitState = transition(checking, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: true,
    });
    const ready = transition(gitState.state, {
      type: "CONFLICTS",
      files: [],
    });
    const continued = transition(ready.state, {
      type: "OP_REQUESTED",
      op: { type: "rebase-continue" },
    });

    expect(continued.state).toMatchObject({
      type: "running",
      op: { type: "rebase-continue" },
      next: { type: "push", mode: "normal" },
    });
  });

  it("pushes directly when the AI already completed the rebase", () => {
    const checking: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "rebase" },
      resolution: "checking",
      banner: null,
    };

    const gitState = transition(checking, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: false,
    });

    expect(gitState.state).toMatchObject({
      type: "conflicted",
      origin: { type: "push", mode: "normal" },
    });
  });

  it("keeps ready-to-sync visible across repository reconciliation", () => {
    const ready: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "ready-to-sync",
      banner: null,
    };

    const gitState = transition(ready, {
      type: "GIT_STATE",
      mergeInProgress: false,
      rebaseInProgress: false,
    });
    const conflicts = transition(gitState.state, {
      type: "CONFLICTS",
      files: [],
    });

    expect(conflicts.state).toBe(gitState.state);
    expect(ignoreReasonOf(conflicts)).toBe("no-change");
  });

  it("uses the dedicated recovery surface with one background-sync notice", () => {
    const push = { type: "push", mode: "normal" } as const;
    const running = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: push,
    }).state;
    const probing = transition(running, {
      type: "OP_FAILED",
      op: push,
      failure: {
        kind: "conflict",
        code: "MERGE_CONFLICT",
        message: "merge conflict",
      },
    }).state;
    const conflicted = transition(probing, {
      type: "CONFLICTS",
      files: ["src/conflicted.ts"],
    });

    expect(conflicted.state).toMatchObject({
      type: "conflicted",
      banner: null,
    });
    expect(commandsOf(conflicted)).toEqual([
      {
        type: "notify",
        kind: "info",
        message: "Sync paused. Resolve merge conflicts to continue.",
      },
    ]);
  });

  it("returns to actionable conflicts when AI leaves conflicts unresolved", () => {
    const resolving: GithubOpsState = {
      type: "conflicted",
      files: ["src/old.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: "resolving",
      resolutionChatId: 42,
      banner: null,
    };

    const stillResolving = transition(resolving, {
      type: "CONFLICTS",
      files: ["src/still-conflicted.ts"],
    });
    expect(stillResolving.state).toEqual({
      ...resolving,
      files: ["src/still-conflicted.ts"],
    });

    const checking = transition(stillResolving.state, {
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: 42,
    });
    expect(
      transition(checking.state, {
        type: "CONFLICTS",
        files: ["src/still-conflicted.ts"],
        verificationAttempt: 1,
      }).state,
    ).toEqual({
      type: "conflicted",
      files: ["src/still-conflicted.ts"],
      origin: { type: "push", mode: "normal" },
      resolution: undefined,
      resolutionChatId: undefined,
      verificationAttempt: undefined,
      banner: null,
    });
  });

  it("atomically clears conflicted UI when abort-and-switch begins", () => {
    const merge = { type: "merge", branch: "feature" } as const;
    const switchBranch = { type: "switch", branch: "release" } as const;
    const runningMerge = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: merge,
    }).state;
    const probingConflicts = transition(runningMerge, {
      type: "OP_FAILED",
      op: merge,
      failure: {
        kind: "conflict",
        code: "MERGE_CONFLICT",
        message: "merge failed",
      },
    }).state;
    const conflicted = transition(probingConflicts, {
      type: "CONFLICTS",
      files: ["src/conflicted.ts"],
    }).state;
    const runningSwitch = transition(conflicted, {
      type: "OP_REQUESTED",
      op: switchBranch,
    }).state;
    const blocked = transition(runningSwitch, {
      type: "OP_FAILED",
      op: switchBranch,
      failure: {
        kind: "conflict",
        code: "MERGE_IN_PROGRESS",
        message: "merge still in progress",
      },
    }).state;
    const confirmed = transition(blocked, {
      type: "ABORT_AND_SWITCH_CONFIRMED",
    });

    expect(conflicted).toMatchObject({
      type: "conflicted",
      files: ["src/conflicted.ts"],
    });
    expect(blocked).toMatchObject({
      type: "switch-blocked",
      target: "release",
      blockingOp: "merge",
    });
    expect(confirmed.state).toEqual({
      type: "running",
      op: { type: "merge-abort" },
      next: switchBranch,
      banner: null,
    });
    expect(confirmed.state).not.toHaveProperty("files");
  });

  it("restores conflicts when abort-and-switch is dismissed", () => {
    const conflicted: GithubOpsState = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: null,
    };
    const switchBranch = {
      type: "switch",
      branch: "release",
    } as const;
    const running = transition(conflicted, {
      type: "OP_REQUESTED",
      op: switchBranch,
    }).state;
    const blocked = transition(running, {
      type: "OP_FAILED",
      op: switchBranch,
      failure: {
        kind: "conflict",
        code: "MERGE_IN_PROGRESS",
        message: "merge still in progress",
      },
    }).state;
    const dismissed = transition(blocked, { type: "BLOCKED_DISMISSED" });

    expect(dismissed.state).toMatchObject({
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "merge", branch: "feature" },
    });
  });

  it("offers abort-and-switch from a paused rebase", () => {
    const switchBranch = {
      type: "switch",
      branch: "release",
    } as const;
    const running = transition(
      { type: "rebase-paused", banner: null },
      { type: "OP_REQUESTED", op: switchBranch },
    ).state;
    const blocked = transition(running, {
      type: "OP_FAILED",
      op: switchBranch,
      failure: {
        kind: "conflict",
        code: "REBASE_IN_PROGRESS",
        message: "rebase still in progress",
      },
    }).state;

    expect(running).toMatchObject({
      type: "running",
      op: switchBranch,
      blockedSwitchResume: { type: "rebase-paused" },
    });
    expect(blocked).toMatchObject({
      type: "switch-blocked",
      target: "release",
      blockingOp: "rebase",
      resume: { type: "rebase-paused" },
    });
    expect(
      transition(blocked, { type: "BLOCKED_DISMISSED" }).state,
    ).toMatchObject({ type: "rebase-paused" });
  });

  it("preserves connect success context when the automatic push fails", () => {
    const connect: GithubOperation = {
      type: "connect-repo",
      mode: "create",
      org: "",
      repo: "demo",
      thenAutoPush: true,
    };
    const runningConnect = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: connect,
    }).state;
    const runningPush = transition(runningConnect, {
      type: "OP_SUCCEEDED",
      op: connect,
    }).state;

    expect(runningPush).toMatchObject({
      type: "running",
      op: { type: "push", mode: "normal" },
      banner: { kind: "success" },
    });

    const failedPush = transition(runningPush, {
      type: "OP_FAILED",
      op: { type: "push", mode: "normal" },
      failure: {
        kind: "unknown",
        message: `push rejected ${"x".repeat(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH)}`,
      },
    });
    expect(failedPush.state.banner).toMatchObject({
      kind: "error",
      message: expect.stringContaining("created and linked"),
    });
    expect(failedPush.state.banner?.message).toContain("push rejected");
    expect(failedPush.state.banner?.message).toHaveLength(
      MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH,
    );
    expect(
      GithubOpsRemoteSnapshotSchema.safeParse({
        appId: 7,
        revision: 1,
        state: failedPush.state,
        activeInvocationRef: null,
        conflictResolutionClaimed: false,
      }).success,
    ).toBe(true);
  });

  it("reports rebase success only after its composite push completes", () => {
    const rebase: GithubOperation = { type: "rebase" };
    const runningRebase = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: rebase,
    }).state;
    const runningPush = transition(runningRebase, {
      type: "OP_SUCCEEDED",
      op: rebase,
    }).state;
    const completed = transition(runningPush, {
      type: "OP_SUCCEEDED",
      op: { type: "push", mode: "normal" },
    });

    expect(runningPush.banner?.message).toBe("Rebase completed successfully.");
    expect(completed.state.banner?.message).toBe(
      "Successfully pushed to GitHub!",
    );
  });

  it("renders operation success through the banner without a duplicate toast", () => {
    const pull = { type: "pull" } as const;
    const running = transition(INITIAL_GITHUB_OPS_STATE, {
      type: "OP_REQUESTED",
      op: pull,
    }).state;
    const completed = transition(running, {
      type: "OP_SUCCEEDED",
      op: pull,
    });

    expect(completed.state.banner?.message).toBe(
      "Pulled latest changes from remote",
    );
    expect(completed.state.banner?.completedOperation).toBe("pull");
    expect(commandsOf(completed)).toEqual([
      { type: "invalidate-branches" },
      { type: "refresh-app" },
    ]);
  });
});
