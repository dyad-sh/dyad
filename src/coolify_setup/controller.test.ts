import { describe, expect, it, vi } from "vitest";
import { CoolifySetupController } from "./controller";
import type { CoolifySetupState } from "./state";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { SetupResult, SetupStep, SetupTarget } from "@/ipc/types";

const TARGET: SetupTarget = {
  host: "203.0.113.5",
  username: "root",
  adminEmail: "me@gmail.com",
};

const RESULT: SetupResult = {
  dashboardUrl: "https://203.0.113.5.sslip.io",
  secure: true,
  insecureReason: null,
  adminEmail: "me@gmail.com",
  adminPassword: "Abc123@xyz",
  tokenStored: true,
  apiEnabled: true,
  tokenUnavailableReason: null,
  version: "4.3.2",
};

/** Deterministic, because a machine keyed on identity must be reproducible. */
function ids() {
  let n = 0;
  return { next: () => `op-${++n}` };
}

function harness(
  execute: CoolifySetupController extends never
    ? never
    : ConstructorParameters<typeof CoolifySetupController>[0]["execute"],
) {
  const states: CoolifySetupState[] = [];
  const controller = new CoolifySetupController({
    execute,
    ids: ids(),
    onChanged: (state) => states.push(state),
  });
  return { controller, states };
}

