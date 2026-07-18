import { describe, expect, it } from "vitest";
import type {
  PreviewCommand,
  PreviewEvent,
  PreviewSession,
  PreviewState,
} from "./state";
import { CLOSED_STATE } from "./state";
import {
  BRANCH_UNAVAILABLE_MESSAGE,
  transition,
  type TransitionResult,
} from "./transition";

const APP_ID = 7;

function session(overrides: Partial<PreviewSession> = {}): PreviewSession {
  return {
    appId: APP_ID,
    originBranch: null,
    targetVersionId: null,
    targetHasDbSnapshot: false,
    checkedOutVersionId: null,
    exitIntent: { type: "none" },
    ...overrides,
  };
}

const EVENT_SAMPLES: PreviewEvent[] = [
  { type: "OPEN", appId: APP_ID },
  { type: "CLOSE" },
  { type: "APP_CHANGED", nextAppId: 8 },
  { type: "APP_CHANGED", nextAppId: null },
  { type: "SELECT_VERSION", versionId: "v1", hasDbSnapshot: false },
  { type: "SELECT_VERSION", versionId: "v2", hasDbSnapshot: true },
  { type: "RESTORE", versionId: "v1", hasDbSnapshot: false },
  { type: "RETRY_RETURN" },
  { type: "ORIGIN_RESOLVED", branch: "feature/origin" },
  { type: "ORIGIN_RESOLUTION_FAILED" },
  { type: "CHECKOUT_SUCCEEDED" },
  { type: "CHECKOUT_FAILED", error: { message: "checkout failed" } },
  { type: "RESTORE_SUCCEEDED" },
  { type: "RESTORE_FAILED", error: { message: "restore failed" } },
  { type: "RETURN_SUCCEEDED" },
  { type: "RETURN_FAILED", error: { message: "return failed" } },
];

const STATE_SAMPLES: PreviewState[] = [
  CLOSED_STATE,
  { type: "browsing", session: session() },
  { type: "resolving-origin", session: session({ targetVersionId: "v1" }) },
  {
    type: "resolving-origin",
    session: session({
      targetVersionId: "v2",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
    }),
  },
  {
    type: "checking-out",
    session: session({
      targetVersionId: "v1",
      originBranch: "feature/origin",
    }),
  },
  {
    type: "checking-out",
    session: session({
      targetVersionId: "v2",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
      exitIntent: { type: "close" },
    }),
  },
  {
    type: "previewing",
    session: session({
      targetVersionId: "v1",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
    }),
  },
  {
    type: "restoring",
    session: session({
      targetVersionId: "v1",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
    }),
  },
  {
    type: "returning",
    session: session({
      targetVersionId: "v1",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
      exitIntent: { type: "close" },
    }),
  },
  {
    type: "recovery-required",
    session: session({
      targetVersionId: "v1",
      originBranch: "feature/origin",
      checkedOutVersionId: "v1",
      exitIntent: { type: "close" },
    }),
    error: { message: "return failed" },
  },
];

const MUTATING_COMMAND_TYPES = new Set(["checkout", "return", "restore"]);

/**
 * Encodes the invariants from plans/version-preview-state-machine.md.
 * Applied to every transition in every test in this file.
 */
function assertInvariants(
  prev: PreviewState,
  event: PreviewEvent,
  result: TransitionResult,
) {
  const next = result.state;
  const label = `${prev.type} + ${event.type} -> ${next.type}`;

  // Invariant 2: originBranch is immutable once captured.
  if (
    prev.type !== "closed" &&
    next.type !== "closed" &&
    prev.session.originBranch !== null
  ) {
    expect(next.session.originBranch, label).toBe(prev.session.originBranch);
  }

  // Invariant 3: the session never changes apps mid-flight.
  if (prev.type !== "closed" && next.type !== "closed") {
    expect(next.session.appId, label).toBe(prev.session.appId);
  }

  // Invariant: post-checkout states always know the origin branch.
  if (
    next.type === "checking-out" ||
    next.type === "previewing" ||
    next.type === "restoring" ||
    next.type === "returning" ||
    next.type === "recovery-required"
  ) {
    expect(next.session.originBranch, label).not.toBeNull();
  }

  // Invariant 8: closed is only reached when the session no longer owns a
  // historical checkout, or when the settlement event released it.
  if (next.type === "closed" && prev.type !== "closed") {
    if (
      event.type !== "RETURN_SUCCEEDED" &&
      event.type !== "RESTORE_SUCCEEDED"
    ) {
      expect(prev.session.checkedOutVersionId, label).toBeNull();
    }
  }

  // At most one mutating command per result, and mutating commands must
  // land in the matching mutation state.
  const mutating = result.commands.filter((c) =>
    MUTATING_COMMAND_TYPES.has(c.type),
  );
  expect(mutating.length, label).toBeLessThanOrEqual(1);
  for (const command of result.commands) {
    if (command.type === "checkout") {
      expect(next.type, label).toBe("checking-out");
    }
    if (command.type === "return") {
      expect(next.type, label).toBe("returning");
      expect(command.branch, label).not.toBe("");
    }
    if (command.type === "restore") {
      expect(next.type, label).toBe("restoring");
      expect(command.targetBranch, label).not.toBe("");
    }
    if (command.type === "resolve-origin") {
      expect(next.type, label).toBe("resolving-origin");
    }
    if (command.type !== "notify-error" && next.type !== "closed") {
      expect(command.appId, label).toBe(next.session.appId);
    }
  }

  // Invariant 7: previewing always has a checked-out version to display.
  if (next.type === "previewing") {
    expect(next.session.checkedOutVersionId, label).not.toBeNull();
  }
}

