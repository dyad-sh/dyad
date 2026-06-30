import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const selectWhere = vi.fn().mockResolvedValue([]);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { update, select },
    update,
    set,
    where,
    select,
    from,
    selectWhere,
    createProjectBranch: vi.fn(),
    deleteProjectBranch: vi.fn().mockResolvedValue({ data: {} }),
    ensureNeonAuth: vi.fn().mockResolvedValue(undefined),
    getOrCreateNeonAuthCookieSecret: vi.fn().mockResolvedValue("secret"),
  };
});

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => ({ apps: { id: "id", neonTestBranchId: "ntb" } }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn((a, b) => ({ a, b })), isNotNull: vi.fn() };
});
vi.mock("../../neon_admin/neon_management_client", () => ({
  getNeonClient: vi.fn(async () => ({
    createProjectBranch: mocks.createProjectBranch,
    deleteProjectBranch: mocks.deleteProjectBranch,
  })),
}));
vi.mock("../../neon_admin/neon_context", () => ({ getConnectionUri: vi.fn() }));
vi.mock("./neon_utils", () => ({
  ensureNeonAuth: mocks.ensureNeonAuth,
  getOrCreateNeonAuthCookieSecret: mocks.getOrCreateNeonAuthCookieSecret,
}));
vi.mock("./retryOnLocked", () => ({
  retryOnLocked: vi.fn((op: () => Promise<unknown>) => op()),
}));
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

import {
  createTempTestBranch,
  deleteTempTestBranch,
  reconcileOrphanTestBranches,
} from "./neon_test_branch";

type AppRow = any;

function makeApp(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: 7,
    path: "/apps/7",
    neonProjectId: "proj-1",
    neonPreviewBranchId: "preview-br",
    neonActiveBranchId: "active-br",
    neonDevelopmentBranchId: "dev-br",
    neonTestBranchId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.where.mockResolvedValue(undefined);
  mocks.selectWhere.mockResolvedValue([]);
  mocks.ensureNeonAuth.mockResolvedValue(undefined);
  mocks.createProjectBranch.mockResolvedValue({
    data: {
      branch: { id: "test-new-branch-id" },
      connection_uris: [{ connection_uri: "postgres://temp" }],
    },
  });
});

describe("createTempTestBranch", () => {
  it("branches off the active branch and returns the connection string", async () => {
    const result = await createTempTestBranch(makeApp());

    expect(mocks.createProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        branch: expect.objectContaining({ parent_id: "active-br" }),
      }),
    );
    expect(result).toMatchObject({
      branchId: "test-new-branch-id",
      databaseUrl: "postgres://temp",
    });
    // Persists the in-flight branch id for crash reconciliation.
    expect(mocks.set).toHaveBeenCalledWith({
      neonTestBranchId: "test-new-branch-id",
    });
  });

  it("falls back to the development branch when there is no active branch", async () => {
    await createTempTestBranch(makeApp({ neonActiveBranchId: null }));
    expect(mocks.createProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        branch: expect.objectContaining({ parent_id: "dev-br" }),
      }),
    );
  });

  it("falls back to the preview branch when there is no active or development branch", async () => {
    await createTempTestBranch(
      makeApp({ neonActiveBranchId: null, neonDevelopmentBranchId: null }),
    );
    expect(mocks.createProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        branch: expect.objectContaining({ parent_id: "preview-br" }),
      }),
    );
  });

  it("throws when the app has no Neon project", async () => {
    await expect(
      createTempTestBranch(makeApp({ neonProjectId: null })),
    ).rejects.toThrow(/not connected to a Neon project/);
  });

  it("attaches auth details when Neon Auth activates", async () => {
    mocks.ensureNeonAuth.mockResolvedValue("https://auth.example");
    const result = await createTempTestBranch(makeApp());
    expect(result.neonAuthBaseUrl).toBe("https://auth.example");
    expect(result.cookieSecret).toBe("secret");
  });
});

describe("deleteTempTestBranch", () => {
  it("deletes the branch and clears the column", async () => {
    await deleteTempTestBranch(makeApp({ neonTestBranchId: "test-br" }));
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith("proj-1", "test-br");
    expect(mocks.set).toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("is a no-op when no test branch is set", async () => {
    await deleteTempTestBranch(makeApp({ neonTestBranchId: null }));
    expect(mocks.deleteProjectBranch).not.toHaveBeenCalled();
  });
});

describe("reconcileOrphanTestBranches", () => {
  it("deletes orphaned branches found at startup", async () => {
    mocks.selectWhere.mockResolvedValue([
      makeApp({ neonTestBranchId: "leaked-br" }),
    ]);
    await reconcileOrphanTestBranches();
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-br",
    );
  });

  it("never throws when the query fails", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"));
    await expect(reconcileOrphanTestBranches()).resolves.toBeUndefined();
  });
});
