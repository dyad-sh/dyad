import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  exploreReachableStates,
} from "@/state_machines/testing";
import {
  INITIAL_GITHUB_OPS_STATE,
  type GithubOperation,
  type GithubOpsEvent,
  type GithubOpsState,
} from "./state";
import { transition } from "./transition";

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
    { type: "BANNER_DISMISSED" },
    { type: "RECONCILE_REQUESTED" },
  ];
}

describe("github_ops transition", () => {
  it("is total over the reachable composite and recovery graph", () => {
    const states = exploreReachableStates({
      initialState: INITIAL_GITHUB_OPS_STATE,
      events: eventsFor,
      transition,
      stateKey: (state) => JSON.stringify(state),
      maxStates: 500,
    });

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
    expect(result.ignoredReason).toBe("op-in-flight");
  });
});
