import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VersionPreviewController,
  type VersionPreviewCommands,
  type VersionPreviewRuntime,
} from "./controller";
import {
  ensureVersionPreviewController,
  disposeVersionPreviewController,
  getVersionPreviewController,
  getVersionPreviewRecoveryEntries,
  initVersionPreviewRuntime,
  notifyVersionPreviewAppChanged,
  resetVersionPreviewForTests,
  subscribeVersionPreviewRegistry,
} from "./registry";

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
    restoreVersion: track(
      "restore",
    ) as VersionPreviewCommands["restoreVersion"],
  };
  const notifyError = vi.fn();
  const runtime: VersionPreviewRuntime = { commands, notifyError };
  return {
    runtime,
    notifyError,
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
  controller.send({ type: "SELECT_VERSION", versionId, hasDbSnapshot: false });
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
      hasDbSnapshot: false,
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
      hasDbSnapshot: false,
    });
    controller.send({ type: "RESTORE", versionId: "v2", hasDbSnapshot: false });
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
      hasDbSnapshot: false,
    });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v2",
      hasDbSnapshot: false,
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
      hasDbSnapshot: false,
    });
  });

  it("ignores a stale resolve failure after a newer selection", async () => {
    const { controller, fake } = makeController();
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
      hasDbSnapshot: false,
    });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v2",
      hasDbSnapshot: false,
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
      hasDbSnapshot: false,
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
});

describe("registry", () => {
  beforeEach(() => {
    resetVersionPreviewForTests();
  });

  it("caches controllers per app and requires an initialized runtime", () => {
    expect(() => ensureVersionPreviewController(1)).toThrow(
      /runtime is not initialized/,
    );
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const a = ensureVersionPreviewController(1);
    expect(ensureVersionPreviewController(1)).toBe(a);
    expect(ensureVersionPreviewController(2)).not.toBe(a);
  });

  it("does not notify registry subscribers when a controller is created", () => {
    // Creation happens during React render; notifying would schedule
    // updates on other components mid-render.
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const listener = vi.fn();
    subscribeVersionPreviewRegistry(listener);
    ensureVersionPreviewController(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps a stable empty recovery snapshot across unrelated state changes", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    const before = getVersionPreviewRecoveryEntries();

    await driveToPreviewing(controller, fake);
    // Transitions occurred but nothing is in recovery: same array reference,
    // so useSyncExternalStore subscribers do not re-render.
    expect(getVersionPreviewRecoveryEntries()).toBe(before);
  });

  it("keeps a non-empty recovery snapshot stable across unrelated activity", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    await driveToPreviewing(controller, fake);
    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();

    const entries = getVersionPreviewRecoveryEntries();
    expect(entries).toHaveLength(1);

    // A different app's controller doing unrelated work must not produce a
    // new recovery snapshot reference (no re-render, no re-issued toast).
    const other = ensureVersionPreviewController(2);
    other.send({ type: "OPEN", appId: 2 });
    other.send({ type: "CLOSE" });
    expect(getVersionPreviewRecoveryEntries()).toBe(entries);
  });

  it("re-notifies subscribers when OPEN hits a recovery-required session", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    await driveToPreviewing(controller, fake);
    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();
    expect(controller.getSnapshot().type).toBe("recovery-required");

    const entriesBefore = getVersionPreviewRecoveryEntries();
    const listener = vi.fn();
    subscribeVersionPreviewRegistry(listener);
    controller.send({ type: "OPEN", appId: APP_ID });
    // A dismissed recovery toast re-surfaces because the snapshot is fresh.
    expect(listener).toHaveBeenCalled();
    expect(getVersionPreviewRecoveryEntries()).not.toBe(entriesBefore);
    expect(getVersionPreviewRecoveryEntries()).toHaveLength(1);
  });

  it("drains the previous app's session on app switch", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    await driveToPreviewing(controller, fake);

    notifyVersionPreviewAppChanged(APP_ID, 2);
    expect(controller.getSnapshot().type).toBe("returning");
    expect(fake.last("return").input).toEqual({
      appId: APP_ID,
      branch: "feature/origin",
    });
  });

  it("disposes a deleted app without returning to its removed repository", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    await driveToPreviewing(controller, fake);

    disposeVersionPreviewController(APP_ID);
    notifyVersionPreviewAppChanged(APP_ID, null);

    expect(getVersionPreviewController(APP_ID)).toBeUndefined();
    expect(fake.ofType("return")).toHaveLength(0);
    expect(getVersionPreviewRecoveryEntries()).toEqual([]);
  });

  it("ignores a deleted app's late mutation completion", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    controller.send({ type: "OPEN", appId: APP_ID });
    controller.send({
      type: "SELECT_VERSION",
      versionId: "v1",
      hasDbSnapshot: false,
    });
    fake.last("resolve").deferred.resolve({ branch: "feature/origin" });
    await flush();

    const listener = vi.fn();
    subscribeVersionPreviewRegistry(listener);
    disposeVersionPreviewController(APP_ID);
    listener.mockClear();
    fake.last("checkout").deferred.reject(new Error("repository deleted"));
    await flush();

    expect(listener).not.toHaveBeenCalled();
    expect(getVersionPreviewRecoveryEntries()).toEqual([]);
  });

  it("exposes recovery entries across apps with working retries", async () => {
    const fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
    const controller = ensureVersionPreviewController(APP_ID);
    const registryListener = vi.fn();
    subscribeVersionPreviewRegistry(registryListener);

    await driveToPreviewing(controller, fake);
    expect(getVersionPreviewRecoveryEntries()).toEqual([]);

    controller.send({ type: "CLOSE" });
    fake.last("return").deferred.reject(new Error("return failed"));
    await flush();

    const entries = getVersionPreviewRecoveryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].appId).toBe(APP_ID);
    expect(entries[0].error.message).toBe("return failed");
    // Stable reference between changes (useSyncExternalStore contract).
    expect(getVersionPreviewRecoveryEntries()).toBe(entries);
    expect(registryListener).toHaveBeenCalled();

    entries[0].retry();
    expect(fake.ofType("return")).toHaveLength(2);
    fake.last("return").deferred.resolve(undefined);
    await flush();
    expect(getVersionPreviewRecoveryEntries()).toEqual([]);
  });
});
