import { describe, expect, it, vi } from "vitest";
import {
  VersionPreviewController,
  type VersionPreviewCommands,
  type VersionPreviewRuntime,
} from "./controller";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fake command runtime where every call is a manually settled deferred. */
function makeFakeRuntime() {
  const calls: Array<{
    type: string;
    input: unknown;
    deferred: Deferred<any>;
  }> = [];
  const track = (type: string) => (input: unknown) => {
    const d = deferred<any>();
    calls.push({ type, input, deferred: d });
    return d.promise;
  };
  const commands: VersionPreviewCommands = {
    resolveOriginBranch: track(
      "resolve",
    ) as VersionPreviewCommands["resolveOriginBranch"],
    checkoutVersion: track(
      "checkout",
    ) as VersionPreviewCommands["checkoutVersion"],
    returnToBranch: track("return") as VersionPreviewCommands["returnToBranch"],
    switchBranch: track(
      "switch-branch",
    ) as VersionPreviewCommands["switchBranch"],
    restoreVersion: track(
      "restore",
    ) as VersionPreviewCommands["restoreVersion"],
    restoreToMessage: track(
      "restore-to-message",
    ) as VersionPreviewCommands["restoreToMessage"],
  };
  const notifyError = vi.fn();
  const notifyRecovery = vi.fn();
  const dismissRecovery = vi.fn();
  const runtime: VersionPreviewRuntime = {
    commands,
    notifyError,
    notifyRecovery,
    dismissRecovery,
  };
  return {
    runtime,
    notifyError,
    notifyRecovery,
    dismissRecovery,
    calls,
    ofType: (type: string) => calls.filter((call) => call.type === type),
    last: (type: string) => {
      const matching = calls.filter((call) => call.type === type);
      return matching[matching.length - 1];
    },
  };
}

