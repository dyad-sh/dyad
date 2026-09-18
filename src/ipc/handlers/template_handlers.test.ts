import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";
import { activeRecordings } from "@/ipc/services/recording_registry";

// All app folders live under one throwaway base so the filesystem-probing
// conflict checks (and actual folder moves) run against real directories.
const TEMP_BASE = path.join(os.tmpdir(), "dyad-template-handler-tests");

const createFromTemplateMock = vi.hoisted(() => vi.fn());
const getGitUncommittedFilesMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string[]> => []),
);
const stageAllAndCommitIfChangedMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => "fake-commit-hash"),
);
const runningAppsMock = vi.hoisted(
  () => new Map<number, { processId: number; mode: string }>(),
);
const stopAppByInfoMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureDyadGitignoredMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-template-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const nodePath = await import("node:path");
  const nodeOs = await import("node:os");
  const base = nodePath.join(nodeOs.tmpdir(), "dyad-template-handler-tests");
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.isAbsolute(appPath) ? appPath : nodePath.join(base, appPath),
    isAppLocationAccessible: () => true,
  };
});

vi.mock("@/ipc/services/git_service", () => ({
  GitService: class {},
  gitService: {
    stageAllAndCommitIfChanged: stageAllAndCommitIfChangedMock,
  },
}));

vi.mock("@/ipc/handlers/createFromTemplate", () => ({
  createFromTemplate: createFromTemplateMock,
}));

vi.mock("@/ipc/handlers/gitignoreUtils", () => ({
  ensureDyadGitignored: ensureDyadGitignoredMock,
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  getGitUncommittedFiles: getGitUncommittedFilesMock,
}));

vi.mock("@/ipc/utils/process_manager", () => ({
  runningApps: runningAppsMock,
  stopAppByInfo: stopAppByInfoMock,
}));

import { registerTemplateHandlers } from "./template_handlers";

async function writeTree(root: string, files: Record<string, string>) {
  await fs.promises.mkdir(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content);
  }
}

function readApp(rel: string, appPath: string): string {
  return fs.readFileSync(path.join(appPath, rel), "utf8");
}

