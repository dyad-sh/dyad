import { describe, expect, it } from "vitest";
import { coolifySetupTransition } from "./transition";
import {
  IDLE,
  MAX_LOG_CHARS,
  COOLIFY_SETUP_INVOCATION_KIND,
  type CoolifySetupCommand,
  type CoolifySetupEvent,
  type CoolifySetupInvocationRef,
  type CoolifySetupState,
} from "./state";
import type { SetupResult } from "@/ipc/types/coolify_setup";

const ref = (host: string, operationId: string): CoolifySetupInvocationRef => ({
  kind: COOLIFY_SETUP_INVOCATION_KIND,
  entityKey: host,
  operationId,
});

const HOST = "203.0.113.5";
const REF = ref(HOST, "op-1");
// A second run of the SAME server: the host cannot tell these apart, which is
// why correlation is by operation and not by address.
const AGAIN = ref(HOST, "op-2");
const OTHER = ref("198.51.100.9", "op-3");

const TARGET = { host: HOST, username: "root", adminEmail: "me@gmail.com" };

const RESULT: SetupResult = {
  dashboardUrl: "https://203.0.113.5.sslip.io",
  secure: true,
  insecureReason: null,
  adminEmail: "me@gmail.com",
  adminPassword: "Abc123@xyz",
  tokenStored: true,
  tokenUnavailableReason: null,
  version: "4.3.2",
};

const running = (over: Record<string, unknown> = {}): CoolifySetupState =>
  ({
    type: "running",
    host: HOST,
    invocationRef: REF,
    step: "installing",
    log: "",
    stopping: false,
    ...over,
  }) as CoolifySetupState;

const done = (): CoolifySetupState => ({
  type: "done",
  host: HOST,
  invocationRef: REF,
  result: RESULT,
});
const failed = (): CoolifySetupState => ({
  type: "failed",
  host: HOST,
  invocationRef: REF,
  message: "boom",
  log: "output",
  cancelled: false,
});

const ALL_STATES: CoolifySetupState[] = [IDLE, running(), done(), failed()];
const ALL_EVENTS: CoolifySetupEvent[] = [
  { type: "start-requested", invocationRef: REF, target: TARGET },
  { type: "cancel-requested" },
  { type: "progress", invocationRef: REF, step: "installing", output: "x" },
  { type: "succeeded", invocationRef: REF, result: RESULT },
  { type: "failed", invocationRef: REF, message: "boom", cancelled: false },
  { type: "dismissed" },
];

/** The state a transition settles on, whether it applied or was ignored. */
const next = (state: CoolifySetupState, event: CoolifySetupEvent) =>
  coolifySetupTransition(state, event).state;

const commandsOf = (
  state: CoolifySetupState,
  event: CoolifySetupEvent,
): readonly CoolifySetupCommand[] => {
  const result = coolifySetupTransition(state, event);
  return result.kind === "applied" ? result.commands : [];
};

const reasonOf = (state: CoolifySetupState, event: CoolifySetupEvent) => {
  const result = coolifySetupTransition(state, event);
  return result.kind === "ignored" ? result.reason : null;
};

describe("totality", () => {
  it("answers every event from every state", () => {
    // The events come from a process that does not know what the user has
    // done since, so there is no combination that cannot arrive.
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        expect(() => coolifySetupTransition(state, event)).not.toThrow();
        expect(coolifySetupTransition(state, event)).toBeTruthy();
      }
    }
  });

  it("never mutates the state it was given", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const before = JSON.stringify(state);
        coolifySetupTransition(state, event);
        expect(JSON.stringify(state)).toBe(before);
      }
    }
  });
});

describe("starting", () => {
  it("begins at connecting with nothing said yet", () => {
    expect(
      next(IDLE, {
        type: "start-requested",
        invocationRef: REF,
        target: TARGET,
      }),
    ).toEqual({
      type: "running",
      host: HOST,
      invocationRef: REF,
      step: "connecting",
      log: "",
      stopping: false,
    });
  });

  it("replaces a terminal screen rather than keeping it beside the new run", () => {
    expect(
      next(done(), {
        type: "start-requested",
        invocationRef: OTHER,
        target: { ...TARGET, host: "198.51.100.9" },
      }),
    ).toMatchObject({ type: "running", host: "198.51.100.9" });
  });
});

describe("while it runs", () => {
  it("follows the step", () => {
    const stepped = next(running(), {
      type: "progress",
      invocationRef: REF,
      step: "securing",
    });
    expect(stepped).toMatchObject({ type: "running", step: "securing" });
  });

  it("accumulates output", () => {
    let state = running();
    state = next(state, {
      type: "progress",
      invocationRef: REF,
      step: "installing",
      output: "one ",
    });
    state = next(state, {
      type: "progress",
      invocationRef: REF,
      step: "installing",
      output: "two",
    });
    expect(state).toMatchObject({ log: "one two" });
  });

  it("keeps the end of a long installer's output", () => {
    // The end is what explains a failure, and an installer can print a lot.
    const state = next(running({ log: "a".repeat(MAX_LOG_CHARS) }), {
      type: "progress",
      invocationRef: REF,
      step: "installing",
      output: "TAIL",
    });
    const log = (state as { log: string }).log;
    expect(log).toHaveLength(MAX_LOG_CHARS);
    expect(log.endsWith("TAIL")).toBe(true);
  });

  it("records that the user has asked it to stop", () => {
    expect(next(running(), { type: "cancel-requested" })).toMatchObject({
      stopping: true,
    });
  });
});

