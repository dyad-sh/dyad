import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearStorageData: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<
    string,
    (event: unknown, input: { appId: number }) => Promise<void>
  >(),
  rm: vi.fn().mockResolvedValue(undefined),
  runningApps: new Map<number, { proxyUrl?: string }>(),
  readSettings: vi.fn(() => ({ enableLocalhostPreviewIsolation: true })),
}));

vi.mock("electron", () => ({
  session: { defaultSession: { clearStorageData: mocks.clearStorageData } },
}));
vi.mock("node:fs/promises", () => ({
  default: { rm: mocks.rm },
}));
vi.mock("@/paths/paths", () => ({
  getTypeScriptCachePath: () => "/tmp/dyad-typescript-cache",
}));
vi.mock("../utils/process_manager", () => ({
  runningApps: mocks.runningApps,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => mocks.readSettings(),
}));
vi.mock("./base", () => ({
  createTypedHandler: (
    contract: { channel: string },
    handler: (event: unknown, input: { appId: number }) => Promise<void>,
  ) => {
    mocks.handlers.set(contract.channel, handler);
  },
}));

import { registerSessionHandlers } from "./session_handlers";

registerSessionHandlers();

describe("registerSessionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runningApps.clear();
    mocks.readSettings.mockReturnValue({
      enableLocalhostPreviewIsolation: true,
    });
  });

  it("clears only the selected app's authentication and worker cache storage", async () => {
    mocks.runningApps.set(42, {
      proxyUrl: "http://app-42.localhost:42142/settings",
    });

    await mocks.handlers.get("clear-session-data")!({}, { appId: 42 });

    expect(mocks.clearStorageData).toHaveBeenCalledWith({
      origin: "http://app-42.localhost:42142",
      storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"],
    });
  });

  it("refuses to clear a shared localhost cookie scope", async () => {
    mocks.runningApps.set(42, { proxyUrl: "http://localhost:42142" });

    await expect(
      mocks.handlers.get("clear-session-data")!({}, { appId: 42 }),
    ).rejects.toThrow("does not have isolated browser storage");
    expect(mocks.clearStorageData).not.toHaveBeenCalled();
  });

  it("clears shared preview data when isolation is explicitly disabled", async () => {
    mocks.readSettings.mockReturnValue({
      enableLocalhostPreviewIsolation: false,
    });
    mocks.runningApps.set(42, { proxyUrl: "http://localhost:42142" });

    await mocks.handlers.get("clear-session-data")!({}, { appId: 42 });

    expect(mocks.clearStorageData).toHaveBeenCalledWith({
      origin: "http://localhost:42142",
      storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"],
    });
  });

  it("refuses to clear data when the selected app is not running", async () => {
    await expect(
      mocks.handlers.get("clear-session-data")!({}, { appId: 42 }),
    ).rejects.toThrow("preview is not running");
    expect(mocks.clearStorageData).not.toHaveBeenCalled();
  });
});
