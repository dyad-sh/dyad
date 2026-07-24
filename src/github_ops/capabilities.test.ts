import { describe, expect, it } from "vitest";
import { assertCapabilityTransitionConsistency } from "@/state_machines/testing";
import { selectGithubOpsCapabilities } from "./capabilities";
import type { GithubOperation, GithubOpsEvent, GithubOpsState } from "./state";
import { transition } from "./transition";

const idle = { type: "idle", banner: null } satisfies GithubOpsState;
const states: GithubOpsState[] = [
  idle,
  {
    type: "idle",
    banner: {
      kind: "error",
      code: "NON_FAST_FORWARD",
      message: "force push available",
    },
  },
  {
    type: "idle",
    banner: {
      kind: "error",
      code: "DIVERGENT_BRANCHES",
      message: "rebase available",
    },
  },
  {
    type: "running",
    op: { type: "push", mode: "normal" },
    banner: null,
  },
  {
    type: "conflicted",
    files: ["src/conflicted.ts"],
    origin: { type: "merge", branch: "feature" },
    banner: null,
  },
  {
    type: "conflicted",
    files: ["src/conflicted.ts"],
    origin: { type: "rebase" },
    banner: null,
  },
  { type: "rebase-paused", banner: null },
  {
    type: "switch-blocked",
    target: "feature",
    blockingOp: "merge",
    hasConflicts: false,
    banner: null,
  },
];

function request(op: GithubOperation): GithubOpsEvent {
  return { type: "OP_REQUESTED", op };
}

describe("github_ops capabilities", () => {
  it("keeps every enabled control consistent with the transition", () => {
    expect(() =>
      assertCapabilityTransitionConsistency({
        states,
        selectCapabilities: selectGithubOpsCapabilities,
        transition,
        cases: {
          canSync: {
            representativeEvents: () => ({
              valid: [request({ type: "push", mode: "normal" })],
            }),
          },
          canDisconnect: {
            representativeEvents: () => ({
              valid: [request({ type: "disconnect" })],
            }),
          },
          canAbortRebase: {
            representativeEvents: () => ({
              valid: [request({ type: "rebase-abort" })],
            }),
          },
          canContinueRebase: {
            representativeEvents: () => ({
              valid: [request({ type: "rebase-continue" })],
            }),
          },
          canSafeForcePush: {
            representativeEvents: () => ({
              valid: [request({ type: "push", mode: "lease" })],
            }),
          },
          canForcePush: {
            representativeEvents: () => ({
              valid: [request({ type: "push", mode: "force" })],
            }),
          },
          canRebaseAndSync: {
            representativeEvents: () => ({
              valid: [request({ type: "rebase" })],
            }),
          },
          canResolveConflicts: {
            representativeEvents: () => ({
              valid: [
                { type: "RESOLVE_WITH_AI_STARTED" } satisfies GithubOpsEvent,
              ],
            }),
            disabledReason: "invalid-in-current-state",
          },
          canCancelSync: {
            representativeEvents: (state) => ({
              valid: [
                request({
                  type:
                    state.type === "conflicted" &&
                    state.origin.type !== "reconcile" &&
                    state.origin.type.startsWith("rebase")
                      ? "rebase-abort"
                      : "merge-abort",
                }),
              ],
            }),
          },
          canMutateBranches: {
            representativeEvents: () => ({
              valid: [
                request({ type: "pull" }),
                request({
                  type: "create-branch",
                  name: "feature",
                  thenSwitch: true,
                }),
                request({ type: "merge", branch: "feature" }),
                request({ type: "delete-branch", branch: "old" }),
                request({
                  type: "rename-branch",
                  oldBranch: "old",
                  newBranch: "new",
                }),
              ],
            }),
          },
          canSwitchBranches: {
            representativeEvents: () => ({
              valid: [request({ type: "switch", branch: "feature" })],
            }),
          },
          canConfirmBlockedSwitch: {
            representativeEvents: () => ({
              valid: [
                {
                  type: "ABORT_AND_SWITCH_CONFIRMED",
                } satisfies GithubOpsEvent,
              ],
            }),
            disabledReason: "invalid-in-current-state",
          },
          canDismissBlockedSwitch: {
            representativeEvents: () => ({
              valid: [{ type: "BLOCKED_DISMISSED" } satisfies GithubOpsEvent],
            }),
            disabledReason: "invalid-in-current-state",
          },
          canConnectRepository: {
            representativeEvents: () => ({
              valid: [
                request({
                  type: "connect-repo",
                  mode: "existing",
                  owner: "dyad",
                  repo: "app",
                  branch: "main",
                  thenAutoPush: true,
                }),
                request({
                  type: "connect-repo",
                  mode: "create",
                  org: "dyad",
                  repo: "app",
                  thenAutoPush: true,
                }),
              ],
            }),
          },
        },
      }),
    ).not.toThrow();
  });
});