function step(state: PreviewState, event: PreviewEvent): TransitionResult {
  const result = transition(state, event);
  assertInvariants(state, event, result);
  return result;
}

/** Runs an event sequence from closed, asserting invariants at each step. */
function run(events: PreviewEvent[], from: PreviewState = CLOSED_STATE) {
  let state = from;
  const allCommands: PreviewCommand[] = [];
  for (const event of events) {
    const result = step(state, event);
    state = result.state;
    allCommands.push(...result.commands);
  }
  return { state, commands: allCommands };
}

const OPEN: PreviewEvent = { type: "OPEN", appId: APP_ID };
const SELECT_V1: PreviewEvent = {
  type: "SELECT_VERSION",
  versionId: "v1",
  hasDbSnapshot: false,
};
const SELECT_V2: PreviewEvent = {
  type: "SELECT_VERSION",
  versionId: "v2",
  hasDbSnapshot: true,
};
const RESOLVED: PreviewEvent = {
  type: "ORIGIN_RESOLVED",
  branch: "feature/origin",
};

describe("transition totality", () => {
  it("handles every state/event pair without throwing and upholds invariants", () => {
    for (const state of STATE_SAMPLES) {
      for (const event of EVENT_SAMPLES) {
        const result = step(state, event);
        expect(result).toBeDefined();
        expect(result.state).toBeDefined();
        expect(Array.isArray(result.commands)).toBe(true);
      }
    }
  });

  it("returns the same state reference for ignored events", () => {
    const previewing = STATE_SAMPLES.find((s) => s.type === "previewing")!;
    const result = transition(previewing, { type: "RETURN_SUCCEEDED" });
    expect(result.state).toBe(previewing);
    expect(result.commands).toEqual([]);
  });
});

