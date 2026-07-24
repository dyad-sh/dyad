import { describe, expect, it } from "vitest";
import type {
  AppRunInvocationRef,
  RunCommand,
  RunEvent,
  RunState,
  RunUrl,
} from "./state";
import { ignore, projectRunState, transition } from "./transition";
import {
  assertReferenceStability,
  assertAllCommandsProducible,
  assertAllStatesReachable,
  commandsOf,
  ignoreReasonOf,
} from "@/state_machines/testing";

const APP_ID = 7;
const makeRef = (operationId: string): AppRunInvocationRef => ({
  kind: "app-run",
  entityKey: APP_ID,
  operationId,
});
const REF_1 = makeRef("app-run:1");
const REF_2 = makeRef("app-run:2");
const CURRENT_REF = makeRef("app-run:3");
const STALE_REF = makeRef("app-run:stale");
const FRESH_REF = makeRef("app-run:4");

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
    invocationRef: CURRENT_REF,
    operation: "run",
    startedAt: 100,
    pendingUrl: null,
  },
  {
    type: "starting",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    operation: "run",
    startedAt: 100,
    pendingUrl: makeUrl(1),
  },
  {
    type: "starting",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    operation: "restart",
    startedAt: 100,
    pendingUrl: null,
  },
  {
    type: "starting",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    operation: "rebuild",
    startedAt: 100,
    pendingUrl: makeUrl(1),
  },
  { type: "ready", appId: APP_ID, invocationRef: CURRENT_REF, url: makeUrl(1) },
  { type: "ready", appId: APP_ID, invocationRef: CURRENT_REF, url: null },
  {
    type: "reloading",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    reason: "hmr",
    url: makeUrl(1),
  },
  {
    type: "reloading",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    reason: "manual",
    url: null,
  },
  {
    type: "stopping",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    startedAt: 100,
  },
  { type: "stopped", appId: APP_ID, invocationRef: CURRENT_REF, exitCode: 0 },
  {
    type: "stopped",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    exitCode: null,
  },
  {
    type: "errored",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    error: { message: "boom" },
  },
];

