import { describe, expect, it } from "vitest";
import type { RunCommand, RunEvent, RunState, RunUrl } from "./state";
import { ignore, projectRunState, transition } from "./transition";
import { assertReferenceStability } from "@/state_machines/testing";

const APP_ID = 7;
const CURRENT_RUN_ID = 3;
const STALE_RUN_ID = 2;
const FRESH_RUN_ID = 4;

function makeUrl(n: number): RunUrl {
  return {
    appUrl: `http://localhost:4210${n}`,
    originalUrl: `http://localhost:3210${n}`,
    mode: "host",
  };
}

const STATE_FIXTURES: RunState[] = [
  { type: "idle" },
  {
    type: "starting",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    operation: "run",
    startedAt: 100,
    pendingUrl: null,
  },
  {
    type: "starting",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    operation: "run",
    startedAt: 100,
    pendingUrl: makeUrl(1),
  },
  {
    type: "starting",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    operation: "restart",
    startedAt: 100,
    pendingUrl: null,
  },
  {
    type: "starting",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    operation: "rebuild",
    startedAt: 100,
    pendingUrl: makeUrl(1),
  },
  { type: "ready", appId: APP_ID, runId: CURRENT_RUN_ID, url: makeUrl(1) },
  { type: "ready", appId: APP_ID, runId: CURRENT_RUN_ID, url: null },
  {
    type: "reloading",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    reason: "hmr",
    url: makeUrl(1),
  },
  {
    type: "reloading",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    reason: "manual",
    url: null,
  },
  { type: "stopping", appId: APP_ID, runId: CURRENT_RUN_ID, startedAt: 100 },
  { type: "stopped", appId: APP_ID, runId: CURRENT_RUN_ID, exitCode: 0 },
  { type: "stopped", appId: APP_ID, runId: CURRENT_RUN_ID, exitCode: null },
  {
    type: "errored",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    error: { message: "boom" },
  },
];

function makeEventFixtures(runId: number): RunEvent[] {
  return [
    { type: "START", appId: APP_ID, runId: FRESH_RUN_ID, startedAt: 200 },
    {
      type: "RESTART",
      appId: APP_ID,
      runId: FRESH_RUN_ID,
      startedAt: 200,
      options: { removeNodeModules: true, recreateSandbox: true },
    },
    { type: "REBUILD", appId: APP_ID, runId: FRESH_RUN_ID, startedAt: 200 },
    {
      type: "EXTERNAL_RESTART",
      appId: APP_ID,
      runId: FRESH_RUN_ID,
      startedAt: 200,
      operation: "rebuild",
    },
    { type: "STOP", appId: APP_ID, runId: FRESH_RUN_ID, startedAt: 200 },
    { type: "RUN_IPC_RESOLVED", runId },
    { type: "RUN_IPC_FAILED", runId, error: { message: "spawn failed" } },
    { type: "STOP_IPC_RESOLVED", runId },
    { type: "STOP_IPC_FAILED", runId, error: { message: "stop failed" } },
    { type: "PROXY_READY", appId: APP_ID, runId, url: makeUrl(9) },
    { type: "HMR_DETECTED", appId: APP_ID },
    { type: "MANUAL_RELOAD", appId: APP_ID },
    { type: "RELOAD_DONE", runId },
    { type: "APP_EXIT", appId: APP_ID, exitCode: 1, timestamp: 300 },
  ];
}

const STATE_TYPES = new Set([
  "idle",
  "starting",
  "ready",
  "reloading",
  "stopping",
  "stopped",
  "errored",
]);

const MUTATING_COMMAND_TYPES = new Set([
  "start",
  "stop",
  "prepareExternalStart",
]);

const COMPLETION_EVENT_TYPES = new Set([
  "RUN_IPC_RESOLVED",
  "RUN_IPC_FAILED",
  "STOP_IPC_RESOLVED",
  "STOP_IPC_FAILED",
  "RELOAD_DONE",
]);