describe("preview lifecycle", () => {
  it("captures the origin branch exactly once per session", () => {
    const { state, commands } = run([OPEN, SELECT_V1, RESOLVED]);
    expect(state.type).toBe("checking-out");
    if (state.type !== "checking-out") return;
    expect(state.session.originBranch).toBe("feature/origin");
    expect(commands).toContainEqual({
      type: "checkout",
      appId: APP_ID,
      versionId: "v1",
      hasDbSnapshot: false,
    });
  });

  it("reuses the immutable origin branch for later previews", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_SUCCEEDED" },
      SELECT_V2,
    ]);
    expect(state.type).toBe("checking-out");
    if (state.type !== "checking-out") return;
    expect(state.session.originBranch).toBe("feature/origin");
    // The second preview goes straight to checkout: no second resolve.
    expect(commands.filter((c) => c.type === "resolve-origin")).toHaveLength(1);
    expect(commands.filter((c) => c.type === "checkout")).toHaveLength(2);
  });

  it("lets the latest selection win while origin resolution is pending", () => {
    const { state, commands } = run([OPEN, SELECT_V1, SELECT_V2, RESOLVED]);
    expect(state.type).toBe("checking-out");
    if (state.type !== "checking-out") return;
    expect(state.session.targetVersionId).toBe("v2");
    expect(commands.filter((c) => c.type === "checkout")).toEqual([
      { type: "checkout", appId: APP_ID, versionId: "v2", hasDbSnapshot: true },
    ]);
  });

  it("ignores selection while a Git mutation is active", () => {
    const { state, commands } = run([OPEN, SELECT_V1, RESOLVED, SELECT_V2]);
    expect(state.type).toBe("checking-out");
    if (state.type !== "checking-out") return;
    expect(state.session.targetVersionId).toBe("v1");
    expect(commands.filter((c) => c.type === "checkout")).toHaveLength(1);
  });

  it("cancels the preview and stays browsing when the branch is unavailable", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      { type: "ORIGIN_RESOLUTION_FAILED" },
    ]);
    expect(state.type).toBe("browsing");
    if (state.type !== "browsing") return;
    expect(state.session.targetVersionId).toBeNull();
    expect(commands).toContainEqual({
      type: "notify-error",
      message: BRANCH_UNAVAILABLE_MESSAGE,
    });
    expect(commands.filter((c) => c.type === "checkout")).toHaveLength(0);
  });

  it("returns to the prior preview when a superseding checkout fails", () => {
    const { state } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_SUCCEEDED" },
      SELECT_V2,
      { type: "CHECKOUT_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("previewing");
    if (state.type !== "previewing") return;
    expect(state.session.targetVersionId).toBe("v1");
    expect(state.session.checkedOutVersionId).toBe("v1");
  });

  it("falls back to browsing when the first checkout fails", () => {
    const { state } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("browsing");
    if (state.type !== "browsing") return;
    expect(state.session.targetVersionId).toBeNull();
    expect(state.session.checkedOutVersionId).toBeNull();
  });
});

describe("close and app-switch handling", () => {
  it("closes without any Git command when nothing was checked out", () => {
    for (const closeEvents of [
      [OPEN, { type: "CLOSE" } as PreviewEvent],
      [OPEN, SELECT_V1, { type: "CLOSE" } as PreviewEvent],
    ]) {
      const { state, commands } = run(closeEvents);
      expect(state.type).toBe("closed");
      expect(
        commands.filter((c) => MUTATING_COMMAND_TYPES.has(c.type)),
      ).toEqual([]);
    }
  });

  it("returns to the origin branch when closing while previewing", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_SUCCEEDED" },
      { type: "CLOSE" },
    ]);
    expect(state.type).toBe("returning");
    expect(commands).toContainEqual({
      type: "return",
      appId: APP_ID,
      branch: "feature/origin",
    });
  });

  it("waits out an active checkout before returning on close", () => {
    const afterClose = run([OPEN, SELECT_V1, RESOLVED, { type: "CLOSE" }]);
    expect(afterClose.state.type).toBe("checking-out");
    expect(afterClose.commands.filter((c) => c.type === "return")).toHaveLength(
      0,
    );

    const settled = run([{ type: "CHECKOUT_SUCCEEDED" }], afterClose.state);
    expect(settled.state.type).toBe("returning");
    expect(settled.commands).toContainEqual({
      type: "return",
      appId: APP_ID,
      branch: "feature/origin",
    });
  });

  it("closes without a return when a first checkout fails after a close request", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CLOSE" },
      { type: "CHECKOUT_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("closed");
    expect(commands.filter((c) => c.type === "return")).toHaveLength(0);
  });

  it("returns after a failed superseding checkout when close was requested", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_SUCCEEDED" },
      SELECT_V2,
      { type: "CLOSE" },
      { type: "CHECKOUT_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("returning");
    expect(commands).toContainEqual({
      type: "return",
      appId: APP_ID,
      branch: "feature/origin",
    });
  });

  it("treats an app switch like a close that drains the old session", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "CHECKOUT_SUCCEEDED" },
      { type: "APP_CHANGED", nextAppId: 9 },
    ]);
    expect(state.type).toBe("returning");
    if (state.type !== "returning") return;
    // The return targets the session's original app, not the new one.
    expect(state.session.appId).toBe(APP_ID);
    expect(commands).toContainEqual({
      type: "return",
      appId: APP_ID,
      branch: "feature/origin",
    });
  });
});

