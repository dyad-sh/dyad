import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

const h = vi.hoisted(() => ({
  db: undefined as TestDb | undefined,
  root: "",
  appPath: "",
  branch: "main",
  commit: "abcdef",
  settings: { enableParallelTestRuns: true, runtimeMode2: "host" },
}));
vi.mock("@/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (appPath: string) => path.join(h.root, appPath),
}));
vi.mock("@/main/settings", () => ({ readSettings: () => h.settings }));
vi.mock("../utils/git_utils", () => ({
  execGit: async () => ({ exitCode: 0, stdout: h.root }),
  gitCurrentBranch: vi.fn(async () => h.branch),
  getCurrentCommitHash: vi.fn(async () => h.commit),
}));
import { loadTestRunContext } from "./test_run_context";
import { gitCurrentBranch, getCurrentCommitHash } from "../utils/git_utils";

const request = {
  appId: 7,
  runId: 1,
  source: "panel" as const,
  testFile: "e2e-tests/login.spec.ts",
};
beforeEach(async () => {
  vi.clearAllMocks();
  h.root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "dyad-test-context-")),
  );
  h.appPath = path.join(h.root, "packages", "app");
  h.branch = "main";
  h.commit = "abcdef";
  h.db = createInMemoryTestDb();
  h.db
    .insert(apps)
    .values([
      { id: 7, name: "App", path: "packages/app", neonProjectId: "neon" },
      { id: 8, name: "Other", path: "packages/other" },
    ])
    .run();
  for (const appPath of [h.appPath, path.join(h.root, "packages", "other")]) {
    await fs.mkdir(path.join(appPath, "e2e-tests"), { recursive: true });
    await fs.writeFile(
      path.join(appPath, request.testFile),
      'import { test } from "@playwright/test";\ntest("login", async () => {});\n',
    );
  }
  await fs.writeFile(path.join(h.root, "package-lock.json"), "first lock");
});
afterEach(async () => {
  h.db?.$client.close();
  await fs.rm(h.root, { recursive: true, force: true });
});

it("ignores edits and display preferences that do not affect admission", async () => {
  const first = await loadTestRunContext(request);
  // Neon runs own separate branches, so different revisions can overlap.
  expect(first.databaseKey).toBeUndefined();
  expect(first.exclusive).toBe(false);
  await fs.writeFile(
    path.join(h.appPath, "e2e-tests", "fixtures.ts"),
    "new fixture",
  );
  const fixture = await loadTestRunContext(request);
  expect(fixture).toEqual(first);
  await fs.writeFile(path.join(h.root, "package-lock.json"), "changed lock");
  const lock = await loadTestRunContext(request);
  expect(lock).toEqual(fixture);
  h.branch = "feature";
  h.commit = "new-commit";
  const branch = await loadTestRunContext(request);
  expect(branch).toMatchObject({ branch: "feature", revision: "new-commit" });
  const headed = await loadTestRunContext({ ...request, headed: true });
  expect(headed).toEqual(branch);
});

it("preserves provider compatibility and exclusive setup", async () => {
  h.db!.update(apps)
    .set({ supabaseProjectId: "supabase" })
    .where(eq(apps.id, 7))
    .run();
  const context = await loadTestRunContext(request);
  expect(context.databaseKey).toBe("supabase:supabase");
  // Like the E2E runtime, only an install AND start command make setup custom.
  for (const [installCommand, startCommand, exclusive] of [
    ["custom-install", null, false],
    ["custom-install", "   ", false],
    ["  ", "custom-start", false],
    ["custom-install", "custom-start", true],
  ] as const) {
    h.db!.update(apps)
      .set({ installCommand, startCommand })
      .where(eq(apps.id, 7))
      .run();
    expect((await loadTestRunContext(request)).exclusive).toBe(exclusive);
  }
});

it("classifies a deleted app as missing", async () => {
  h.db!.delete(apps).where(eq(apps.id, request.appId)).run();
  await expect(loadTestRunContext(request)).rejects.toEqual(
    new DyadError("App no longer exists", DyadErrorKind.NotFound),
  );
});

it("uses the source worktree for admission identity and revision", async () => {
  const appPath = path.join(h.root, "chat-worktree");
  await fs.mkdir(appPath);
  h.branch = "dyad/chat-7";
  h.commit = "worktree-commit";
  const context = await loadTestRunContext({
    ...request,
    source: "agent",
    sourceWorkspace: { appPath, workspaceId: 7 },
  });
  expect(context).toMatchObject({
    workspaceKey: appPath,
    branch: "dyad/chat-7",
    revision: "worktree-commit",
  });
  expect(gitCurrentBranch).toHaveBeenCalledWith({ path: appPath });
  expect(getCurrentCommitHash).toHaveBeenCalledWith({ path: appPath });
});

it("refuses a missing worktree even when the main app still exists", async () => {
  await expect(
    loadTestRunContext({
      ...request,
      source: "agent",
      sourceWorkspace: {
        appPath: path.join(h.root, "missing-worktree"),
        workspaceId: 7,
      },
    }),
  ).rejects.toMatchObject({
    kind: DyadErrorKind.NotFound,
    message: expect.stringContaining("worktree folder no longer exists"),
  });
  expect(gitCurrentBranch).not.toHaveBeenCalled();
});

it("explains how to recover a missing app folder", async () => {
  await fs.rm(h.appPath, { recursive: true });
  await expect(loadTestRunContext(request)).rejects.toMatchObject({
    name: "DyadError",
    kind: DyadErrorKind.NotFound,
    message: expect.stringContaining(
      "Restore the folder or import the app again",
    ),
    cause: expect.objectContaining({ code: "ENOENT" }),
  });
});

it("preserves other filesystem failures", async () => {
  const error = Object.assign(new Error("Access denied"), { code: "EACCES" });
  const realpath = vi.spyOn(fs, "realpath").mockRejectedValueOnce(error);
  try {
    await expect(loadTestRunContext(request)).rejects.toBe(error);
  } finally {
    realpath.mockRestore();
  }
});
