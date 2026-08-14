import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, params: any) => Promise<any>>(),
  findFirst: vi.fn(),
  prepareIsolatedTestDatabase: vi.fn(),
  isTestRunActive: vi.fn().mockReturnValue(false),
  clearStorageData: vi.fn().mockResolvedValue(undefined),
  safeSend: vi.fn(),
  restoreAppFromTestBranch: vi.fn(),
  runningApps: new Map<number, any>(),
  readSettings: vi.fn().mockReturnValue({ runtimeMode2: "host" }),
}));

vi.mock("./base", () => ({
  createTypedHandler: (contract: any, fn: any) => {
    mocks.handlers.set(contract.channel, fn);
  },
}));
vi.mock("../../db", () => ({
  db: { query: { apps: { findFirst: mocks.findFirst } } },
}));
vi.mock("../../db/schema", () => ({ apps: { id: "id" } }));
vi.mock("electron", () => ({
  session: { defaultSession: { clearStorageData: mocks.clearStorageData } },
}));
vi.mock("../utils/process_manager", () => ({ runningApps: mocks.runningApps }));
// The real operation coordinator, deliberately: a session owns the app's
// resources for its whole lifetime, and a stub that just invokes the callback
// can't tell serialized from concurrent — which is the property these tests
// exist to protect.
vi.mock("../utils/safe_sender", () => ({ safeSend: mocks.safeSend }));
vi.mock("../services/isolated_test_db", () => ({
  prepareIsolatedTestDatabase: mocks.prepareIsolatedTestDatabase,
}));
vi.mock("../utils/neon_test_branch", () => ({
  restoreAppFromTestBranch: mocks.restoreAppFromTestBranch,
}));
vi.mock("./tests_handlers", () => ({ isTestRunActive: mocks.isTestRunActive }));
vi.mock("@/main/settings", () => ({ readSettings: mocks.readSettings }));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { registerRecordingHandlers } from "./recording_handlers";
import {
  activeRecordings,
  endRecordingForApp,
  isRecordingActive,
} from "../services/recording_registry";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import {
  getRecordedTestDraft,
  resetRecordedTestDrafts,
  setRecordedTestDraft,
} from "../services/recorded_test_drafts";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";

registerRecordingHandlers();
const startHandler = mocks.handlers.get("recording:start")!;
const stopHandler = mocks.handlers.get("recording:stop")!;
const discardDraftHandler = mocks.handlers.get("recording:discard-draft")!;

function makeEvent(isDestroyed: () => boolean = () => false) {
  let destroyedHandler: (() => void) | undefined;
  return {
    event: {
      sender: {
        once: (name: string, handler: () => void) => {
          if (name === "destroyed") destroyedHandler = handler;
        },
        removeListener: vi.fn(),
        isDestroyed,
      },
    },
    triggerDestroyed: () => destroyedHandler?.(),
  };
}