describe("apply-app-template", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    harness = setupHandlerTestHarness();
    activeRecordings.clear();
    runningAppsMock.clear();
    stopAppByInfoMock.mockClear();
    stopAppByInfoMock.mockResolvedValue(undefined);
    ensureDyadGitignoredMock.mockClear();
    ensureDyadGitignoredMock.mockResolvedValue(undefined);
    getGitUncommittedFilesMock.mockReset();
    getGitUncommittedFilesMock.mockResolvedValue([]);
    stageAllAndCommitIfChangedMock.mockReset();
    stageAllAndCommitIfChangedMock.mockResolvedValue("fake-commit-hash");
    createFromTemplateMock.mockReset();
    registerTemplateHandlers();
  });

  afterEach(() => {
    activeRecordings.clear();
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

  // Configures createFromTemplate to stage a template whose top-level tree is
  // `files` under the staged `app/` directory dyad creates in a temp dir.
  function stageTemplateTree(files: Record<string, string>) {
    createFromTemplateMock.mockImplementation(
      async ({ fullAppPath }: { fullAppPath: string }) => {
        await writeTree(fullAppPath, files);
      },
    );
  }

  describe("in-place flow (imported absolute-path app)", () => {
    let appPath: string;

    beforeEach(() => {
      appPath = path.join(TEMP_BASE, "imported-app");
    });

    it("preserves a user-customized .env.example over the template's copy", async () => {
      await writeTree(appPath, {
        ".env.example": "USER_KEY=user-value\n",
        "package.json": '{"name":"old"}',
        "src/old.ts": "// old\n",
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".env.example": "TEMPLATE_KEY=template-value\n",
        "package.json": '{"name":"template"}',
        "src/App.tsx": "// template\n",
      });

      const result = await harness.invokeHandler<{
        applied: boolean;
        needsRestart: boolean;
      }>("apply-app-template", { appId, templateId: "portal-mini-store" });

      expect(result.applied).toBe(true);
      expect(readApp(".env.example", appPath)).toBe("USER_KEY=user-value\n");
      expect(readApp("package.json", appPath)).toBe('{"name":"template"}');
      expect(readApp("src/App.tsx", appPath)).toBe("// template\n");
      expect(fs.existsSync(path.join(appPath, "src", "old.ts"))).toBe(false);
    });

    it("preserves a gitignored .env over the template's copy", async () => {
      await writeTree(appPath, {
        ".env": "DATABASE_URL=super-secret\n",
        "package.json": '{"name":"old"}',
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".env": "PLACEHOLDER=replace-me\n",
        ".env.example": "PLACEHOLDER=replace-me\n",
        "package.json": '{"name":"template"}',
      });

      await harness.invokeHandler("apply-app-template", {
        appId,
        templateId: "portal-mini-store",
      });

      expect(readApp(".env", appPath)).toBe("DATABASE_URL=super-secret\n");
      expect(readApp(".env.example", appPath)).toBe("PLACEHOLDER=replace-me\n");
    });

    it("keeps the template's .env.example when the user has none", async () => {
      await writeTree(appPath, {
        "package.json": '{"name":"old"}',
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".env.example": "TEMPLATE_KEY=template-value\n",
        "package.json": '{"name":"template"}',
      });

      await harness.invokeHandler("apply-app-template", {
        appId,
        templateId: "portal-mini-store",
      });

      expect(readApp(".env.example", appPath)).toBe(
        "TEMPLATE_KEY=template-value\n",
      );
    });

    it("preserves .git and .dyad directories over the template's same-named copies", async () => {
      await writeTree(appPath, {
        ".git/HEAD": "ref: refs/heads/main\n",
        ".dyad/meta.json": '{"user":"preserved"}',
        "package.json": '{"name":"old"}',
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".git/HEAD": "ref: refs/heads/template-main\n",
        ".git/config": "[template]\n",
        ".dyad/meta.json": '{"template":"injected"}',
        "package.json": '{"name":"template"}',
      });

      await harness.invokeHandler("apply-app-template", {
        appId,
        templateId: "portal-mini-store",
      });

      expect(readApp(".git/HEAD", appPath)).toBe("ref: refs/heads/main\n");
      expect(fs.existsSync(path.join(appPath, ".git", "config"))).toBe(false);
      expect(readApp(".dyad/meta.json", appPath)).toBe('{"user":"preserved"}');
    });

    it("clears non-preserved entries before copying the template", async () => {
      await writeTree(appPath, {
        ".env": "KEEP=me\n",
        "old-only.txt": "stale\n",
        "legacy-deep/sub.txt": "gone\n",
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".env": "REPLACE=me\n",
        "fresh.txt": "new\n",
      });

      await harness.invokeHandler("apply-app-template", {
        appId,
        templateId: "portal-mini-store",
      });

      expect(readApp(".env", appPath)).toBe("KEEP=me\n");
      expect(fs.existsSync(path.join(appPath, "old-only.txt"))).toBe(false);
      expect(fs.existsSync(path.join(appPath, "legacy-deep"))).toBe(false);
      expect(readApp("fresh.txt", appPath)).toBe("new\n");
    });

    it("copies nested preserved-named files from the template (only top-level is protected)", async () => {
      await writeTree(appPath, {
        "package.json": '{"name":"old"}',
      });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({
        ".env": "TOP_LEVEL=skipped-or-preserved\n",
        "packages/app/.env": "NESTED=from-template\n",
        "package.json": '{"name":"template"}',
      });

      await harness.invokeHandler("apply-app-template", {
        appId,
        templateId: "portal-mini-store",
      });

      expect(readApp("packages/app/.env", appPath)).toBe(
        "NESTED=from-template\n",
      );
    });

    it("stops a running dev server and reports a restart is needed", async () => {
      await writeTree(appPath, { "package.json": '{"name":"old"}' });
      const appId = seedApp("Imported App", appPath);
      runningAppsMock.set(appId, { processId: 42, mode: "host" });
      stageTemplateTree({ "package.json": '{"name":"template"}' });

      const result = await harness.invokeHandler<{
        applied: boolean;
        needsRestart: boolean;
      }>("apply-app-template", { appId, templateId: "react" });

      expect(stopAppByInfoMock).toHaveBeenCalledTimes(1);
      expect(result.applied).toBe(true);
      expect(result.needsRestart).toBe(true);
    });

    it("rejects when the working tree has uncommitted files", async () => {
      await writeTree(appPath, { "package.json": '{"name":"old"}' });
      const appId = seedApp("Imported App", appPath);
      getGitUncommittedFilesMock.mockResolvedValueOnce(["src/dirty.ts"]);
      stageTemplateTree({ "package.json": '{"name":"template"}' });

      await expect(
        harness.invokeHandler("apply-app-template", {
          appId,
          templateId: "react",
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(createFromTemplateMock).not.toHaveBeenCalled();
    });

    it("reports a no-op when staging produces no git changes", async () => {
      await writeTree(appPath, { "package.json": '{"name":"old"}' });
      const appId = seedApp("Imported App", appPath);
      stageTemplateTree({ "package.json": '{"name":"template"}' });
      stageAllAndCommitIfChangedMock.mockResolvedValueOnce(null);

      const result = await harness.invokeHandler<{
        applied: boolean;
        needsRestart: boolean;
      }>("apply-app-template", { appId, templateId: "react" });

      expect(result.applied).toBe(false);
      expect(result.needsRestart).toBe(false);
    });
  });

  describe("path-swap flow (legacy non-canonical folder name)", () => {
    it("migrates the user's preserved .env.example into the new folder", async () => {
      const oldRelPath = "legacy-folder";
      const oldAbsPath = path.join(TEMP_BASE, oldRelPath);
      await writeTree(oldAbsPath, {
        ".env.example": "USER_KEY=user-value\n",
        ".git/HEAD": "ref: refs/heads/main\n",
        "package.json": '{"name":"old"}',
      });
      const appId = seedApp("Path Swap App", oldRelPath);
      stageTemplateTree({
        ".env.example": "TEMPLATE_KEY=template-value\n",
        "package.json": '{"name":"template"}',
        "src/App.tsx": "// template\n",
      });

      const result = await harness.invokeHandler<{
        applied: boolean;
        needsRestart: boolean;
      }>("apply-app-template", { appId, templateId: "portal-mini-store" });

      expect(result.applied).toBe(true);
      const newAbsPath = path.join(TEMP_BASE, "path-swap-app");
      expect(readApp(".env.example", newAbsPath)).toBe("USER_KEY=user-value\n");
      expect(readApp(".git/HEAD", newAbsPath)).toBe("ref: refs/heads/main\n");
      expect(readApp("package.json", newAbsPath)).toBe('{"name":"template"}');
      expect(readApp("src/App.tsx", newAbsPath)).toBe("// template\n");
      expect(fs.existsSync(oldAbsPath)).toBe(false);
      expect(
        harness.db.select().from(apps).where(eq(apps.id, appId)).get()?.path,
      ).toBe("path-swap-app");
    });
  });
});
