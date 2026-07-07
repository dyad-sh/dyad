// @vitest-environment node
//
// Migrated from e2e-tests/custom_apps_folder.spec.ts.
//
// The e2e test drove the Settings UI: stubbed the native folder picker,
// clicked "customize apps folder" / "Reset to Default", then created apps via
// the home chat input and asserted where the app folders landed on disk.
// The UI is thin glue over the `select-custom-apps-folder` /
// `set-custom-apps-folder` handlers plus `create-app`; here we call those real
// handlers directly and assert the same fs/db/settings behavior:
//   1. new apps are stored in the user's custom folder
//   2. apps are stored in the default folder after resetting the path
//   3. changing the folder doesn't make existing apps inaccessible
//
// The default apps directory is `~/dyad-apps` (the e2e build resolves it under
// userData, but that path requires a real Electron runtime). To keep the test
// hermetic, `os.homedir()` is redirected to the harness temp dir via the
// DYAD_TEST_FAKE_HOME env var, so the "default folder" is
// <userDataDir>/dyad-apps. Native git is disabled so `set-custom-apps-folder`
// does not touch the developer's global git config (safe.directory); app
// creation then uses isomorphic-git, which is fully in-process.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// The real createFromTemplate locates the "react" scaffold via
// `path.join(__dirname, "..", "..", "scaffold")`, which only resolves in the
// bundled build (`.vite/build` → repo root). Under vitest, __dirname is
// `src/ipc/handlers`, so that path points at the nonexistent `src/scaffold`.
// Mock preserves the behavior (copy the scaffold template into the new app
// dir) using the repo-root scaffold directory.
vi.mock("@/ipc/handlers/createFromTemplate", () => ({
  createFromTemplate: async ({ fullAppPath }: { fullAppPath: string }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.cpSync(path.join(process.cwd(), "scaffold"), fullAppPath, {
      recursive: true,
    });
  },
}));

// Redirect only os.homedir() (read at call time via DYAD_TEST_FAKE_HOME) so
// the default `~/dyad-apps` folder lands in the per-test temp dir instead of
// the real home directory. Everything else on node:os stays real.
vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:os")>();
  const homedir = () => process.env.DYAD_TEST_FAKE_HOME || orig.homedir();
  return {
    ...orig,
    homedir,
    default: { ...(orig as any).default, ...orig, homedir },
  };
});

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { dialog } from "electron";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import { registerCustomAppsFolderHandlers } from "@/ipc/handlers/custom_apps_folder_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { apps } from "@/db/schema";

describe("custom apps folder (integration)", () => {
  let harness: ChatFlowHarness;
  let defaultBasePath: string;
  let customBasePath: string;

  const invoke = async (channel: string, input?: unknown) => {
    const handler = getRegisteredHandlerForTesting(channel);
    return handler({} as any, input);
  };

  const setCustomAppsFolder = (folder: string | null) =>
    invoke("set-custom-apps-folder", folder);

  const getCustomAppsFolder = () =>
    invoke("get-custom-apps-folder") as Promise<{
      path: string;
      isPathAvailable: boolean;
      isPathDefault: boolean;
    }>;

  const createApp = (name: string) =>
    invoke("create-app", { name }) as Promise<{
      app: { id: number; path: string; resolvedPath: string };
      chatId: number;
    }>;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      enableNativeGit: false,
    });
    process.env.DYAD_TEST_FAKE_HOME = harness.userDataDir;
    registerAppHandlers();
    registerCustomAppsFolderHandlers();

    defaultBasePath = path.join(harness.userDataDir, "dyad-apps");
    customBasePath = path.join(harness.userDataDir, "alt-app-storage");
    fs.mkdirSync(customBasePath, { recursive: true });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("select-custom-apps-folder returns the directory picked in the dialog", async () => {
    // The e2e stubbed the native folder picker; same idea here.
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [customBasePath],
    } as any);

    const result = await invoke("select-custom-apps-folder");
    expect(result).toEqual({ path: customBasePath, canceled: false });

    // Cancelling the dialog yields no path.
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    } as any);
    expect(await invoke("select-custom-apps-folder")).toEqual({
      path: null,
      canceled: true,
    });
  });

  it("new apps are stored in the user's custom folder", async () => {
    await setCustomAppsFolder(customBasePath);

    expect(readSettings().customAppsFolder).toBe(customBasePath);
    const folderInfo = await getCustomAppsFolder();
    expect(folderInfo.path).toBe(customBasePath);
    expect(folderInfo.isPathDefault).toBe(false);
    expect(folderInfo.isPathAvailable).toBe(true);

    const { app } = await createApp("custom-folder-app");
    expect(app.resolvedPath).toBe(
      path.join(customBasePath, "custom-folder-app"),
    );

    // The app is in the custom directory, not the default one.
    expect(fs.existsSync(path.join(customBasePath, "custom-folder-app"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(defaultBasePath, "custom-folder-app"))).toBe(
      false,
    );
  }, 30_000);

  it("stores apps in the default folder after resetting the path", async () => {
    await setCustomAppsFolder(customBasePath);
    await setCustomAppsFolder(null);

    expect(readSettings().customAppsFolder).toBeNull();
    const folderInfo = await getCustomAppsFolder();
    expect(folderInfo.path).toBe(defaultBasePath);
    expect(folderInfo.isPathDefault).toBe(true);

    const { app } = await createApp("default-folder-app");
    expect(app.resolvedPath).toBe(
      path.join(defaultBasePath, "default-folder-app"),
    );

    // The app is under the default path, not the custom one.
    expect(fs.existsSync(path.join(customBasePath, "default-folder-app"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(defaultBasePath, "default-folder-app")),
    ).toBe(true);
  }, 30_000);

  it("custom folder change doesn't make apps inaccessible", async () => {
    await setCustomAppsFolder(customBasePath);
    const { app } = await createApp("sticky-app");
    // Newly created apps store a relative path.
    expect(path.isAbsolute(app.path)).toBe(false);

    // Reset the folder back to the default.
    await setCustomAppsFolder(null);

    // The app's db path was converted to an absolute path under the previous
    // (custom) base directory, so it stays accessible.
    const appRow = await harness.db.query.apps.findFirst({
      where: eq(apps.id, app.id),
    });
    expect(appRow?.path).toBe(path.join(customBasePath, "sticky-app"));
    expect(getDyadAppPath(appRow!.path)).toBe(
      path.join(customBasePath, "sticky-app"),
    );

    // The app files are still in the custom directory (not moved/duplicated).
    expect(fs.existsSync(path.join(customBasePath, "sticky-app"))).toBe(true);
    expect(fs.existsSync(path.join(defaultBasePath, "sticky-app"))).toBe(false);

    // The app can still be loaded without errors.
    const loaded = (await invoke("get-app", app.id)) as { path: string };
    expect(loaded.path).toBe(path.join(customBasePath, "sticky-app"));
  }, 30_000);
});
