import { describe, expect, it } from "vitest";
import {
  assertAllCommandsProducible,
  assertAllStatesReachable,
  assertReferenceStability,
  exploreReachableStates,
} from "@/state_machines/testing";
import { transition } from "./transition";
import {
  MAX_LOG_CHARS,
  type CoolifyDeployCommand,
  type CoolifyDeployEvent,
  type CoolifyDeployInvocationRef,
  type CoolifyDeployState,
} from "./state";

function ref(operationId: string, appId = 1): CoolifyDeployInvocationRef {
  return { kind: "coolify-deploy", entityKey: appId, operationId };
}

const REF_A = ref("a");
const REF_B = ref("b");

function running(
  overrides: Partial<Extract<CoolifyDeployState, { type: "running" }>> = {},
): CoolifyDeployState {
  return {
    type: "running",
    appId: 1,
    invocationRef: REF_A,
    stage: "preparing",
    log: "",
    startedAt: 100,
    deploymentUuid: null,
    ...overrides,
  };
}

const IDLE: CoolifyDeployState = { type: "idle" };

describe("DEPLOY_REQUESTED", () => {
  it("starts from idle and emits RUN_DEPLOY", () => {
    const result = transition(IDLE, {
      type: "DEPLOY_REQUESTED",
      appId: 1,
      invocationRef: REF_A,
      startedAt: 100,
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.state).toEqual(running());
    expect(result.commands).toEqual([
      {
        type: "RUN_DEPLOY",
        appId: 1,
        invocationRef: REF_A,
        resumeDeploymentUuid: null,
      },
    ]);
  });

  it("does not start a second deployment while one runs", () => {
    const state = running();
    const result = transition(state, {
      type: "DEPLOY_REQUESTED",
      appId: 1,
      invocationRef: REF_B,
      startedAt: 200,
    });
    expect(result.kind).toBe("ignored");
    expect(result.state).toBe(state);
  });

  it("starts again after a finished deployment", () => {
    const state: CoolifyDeployState = {
      type: "failed",
      appId: 1,
      log: "boom",
      error: "boom",
      finishedAt: 300,
      deploymentUuid: null,
    };
    const result = transition(state, {
      type: "DEPLOY_REQUESTED",
      appId: 1,
      invocationRef: REF_B,
      startedAt: 400,
    });
    expect(result.kind).toBe("applied");
  });

  it("carries a failed attempt's deployment into the retry", () => {
    // The poll timeout does not stop the build, so a retry must be able to
    // adopt it rather than starting a second one.
    const state: CoolifyDeployState = {
      type: "failed",
      appId: 1,
      log: "timed out",
      error: "Deployment did not finish",
      finishedAt: 300,
      deploymentUuid: "dep-1",
    };
    const result = transition(state, {
      type: "DEPLOY_REQUESTED",
      appId: 1,
      invocationRef: REF_B,
      startedAt: 400,
    });
    if (result.kind !== "applied") throw new Error("expected applied");
    expect(result.commands).toEqual([
      {
        type: "RUN_DEPLOY",
        appId: 1,
        invocationRef: REF_B,
        resumeDeploymentUuid: "dep-1",
      },
    ]);
  });
});

describe("progress events", () => {
  it("advances the stage", () => {
    const result = transition(running(), {
      type: "STAGE_CHANGED",
      invocationRef: REF_A,
      stage: "building",
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied" || result.state.type !== "running") return;
    expect(result.state.stage).toBe("building");
  });

  it("ignores a repeated stage so the snapshot reference stays stable", () => {
    const state = running({ stage: "building" });
    const result = transition(state, {
      type: "STAGE_CHANGED",
      invocationRef: REF_A,
      stage: "building",
    });
    expect(result.kind).toBe("ignored");
    expect(result.state).toBe(state);
  });

  it("appends to the log", () => {
    const result = transition(running({ log: "one\n" }), {
      type: "LOG_APPENDED",
      invocationRef: REF_A,
      chunk: "two\n",
    });
    if (result.kind !== "applied" || result.state.type !== "running") {
      throw new Error("expected applied running state");
    }
    expect(result.state.log).toBe("one\ntwo\n");
  });

  it("trims the log to a bounded size", () => {
    const result = transition(running({ log: "x".repeat(MAX_LOG_CHARS) }), {
      type: "LOG_APPENDED",
      invocationRef: REF_A,
      chunk: "tail",
    });
    if (result.kind !== "applied" || result.state.type !== "running") {
      throw new Error("expected applied running state");
    }
    expect(result.state.log).toHaveLength(MAX_LOG_CHARS);
    expect(result.state.log.endsWith("tail")).toBe(true);
  });

  it("records the deployment id", () => {
    const result = transition(running(), {
      type: "DEPLOYMENT_STARTED",
      invocationRef: REF_A,
      deploymentUuid: "dep-1",
    });
    if (result.kind !== "applied" || result.state.type !== "running") {
      throw new Error("expected applied running state");
    }
    expect(result.state.deploymentUuid).toBe("dep-1");
  });
});

describe("superseded operations", () => {
  const staleEvents = [
    { type: "STAGE_CHANGED", invocationRef: REF_B, stage: "building" },
    { type: "LOG_APPENDED", invocationRef: REF_B, chunk: "noise" },
    { type: "DEPLOYMENT_STARTED", invocationRef: REF_B, deploymentUuid: "x" },
    {
      type: "SUCCEEDED",
      invocationRef: REF_B,
      url: "https://x",
      finishedAt: 1,
    },
    { type: "FAILED", invocationRef: REF_B, error: "nope", finishedAt: 1 },
  ] as const;

  it.each(staleEvents)("ignores $type from another invocation", (event) => {
    const state = running();
    const result = transition(state, event);
    expect(result.kind).toBe("ignored");
    expect(result.state).toBe(state);
  });

  it.each(staleEvents)("ignores $type once idle", (event) => {
    const result = transition(IDLE, event);
    expect(result.kind).toBe("ignored");
    expect(result.state).toBe(IDLE);
  });
});

describe("completion", () => {
  it("keeps the log and url on success", () => {
    const result = transition(running({ log: "built\n" }), {
      type: "SUCCEEDED",
      invocationRef: REF_A,
      url: "https://app.example.com",
      finishedAt: 500,
    });
    expect(result.kind).toBe("applied");
    expect(result.state).toEqual({
      type: "succeeded",
      appId: 1,
      log: "built\n",
      url: "https://app.example.com",
      finishedAt: 500,
    });
  });

  it("keeps the log, error and deployment id on failure", () => {
    const result = transition(
      running({ log: "oops\n", deploymentUuid: "dep-1" }),
      {
        type: "FAILED",
        invocationRef: REF_A,
        error: "exploded",
        finishedAt: 500,
      },
    );
    expect(result.state).toEqual({
      type: "failed",
      appId: 1,
      log: "oops\n",
      error: "exploded",
      finishedAt: 500,
      deploymentUuid: "dep-1",
    });
  });
});

describe("CANCELLED", () => {
  it("aborts a running deployment and returns to idle", () => {
    const result = transition(running(), {
      type: "CANCELLED",
      appId: 1,
      finishedAt: 600,
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.state).toEqual(IDLE);
    expect(result.commands).toEqual([
      { type: "ABORT_DEPLOY", invocationRef: REF_A },
    ]);
  });

  it("clears a finished result so reconnecting shows nothing stale", () => {
    const state: CoolifyDeployState = {
      type: "succeeded",
      appId: 1,
      log: "old",
      url: "https://old.example.com",
      finishedAt: 1,
    };
    const result = transition(state, {
      type: "CANCELLED",
      appId: 1,
      finishedAt: 2,
    });
    expect(result.kind).toBe("applied");
    expect(result.state).toEqual(IDLE);
  });

  it("leaves another app alone", () => {
    const state = running();
    const result = transition(state, {
      type: "CANCELLED",
      appId: 2,
      finishedAt: 600,
    });
    expect(result.kind).toBe("ignored");
    expect(result.state).toBe(state);
  });

  it("a cancelled deployment cannot report success afterwards", () => {
    const cancelled = transition(running(), {
      type: "CANCELLED",
      appId: 1,
      finishedAt: 600,
    });
    if (cancelled.kind !== "applied") throw new Error("expected applied");
    const late = transition(cancelled.state, {
      type: "SUCCEEDED",
      invocationRef: REF_A,
      url: "https://late.example.com",
      finishedAt: 700,
    });
    expect(late.kind).toBe("ignored");
    expect(late.state).toEqual(IDLE);
  });
});

// The rules require every reachable state to meet every event type. Driven off
// the declared unions rather than a hand-written list, so a new state, command
// or event fails here until it has been reasoned about.
const STATE_KINDS = [
  "idle",
  "running",
  "succeeded",
  "failed",
] as const satisfies readonly CoolifyDeployState["type"][];

const COMMAND_KINDS = [
  "RUN_DEPLOY",
  "ABORT_DEPLOY",
] as const satisfies readonly CoolifyDeployCommand["type"][];

/**
 * Both a matching and a mismatched invocation ref for every ref-carrying
 * event, so exploration covers the stale-operation branches as well as the
 * live ones.
 */
const events: readonly CoolifyDeployEvent[] = [
  { type: "DEPLOY_REQUESTED", appId: 1, invocationRef: REF_A, startedAt: 100 },
  {
    type: "DEPLOY_REQUESTED",
    appId: 2,
    invocationRef: ref("c", 2),
    startedAt: 100,
  },
  ...[REF_A, REF_B].flatMap((r): CoolifyDeployEvent[] => [
    { type: "STAGE_CHANGED", invocationRef: r, stage: "configuring" },
    { type: "STAGE_CHANGED", invocationRef: r, stage: "building" },
    { type: "LOG_APPENDED", invocationRef: r, chunk: "line\n" },
    // An empty chunk must not produce a fresh snapshot identical to the old.
    { type: "LOG_APPENDED", invocationRef: r, chunk: "" },
    { type: "DEPLOYMENT_STARTED", invocationRef: r, deploymentUuid: "dep-1" },
    {
      type: "SUCCEEDED",
      invocationRef: r,
      url: "https://app.example.com",
      finishedAt: 200,
    },
    { type: "FAILED", invocationRef: r, error: "boom", finishedAt: 200 },
  ]),
  { type: "CANCELLED", appId: 1, finishedAt: 300 },
  { type: "CANCELLED", appId: 2, finishedAt: 300 },
];

describe("totality", () => {
  // The log is an unbounded accumulator: every chunk yields a distinct value,
  // so including it would make exploration diverge instead of converging on
  // the structural states. Its emptiness is what the machine branches on.
  const stateKey = (state: CoolifyDeployState) =>
    JSON.stringify(state, (key, value) =>
      key === "log" ? (value === "" ? "empty" : "nonempty") : value,
    );

  const options = { initialState: IDLE, events, transition, stateKey };

  it("reaches every state and produces every command kind", () => {
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

  it("answers every event from every reachable state without losing reference stability", () => {
    const graph = exploreReachableStates(options);
    const states = graph.nodes.map(({ state }) => state);

    expect([...new Set(states.map((s) => s.type))].sort()).toEqual(
      [...STATE_KINDS].sort(),
    );

    for (const state of states) {
      for (const event of events) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        // An ignored event keeps the same reference; a change must not return
        // a new reference for a value-equal state.
        assertReferenceStability(state, result, (left, right) =>
          Object.is(JSON.stringify(left), JSON.stringify(right)),
        );
      }
    }
  });
});
