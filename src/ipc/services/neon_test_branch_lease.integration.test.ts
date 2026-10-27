import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, testBranchCleanup } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

const h = vi.hoisted(() => ({
  db: undefined as TestDb | undefined,
  create: vi.fn(),
  remove: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("../../neon_admin/neon_management_client", () => ({
  getNeonClient: async () => ({
    createProjectBranch: h.create,
    deleteProjectBranch: h.remove,
  }),
}));
vi.mock("../../neon_admin/neon_context", () => ({ getConnectionUri: vi.fn() }));
vi.mock("../utils/neon_utils", () => ({
  ensureNeonAuth: h.auth,
  getOrCreateNeonAuthCookieSecret: async () => "test-secret",
}));
vi.mock("../utils/app_env_var_utils", () => ({
  readEnvVarsOrEmpty: async () => [
    { key: "NEON_AUTH_BASE_URL", value: "https://auth" },
  ],
  updateNeonEnvVars: vi.fn(),
}));
vi.mock("../utils/framework_utils", () => ({
  detectFrameworkType: () => "nextjs",
}));

import { acquireNeonTestBranch } from "./neon_test_branch_lease";
import {
  reconcileOrphanTestBranches,
  trackedRunTestBranchId,
} from "../utils/neon_test_branch";

beforeEach(() => {
  vi.clearAllMocks();
  h.db = createInMemoryTestDb();
  h.remove.mockResolvedValue({ data: {} });
  h.auth.mockResolvedValue("https://test-auth");
  let nextId = 0;
  h.create.mockImplementation(async () => ({
    data: {
      branch: { id: `br-${++nextId}` },
      connection_uris: [{ connection_uri: "postgres://test" }],
    },
  }));
});
afterEach(() => h.db?.$client.close());

async function seedApp() {
  return (
    await h
      .db!.insert(apps)
      .values({
        name: "Test",
        path: "test",
        neonProjectId: "project",
        neonActiveBranchId: "parent",
      })
      .returning()
  )[0];
}

it("persists independent owners before auth, and deletes only the released run's record", async () => {
  const app = await seedApp();
  h.auth.mockImplementation(async ({ branchId }) => {
    expect(
      await h.db!.query.testBranchCleanup.findFirst({
        where: eq(testBranchCleanup.branchId, branchId),
      }),
    ).toBeDefined();
    return "https://test-auth";
  });
  const [first, second] = await Promise.all([
    acquireNeonTestBranch(app, "/sandbox/one", "one", {}),
    acquireNeonTestBranch(app, "/sandbox/two", "two", {}),
  ]);
  expect(await trackedRunTestBranchId("one")).toBe(first.branch.branchId);
  expect(await trackedRunTestBranchId("two")).toBe(second.branch.branchId);
  expect((await h.db!.query.apps.findFirst())?.neonTestBranchId).toBeNull();
  await first.release();
  expect(await trackedRunTestBranchId("one")).toBeNull();
  expect(await trackedRunTestBranchId("two")).toBe(second.branch.branchId);
  await second.release();
  expect(await h.db!.select().from(testBranchCleanup)).toEqual([]);
});

it("retains failed deletion for startup recovery after the local app is deleted", async () => {
  const app = await seedApp();
  const lease = await acquireNeonTestBranch(app, "/sandbox", "run", {});
  h.remove.mockRejectedValueOnce({ response: { status: 403 } });
  expect(await lease.release()).toBe(false);
  await h.db!.delete(apps).where(eq(apps.id, app.id));
  expect(await trackedRunTestBranchId("run")).toBe(lease.branch.branchId);
  await reconcileOrphanTestBranches();
  expect(h.remove).toHaveBeenLastCalledWith("project", lease.branch.branchId);
  expect(await h.db!.select().from(testBranchCleanup)).toEqual([]);
});

it("keeps a partially provisioned branch recoverable when its compensating delete fails", async () => {
  const app = await seedApp();
  h.create.mockResolvedValueOnce({ data: { branch: { id: "partial" } } });
  h.remove.mockRejectedValueOnce({ response: { status: 403 } });
  await expect(
    acquireNeonTestBranch(app, "/sandbox", "partial-run", {}),
  ).rejects.toThrow("connection string");
  expect(await trackedRunTestBranchId("partial-run")).toBe("partial");
  await reconcileOrphanTestBranches();
  expect(await trackedRunTestBranchId("partial-run")).toBeNull();
});