/** A run the test finishes by hand. */
function deferred() {
  let resolve!: (value: SetupResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<SetupResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("starting", () => {
  it("reports what is happening, so a panel can be a view of it", async () => {
    const gate = deferred();
    let report!: (step: SetupStep, output?: string) => void;
    const { controller } = harness(async (_t, hooks) => {
      report = hooks.onProgress;
      return gate.promise;
    });

    controller.start(TARGET);
    expect(controller.getState()).toMatchObject({
      type: "running",
      host: "203.0.113.5",
      step: "connecting",
    });

    report("installing", "3/6 Pulling...");
    expect(controller.getState()).toMatchObject({
      step: "installing",
      log: "3/6 Pulling...",
    });

    gate.resolve(RESULT);
    await controller.getState();
  });

  it("refuses a second setup while one is running", async () => {
    const gate = deferred();
    const { controller } = harness(async () => gate.promise);
    controller.start(TARGET);

    expect(() => controller.start({ ...TARGET, host: "198.51.100.9" })).toThrow(
      /already being set up/,
    );
    gate.resolve(RESULT);
  });

  it("lets another start once the first has finished", async () => {
    const first = deferred();
    let calls = 0;
    const { controller } = harness(async () => {
      calls += 1;
      return calls === 1 ? first.promise : RESULT;
    });

    const run = controller.start(TARGET);
    first.resolve(RESULT);
    await run.result;
    controller.dismiss();

    expect(() => controller.start(TARGET)).not.toThrow();
  });
});

describe("finishing", () => {
  it("keeps the result where a panel can find it after the fact", async () => {
    const { controller } = harness(async () => RESULT);
    const run = controller.start(TARGET);
    await run.result;

    expect(controller.getState()).toMatchObject({ type: "done" });
  });

  it("hands the caller what the work produced", async () => {
    const { controller } = harness(async () => RESULT);
    expect(await controller.start(TARGET).result).toEqual(RESULT);
  });

  it("keeps a failure and the output that explains it", async () => {
    const { controller } = harness(async (_t, hooks) => {
      hooks.onProgress("installing", "3/6 Pulling...");
      throw new DyadError("exit 1", DyadErrorKind.External);
    });

    await expect(controller.start(TARGET).result).rejects.toThrow("exit 1");
    expect(controller.getState()).toMatchObject({
      type: "failed",
      message: "exit 1",
      log: "3/6 Pulling...",
      cancelled: false,
    });
  });

  it("marks a cancellation as one rather than as a fault", async () => {
    const { controller } = harness(async (_t, hooks) => {
      await new Promise<void>((resolve) =>
        hooks.signal.addEventListener("abort", () => resolve()),
      );
      throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
    });

    const run = controller.start(TARGET);
    controller.cancel();
    await expect(run.result).rejects.toThrow("Cancelled.");
    expect(controller.getState()).toMatchObject({
      type: "failed",
      cancelled: true,
    });
  });
});

describe("cancelling", () => {
  it("aborts the work rather than only saying so", async () => {
    let aborted = false;
    const gate = deferred();
    const { controller } = harness(async (_t, hooks) => {
      hooks.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return gate.promise;
    });

    controller.start(TARGET);
    controller.cancel();

    expect(aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ stopping: true });
    gate.resolve(RESULT);
  });

  it("carries out a command from a transition that stays put", async () => {
    // A second cancel does not change the state, and setState answers "no
    // change" the same way it answers "disposed" — so the abort it asks for
    // has to be run on the strength of the transition, not the state change.
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const gate = deferred();
    const { controller } = harness(async () => gate.promise);

    controller.start(TARGET);
    const before = abort.mock.calls.length;
    controller.cancel();
    controller.cancel();

    expect(abort.mock.calls.length - before).toBe(2);
    gate.resolve(RESULT);
    abort.mockRestore();
  });

  it("is quiet when there is nothing to stop", () => {
    const { controller } = harness(async () => RESULT);
    expect(() => controller.cancel()).not.toThrow();
    expect(controller.getState()).toEqual({ type: "idle" });
  });
});

describe("answers from a run nobody is watching any more", () => {
  it("does not put a superseded run's result back on screen", async () => {
    // The reason the state is here and not in the panel: this run finishes
    // after the user has moved on, and its answer must not revive anything.
    const first = deferred();
    let calls = 0;
    const { controller } = harness(async () => {
      calls += 1;
      return calls === 1 ? first.promise : RESULT;
    });

    const stale = controller.start(TARGET);
    controller.cancel();
    first.reject(new DyadError("Cancelled.", DyadErrorKind.UserCancelled));
    await expect(stale.result).rejects.toThrow();
    controller.dismiss();

    // A second run of the same server, then the first one's answer arrives.
    const second = controller.start(TARGET);
    await second.result;
    expect(controller.getState()).toMatchObject({ type: "done" });
  });
});

describe("what a run could not put back", () => {
  it("reaches the state a panel reads, not just the error", async () => {
    // The whole hop: an error carrying it, the dispatch that reads it off,
    // and the transition that has to carry it onto the state. Asserting on
    // either end alone leaves the middle free to drop it, which is what
    // happened.
    const { controller } = harness(async () => {
      throw Object.assign(
        new DyadError("Cancelled.", DyadErrorKind.UserCancelled),
        { warning: "Coolify may still be configured for x.sslip.io." },
      );
    });

    await controller.start(TARGET).result.catch(() => {});

    expect(controller.getState()).toMatchObject({
      type: "failed",
      cancelled: true,
      warning: "Coolify may still be configured for x.sslip.io.",
    });
  });

  it("says nothing when a run had nothing to put back", async () => {
    const { controller } = harness(async () => {
      throw new DyadError("boom", DyadErrorKind.External);
    });

    await controller.start(TARGET).result.catch(() => {});

    expect(
      (controller.getState() as { warning?: string }).warning,
    ).toBeUndefined();
  });
});

describe("telling anyone who is listening", () => {
  it("reports each change once, so windows can follow along", async () => {
    const { controller, states } = harness(async (_t, hooks) => {
      hooks.onProgress("installing");
      return RESULT;
    });

    await controller.start(TARGET).result;

    expect(states.map((s) => s.type)).toEqual(["running", "running", "done"]);
  });

  it("says nothing when the answer is the same as last time", async () => {
    // Starting already puts it at "connecting". Reporting that again is not a
    // change, and telling every window about it is a render for nothing.
    const { controller, states } = harness(async (_t, hooks) => {
      hooks.onProgress("connecting");
      return RESULT;
    });

    await controller.start(TARGET).result;

    expect(states.map((s) => s.type)).toEqual(["running", "done"]);
  });

  it("says nothing when it ignored the event", () => {
    const { controller, states } = harness(async () => RESULT);
    controller.cancel();
    controller.dismiss();
    expect(states).toHaveLength(0);
  });
});

describe("an executor that throws before it starts", () => {
  it("does not leave the machine running with nothing running", async () => {
    // Reading the server key throws where it stands, not as a rejection, and
    // handlers attached to a promise that was never made never run — so the
    // machine would stay running and refuse every later setup.
    const { controller } = harness((() => {
      throw new Error("key file is corrupt");
    }) as never);

    const run = controller.start(TARGET);
    await expect(run.result).rejects.toThrow("key file is corrupt");

    expect(controller.getState()).toMatchObject({ type: "failed" });
    controller.dismiss();
    expect(() => controller.start(TARGET)).not.toThrow();
  });
});

describe("after it is disposed", () => {
  it("starts nothing new, rather than working where nobody can see it", async () => {
    // A disposed store keeps nothing and tells nobody. Launching anyway would
    // put an install on somebody's server that no window could show, cancel,
    // or hear the end of.
    let launched = 0;
    const { controller } = harness(async () => {
      launched += 1;
      return RESULT;
    });

    controller.dispose();
    expect(() => controller.start(TARGET)).toThrow();
    expect(launched).toBe(0);
  });

  it("stops telling anyone, so a late answer cannot reach a closed window", async () => {
    const gate = deferred();
    const { controller, states } = harness(async () => gate.promise);
    controller.start(TARGET);
    const before = states.length;

    controller.dispose();
    gate.resolve(RESULT);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(states).toHaveLength(before);
  });
});

describe("not taking the process down", () => {
  it("survives a failure nobody awaited", async () => {
    const rejection = vi.fn();
    process.once("unhandledRejection", rejection);
    const { controller } = harness(async () => {
      throw new Error("nobody is listening");
    });

    controller.start(TARGET);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(rejection).not.toHaveBeenCalled();
    process.off("unhandledRejection", rejection);
  });
});
