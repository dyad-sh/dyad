import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, params: any) => Promise<any>>(),
  findFirst: vi.fn(),
  prepareIsolatedTestDatabase: vi.fn(),
  isTestRunActive: vi.fn().mockReturnValue(false),
  isLockHeld: vi.fn().mockReturnValue(false),
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
// The real lock, deliberately: a session holds the app's lock for its whole
// lifetime, and a stub that just invokes the callback can't tell serialized
// from concurrent — which is the property these tests exist to protect.
vi.mock("../utils/lock_utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/lock_utils")>();
  return { ...actual, isLockHeld: mocks.isLockHeld };
});
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
import { withLock } from "../utils/lock_utils";

registerRecordingHandlers();
const startHandler = mocks.handlers.get("recording:start")!;
const stopHandler = mocks.handlers.get("recording:stop")!;

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
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  activeRecordings.clear();
  mocks.runningApps.clear();
  mocks.runningApps.set(1, { proxyUrl: "http://localhost:42100" });
  mocks.findFirst.mockResolvedValue({ id: 1, testingEnabled: true });
  mocks.isTestRunActive.mockReturnValue(false);
  mocks.isLockHeld.mockReturnValue(false);
  mocks.readSettings.mockReturnValue({ runtimeMode2: "host" });
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

  it("serializes a queued app operation behind the session's lock", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();
    await startHandler(event, { appId: 1 });

    // The session holds the app's lock for its whole lifetime — that is what
    // keeps a test run or a rebuild from touching the app mid-recording.
    let ranWhileRecording = false;
    const queued = withLock(1, async () => {
      ranWhileRecording = true;
    });
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
