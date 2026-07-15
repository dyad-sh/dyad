import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { DyadErrorKind } from "@/errors/dyad_error";
import { apps } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";

// All app folders live under one throwaway base so the filesystem-probing
// conflict checks (and actual folder moves) run against real directories.
const TEMP_BASE = path.join(os.tmpdir(), "dyad-app-naming-handler-tests");

// Captures handlers registered through createLoggedHandler (import_handlers
// uses it instead of createTypedHandler, so the harness registry misses it).
const ipcHandlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => Promise<unknown>>(),
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, fn);
    },
    on: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-app-naming-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const nodePath = await import("node:path");
  const base = nodePath.join(
    (await import("node:os")).tmpdir(),
    "dyad-app-naming-handler-tests",
  );
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.isAbsolute(appPath) ? appPath : nodePath.join(base, appPath),
    isAppLocationAccessible: () => true,
  };
});

vi.mock("@/ipc/services/git_service", () => {
  class GitService {}
  const fake = {
    initRepoWithInitialCommit: vi.fn(async () => "fake-commit-hash"),
    stageAllAndCommit: vi.fn(async () => "fake-commit-hash"),
    stageAllAndCommitIfChanged: vi.fn(async () => "fake-commit-hash"),
    commitFile: vi.fn(async () => "fake-commit-hash"),
  };
  return { GitService, gitService: fake };
});

vi.mock("@/ipc/handlers/createFromTemplate", () => ({
  createFromTemplate: vi.fn(
    async ({ fullAppPath }: { fullAppPath: string }) => {
      await fs.promises.mkdir(fullAppPath, { recursive: true });
      await fs.promises.writeFile(path.join(fullAppPath, "index.ts"), "// app");
    },
  ),
}));

vi.mock("@/ipc/handlers/gitignoreUtils", () => ({
  ensureDyadGitignored: vi.fn(async () => {}),
}));

vi.mock("@/ipc/handlers/chat_mode_resolution", () => ({
  getInitialChatModeForNewChat: vi.fn(async () => "build"),
}));

import { registerAppHandlers } from "./app_handlers";
import { registerImportHandlers } from "./import_handlers";

