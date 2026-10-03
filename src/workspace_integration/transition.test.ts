import { describe, expect, it } from "vitest";
import {
  driveTransitionMatrix,
  exploreReachableStates,
} from "@/state_machines/testing";
import {
  IDLE_INTEGRATION_STATE,
  INTEGRATION_PHASES,
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  selectIntegrationCapabilities,
  type IntegrationEvent,
  type IntegrationState,
} from "./state";
import { transitionIntegration } from "./transition";

const TARGET = "a".repeat(40);
const NEWER_TARGET = "b".repeat(40);

const events: IntegrationEvent[] = [
  { type: "REQUESTED", userInitiated: false },
  { type: "REQUESTED", userInitiated: true },
  { type: "STARTED", targetCommit: TARGET },
  { type: "WAITING", reason: "The app is on another branch." },
  { type: "MERGE_CLEAN" },
  { type: "NOTHING_TO_INTEGRATE" },
  { type: "MERGE_CONFLICTED", conflictedFiles: ["src/App.tsx"] },
  { type: "REPAIR_SETTLED", outcome: "resolved" },
  { type: "REPAIR_SETTLED", outcome: "unresolved" },
  { type: "REPAIR_SETTLED", outcome: "interrupted" },
  { type: "VALIDATION_PASSED" },
  { type: "VALIDATION_FAILED", summary: "build: failed" },
  { type: "TARGET_ADVANCED", targetCommit: NEWER_TARGET },
  { type: "INTEGRATED" },
  { type: "FAILED", reason: "boom" },
];

function stateIn(
  phase: IntegrationState["phase"],
  overrides: Partial<IntegrationState> = {},
): IntegrationState {
  return {
    ...IDLE_INTEGRATION_STATE,
    phase,
    targetCommit:
      phase === "merging" || phase === "validating" || phase === "integrating"
        ? TARGET
        : null,
    ...overrides,
  };
}

const states = INTEGRATION_PHASES.flatMap((phase) => [
  stateIn(phase),
  stateIn(phase, { repairAttempts: MAX_AUTOMATIC_REPAIR_ATTEMPTS }),
]);