describe("transition totality and invariants", () => {
  const allEvents = [
    ...makeEventFixtures(CURRENT_RUN_ID),
    ...makeEventFixtures(STALE_RUN_ID),
  ];

  it("is total over the state x event matrix and upholds invariants", () => {
    for (const state of STATE_FIXTURES) {
      for (const event of allEvents) {
        const result = transition(state, event);

        // Totality: every pair produces a well-formed result.
        expect(result).toBeDefined();
        expect(STATE_TYPES.has(result.state.type)).toBe(true);
        expect(Array.isArray(result.commands)).toBe(true);
        if (result.state === state && result.commands.length === 0) {
          expect(result.ignoredReason).toBeTruthy();
        }
        assertReferenceStability(
          state,
          result,
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );

        // At most one mutating (process-affecting IPC) command per result.
        const mutating = result.commands.filter((command: RunCommand) =>
          MUTATING_COMMAND_TYPES.has(command.type),
        );
        expect(mutating.length).toBeLessThanOrEqual(1);

        // appUrl is only applied when the machine lands in ready/reloading.
        if (result.commands.some((command) => command.type === "applyUrl")) {
          expect(["ready", "reloading"]).toContain(result.state.type);
        }

        // Every non-idle state carries appId and runId.
        if (result.state.type !== "idle") {
          expect(result.state.appId).toBe(APP_ID);
          expect(typeof result.state.runId).toBe("number");
        }
      }
    }
  });

  it("never advances state on a completion event with a stale runId", () => {
    for (const state of STATE_FIXTURES) {
      for (const event of makeEventFixtures(STALE_RUN_ID)) {
        if (!COMPLETION_EVENT_TYPES.has(event.type)) {
          continue;
        }
        const result = transition(state, event);
        expect(result.state).toBe(state);
        expect(result.commands).toEqual([]);
        expect(result.ignoredReason).toBe("stale-run-id");
      }
    }
  });
});