async function invokeImportHandler<TOutput>(
  channel: string,
  input: unknown,
): Promise<TOutput> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler captured for channel "${channel}"`);
  }
  const frame = { url: "http://localhost:5173/" };
  const envelope = (await handler(
    { sender: { mainFrame: frame }, senderFrame: frame },
    input,
  )) as {
    ok: boolean;
    value?: TOutput;
    error?: { message: string; kind?: string };
  };
  if (!envelope.ok) {
    const error = new Error(envelope.error?.message);
    (error as unknown as { kind?: string }).kind = envelope.error?.kind;
    throw error;
  }
  return envelope.value as TOutput;
}

describe("app naming handlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    harness = setupHandlerTestHarness();
    registerAppHandlers();
    registerImportHandlers();
  });

  afterEach(() => {
    harness.dispose();
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  });

  function seedApp(name: string, appPath: string): number {
    const result = harness.db
      .insert(apps)
      .values({ name, path: appPath })
      .run();
    return Number(result.lastInsertRowid);
  }

  function seedAppWithFolder(name: string, appPath: string): number {
    fs.mkdirSync(path.join(TEMP_BASE, appPath), { recursive: true });
    fs.writeFileSync(path.join(TEMP_BASE, appPath, "index.ts"), "// app");
    return seedApp(name, appPath);
  }

  function getAppRow(appId: number) {
    return harness.db.select().from(apps).where(eq(apps.id, appId)).get();
  }

  describe("create-app", () => {
    it("stores the sanitized display name with a lowercase slug folder", async () => {
      const result = await harness.invokeHandler<{
        app: { name: string; path: string };
      }>("create-app", { name: "Food/Drink  Planner" });

      expect(result.app.name).toBe("Food/Drink Planner");
      expect(result.app.path).toBe("food-drink-planner");
      expect(fs.existsSync(path.join(TEMP_BASE, "food-drink-planner"))).toBe(
        true,
      );
    });

    it("auto-suffixes folder collisions from distinct display names", async () => {
      seedAppWithFolder("My App!", "my-app");

      const result = await harness.invokeHandler<{
        app: { name: string; path: string };
      }>("create-app", { name: "My App?" });

      expect(result.app.name).toBe("My App?");
      expect(result.app.path).toBe("my-app-2");
    });

    it("auto-suffixes past an existing folder with no app row", async () => {
      fs.mkdirSync(path.join(TEMP_BASE, "my-app"), { recursive: true });

      const result = await harness.invokeHandler<{
        app: { path: string };
      }>("create-app", { name: "My App" });

      expect(result.app.path).toBe("my-app-2");
    });

    it("rejects duplicate display names with Conflict", async () => {
      seedAppWithFolder("My App", "my-app");

      await expect(
        harness.invokeHandler("create-app", { name: "My App" }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });
    });

    it("treats folder conflicts case-insensitively", async () => {
      seedAppWithFolder("Legacy", "My-App");

      const result = await harness.invokeHandler<{
        app: { path: string };
      }>("create-app", { name: "My App" });

      expect(result.app.path).toBe("my-app-2");
    });
  });

  describe("copy-app", () => {
    it("copies into a slug folder and auto-suffixes collisions", async () => {
      const sourceId = seedAppWithFolder("Source", "source");
      seedAppWithFolder("Occupier", "my-copy");

      const result = await harness.invokeHandler<{
        app: { name: string; path: string };
      }>("copy-app", {
        appId: sourceId,
        newAppName: "My Copy!",
        withHistory: false,
      });

      expect(result.app.name).toBe("My Copy!");
      expect(result.app.path).toBe("my-copy-2");
      expect(fs.existsSync(path.join(TEMP_BASE, "my-copy-2", "index.ts"))).toBe(
        true,
      );
      // The occupying app's folder was not merged into.
      expect(fs.existsSync(path.join(TEMP_BASE, "my-copy", "index.ts"))).toBe(
        true,
      );
    });

    it("rejects duplicate display names with Conflict", async () => {
      const sourceId = seedAppWithFolder("Source", "source");
      seedApp("Taken", "taken");

      await expect(
        harness.invokeHandler("copy-app", {
          appId: sourceId,
          newAppName: "Taken",
          withHistory: false,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });
    });
  });

  describe("import-app", () => {
    function makeSourceDir(): string {
      const sourcePath = path.join(TEMP_BASE, "outside-source");
      fs.mkdirSync(sourcePath, { recursive: true });
      fs.writeFileSync(path.join(sourcePath, "index.ts"), "// app");
      return sourcePath;
    }

    it("copies into a slug folder derived from the display name", async () => {
      const sourcePath = makeSourceDir();

      const result = await invokeImportHandler<{ appId: number }>(
        "import-app",
        { path: sourcePath, appName: "My Imported App" },
      );

      const row = getAppRow(result.appId);
      expect(row?.name).toBe("My Imported App");
      expect(row?.path).toBe("my-imported-app");
      expect(
        fs.existsSync(path.join(TEMP_BASE, "my-imported-app", "index.ts")),
      ).toBe(true);
    });

    it("auto-suffixes folder collisions", async () => {
      const sourcePath = makeSourceDir();
      seedAppWithFolder("Occupier", "my-imported-app");

      const result = await invokeImportHandler<{ appId: number }>(
        "import-app",
        { path: sourcePath, appName: "My Imported App!" },
      );

      expect(getAppRow(result.appId)?.path).toBe("my-imported-app-2");
    });

    it("rejects duplicate display names", async () => {
      const sourcePath = makeSourceDir();
      seedApp("My Imported App", "elsewhere");

      await expect(
        invokeImportHandler("import-app", {
          path: sourcePath,
          appName: "My Imported App",
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("already exists"),
      });
    });
  });

  describe("rename-app", () => {
    it("moves the folder and returns the final name and path", async () => {
      const appId = seedAppWithFolder("Old Name", "old-name");

      const result = await harness.invokeHandler<{
        name: string;
        path: string;
      }>("rename-app", {
        appId,
        appName: "New Name",
        appPath: "new-name",
      });

      expect(result).toEqual({ name: "New Name", path: "new-name" });
      expect(fs.existsSync(path.join(TEMP_BASE, "new-name", "index.ts"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(TEMP_BASE, "old-name"))).toBe(false);
      expect(getAppRow(appId)).toMatchObject({
        name: "New Name",
        path: "new-name",
      });
    });

    it("rejects invalid folder names with Validation", async () => {
      const appId = seedAppWithFolder("My App", "my-app");

      for (const invalidPath of ["bad|name", "CON", "name.", ".."]) {
        await expect(
          harness.invokeHandler("rename-app", {
            appId,
            appName: "My App",
            appPath: invalidPath,
          }),
        ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
      }
    });

    it("allows a display-name-only rename of a legacy app whose folder fails slug rules", async () => {
      const appId = seedAppWithFolder("Legacy App", "My Legacy Folder");

      const result = await harness.invokeHandler<{
        name: string;
        path: string;
      }>("rename-app", {
        appId,
        appName: "Renamed Legacy App",
        appPath: "My Legacy Folder",
      });

      expect(result).toEqual({
        name: "Renamed Legacy App",
        path: "My Legacy Folder",
      });
      expect(fs.existsSync(path.join(TEMP_BASE, "My Legacy Folder"))).toBe(
        true,
      );
    });

    it("sanitizes the display name before conflict checks and persistence", async () => {
      seedAppWithFolder("My App", "my-app");
      const appId = seedAppWithFolder("Other", "other");

      await expect(
        harness.invokeHandler("rename-app", {
          appId,
          appName: " My\u0000 App ",
          appPath: "other",
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });

      const result = await harness.invokeHandler<{
        name: string;
        path: string;
      }>("rename-app", {
        appId,
        appName: " Clean\u0000 Name ",
        appPath: "other",
      });

      expect(result.name).toBe("Clean Name");
      expect(getAppRow(appId)?.name).toBe("Clean Name");
    });

    it("rejects path conflicts case-insensitively", async () => {
      seedAppWithFolder("Other", "Taken-Folder");
      const appId = seedAppWithFolder("My App", "my-app");

      await expect(
        harness.invokeHandler("rename-app", {
          appId,
          appName: "My App",
          appPath: "taken-folder",
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });
    });

    it("performs a case-only folder rename without destroying the app", async () => {
      const appId = seedAppWithFolder("My App", "MyApp");

      const result = await harness.invokeHandler<{
        name: string;
        path: string;
      }>("rename-app", {
        appId,
        appName: "My App",
        appPath: "myapp",
      });

      expect(result.path).toBe("myapp");
      expect(fs.existsSync(path.join(TEMP_BASE, "myapp", "index.ts"))).toBe(
        true,
      );
    });

    describe("autoResolveConflicts", () => {
      it("suffixes the display name and derives the folder from the final name", async () => {
        seedAppWithFolder("Todo App", "todo-app");
        const appId = seedAppWithFolder("Fresh App", "fresh-app");

        const result = await harness.invokeHandler<{
          name: string;
          path: string;
        }>("rename-app", {
          appId,
          appName: "Todo App",
          appPath: "todo-app",
          autoResolveConflicts: true,
        });

        expect(result).toEqual({ name: "Todo App 2", path: "todo-app-2" });
        expect(getAppRow(appId)).toMatchObject({
          name: "Todo App 2",
          path: "todo-app-2",
        });
      });

      it("suffixes only the folder when the name is free but the folder is taken", async () => {
        seedAppWithFolder("Occupier", "todo-app");
        const appId = seedAppWithFolder("Fresh App", "fresh-app");

        const result = await harness.invokeHandler<{
          name: string;
          path: string;
        }>("rename-app", {
          appId,
          appName: "Todo App!",
          appPath: "todo-app",
          autoResolveConflicts: true,
        });

        expect(result).toEqual({ name: "Todo App!", path: "todo-app-2" });
      });

      it("is idempotent: re-approving the same rename is a no-op", async () => {
        seedAppWithFolder("Todo App", "todo-app");
        const appId = seedAppWithFolder("Fresh App", "fresh-app");

        const first = await harness.invokeHandler<{
          name: string;
          path: string;
        }>("rename-app", {
          appId,
          appName: "Todo App",
          appPath: "todo-app",
          autoResolveConflicts: true,
        });
        expect(first).toEqual({ name: "Todo App 2", path: "todo-app-2" });

        // A blueprint re-approval passes the (already suffixed) stored name.
        const second = await harness.invokeHandler<{
          name: string;
          path: string;
        }>("rename-app", {
          appId,
          appName: "Todo App 2",
          appPath: "todo-app-2",
          autoResolveConflicts: true,
        });
        expect(second).toEqual({ name: "Todo App 2", path: "todo-app-2" });
        expect(fs.existsSync(path.join(TEMP_BASE, "todo-app-2"))).toBe(true);
      });

      it("normalizes a legacy folder to the canonical slug", async () => {
        const appId = seedAppWithFolder("Lumen Notes", "My Legacy Folder");

        const result = await harness.invokeHandler<{
          name: string;
          path: string;
        }>("rename-app", {
          appId,
          appName: "Lumen Notes",
          appPath: "lumen-notes",
          autoResolveConflicts: true,
        });

        expect(result).toEqual({ name: "Lumen Notes", path: "lumen-notes" });
        expect(
          fs.existsSync(path.join(TEMP_BASE, "lumen-notes", "index.ts")),
        ).toBe(true);
        expect(fs.existsSync(path.join(TEMP_BASE, "My Legacy Folder"))).toBe(
          false,
        );
      });
    });
  });

  describe("preview-app-folder-name", () => {
    it("returns the slug for a free name", async () => {
      const result = await harness.invokeHandler<{ folderName: string }>(
        "preview-app-folder-name",
        { name: "Food/Drink Planner" },
      );
      expect(result.folderName).toBe("food-drink-planner");
    });

    it("returns the suffixed folder when the base slug is taken", async () => {
      seedAppWithFolder("My App", "my-app");

      const result = await harness.invokeHandler<{ folderName: string }>(
        "preview-app-folder-name",
        { name: "My App!" },
      );
      expect(result.folderName).toBe("my-app-2");
    });

    it("excludes the app's own folder when previewing a rename", async () => {
      const appId = seedAppWithFolder("My App", "my-app");

      const result = await harness.invokeHandler<{ folderName: string }>(
        "preview-app-folder-name",
        { name: "My App", appId },
      );
      expect(result.folderName).toBe("my-app");
    });
  });
});