/** Flushes pending microtasks so settled deferreds dispatch their events. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const APP_ID = 1;

function makeController() {
  const fake = makeFakeRuntime();
  const controller = new VersionPreviewController(APP_ID, fake.runtime);
  return { controller, fake };
}

async function driveToPreviewing(
  controller: VersionPreviewController,
  fake: ReturnType<typeof makeFakeRuntime>,
  versionId = "v1",
) {
  controller.send({ type: "OPEN", appId: APP_ID });
  controller.send({ type: "SELECT_VERSION", versionId });
  fake.last("resolve").deferred.resolve({ branch: "feature/origin" });
  await flush();
  fake.last("checkout").deferred.resolve(undefined);
  await flush();
  expect(controller.getSnapshot().type).toBe("previewing");
}

describe("VersionPreviewController", () => {
  it("runs the full preview/close lifecycle through the fake commands", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);

    controller.send({ type: "CLOSE" });
    expect(controller.getSnapshot().type).toBe("returning");
    expect(fake.last("return").input).toEqual({
      appId: APP_ID,
      branch: "feature/origin",
    });

    fake.last("return").deferred.resolve(undefined);
    await flush();
    expect(controller.getSnapshot().type).toBe("closed");
  });

  it("never overlaps two mutating commands, even with adversarial ordering", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
    });
    fake.last("resolve").deferred.resolve({ branch: "feature/origin" });
    await flush();
    expect(fake.ofType("checkout")).toHaveLength(1);

    // Close while the checkout is still in flight: no return may start yet.
    controller.send({ type: "CLOSE" });
    expect(fake.ofType("return")).toHaveLength(0);
    expect(controller.getSnapshot().type).toBe("checking-out");

    // More UI noise while the mutation is pending changes nothing.
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v2",
    });
    controller.send({ type: "RESTORE", appId: APP_ID, versionId: "v2" });
    expect(fake.ofType("checkout")).toHaveLength(1);
    expect(fake.ofType("restore")).toHaveLength(0);

    // Only after the checkout settles does the return start.
    fake.last("checkout").deferred.resolve(undefined);
    await flush();
    expect(fake.ofType("return")).toHaveLength(1);
  });

  it("drops a superseded origin resolution but never a mutation completion", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
    });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v2",
    });
    expect(fake.ofType("resolve")).toHaveLength(2);

    // The stale resolve completes first — it must be ignored entirely.
    fake.ofType("resolve")[0].deferred.resolve({ branch: "stale/branch" });
    await flush();
    expect(controller.getSnapshot().type).toBe("resolving-origin");
    expect(fake.ofType("checkout")).toHaveLength(0);

    fake.ofType("resolve")[1].deferred.resolve({ branch: "feature/origin" });
    await flush();
    expect(controller.getSnapshot().type).toBe("checking-out");
    expect(fake.last("checkout").input).toEqual({
      appId: APP_ID,
      versionId: "v2",
    });
  });

  it("ignores a stale resolve failure after a newer selection", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
    });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v2",
    });

    fake.ofType("resolve")[0].deferred.reject(new Error("stale failure"));
    await flush();
    // No error notification and no state regression from the stale failure.
    expect(fake.notifyError).not.toHaveBeenCalled();
    expect(controller.getSnapshot().type).toBe("resolving-origin");
  });

  it("maps an unavailable branch to a cancelled preview with a notification", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
    });
    fake.last("resolve").deferred.resolve({ branch: null });
    await flush();
    expect(controller.getSnapshot().type).toBe("browsing");
    expect(fake.notifyError).toHaveBeenCalledWith(
      expect.stringContaining("Unable to determine the current Git branch"),
    );
    expect(fake.ofType("checkout")).toHaveLength(0);
  });

  it("enters recovery on return failure and retries with retained context", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);

    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();

    const snapshot = controller.getSnapshot();
    expect(snapshot.type).toBe("recovery-required");
    if (snapshot.type !== "recovery-required") return;
    expect(snapshot.error.message).toBe("return failed");
    expect(snapshot.session.originBranch).toBe("feature/origin");

    controller.send({ type: "RETRY_RETURN" });
    expect(fake.ofType("return")).toHaveLength(2);
    expect(fake.last("return").input).toEqual({
      appId: APP_ID,
      branch: "feature/origin",
    });
    fake.last("return").deferred.resolve(undefined);
    await flush();
    expect(controller.getSnapshot().type).toBe("closed");
  });

  it("rejects a waited mutation when the event is ignored", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);
    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();

    await expect(
      controller.sendAndWaitForMutation({
        type: "RESTORE",
        appId: APP_ID,
        versionId: "v1",
      }),
    ).rejects.toThrow(/not accepted/);
    expect(fake.ofType("restore")).toHaveLength(0);
  });

  it("does not attach a waiter to an already-running mutation", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);
    controller.send({ type: "SELECT_VERSION", versionId: "v2" });

    await expect(
      controller.sendAndWaitForMutation({
        type: "RESTORE",
        appId: APP_ID,
        versionId: "v1",
      }),
    ).rejects.toThrow(/already pending/);
  });

  it("keeps ownership when restore-to-message reports Git unchanged", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);
    controller.send({
      type: "RESTORE_TO_MESSAGE",
      appId: APP_ID,
      chatId: 2,
      messageId: 3,
      restoreCodebase: false,
    });
    fake
      .last("restore-to-message")
      .deferred.resolve({ repositoryOutcome: "unchanged" });
    await flush();
    expect(controller.getSnapshot().type).toBe("previewing");
  });

  it("routes an explicit branch switch through the controller", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "SWITCH_BRANCH", appId: APP_ID, branch: "main" });
    expect(controller.getSnapshot().type).toBe("switching-branch");
    expect(fake.last("switch-branch").input).toEqual({
      appId: APP_ID,
      branch: "main",
    });
    fake.last("switch-branch").deferred.resolve(undefined);
    await flush();
    expect(controller.getSnapshot().type).toBe("closed");
  });

  it("notifies subscribers only when the state actually changes", async () => {
    const { controller } = makeController();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.send({ type: "OPEN", appId: APP_ID });
    expect(listener).toHaveBeenCalledTimes(1);

    // Ignored event: same state reference, no notification.
    controller.send({ type: "RETURN_SUCCEEDED" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps state alive with zero subscribers", async () => {
    const { controller, fake } = makeController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    await driveToPreviewing(controller, fake);
    unsubscribe();

    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();
    expect(controller.getSnapshot().type).toBe("recovery-required");
  });

  it("rejects a mutation waiter during disposal and ignores its late settlement", async () => {
    const { controller, fake } = makeController();
    await driveToPreviewing(controller, fake);
    const pending = controller.sendAndWaitForMutation({
      type: "SELECT_VERSION",
      versionId: "v2",
    });
    const checkout = fake.last("checkout");
    const snapshot = controller.getSnapshot();

    controller.dispose();
    controller.dispose();
    await expect(pending).rejects.toThrow("Version preview was disposed");

    checkout.deferred.resolve(undefined);
    await flush();
    expect(controller.getSnapshot()).toBe(snapshot);
  });
});