function makeEventFixtures(invocationRef: AppRunInvocationRef): RunEvent[] {
  return [
    { type: "START", appId: APP_ID, invocationRef: FRESH_REF, startedAt: 200 },
    {
      type: "RESTART",
      appId: APP_ID,
      invocationRef: FRESH_REF,
      startedAt: 200,
      options: { removeNodeModules: true, recreateSandbox: true },
    },
    {
      type: "REBUILD",
      appId: APP_ID,
      invocationRef: FRESH_REF,
      startedAt: 200,
    },
    {
      type: "EXTERNAL_RESTART",
      appId: APP_ID,
      invocationRef: FRESH_REF,
      startedAt: 200,
      operation: "rebuild",
    },
    { type: "STOP", appId: APP_ID, invocationRef: FRESH_REF, startedAt: 200 },
    { type: "RUN_IPC_RESOLVED", invocationRef },
    {
      type: "RUN_IPC_FAILED",
      invocationRef,
      error: { message: "spawn failed" },
    },
    { type: "STOP_IPC_RESOLVED", invocationRef },
    {
      type: "STOP_IPC_FAILED",
      invocationRef,
      error: { message: "stop failed" },
    },
    { type: "PROXY_READY", appId: APP_ID, invocationRef, url: makeUrl(9) },
    { type: "HMR_DETECTED", appId: APP_ID },
    { type: "MANUAL_RELOAD", appId: APP_ID },
    { type: "RELOAD_DONE", invocationRef },
    {
      type: "APP_EXIT",
      appId: APP_ID,
      invocationRef,
      exitCode: 1,
      timestamp: 300,
    },
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
const STATE_KINDS = [
  "idle",
  "starting",
  "ready",
  "reloading",
  "stopping",
  "stopped",
  "errored",
] as const satisfies readonly RunState["type"][];
const COMMAND_KINDS = [
  "start",
  "prepareExternalStart",
  "stop",
  "applyUrl",
  "bumpReloadToken",
  "reload",
  "clearError",
  "setError",
] as const satisfies readonly RunCommand["type"][];

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
  it("reaches every state and produces every command kind", () => {
    const options = {
      initialState: { type: "idle" } as RunState,
      events: (state: RunState) =>
        makeEventFixtures(FRESH_REF).filter(
          (event) =>
            state.type === "idle" ||
            ![
              "START",
              "RESTART",
              "REBUILD",
              "EXTERNAL_RESTART",
              "STOP",
            ].includes(event.type),
        ),
      transition,
      stateKey: JSON.stringify,
      maxStates: 1_000,
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

  const allEvents = [
    ...makeEventFixtures(CURRENT_REF),
    ...makeEventFixtures(STALE_REF),
  ];

  it("is total over the state x event matrix and upholds invariants", () => {
    for (const state of STATE_FIXTURES) {
      for (const event of allEvents) {
        const result = transition(state, event);

        // Totality: every pair produces a well-formed result.
        expect(result).toBeDefined();
        expect(STATE_TYPES.has(result.state.type)).toBe(true);
        expect(Array.isArray(commandsOf(result))).toBe(true);
        if (result.state === state && commandsOf(result).length === 0) {
          expect(ignoreReasonOf(result)).toBeTruthy();
        }
        assertReferenceStability(
          state,
          result,
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );

        // At most one mutating (process-affecting IPC) command per result.
        const mutating = commandsOf(result).filter((command: RunCommand) =>
          MUTATING_COMMAND_TYPES.has(command.type),
        );
        expect(mutating.length).toBeLessThanOrEqual(1);

        // appUrl is only applied when the machine lands in ready/reloading.
        if (commandsOf(result).some((command) => command.type === "applyUrl")) {
          expect(["ready", "reloading"]).toContain(result.state.type);
        }

        // Every non-idle state carries appId and invocationRef.
        if (result.state.type !== "idle") {
          expect(result.state.appId).toBe(APP_ID);
          expect(result.state.invocationRef).toMatchObject({
            kind: "app-run",
            entityKey: APP_ID,
          });
        }
      }
    }
  });

  it("never advances state on a completion event with a stale invocation ref", () => {
    for (const state of STATE_FIXTURES) {
      for (const event of makeEventFixtures(STALE_REF)) {
        if (!COMPLETION_EVENT_TYPES.has(event.type)) {
          continue;
        }
        const result = transition(state, event);
        expect(result.state).toBe(state);
        expect(commandsOf(result)).toEqual([]);
        expect(ignoreReasonOf(result)).toBe("stale-operation");
      }
    }
  });
});

describe("transition scenarios", () => {
  const startingRun: RunState = {
    type: "starting",
    appId: APP_ID,
    invocationRef: CURRENT_REF,
    operation: "run",
    startedAt: 100,
    pendingUrl: null,
  };

  it("ignores a stale run resolution after a restart supersedes the run", () => {
    // A run is in flight...
    const run = transition(
      { type: "idle" },
      { type: "START", appId: APP_ID, invocationRef: REF_1, startedAt: 100 },
    );
    expect(run.state).toMatchObject({ type: "starting", invocationRef: REF_1 });

    // ...then a restart supersedes it before the run IPC settles.
    const restart = transition(run.state, {
      type: "RESTART",
      appId: APP_ID,
      invocationRef: REF_2,
      startedAt: 150,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    expect(restart.state).toMatchObject({
      type: "starting",
      operation: "restart",
      invocationRef: REF_2,
    });

    // The old run's `finally`-equivalent must not stomp the restart.
    const staleResolution = transition(restart.state, {
      type: "RUN_IPC_RESOLVED",
      invocationRef: REF_1,
    });
    expect(staleResolution.state).toBe(restart.state);
    expect(commandsOf(staleResolution)).toEqual([]);

    // The restart's own resolution advances to ready.
    const resolution = transition(restart.state, {
      type: "RUN_IPC_RESOLVED",
      invocationRef: REF_2,
    });
    expect(resolution.state).toMatchObject({
      type: "ready",
      invocationRef: REF_2,
    });
  });

  it("buffers a proxy line during a restart instead of clearing its loading state", () => {
    const restarting: RunState = {
      type: "starting",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      operation: "restart",
      startedAt: 100,
      pendingUrl: null,
    };
    // A cached proxy line re-emitted from before the restart arrives.
    const buffered = transition(restarting, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: makeUrl(1),
    });
    // Still starting (loading stays up), no URL applied yet.
    expect(buffered.state).toMatchObject({
      type: "starting",
      pendingUrl: makeUrl(1),
    });
    expect(commandsOf(buffered)).toEqual([]);

    // The buffered URL is applied once the restart IPC resolves.
    const resolved = transition(buffered.state, {
      type: "RUN_IPC_RESOLVED",
      invocationRef: CURRENT_REF,
    });
    expect(resolved.state).toMatchObject({ type: "ready", url: makeUrl(1) });
    expect(commandsOf(resolved)).toContainEqual({
      type: "applyUrl",
      appId: APP_ID,
      url: makeUrl(1),
    });
  });

  it("keeps the newest proxy line when several arrive while starting", () => {
    const first = transition(startingRun, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: makeUrl(1),
    });
    const second = transition(first.state, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: makeUrl(2),
    });
    expect(second.state).toMatchObject({ pendingUrl: makeUrl(2) });
  });

  it("reuses snapshots for structurally identical proxy URLs", () => {
    const url = makeUrl(1);
    const ready: RunState = {
      type: "ready",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url,
    };
    const readyResult = transition(ready, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: { ...url },
    });
    expect(readyResult.state).toBe(ready);
    expect(commandsOf(readyResult)).toHaveLength(1);

    const starting: RunState = {
      type: "starting",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      operation: "run",
      startedAt: 100,
      pendingUrl: url,
    };
    const startingResult = transition(starting, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: { ...url },
    });
    expect(startingResult.state).toBe(starting);
    expect(ignoreReasonOf(startingResult)).toBe("no-change");
  });

  it("handles stop during starting: stale run completion is ignored", () => {
    const stop = transition(startingRun, {
      type: "STOP",
      appId: APP_ID,
      invocationRef: FRESH_REF,
      startedAt: 200,
    });
    expect(stop.state).toMatchObject({
      type: "stopping",
      invocationRef: FRESH_REF,
    });
    expect(commandsOf(stop)).toEqual([
      { type: "stop", appId: APP_ID, invocationRef: FRESH_REF },
    ]);

    const staleRun = transition(stop.state, {
      type: "RUN_IPC_RESOLVED",
      invocationRef: CURRENT_REF,
    });
    expect(staleRun.state).toBe(stop.state);

    const stopped = transition(stop.state, {
      type: "STOP_IPC_RESOLVED",
      invocationRef: FRESH_REF,
    });
    expect(stopped.state).toMatchObject({ type: "stopped", exitCode: null });
  });

  it("cycles ready -> reloading -> ready on HMR", () => {
    const ready: RunState = {
      type: "ready",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: makeUrl(1),
    };
    const reloading = transition(ready, {
      type: "HMR_DETECTED",
      appId: APP_ID,
    });
    expect(reloading.state).toMatchObject({ type: "reloading", reason: "hmr" });
    expect(commandsOf(reloading)).toEqual([
      {
        type: "reload",
        appId: APP_ID,
        invocationRef: CURRENT_REF,
        reason: "hmr",
      },
    ]);

    const done = transition(reloading.state, {
      type: "RELOAD_DONE",
      invocationRef: CURRENT_REF,
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
      expect(commandsOf(result)).toEqual([
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
        invocationRef: REF_1,
        startedAt: 100,
        options: { removeNodeModules: true, recreateSandbox: true },
      },
    );
    expect(commandsOf(result)).toEqual([
      {
        type: "start",
        appId: APP_ID,
        invocationRef: REF_1,
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
        invocationRef: CURRENT_REF,
        error: { message: "old" },
      },
      {
        type: "EXTERNAL_RESTART",
        appId: APP_ID,
        invocationRef: FRESH_REF,
        startedAt: 200,
        operation: "rebuild",
      },
    );

    expect(result.state).toEqual({
      type: "starting",
      appId: APP_ID,
      invocationRef: FRESH_REF,
      operation: "rebuild",
      startedAt: 200,
      pendingUrl: null,
    });
    expect(commandsOf(result)).toEqual([
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
      { type: "REBUILD", appId: APP_ID, invocationRef: REF_1, startedAt: 100 },
    );
    expect(commandsOf(result)).toEqual([
      {
        type: "start",
        appId: APP_ID,
        invocationRef: REF_1,
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
        invocationRef: CURRENT_REF,
        url: makeUrl(5),
      });
      expect(result.state).toMatchObject({ type: "ready", url: makeUrl(5) });
      expect(commandsOf(result)).toEqual([
        { type: "applyUrl", appId: APP_ID, url: makeUrl(5) },
      ]);
    }
  });

  it("ignores proxy lines while stopping", () => {
    const stopping: RunState = {
      type: "stopping",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      startedAt: 100,
    };
    const result = transition(stopping, {
      type: "PROXY_READY",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      url: makeUrl(5),
    });
    expect(result.state).toBe(stopping);
    expect(commandsOf(result)).toEqual([]);
  });

  it("records app exit from ready/reloading and ignores it elsewhere", () => {
    for (const state of STATE_FIXTURES) {
      const result = transition(state, {
        type: "APP_EXIT",
        appId: APP_ID,
        invocationRef: CURRENT_REF,
        exitCode: 137,
        timestamp: 300,
      });
      if (state.type === "ready" || state.type === "reloading") {
        expect(result.state).toMatchObject({ type: "stopped", exitCode: 137 });
      } else {
        expect(result.state).toBe(state);
      }
      expect(commandsOf(result)).toEqual([]);
    }
  });

  it("bumps the reload token when a restart fails (finally-block parity)", () => {
    const restarting: RunState = {
      type: "starting",
      appId: APP_ID,
      invocationRef: CURRENT_REF,
      operation: "restart",
      startedAt: 100,
      pendingUrl: null,
    };
    const result = transition(restarting, {
      type: "RUN_IPC_FAILED",
      invocationRef: CURRENT_REF,
      error: { message: "boom" },
    });
    expect(result.state).toMatchObject({
      type: "errored",
      error: { message: "boom" },
    });
    expect(commandsOf(result)).toEqual([
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
      invocationRef: CURRENT_REF,
      operation: "restart",
      startedAt: 100,
      pendingUrl: makeUrl(3),
    };
    const result = transition(restarting, {
      type: "RUN_IPC_FAILED",
      invocationRef: CURRENT_REF,
      error: { message: "boom" },
    });
    expect(result.state).toMatchObject({
      type: "errored",
      error: { message: "boom" },
    });
    expect(commandsOf(result)).toEqual([
      { type: "setError", appId: APP_ID, error: { message: "boom" } },
      { type: "bumpReloadToken", appId: APP_ID },
    ]);
  });

  it("does not bump the reload token when a plain run settles without a URL", () => {
    const resolved = transition(startingRun, {
      type: "RUN_IPC_RESOLVED",
      invocationRef: CURRENT_REF,
    });
    expect(resolved.state).toMatchObject({ type: "ready", url: null });
    expect(commandsOf(resolved)).toEqual([
      { type: "clearError", appId: APP_ID },
    ]);
  });
});

describe("projectRunState", () => {
  it("projects starting/stopping to the legacy PreviewRunState shape", () => {
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        invocationRef: REF_1,
        operation: "run",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "run", startedAt: 42 });
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        invocationRef: REF_1,
        operation: "restart",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "restart", startedAt: 42 });
    expect(
      projectRunState({
        type: "starting",
        appId: APP_ID,
        invocationRef: REF_1,
        operation: "rebuild",
        startedAt: 42,
        pendingUrl: null,
      }),
    ).toEqual({ operation: "restart", startedAt: 42 });
    expect(
      projectRunState({
        type: "stopping",
        appId: APP_ID,
        invocationRef: REF_1,
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
      kind: "ignored",
      state,
      reason: "invalid-in-current-state",
    });
    expect(ignore(state, "invalid-in-current-state").state).toBe(state);
  });
});
