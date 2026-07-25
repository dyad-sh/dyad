import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AppRunInvocationRef,
  RestartOptions,
  RunErrorInfo,
  RunState,
  RunUrl,
} from "./state";
import {
  APP_RUN_REMOTE_INTENT_CLASS,
  AppRunDispatchSchema,
  AppRunIntentEventSchema,
  AppRunKeySchema,
  AppRunProducerEventSchema,
  AppRunRemoteSnapshotSchema,
  AppRunWireEventSchema,
  projectAppRunRemoteSnapshot,
  type AppRunIntentEvent,
  type AppRunProducerEvent,
  type AppRunRemoteSnapshot,
  type AppRunWireInvocationRef,
} from "./transport";

const APP_ID = 42;
const invocationRef = {
  kind: "app-run" as const,
  entityKey: APP_ID,
  operationId: "run:42:1",
};
const restartOptions = {
  removeNodeModules: true,
  recreateSandbox: false,
};
const url = {
  appUrl: "http://localhost:3210",
  originalUrl: "http://localhost:5173",
  mode: "host" as const,
};

const intentEvents = [
  {
    type: "START",
    operationId: "intent:start:1",
    startedAt: 100,
    expectedRevision: 0,
  },
  {
    type: "RESTART",
    operationId: "intent:restart:1",
    startedAt: 110,
    expectedRevision: 1,
    operation: "restart",
    options: restartOptions,
  },
  {
    type: "RESTART",
    operationId: "intent:rebuild:1",
    startedAt: 115,
    expectedRevision: 1,
    operation: "rebuild",
  },
  {
    type: "STOP_REQUESTED",
    operationId: "intent:stop:1",
    startedAt: 120,
    activeInvocationRef: invocationRef,
  },
  {
    type: "MANUAL_RELOAD",
    operationId: "intent:reload:1",
    startedAt: 130,
  },
] satisfies AppRunIntentEvent[];

const producerEvents = [
  {
    type: "EXTERNAL_RESTART_STARTED",
    invocationRef,
    startedAt: 200,
    operation: "rebuild",
  },
  { type: "PROCESS_SPAWNED", invocationRef },
  {
    type: "PROCESS_FAILED",
    invocationRef,
    error: { message: "spawn failed" },
  },
  { type: "PROCESS_STOPPED", invocationRef },
  {
    type: "PROCESS_STOP_FAILED",
    invocationRef,
    error: { message: "stop failed" },
  },
  { type: "PROXY_READY", invocationRef, url },
  { type: "HMR_DETECTED", invocationRef },
  { type: "RELOAD_COMPLETED", invocationRef },
  {
    type: "PROCESS_EXITED",
    invocationRef,
    exitCode: 1,
    timestamp: 300,
  },
] satisfies AppRunProducerEvent[];