describe("restore", () => {
  const toPreviewing: PreviewEvent[] = [
    OPEN,
    SELECT_V1,
    RESOLVED,
    { type: "CHECKOUT_SUCCEEDED" },
  ];

  it("restores onto the origin branch and closes without an extra return", () => {
    const restored = run([
      ...toPreviewing,
      { type: "RESTORE", versionId: "v1", hasDbSnapshot: false },
      { type: "RESTORE_SUCCEEDED" },
    ]);
    expect(restored.state.type).toBe("closed");
    expect(restored.commands.filter((c) => c.type === "return")).toHaveLength(
      0,
    );
    expect(restored.commands).toContainEqual({
      type: "restore",
      appId: APP_ID,
      versionId: "v1",
      targetBranch: "feature/origin",
      hasDbSnapshot: false,
    });
  });

  it("stays recoverable when a restore fails", () => {
    const { state } = run([
      ...toPreviewing,
      { type: "RESTORE", versionId: "v1", hasDbSnapshot: false },
      { type: "RESTORE_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("previewing");
    if (state.type !== "previewing") return;
    expect(state.session.checkedOutVersionId).toBe("v1");
    expect(state.session.originBranch).toBe("feature/origin");
  });

  it("honors a close received during a restore that then fails", () => {
    const { state, commands } = run([
      ...toPreviewing,
      { type: "RESTORE", versionId: "v1", hasDbSnapshot: false },
      { type: "CLOSE" },
      { type: "RESTORE_FAILED", error: { message: "nope" } },
    ]);
    expect(state.type).toBe("returning");
    expect(commands).toContainEqual({
      type: "return",
      appId: APP_ID,
      branch: "feature/origin",
    });
  });

  it("ignores restore requests while a mutation is active", () => {
    const { state, commands } = run([
      OPEN,
      SELECT_V1,
      RESOLVED,
      { type: "RESTORE", versionId: "v1", hasDbSnapshot: false },
    ]);
    expect(state.type).toBe("checking-out");
    expect(commands.filter((c) => c.type === "restore")).toHaveLength(0);
  });
});

describe("return failure and recovery", () => {
  const toReturning: PreviewEvent[] = [
    OPEN,
    SELECT_V1,
    RESOLVED,
    { type: "CHECKOUT_SUCCEEDED" },
    { type: "CLOSE" },
  ];

  it("preserves every retry input when the return fails", () => {
    const { state } = run([
      ...toReturning,
      { type: "RETURN_FAILED", error: { message: "return failed" } },
    ]);
    expect(state.type).toBe("recovery-required");
    if (state.type !== "recovery-required") return;
    expect(state.session.appId).toBe(APP_ID);
    expect(state.session.originBranch).toBe("feature/origin");
    expect(state.session.checkedOutVersionId).toBe("v1");
    expect(state.error.message).toBe("return failed");
  });

  it("retries the return with the retained session", () => {
    const { state, commands } = run([
      ...toReturning,
      { type: "RETURN_FAILED", error: { message: "return failed" } },
      { type: "RETRY_RETURN" },
    ]);
    expect(state.type).toBe("returning");
    expect(commands.filter((c) => c.type === "return")).toHaveLength(2);
  });

  it("only a successful retry clears the recovery session", () => {
    const failedTwice = run([
      ...toReturning,
      { type: "RETURN_FAILED", error: { message: "one" } },
      { type: "RETRY_RETURN" },
      { type: "RETURN_FAILED", error: { message: "two" } },
    ]);
    expect(failedTwice.state.type).toBe("recovery-required");

    const succeeded = run(
      [{ type: "RETRY_RETURN" }, { type: "RETURN_SUCCEEDED" }],
      failedTwice.state,
    );
    expect(succeeded.state.type).toBe("closed");
  });

  it("ignores OPEN and SELECT_VERSION while recovery is pending", () => {
    const recovery = run([
      ...toReturning,
      { type: "RETURN_FAILED", error: { message: "return failed" } },
    ]);
    for (const event of [OPEN, SELECT_V1]) {
      const result = step(recovery.state, event);
      expect(result.state).toBe(recovery.state);
      expect(result.commands).toEqual([]);
    }
  });
});

describe("sequence fuzzing", () => {
  // Deterministic PRNG so failures reproduce from the logged seed.
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("upholds invariants across thousands of random event sequences", () => {
    const SEQUENCES = 2000;
    const STEPS = 40;
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const rand = mulberry32(seed);
      let state: PreviewState = CLOSED_STATE;
      for (let i = 0; i < STEPS; i++) {
        const event = EVENT_SAMPLES[Math.floor(rand() * EVENT_SAMPLES.length)];
        try {
          const result = step(state, event);
          state = result.state;
        } catch (error) {
          throw new Error(
            `Fuzz failure (seed=${seed}, step=${i}, state=${state.type}, event=${event.type}): ${error}`,
          );
        }
      }
    }
  });
});
