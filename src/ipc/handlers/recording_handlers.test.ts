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
vi.mock("../utils/lock_utils", () => ({
  isLockHeld: mocks.isLockHeld,
  // Run the callback immediately; it holds the "lock" until it resolves.
  withLock: (_id: number, fn: () => Promise<unknown>) => fn(),
}));
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

  it("reports auth mode none when the app has no supported auth", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.auth).toEqual({ mode: "none" });

    await stopHandler(event, { appId: 1 });
  });

  it("refuses when testing is not enabled", async () => {
    mocks.findFirst.mockResolvedValue({ id: 1, testingEnabled: false });
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.infraError?.message).toMatch(/Testing isn't enabled/i);
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
    expect(activeRecordings.has(1)).toBe(false);
  });

  it("refuses when the dev server is not running", async () => {
    mocks.runningApps.clear();
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.infraError?.message).toMatch(
      /Start the app before recording/i,
    );
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
  });

  it("refuses when a test run is in progress", async () => {
    mocks.isTestRunActive.mockReturnValue(true);
    const { event } = makeEvent();

    const result = await startHandler(event, { appId: 1 });
    expect(result.infraError?.message).toMatch(/Stop the running tests/i);
    expect(mocks.prepareIsolatedTestDatabase).not.toHaveBeenCalled();
  });

  it("refuses a second concurrent recording for the same app", async () => {
    mocks.prepareIsolatedTestDatabase.mockResolvedValue(makePrepared());
    const { event } = makeEvent();

    await startHandler(event, { appId: 1 });
    const second = await startHandler(event, { appId: 1 });

    expect(second.infraError?.message).toMatch(/already in progress/i);
    expect(mocks.prepareIsolatedTestDatabase).toHaveBeenCalledTimes(1);

    await stopHandler(event, { appId: 1 });
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