function roundTrip<T>(schema: { parse(input: unknown): T }, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

describe("app-run transport codecs", () => {
  it("round-trips the app key", () => {
    const key = { appId: APP_ID };
    expect(roundTrip(AppRunKeySchema, key)).toEqual(key);
  });

  it.each(intentEvents)("round-trips intent $type", (event) => {
    expect(roundTrip(AppRunIntentEventSchema, event)).toEqual(event);
    expect(roundTrip(AppRunWireEventSchema, event)).toEqual(event);
    const dispatch = { key: { appId: APP_ID }, event };
    expect(roundTrip(AppRunDispatchSchema, dispatch)).toEqual(dispatch);
  });

  it.each(producerEvents)("round-trips producer $type", (event) => {
    expect(roundTrip(AppRunProducerEventSchema, event)).toEqual(event);
    expect(roundTrip(AppRunWireEventSchema, event)).toEqual(event);
  });

  it("round-trips the safe remote snapshot", () => {
    const state: RunState = {
      type: "starting",
      appId: APP_ID,
      invocationRef,
      operation: "restart",
      startedAt: 400,
      pendingUrl: url,
    };
    const snapshot = projectAppRunRemoteSnapshot(APP_ID, 7, state);

    expect(roundTrip(AppRunRemoteSnapshotSchema, snapshot)).toEqual(snapshot);
  });

  it("preserves an early proxy URL until spawn settlement", () => {
    const state: RunState = {
      type: "starting",
      appId: APP_ID,
      invocationRef,
      operation: "run",
      startedAt: 400,
      pendingUrl: url,
    };

    expect(projectAppRunRemoteSnapshot(APP_ID, 7, state)).toMatchObject({
      phase: "starting",
      operation: "run",
      url: null,
    });
  });

  it("projects only observed process exits", () => {
    const stopSettled: RunState = {
      type: "stopped",
      appId: APP_ID,
      invocationRef,
      exitCode: null,
      timestamp: null,
    };
    expect(projectAppRunRemoteSnapshot(APP_ID, 8, stopSettled).exit).toBeNull();

    const processExited: RunState = {
      ...stopSettled,
      exitCode: 137,
      timestamp: 450,
    };
    expect(projectAppRunRemoteSnapshot(APP_ID, 9, processExited).exit).toEqual({
      exitCode: 137,
      timestamp: 450,
    });
  });

  it("keeps stop available after an operation error", () => {
    const state: RunState = {
      type: "errored",
      appId: APP_ID,
      invocationRef,
      error: { message: "stop failed" },
    };

    expect(
      projectAppRunRemoteSnapshot(APP_ID, 10, state).capabilities.canStop,
    ).toBe(true);
  });

  it("rejects projection state from a different app", () => {
    const state: RunState = {
      type: "ready",
      appId: APP_ID,
      invocationRef,
      url,
    };

    expect(() =>
      projectAppRunRemoteSnapshot(APP_ID + 1, 11, state),
    ).toThrowError("App-run projection state does not match its actor key");
  });

  it("rejects unknown events and unknown payload fields", () => {
    expect(() =>
      AppRunWireEventSchema.parse({ type: "PROCESS_HANDLE_ATTACHED" }),
    ).toThrow();
    expect(() =>
      AppRunIntentEventSchema.parse({
        ...intentEvents[0],
        callback: () => undefined,
      }),
    ).toThrow();
    expect(() =>
      AppRunProducerEventSchema.parse({
        ...producerEvents[1],
        invocationRef: { ...invocationRef, operationId: "" },
      }),
    ).toThrow();
    expect(() =>
      AppRunDispatchSchema.parse({
        key: { appId: APP_ID },
        event: {
          ...intentEvents[3],
          activeInvocationRef: {
            ...invocationRef,
            entityKey: APP_ID + 1,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      AppRunIntentEventSchema.parse({
        ...intentEvents[0],
        appId: APP_ID,
      }),
    ).toThrow();
  });

  it("rejects malformed keys, events, and snapshots", () => {
    expect(() => AppRunKeySchema.parse({ appId: 0 })).toThrow();
    expect(() =>
      AppRunIntentEventSchema.parse({
        ...intentEvents[1],
        expectedRevision: -1,
      }),
    ).toThrow();
    expect(() =>
      AppRunIntentEventSchema.parse({
        ...intentEvents[1],
        operation: "rebuild",
      }),
    ).toThrow();
    expect(() =>
      AppRunProducerEventSchema.parse({
        ...producerEvents[8],
        timestamp: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();

    const snapshot = projectAppRunRemoteSnapshot(APP_ID, 1, {
      type: "errored",
      appId: APP_ID,
      invocationRef,
      error: { message: "boom" },
    });
    expect(() =>
      AppRunRemoteSnapshotSchema.parse({
        ...snapshot,
        processHandle: {},
      }),
    ).toThrow();
    expect(() =>
      AppRunRemoteSnapshotSchema.parse({
        ...snapshot,
        operationError: new Error("boom"),
      }),
    ).toThrow();
  });

  it("classifies every remotely dispatchable event", () => {
    expect(Object.keys(APP_RUN_REMOTE_INTENT_CLASS).sort()).toEqual(
      [...new Set(intentEvents.map((event) => event.type))].sort(),
    );
  });
});

type ExcludedProjectionField =
  | "process"
  | "processHandle"
  | "childProcess"
  | "appPath"
  | "cwd"
  | "command"
  | "commandRuntime"
  | "callback"
  | "callbacks";

expectTypeOf<
  Extract<keyof AppRunRemoteSnapshot, ExcludedProjectionField>
>().toEqualTypeOf<never>();
expectTypeOf<AppRunWireInvocationRef>().toEqualTypeOf<AppRunInvocationRef>();
expectTypeOf<
  Extract<
    AppRunIntentEvent,
    { type: "RESTART"; operation: "restart" }
  >["options"]
>().toEqualTypeOf<RestartOptions>();
expectTypeOf<
  Extract<AppRunProducerEvent, { type: "PROXY_READY" }>["url"]
>().toEqualTypeOf<RunUrl>();
expectTypeOf<
  Extract<AppRunProducerEvent, { type: "PROCESS_FAILED" }>["error"]
>().toEqualTypeOf<RunErrorInfo>();
