import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apps } from "@/db/schema";
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
  gitCurrentBranch: async () => h.branch,
  getCurrentCommitHash: async () => h.commit,
}));
import { loadTestRunContext } from "./test_run_context";

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

it("detects changed workspace inputs", async () => {
  const first = await loadTestRunContext(request);
  expect(first.databaseKey).toBe("neon:neon:7");
  expect(first.exclusive).toBe(false);
  await fs.writeFile(
    path.join(h.appPath, "e2e-tests", "fixtures.ts"),
    "new fixture",
  );
  const fixture = await loadTestRunContext(request);
  expect(fixture.inputFingerprint).not.toBe(first.inputFingerprint);
  await fs.writeFile(path.join(h.root, "package-lock.json"), "changed lock");
  const lock = await loadTestRunContext(request);
  expect(lock.inputFingerprint).not.toBe(fixture.inputFingerprint);
  h.branch = "feature";
  h.commit = "new-commit";
  const branch = await loadTestRunContext(request);
  expect(branch.inputFingerprint).not.toBe(lock.inputFingerprint);
  const headed = await loadTestRunContext({ ...request, headed: true });
  expect(headed.inputFingerprint).not.toBe(branch.inputFingerprint);
});

it("preserves provider compatibility and exclusive setup", async () => {
  h.db!.update(apps)
    .set({ supabaseProjectId: "supabase" })
    .where(eq(apps.id, 7))
    .run();
  const context = await loadTestRunContext(request);
  expect(context.databaseKey).toBe("supabase:supabase");
  h.db!.update(apps)
    .set({ installCommand: "custom-install" })
    .where(eq(apps.id, 7))
    .run();
  expect((await loadTestRunContext(request)).exclusive).toBe(true);
});
