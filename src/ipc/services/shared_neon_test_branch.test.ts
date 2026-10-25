import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  row: vi.fn(),
  marker: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { query: { apps: { findFirst: mocks.row } } } }));
vi.mock("../utils/neon_test_branch", () => ({
  createTempTestBranch: mocks.create,
  markAndDeleteTempTestBranch: mocks.remove,
  trackedTestBranchId: mocks.marker,
}));
import { acquireSharedNeonTestBranch } from "./shared_neon_test_branch";
import type { apps } from "@/db/schema";
const app = {
  id: 1,
  neonProjectId: "project",
  neonActiveBranchId: "parent",
  neonTestBranchId: null,
} as typeof apps.$inferSelect;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row.mockResolvedValue(app);
  mocks.create.mockResolvedValue({
    branchId: "test",
    databaseUrl: "postgres://test",
  });
  mocks.remove.mockResolvedValue(true);
  mocks.marker.mockResolvedValue(null);
});

it("coalesces acquisition, initializes once, and deletes only after the last owner releases", async () => {
  const initialize = vi.fn(async () => {});
  const [first, second] = await Promise.all([
    acquireSharedNeonTestBranch(app, "/sandbox/1", initialize),
    acquireSharedNeonTestBranch(app, "/sandbox/2", initialize),
  ]);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(first.branch).toBe(second.branch);
  await first.release();
  await first.release();
  expect(mocks.remove).not.toHaveBeenCalled();
  await second.release();
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(app, "test");
});

it("makes an acquisition arriving during last-owner deletion wait for deletion", async () => {
  let finish!: () => void;
  mocks.remove.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
  );
  const first = await acquireSharedNeonTestBranch(
    app,
    "/sandbox/1",
    async () => {},
  );
  const release = first.release();
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
  const acquire = acquireSharedNeonTestBranch(
    app,
    "/sandbox/2",
    async () => {},
  );
  await Promise.resolve();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  finish();
  await release;
  const second = await acquire;
  expect(mocks.create).toHaveBeenCalledTimes(2);
  await second.release();
});

it("does not publish a branch whose initialization fails and compensates that branch only", async () => {
  await expect(
    acquireSharedNeonTestBranch(app, "/sandbox", async () => {
      throw new Error("cleanup failed");
    }),
  ).rejects.toThrow("cleanup failed");
  expect(mocks.remove).toHaveBeenCalledWith(app, "test");
  const next = await acquireSharedNeonTestBranch(
    app,
    "/sandbox",
    async () => {},
  );
  expect(mocks.create).toHaveBeenCalledTimes(2);
  await next.release();
});