function makePrepared(overrides: Record<string, unknown> = {}) {
  return {
    isolation: { mode: "neon-branch" },
    // Must be the real `TeardownResult` shape: the handler reads `.envRestored`
    // off it, so a mock resolving to `undefined` throws into the teardown catch
    // and every assertion below would be checking the failure path by accident.
    teardown: vi.fn().mockResolvedValue({ envRestored: true }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  activeRecordings.clear();
  resetRecordedTestDrafts();
  mocks.runningApps.clear();
  mocks.runningApps.set(1, {
    proxyUrl: "http://localhost:42100",
    authBootstrapToken: "00000000-0000-4000-8000-000000000001",
  });
  mocks.findFirst.mockResolvedValue({ id: 1, testingEnabled: true });
  mocks.restoreAppFromTestBranch.mockReset();
  mocks.restoreAppFromTestBranch.mockResolvedValue(true);
  mocks.isTestRunActive.mockReturnValue(false);
  mocks.readSettings.mockReturnValue({ runtimeMode2: "host" });
});

describe("recording:discard-draft", () => {
  it("does not let a stale window discard a newer draft", async () => {
    const newerDraft: RecordedTestDraft = {
      version: RECORDED_TEST_DRAFT_VERSION,
      draftId: "newer-draft",
      testName: "new flow",
      authMode: "none",
      actions: [],
    };
    setRecordedTestDraft(1, newerDraft);

    await discardDraftHandler(makeEvent().event, {
      appId: 1,
      draftId: "older-draft",
    });

    expect(getRecordedTestDraft(1)).toEqual(newerDraft);
  });
});

describe("recording:start / recording:stop", () => {
  it("publishes startup ownership before its first database await", async () => {
    let resolveApp!: (app: { id: number; testingEnabled: boolean }) => void;
    mocks.findFirst.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApp = resolve;
      }),
    );
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    const start = startHandler(event, { appId: 1 });
    // This is what the test-run side consults while recording:start is still
    // waiting for its app row/recovery work.
    expect(isRecordingActive(1)).toBe(true);

    resolveApp({ id: 1, testingEnabled: true });
    await start;
    await stopHandler(event, { appId: 1 });
    expect(isRecordingActive(1)).toBe(false);
  });

  it("gives up a reserved start that Stop cancelled before it published", async () => {
    // Stop arrives while the start is still awaiting its app row. The app is
    // only a reservation at that point, so there is no `stop` for
    // `endRecordingForApp` to call — without the cancellation tombstone it
    // reports success and this start goes on to swap the environment and
    // restart, through isolation setup, the very app the user just stopped.
    let resolveApp!: (app: { id: number; testingEnabled: boolean }) => void;
    mocks.findFirst.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApp = resolve;
      }),
    );
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    const start = startHandler(event, { appId: 1 });
    expect(isRecordingActive(1)).toBe(true);
    const summary = await endRecordingForApp(1, "app-stopped", {
      skipRestart: true,
    });
    resolveApp({ id: 1, testingEnabled: true });
    const result = await start;

    // Nothing was swapped, so there is nothing for the caller to refuse over.
    expect(summary.envRestored).toBe(true);
    expect(result.infraError?.message).toMatch(/ended before/i);
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
    expect(isRecordingActive(1)).toBe(false);
  });

  it("lets the next start reserve after a cancelled one gave up", async () => {
    // The tombstone belongs to the reservation it cancelled, not to the app.
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();
    let resolveApp!: (app: { id: number; testingEnabled: boolean }) => void;
    mocks.findFirst.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApp = resolve;
      }),
    );

    const cancelled = startHandler(event, { appId: 1 });
    await endRecordingForApp(1, "app-stopped");
    resolveApp({ id: 1, testingEnabled: true });
    await cancelled;

    const result = await startHandler(event, { appId: 1 });

    expect(result.infraError).toBeUndefined();
    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledTimes(1);
    await stopHandler(event, { appId: 1 });
  });

  it("refuses to snapshot an environment a prior recording did not restore", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 1,
      testingEnabled: true,
      neonTestBranchId: "dirty-test-branch",
    });
    mocks.restoreAppFromTestBranch.mockResolvedValueOnce(false);
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });

    expect(result.infraError?.message).toMatch(/previous session/i);
    expect(mocks.restoreAppFromTestBranch).toHaveBeenCalledWith(
      expect.objectContaining({ neonTestBranchId: "dirty-test-branch" }),
    );
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
  });

  it("passes the refreshed app row to isolation after recovery", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        id: 1,
        testingEnabled: true,
        neonTestBranchId: "dirty-test-branch",
      })
      .mockResolvedValueOnce({
        id: 1,
        testingEnabled: true,
        neonTestBranchId: null,
      })
      .mockResolvedValueOnce({
        id: 1,
        testingEnabled: true,
        neonTestBranchId: null,
      });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });

    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.objectContaining({ neonTestBranchId: null }),
      }),
    );
    await stopHandler(event, { appId: 1 });
  });

  it("uses the app row read after coordinator admission for isolation", async () => {
    let releaseRename!: () => void;
    const rename = appOperationCoordinator.run(
      {
        appId: 1,
        operation: "rename-app",
        resources: ["app-path", "provider"],
      },
      () =>
        new Promise<void>((resolve) => {
          releaseRename = resolve;
        }),
    );
    await vi.waitFor(() => expect(releaseRename).toEqual(expect.any(Function)));
    mocks.findFirst
      .mockResolvedValueOnce({
        id: 1,
        path: "/apps/old",
        testingEnabled: true,
        neonTestBranchId: null,
      })
      .mockResolvedValueOnce({
        id: 1,
        path: "/apps/moved",
        testingEnabled: true,
        supabaseProjectId: "new-provider",
        neonTestBranchId: null,
      });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    const start = startHandler(event, { appId: 1 });
    await vi.waitFor(() =>
      expect(mocks.safeSend).toHaveBeenCalledWith(
        event.sender,
        "recording:setup-progress",
        expect.objectContaining({ message: expect.stringMatching(/waiting/i) }),
      ),
    );
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();

    releaseRename();
    await rename;
    await start;

    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.objectContaining({
          path: "/apps/moved",
          supabaseProjectId: "new-provider",
        }),
      }),
    );
    await stopHandler(event, { appId: 1 });
  });

  it("settles and unregisters when deletion rejects coordinator admission", async () => {
    const deletion = appOperationCoordinator.beginAppDeletion(1);
    const { event } = makeEvent();
    try {
      const result = await startHandler(event, { appId: 1 });

      expect(result.infraError?.message).toMatch(/temporarily unavailable/i);
      expect(activeRecordings.has(1)).toBe(false);
      expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
    } finally {
      deletion.release();
    }
  });

  it("sets up isolation, clears preview storage, and holds the session until stop", async () => {
    const prepared = makePrepared({
      authSetup: {
        mode: "neon-better-auth",
        email: "t@dyad.test",
        password: "pw",
      },
    });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });

    expect(result.isolation).toEqual({ mode: "neon-branch" });
    expect(result.auth).toEqual({
      mode: "neon-better-auth",
      email: "t@dyad.test",
      password: "pw",
    });
    expect(result.authBootstrapToken).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result.infraError).toBeUndefined();
    expect(mocks.clearStorageData).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "http://localhost:42100" }),
    );
    // The lock is still held (session running) until stop.
    expect(activeRecordings.has(1)).toBe(true);
    expect(prepared.teardown).not.toHaveBeenCalled();

    await stopHandler(event, { appId: 1 });

    expect(prepared.teardown).toHaveBeenCalledTimes(1);
    expect(activeRecordings.has(1)).toBe(false);
    expect(mocks.safeSend).toHaveBeenCalledWith(
      event.sender,
      "recording:ended",
      expect.objectContaining({ appId: 1, reason: "stopped" }),
    );
  });

  it("abandons a session whose window closed while setup was awaiting", async () => {
    // `destroyed` fires while the handler is still awaiting the app lookup, so
    // the listener registered afterwards never hears it. Left unnoticed the
    // session would swap the app onto an isolated database and hold every claim
    // until the 30-minute cap, with no recorder UI able to end it.
    let windowClosed = false;
    const { event } = makeEvent(() => windowClosed);
    mocks.findFirst.mockImplementationOnce(async () => {
      windowClosed = true;
      return { id: 1, testingEnabled: true };
    });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());

    const result = await startHandler(event, { appId: 1 });

    expect(result.infraError?.message).toMatch(/ended before/i);
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
    await activeRecordings.get(1)?.done;
    expect(activeRecordings.has(1)).toBe(false);
    expect(isRecordingActive(1)).toBe(false);
  });

  it("clears the preview's storage again when the session ends", async () => {
    // The auth bootstrap seeded the temporary test user's session into the
    // preview's storage. Deleting that user is a server-side change the issued
    // token doesn't see, so the credential itself has to come back out.
    const prepared = makePrepared({
      authSetup: {
        mode: "supabase-password",
        email: "t@dyad.test",
        password: "pw",
        projectUrl: "https://ref.supabase.co",
        anonKey: "anon",
      },
    });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });
    expect(mocks.clearStorageData).toHaveBeenCalledTimes(1);

    await stopHandler(event, { appId: 1 });

    expect(mocks.clearStorageData).toHaveBeenCalledTimes(2);
    expect(mocks.clearStorageData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: "http://localhost:42100",
        storages: expect.arrayContaining(["localstorage", "cookies"]),
      }),
    );
  });

  it("still clears the preview at teardown when the setup clear failed", async () => {
    // The setup clear is deliberately non-fatal — the recording is still usable
    // — but the session goes on to seed the temporary test user's credentials
    // under that origin either way. Forgetting the origin because the first
    // clear threw is what leaves them in the preview after the user is deleted.
    mocks.clearStorageData.mockRejectedValueOnce(new Error("clear failed"));
    const prepared = makePrepared();
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.warning).toMatch(/stored session/i);

    await stopHandler(event, { appId: 1 });

    expect(mocks.clearStorageData).toHaveBeenCalledTimes(2);
    expect(mocks.clearStorageData).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: "http://localhost:42100" }),
    );
  });

  it("refuses a second recording started after the first", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });
    const second = await startHandler(event, { appId: 1 });

    expect(second.infraError?.message).toMatch(/already in progress/i);
    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledTimes(1);

    await stopHandler(event, { appId: 1 });
  });

  it("refuses two recordings issued at once", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    const [first, second] = await Promise.all([
      startHandler(event, { appId: 1 }),
      startHandler(event, { appId: 1 }),
    ]);

    const refused = [first, second].filter((r) => r.infraError);
    expect(refused).toHaveLength(1);
    expect(refused[0].infraError?.message).toMatch(/already in progress/i);
    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledTimes(1);

    await stopHandler(event, { appId: 1 });
    expect(activeRecordings.has(1)).toBe(false);
  });

  it("serializes a queued app operation behind the session's resources", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();
    await startHandler(event, { appId: 1 });

    // The session owns the app's resources for its whole lifetime — that is
    // what keeps a test run or a rebuild from touching the app mid-recording.
    let ranWhileRecording = false;
    const queued = appOperationCoordinator.run(
      {
        appId: 1,
        operation: "queued-operation",
        resources: [readAppResource("app-path"), "runtime"],
      },
      async () => {
        ranWhileRecording = true;
      },
    );
    await Promise.resolve();
    expect(ranWhileRecording).toBe(false);

    await stopHandler(event, { appId: 1 });
    await queued;
    expect(ranWhileRecording).toBe(true);
  });

  it("allows a Git ref snapshot while the session owns the working tree", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();
    await startHandler(event, { appId: 1 });

    let releaseWriter!: () => void;
    const writer = appOperationCoordinator.run(
      {
        appId: 1,
        operation: "write-repository",
        resources: ["repository"],
      },
      () =>
        new Promise<void>((resolve) => {
          releaseWriter = resolve;
        }),
    );
    const snapshot = vi.fn();
    await appOperationCoordinator.run(
      {
        appId: 1,
        operation: "create-chat",
        resources: [readAppResource("repository-ref")],
      },
      async () => snapshot(),
    );

    expect(snapshot).toHaveBeenCalledOnce();
    await stopHandler(event, { appId: 1 });
    await vi.waitFor(() => expect(releaseWriter).toBeTypeOf("function"));
    releaseWriter();
    await writer;
  });

  it("returns the infra error and does not start when isolation fails", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(
      makePrepared({
        isolation: { mode: "none" },
        infraError: { message: "Couldn't set up an isolated test database." },
      }),
    );
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.infraError?.message).toMatch(/isolated test database/i);
    // The failed-setup session must not linger as active.
    expect(activeRecordings.has(1)).toBe(false);
  });

  it("reports a failed restore even when setup failed before recording", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(
      makePrepared({
        isolation: { mode: "none" },
        infraError: { message: "Couldn't set up an isolated test database." },
        teardown: vi.fn().mockResolvedValue({ envRestored: false }),
      }),
    );
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });

    expect(result.infraError?.message).toMatch(/isolated test database/i);
    await vi.waitFor(() =>
      expect(mocks.safeSend).toHaveBeenCalledWith(
        event.sender,
        "recording:ended",
        expect.objectContaining({
          appId: 1,
          reason: "error",
          message: expect.stringMatching(/restore your app's real database/i),
        }),
      ),
    );
    expect(activeRecordings.has(1)).toBe(false);
  });

  it("refuses when the preview stopped while isolation was being set up", async () => {
    const prepared = makePrepared();
    // A recording queued behind another app operation can reach this point long
    // after the up-front check, with the dev server gone in the meantime.
    mocks.prepareIsolatedTestDatabase.mockImplementation(async () => {
      mocks.runningApps.clear();
      return prepared;
    });
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });

    expect(result.infraError?.message).toMatch(/app stopped while/i);
    expect(mocks.clearStorageData).not.toHaveBeenCalled();
    // The isolation that was already stood up has to come back down.
    await activeRecordings.get(1)?.done;
    expect(prepared.teardown).toHaveBeenCalledTimes(1);
    expect(activeRecordings.has(1)).toBe(false);
  });

  it("reports an unrestored .env.local as an error, not a clean stop", async () => {
    // The app is still pointed at the temporary test branch. The recorder bar is
    // the only surface still listening, and this is what reaches the user as an
    // error toast — the alternative is their app quietly serving isolated data.
    const prepared = makePrepared({
      teardown: vi.fn().mockResolvedValue({ envRestored: false }),
    });
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });
    await stopHandler(event, { appId: 1 });

    expect(mocks.safeSend).toHaveBeenCalledWith(
      event.sender,
      "recording:ended",
      expect.objectContaining({
        appId: 1,
        reason: "error",
        message: expect.stringMatching(/restore your app's real database/i),
      }),
    );
  });

  it("hands the caller's teardown options through to isolation", async () => {
    // `endRecordingForApp(..., { skipRestart: true })` is how stopApp/restartApp/
    // delete avoid restarting the dev server twice; the option has to survive the
    // trip from `stop` to the teardown that acts on it.
    const prepared = makePrepared();
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });
    const recording = activeRecordings.get(1)!;
    recording.stop("app-stopped", { skipRestart: true });
    await recording.done;

    expect(prepared.teardown).toHaveBeenCalledWith({ skipRestart: true });
  });

  it("tears down and ends the session when the renderer is destroyed", async () => {
    const prepared = makePrepared();
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(prepared);
    const { event, triggerDestroyed } = makeEvent();

    await startHandler(event, { appId: 1 });
    const rec = activeRecordings.get(1)!;

    triggerDestroyed();
    await rec.done;

    expect(prepared.teardown).toHaveBeenCalledTimes(1);
    expect(activeRecordings.has(1)).toBe(false);
    expect(mocks.safeSend).toHaveBeenCalledWith(
      event.sender,
      "recording:ended",
      expect.objectContaining({ appId: 1, reason: "app-stopped" }),
    );
  });
});
