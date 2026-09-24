import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const h = vi.hoisted(() => ({
  runtimeMode2: "docker" as "docker" | "host",
  loggedHandlers: new Map<
    string,
    (event: unknown, ...args: any[]) => Promise<any>
  >(),
  simpleSpawn: vi.fn(),
  simpleSpawnWithDeniedPnpmBuildSelfHeal: vi.fn(),
  applyComponentTagger: vi.fn(),
  applyPnpmVersionMigration: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/dyad-capacitor-docker-test"),
    getAppPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({ runtimeMode2: h.runtimeMode2 }),
}));

vi.mock("../../db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(async () => ({ id: 5, name: "Demo", path: "demo" })),
      },
    },
  },
}));

vi.mock("../../paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../paths/paths")>()),
  getDyadAppPath: (appPath: string) => `/apps/${appPath}`,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, existsSync: h.existsSync },
    existsSync: h.existsSync,
  };
});

vi.mock("../utils/simpleSpawn", () => ({ simpleSpawn: h.simpleSpawn }));

vi.mock("../utils/app_upgrade_utils", () => ({
  isComponentTaggerUpgradeNeeded: vi.fn(() => false),
  applyComponentTagger: h.applyComponentTagger,
  simpleSpawnWithDeniedPnpmBuildSelfHeal:
    h.simpleSpawnWithDeniedPnpmBuildSelfHeal,
}));

vi.mock("../utils/pnpm_migration", () => ({
  applyPnpmVersionMigration: h.applyPnpmVersionMigration,
  getManagedPnpmMajorVersion: () => 11,
  isPnpmVersionMigrationNeeded: () => false,
}));

vi.mock("../utils/git_utils", () => ({
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
}));

vi.mock("./safe_handle", () => ({
  createLoggedHandler:
    () =>
    (channel: string, fn: (event: unknown, ...args: any[]) => Promise<any>) =>
      h.loggedHandlers.set(channel, fn),
}));

vi.mock("@/window_infrastructure/main/query_invalidation_bus", () => ({
  queryInvalidationBus: { publish: vi.fn() },
}));

import { getRegisteredHandlerForTesting } from "./base";
import { registerCapacitorHandlers } from "./capacitor_handlers";
import { registerAppUpgradeHandlers } from "./app_upgrade_handlers";
import { capacitorContracts } from "../types/capacitor";

const DOCKER_CAPACITOR_MESSAGE =
  /Capacitor commands aren't supported in Docker mode/;

beforeAll(() => {
  registerCapacitorHandlers();
  registerAppUpgradeHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.runtimeMode2 = "docker";
  // A Vite app with Capacitor installed.
  h.existsSync.mockReturnValue(true);
});

function callCapacitor(channel: string) {
  return getRegisteredHandlerForTesting(channel)({} as IpcMainInvokeEvent, {
    appId: 5,
  });
}

function executeUpgrade(upgradeId: string) {
  return h.loggedHandlers.get("execute-app-upgrade")!(
    { sender: {} },
    { appId: 5, upgradeId },
  );
}

describe("Capacitor in Docker mode", () => {
  it.each([
    capacitorContracts.syncCapacitor.channel,
    capacitorContracts.openIos.channel,
    capacitorContracts.openAndroid.channel,
  ])("refuses %s without running anything on the host", async (channel) => {
    await expect(callCapacitor(channel)).rejects.toMatchObject({
      name: "DyadError",
      kind: "precondition",
      message: expect.stringMatching(DOCKER_CAPACITOR_MESSAGE),
    });
    expect(h.simpleSpawn).not.toHaveBeenCalled();
  });

  it("still syncs in Local mode", async () => {
    h.runtimeMode2 = "host";
    await callCapacitor(capacitorContracts.syncCapacitor.channel);
    expect(h.simpleSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm run build", cwd: "/apps/demo" }),
    );
  });

  it("refuses the Capacitor upgrade before installing anything", async () => {
    await expect(executeUpgrade("capacitor")).rejects.toThrow(
      DOCKER_CAPACITOR_MESSAGE,
    );
    expect(h.simpleSpawn).not.toHaveBeenCalled();
    expect(h.simpleSpawnWithDeniedPnpmBuildSelfHeal).not.toHaveBeenCalled();
  });

  it("passes the app ID to the component-tagger upgrade so it can install in the guest", async () => {
    await executeUpgrade("component-tagger");
    expect(h.applyComponentTagger).toHaveBeenCalledWith("/apps/demo", {
      appId: 5,
    });
  });
});