describe("workspace integration transitions", () => {
  it("is total over every phase and event", () => {
    const results = driveTransitionMatrix({
      states,
      events,
      transition: transitionIntegration,
    });
    expect(results).toHaveLength(states.length * events.length);
    for (const result of results) {
      if (result.kind === "ignored") {
        expect("commands" in result).toBe(false);
      }
    }
  });

  it("keeps the exact state reference when an event is ignored", () => {
    for (const state of states) {
      for (const event of events) {
        const result = transitionIntegration(state, event);
        if (result.kind === "ignored") {
          expect(result.state).toBe(state);
        } else {
          expect(result.state).not.toBe(state);
        }
      }
    }
  });

  it("runs a clean integration from request to merged", () => {
    let state = IDLE_INTEGRATION_STATE;
    const step = (event: IntegrationEvent) => {
      const result = transitionIntegration(state, event);
      expect(result.kind).toBe("applied");
      state = result.state;
      return result.kind === "applied" ? result.commands : [];
    };
    expect(step({ type: "REQUESTED", userInitiated: false })).toEqual([
      { type: "schedule" },
    ]);
    expect(state.phase).toBe("queued");
    expect(step({ type: "STARTED", targetCommit: TARGET })).toEqual([
      { type: "merge", targetCommit: TARGET },
    ]);
    expect(step({ type: "MERGE_CLEAN" })).toEqual([{ type: "validate" }]);
    expect(state.phase).toBe("validating");
    expect(step({ type: "VALIDATION_PASSED" })).toEqual([
      { type: "integrate", targetCommit: TARGET },
    ]);
    expect(step({ type: "INTEGRATED" })).toEqual([]);
    expect(state).toEqual({
      phase: "merged",
      detail: null,
      targetCommit: null,
      repairAttempts: 0,
    });
  });

  it("re-merges and re-validates when the target advanced after validation", () => {
    const result = transitionIntegration(stateIn("integrating"), {
      type: "TARGET_ADVANCED",
      targetCommit: NEWER_TARGET,
    });
    expect(result).toMatchObject({
      kind: "applied",
      state: { phase: "merging", targetCommit: NEWER_TARGET },
      commands: [{ type: "merge", targetCommit: NEWER_TARGET }],
    });
  });

  it("resumes the originating chat for conflicts until the attempt budget is spent", () => {
    let state = stateIn("merging");
    for (let attempt = 1; attempt <= MAX_AUTOMATIC_REPAIR_ATTEMPTS; attempt++) {
      const conflicted = transitionIntegration(state, {
        type: "MERGE_CONFLICTED",
        conflictedFiles: ["src/App.tsx"],
      });
      expect(conflicted).toMatchObject({
        kind: "applied",
        state: { phase: "resolving-conflicts", repairAttempts: attempt },
        commands: [
          {
            type: "dispatch-repair",
            conflictedFiles: ["src/App.tsx"],
            attempt,
          },
        ],
      });
      // The repair turn left conflicts; a later merge attempt finds them again.
      state = { ...conflicted.state, phase: "merging" };
    }
    const exhausted = transitionIntegration(state, {
      type: "MERGE_CONFLICTED",
      conflictedFiles: ["src/App.tsx", "src/main.tsx"],
    });
    expect(exhausted).toMatchObject({
      kind: "applied",
      state: { phase: "paused" },
      commands: [],
    });
    expect(exhausted.state.detail).toContain("2 files");
  });

  it("validates after a resolved repair and pauses on incomplete ones", () => {
    const resolving = stateIn("resolving-conflicts", { targetCommit: TARGET });
    expect(
      transitionIntegration(resolving, {
        type: "REPAIR_SETTLED",
        outcome: "resolved",
      }),
    ).toMatchObject({
      kind: "applied",
      state: { phase: "validating" },
      commands: [{ type: "validate" }],
    });
    for (const outcome of ["unresolved", "interrupted"] as const) {
      expect(
        transitionIntegration(resolving, { type: "REPAIR_SETTLED", outcome }),
      ).toMatchObject({ kind: "applied", state: { phase: "paused" } });
    }
    // A user turn that finishes the resolution while paused resumes it.
    expect(
      transitionIntegration(stateIn("paused", { targetCommit: TARGET }), {
        type: "REPAIR_SETTLED",
        outcome: "resolved",
      }),
    ).toMatchObject({ kind: "applied", state: { phase: "validating" } });
  });

  it("never publishes a failed validation and lets the user retry", () => {
    const failed = transitionIntegration(stateIn("validating"), {
      type: "VALIDATION_FAILED",
      summary: "build: npm run build failed.",
    });
    expect(failed).toMatchObject({
      kind: "applied",
      state: { phase: "failed", detail: "build: npm run build failed." },
      commands: [],
    });
    expect(selectIntegrationCapabilities(failed.state).canRetry).toBe(true);
    expect(
      transitionIntegration(failed.state, {
        type: "REQUESTED",
        userInitiated: true,
      }),
    ).toMatchObject({
      kind: "applied",
      state: { phase: "queued", repairAttempts: 0, detail: null },
      commands: [{ type: "schedule" }],
    });
  });

  it("waits with an explanation instead of retargeting a switched branch", () => {
    const waiting = transitionIntegration(stateIn("queued"), {
      type: "WAITING",
      reason: 'The app is on branch "feature". Switch back to "main".',
    });
    expect(waiting).toMatchObject({
      kind: "applied",
      state: { phase: "queued", targetCommit: null },
      commands: [],
    });
    // The same wait reported again is a no-op.
    expect(
      transitionIntegration(waiting.state, {
        type: "WAITING",
        reason: 'The app is on branch "feature". Switch back to "main".',
      }).kind,
    ).toBe("ignored");
  });

  it("ignores stale step results once a later phase was reached", () => {
    for (const event of [
      { type: "MERGE_CLEAN" },
      { type: "VALIDATION_PASSED" },
      { type: "INTEGRATED" },
    ] as const) {
      expect(transitionIntegration(stateIn("merged"), event)).toMatchObject({
        kind: "ignored",
        reason: "stale-operation",
      });
    }
  });

  it("reaches only the declared phases", () => {
    const graph = exploreReachableStates({
      initialState: IDLE_INTEGRATION_STATE,
      events,
      transition: transitionIntegration,
      stateKey: (state) => JSON.stringify(state),
      maxStates: 500,
    });
    const reached = new Set(graph.nodes.map((node) => node.state.phase));
    for (const phase of reached) {
      expect(INTEGRATION_PHASES).toContain(phase);
    }
    expect(reached).toEqual(new Set(INTEGRATION_PHASES));
  });
});