describe("transition scenarios", () => {
  const startingRun: RunState = {
    type: "starting",
    appId: APP_ID,
    runId: CURRENT_RUN_ID,
    operation: "run",
    startedAt: 100,
    pendingUrl: null,
  };

  it("ignores a stale run resolution after a restart supersedes the run", () => {
    // A run is in flight...
    const run = transition(
      { type: "idle" },
      { type: "START", appId: APP_ID, runId: 1, startedAt: 100 },
    );
    expect(run.state).toMatchObject({ type: "starting", runId: 1 });

    // ...then a restart supersedes it before the run IPC settles.
    const restart = transition(run.state, {
      type: "RESTART",
      appId: APP_ID,
      runId: 2,
      startedAt: 150,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    expect(restart.state).toMatchObject({
      type: "starting",
      operation: "restart",
      runId: 2,
    });

    // The old run's `finally`-equivalent must not stomp the restart.
    const staleResolution = transition(restart.state, {
      type: "RUN_IPC_RESOLVED",
      runId: 1,
    });
    expect(staleResolution.state).toBe(restart.state);
    expect(staleResolution.commands).toEqual([]);

    // The restart's own resolution advances to ready.
    const resolution = transition(restart.state, {
      type: "RUN_IPC_RESOLVED",
      runId: 2,
    });
    expect(resolution.state).toMatchObject({ type: "ready", runId: 2 });
  });

  it("buffers a proxy line during a restart instead of clearing its loading state", () => {
    const restarting: RunState = {
      type: "starting",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      operation: "restart",
      startedAt: 100,
      pendingUrl: null,
    };
    // A cached proxy line re-emitted from before the restart arrives.
    const buffered = transition(restarting, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: makeUrl(1),
    });
    // Still starting (loading stays up), no URL applied yet.
    expect(buffered.state).toMatchObject({
      type: "starting",
      pendingUrl: makeUrl(1),
    });
    expect(buffered.commands).toEqual([]);

    // The buffered URL is applied once the restart IPC resolves.
    const resolved = transition(buffered.state, {
      type: "RUN_IPC_RESOLVED",
      runId: CURRENT_RUN_ID,
    });
    expect(resolved.state).toMatchObject({ type: "ready", url: makeUrl(1) });
    expect(resolved.commands).toContainEqual({
      type: "applyUrl",
      appId: APP_ID,
      url: makeUrl(1),
    });
  });

  it("keeps the newest proxy line when several arrive while starting", () => {
    const first = transition(startingRun, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: makeUrl(1),
    });
    const second = transition(first.state, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: makeUrl(2),
    });
    expect(second.state).toMatchObject({ pendingUrl: makeUrl(2) });
  });

  it("reuses snapshots for structurally identical proxy URLs", () => {
    const url = makeUrl(1);
    const ready: RunState = {
      type: "ready",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url,
    };
    const readyResult = transition(ready, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: { ...url },
    });
    expect(readyResult.state).toBe(ready);
    expect(readyResult.commands).toHaveLength(1);

    const starting: RunState = {
      type: "starting",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      operation: "run",
      startedAt: 100,
      pendingUrl: url,
    };
    const startingResult = transition(starting, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: { ...url },
    });
    expect(startingResult.state).toBe(starting);
    expect(startingResult.ignoredReason).toBe("no-change");
  });

  it("handles stop during starting: stale run completion is ignored", () => {
    const stop = transition(startingRun, {
      type: "STOP",
      appId: APP_ID,
      runId: FRESH_RUN_ID,
      startedAt: 200,
    });
    expect(stop.state).toMatchObject({
      type: "stopping",
      runId: FRESH_RUN_ID,
    });
    expect(stop.commands).toEqual([
      { type: "stop", appId: APP_ID, runId: FRESH_RUN_ID },
    ]);

    const staleRun = transition(stop.state, {
      type: "RUN_IPC_RESOLVED",
      runId: CURRENT_RUN_ID,
    });
    expect(staleRun.state).toBe(stop.state);

    const stopped = transition(stop.state, {
      type: "STOP_IPC_RESOLVED",
      runId: FRESH_RUN_ID,
    });
    expect(stopped.state).toMatchObject({ type: "stopped", exitCode: null });
  });

  it("cycles ready -> reloading -> ready on HMR", () => {
    const ready: RunState = {
      type: "ready",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: makeUrl(1),
    };
    const reloading = transition(ready, {
      type: "HMR_DETECTED",
      appId: APP_ID,
    });
    expect(reloading.state).toMatchObject({ type: "reloading", reason: "hmr" });
    expect(reloading.commands).toEqual([
      {
        type: "reload",
        appId: APP_ID,
        runId: CURRENT_RUN_ID,
        reason: "hmr",
      },
    ]);

    const done = transition(reloading.state, {
      type: "RELOAD_DONE",
      runId: CURRENT_RUN_ID,
    });
    expect(done.state).toMatchObject({ type: "ready", url: makeUrl(1) });
  });

  it("still bumps the reload token for HMR/manual reload outside ready", () => {
    for (const state of STATE_FIXTURES) {
      if (state.type === "ready") {
        continue;
      }
      const result = transition(state, {
        type: "MANUAL_RELOAD",
        appId: APP_ID,
      });
      expect(result.state).toBe(state);
      expect(result.commands).toEqual([
        { type: "bumpReloadToken", appId: APP_ID },
      ]);
    }
  });

  it("passes restart flags through on the RESTART event", () => {
    const result = transition(
      { type: "idle" },
      {
        type: "RESTART",
        appId: APP_ID,
        runId: 1,
        startedAt: 100,
        options: { removeNodeModules: true, recreateSandbox: true },
      },
    );
    expect(result.commands).toEqual([
      {
        type: "start",
        appId: APP_ID,
        runId: 1,
        operation: "restart",
        startedAt: 100,
        options: { removeNodeModules: true, recreateSandbox: true },
      },
    ]);
  });

  it("models an externally executed rebuild without issuing a second start", () => {
    const result = transition(
      {
        type: "errored",
        appId: APP_ID,
        runId: CURRENT_RUN_ID,
        error: { message: "old" },
      },
      {
        type: "EXTERNAL_RESTART",
        appId: APP_ID,
        runId: FRESH_RUN_ID,
        startedAt: 200,
        operation: "rebuild",
      },
    );

    expect(result.state).toEqual({
      type: "starting",
      appId: APP_ID,
      runId: FRESH_RUN_ID,
      operation: "rebuild",
      startedAt: 200,
      pendingUrl: null,
    });
    expect(result.commands).toEqual([
      {
        type: "prepareExternalStart",
        appId: APP_ID,
        operation: "rebuild",
      },
    ]);
  });

  it("uses rebuild flags (removeNodeModules only) for REBUILD", () => {
    const result = transition(
      { type: "idle" },
      { type: "REBUILD", appId: APP_ID, runId: 1, startedAt: 100 },
    );
    expect(result.commands).toEqual([
      {
        type: "start",
        appId: APP_ID,
        runId: 1,
        operation: "rebuild",
        startedAt: 100,
        options: { removeNodeModules: true, recreateSandbox: false },
      },
    ]);
  });

  it("re-establishes ready when a proxy line arrives with no run in flight", () => {
    for (const state of STATE_FIXTURES) {
      if (!["idle", "stopped", "errored"].includes(state.type)) {
        continue;
      }
      const result = transition(state, {
        type: "PROXY_READY",
        appId: APP_ID,
        runId: CURRENT_RUN_ID,
        url: makeUrl(5),
      });
      expect(result.state).toMatchObject({ type: "ready", url: makeUrl(5) });
      expect(result.commands).toEqual([
        { type: "applyUrl", appId: APP_ID, url: makeUrl(5) },
      ]);
    }
  });

  it("ignores proxy lines while stopping", () => {
    const stopping: RunState = {
      type: "stopping",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      startedAt: 100,
    };
    const result = transition(stopping, {
      type: "PROXY_READY",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      url: makeUrl(5),
    });
    expect(result.state).toBe(stopping);
    expect(result.commands).toEqual([]);
  });

  it("records app exit from ready/reloading and ignores it elsewhere", () => {
    for (const state of STATE_FIXTURES) {
      const result = transition(state, {
        type: "APP_EXIT",
        appId: APP_ID,
        exitCode: 137,
        timestamp: 300,
      });
      if (state.type === "ready" || state.type === "reloading") {
        expect(result.state).toMatchObject({ type: "stopped", exitCode: 137 });
      } else {
        expect(result.state).toBe(state);
      }
      expect(result.commands).toEqual([]);
    }
  });

  it("bumps the reload token when a restart fails (finally-block parity)", () => {
    const restarting: RunState = {
      type: "starting",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      operation: "restart",
      startedAt: 100,
      pendingUrl: null,
    };
    const result = transition(restarting, {
      type: "RUN_IPC_FAILED",
      runId: CURRENT_RUN_ID,
      error: { message: "boom" },
    });
    expect(result.state).toMatchObject({
      type: "errored",
      error: { message: "boom" },
    });
    expect(result.commands).toEqual([
      { type: "setError", appId: APP_ID, error: { message: "boom" } },
      { type: "bumpReloadToken", appId: APP_ID },
    ]);
  });

  it("does not trust a buffered proxy URL when the restart IPC fails", () => {
    // Proxy output has no operation identity, so a line buffered during the
    // restart may belong to the old process whose proxy has been terminated.
    const restarting: RunState = {
      type: "starting",
      appId: APP_ID,
      runId: CURRENT_RUN_ID,
      operation: "restart",
      startedAt: 100,
      pendingUrl: makeUrl(3),
    };
    const result = transition(restarting, {
      type: "RUN_IPC_FAILED",
      runId: CURRENT_RUN_ID,
      error: { message: "boom" },
    });
    expect(result.state).toMatchObject({
      type: "errored",
      error: { message: "boom" },
    });
    expect(result.commands).toEqual([
      { type: "setError", appId: APP_ID, error: { message: "boom" } },
      { type: "bumpReloadToken", appId: APP_ID },
    ]);
  });

  it("does not bump the reload token when a plain run settles without a URL", () => {
    const resolved = transition(startingRun, {
      type: "RUN_IPC_RESOLVED",
      runId: CURRENT_RUN_ID,
    });
    expect(resolved.state).toMatchObject({ type: "ready", url: null });
    expect(resolved.commands).toEqual([{ type: "clearError", appId: APP_ID }]);
  });
});

describe("projectRunState", () => {
  it("projects starting/stopping to the legacy PreviewRunState shape", () => {
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        runId: 1,
        operation: "run",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "run", startedAt: 42 });
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        runId: 1,
        operation: "restart",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "restart", startedAt: 42 });
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        runId: 1,
        operation: "rebuild",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "restart", startedAt: 42 });
    expect(
      projectRunState({
        type: "stopping",
        appId: APP_ID,
        runId: 1,
        startedAt: 42,
      }),
    ).toEqual({ operation: "stop", startedAt: 42 });
  });

  it("projects every non-loading state to undefined", () => {
    for (const state of STATE_FIXTURES) {
      if (state.type === "starting" || state.type === "stopping") {
        continue;
      }
      expect(projectRunState(state)).toBeUndefined();
    }
  });
});

describe("ignore", () => {
  it("returns the same state reference with no commands", () => {
    const state: RunState = { type: "idle" };
    expect(ignore(state, "invalid-in-current-state")).toEqual({
      state,
      commands: [],
      ignoredReason: "invalid-in-current-state",
    });
    expect(ignore(state, "invalid-in-current-state").state).toBe(state);
  });
});
