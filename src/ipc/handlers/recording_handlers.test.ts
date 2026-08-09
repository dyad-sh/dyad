import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, params: any) => Promise<any>>(),
  findFirst: vi.fn(),
  prepareIsolatedTestDatabase: vi.fn(),
  isTestRunActive: vi.fn().mockReturnValue(false),
  clearStorageData: vi.fn().mockResolvedValue(undefined),
  safeSend: vi.fn(),
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
import { activeRecordings } from "../services/recording_registry";
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

function makeEvent() {
  let destroyedHandler: (() => void) | undefined;
  return {
    event: {
      sender: {
        once: (name: string, handler: () => void) => {
          if (name === "destroyed") destroyedHandler = handler;
        },
        removeListener: vi.fn(),
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