describe("what it asks the controller to do", () => {
  // The rules live here rather than beside the effect, so they can be tested
  // without a server.

  it("asks for the work to be launched when nothing is running", () => {
    expect(
      commandsOf(IDLE, {
        type: "start-requested",
        invocationRef: REF,
        target: TARGET,
      }),
    ).toEqual([{ type: "launch", invocationRef: REF, target: TARGET }]);
  });

  it("refuses a second setup while one is going, and launches nothing", () => {
    const state = running();
    const event: CoolifySetupEvent = {
      type: "start-requested",
      invocationRef: AGAIN,
      target: TARGET,
    };
    expect(reasonOf(state, event)).toBe("already-running");
    expect(commandsOf(state, event)).toEqual([]);
    expect(next(state, event)).toBe(state);
  });

  it("asks for the running invocation to be aborted, not the requested one", () => {
    // The abort has to name what is actually going on, or a cancel arriving
    // just after a supersede would stop the wrong run.
    expect(commandsOf(running(), { type: "cancel-requested" })).toEqual([
      { type: "abort", invocationRef: REF },
    ]);
  });

  it("does not remake the state when it is already stopping", () => {
    // A second Cancel — a double click inside the round trip, or another
    // window — must not hand back a new object that says the same thing.
    const state = running({ stopping: true });
    const result = coolifySetupTransition(state, { type: "cancel-requested" });

    expect(result.state).toBe(state);
    expect(commandsOf(state, { type: "cancel-requested" })).toEqual([
      { type: "abort", invocationRef: REF },
    ]);
  });

  it("aborts nothing when nothing is running", () => {
    expect(reasonOf(IDLE, { type: "cancel-requested" })).toBe("not-running");
    expect(commandsOf(done(), { type: "cancel-requested" })).toEqual([]);
  });

  it("says why it ignored an answer from a superseded run", () => {
    expect(
      reasonOf(running(), {
        type: "succeeded",
        invocationRef: AGAIN,
        result: RESULT,
      }),
    ).toBe("stale-operation");
  });
});

describe("answers from a run that is no longer the one in hand", () => {
  // The reason this is a machine. A run keeps going after the panel showing
  // it is gone, so its answers arrive against whatever state came next.

  it("ignores progress for another server", () => {
    const state = running();
    expect(
      next(state, {
        type: "progress",
        invocationRef: OTHER,
        step: "securing",
      }),
    ).toBe(state);
  });

  it("ignores a result for another server", () => {
    const state = running();
    expect(
      next(state, { type: "succeeded", invocationRef: OTHER, result: RESULT }),
    ).toBe(state);
  });

  it("ignores a result that arrives after the screen was dismissed", () => {
    // Exactly the shape that put a finished install over a panel the user had
    // already moved on from.
    expect(
      next(IDLE, { type: "succeeded", invocationRef: REF, result: RESULT }),
    ).toBe(IDLE);
  });

  it("ignores a failure from an earlier run of the same server", () => {
    // Start, cancel, start again: the host is identical, so only the
    // operation identity can tell the first run's answer from the second's.
    const state = running({ invocationRef: AGAIN });
    expect(
      next(state, {
        type: "failed",
        invocationRef: REF,
        message: "late",
        cancelled: false,
      }),
    ).toBe(state);
  });

  it("ignores a second result for a run already finished", () => {
    const state = done();
    expect(
      next(state, { type: "succeeded", invocationRef: REF, result: RESULT }),
    ).toBe(state);
  });
});

describe("finishing", () => {
  it("carries the result through", () => {
    expect(
      next(running(), {
        type: "succeeded",
        invocationRef: REF,
        result: RESULT,
      }),
    ).toEqual({
      type: "done",
      host: HOST,
      invocationRef: REF,
      result: RESULT,
    });
  });

  it("keeps the output when it fails, since that is what explains it", () => {
    expect(
      next(running({ log: "3/6 Pulling..." }), {
        type: "failed",
        invocationRef: REF,
        message: "exit 1",
        cancelled: false,
      }),
    ).toEqual({
      type: "failed",
      host: HOST,
      invocationRef: REF,
      message: "exit 1",
      log: "3/6 Pulling...",
      cancelled: false,
    });
  });

  it("marks a cancellation as one, so it is not reported as a fault", () => {
    expect(
      next(running({ stopping: true }), {
        type: "failed",
        invocationRef: REF,
        message: "Cancelled.",
        cancelled: true,
      }),
    ).toMatchObject({ type: "failed", cancelled: true });
  });
});

describe("dismissing", () => {
  it("clears a finished screen", () => {
    expect(next(done(), { type: "dismissed" })).toEqual(IDLE);
  });

  it("clears a failed screen", () => {
    expect(next(failed(), { type: "dismissed" })).toEqual(IDLE);
  });

  it("does not clear a running one", () => {
    // There would still be an install going on, with nothing showing it.
    const state = running();
    expect(next(state, { type: "dismissed" })).toBe(state);
  });
});
