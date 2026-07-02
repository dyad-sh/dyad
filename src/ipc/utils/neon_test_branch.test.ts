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
    getConnectionUri: vi.fn().mockResolvedValue("postgres://real"),
    readEnvVarsOrEmpty: vi.fn().mockResolvedValue([]),
    updateNeonEnvVars: vi.fn().mockResolvedValue(undefined),
    detectFrameworkType: vi.fn().mockReturnValue("nextjs"),
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
vi.mock("../../neon_admin/neon_context", () => ({
  getConnectionUri: mocks.getConnectionUri,
}));
vi.mock("./app_env_var_utils", () => ({
  readEnvVarsOrEmpty: mocks.readEnvVarsOrEmpty,
  updateNeonEnvVars: mocks.updateNeonEnvVars,
}));
vi.mock("./framework_utils", () => ({
  detectFrameworkType: mocks.detectFrameworkType,
}));
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
  mocks.getConnectionUri.mockResolvedValue("postgres://real");
  mocks.readEnvVarsOrEmpty.mockResolvedValue([]);
  mocks.updateNeonEnvVars.mockResolvedValue(undefined);
  mocks.detectFrameworkType.mockReturnValue("nextjs");
  mocks.deleteProjectBranch.mockResolvedValue({ data: {} });
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
    const result = await createTempTestBranch(
      makeApp({ neonDevelopmentAuthCookieSecret: "dev-secret" }),
    );
    expect(result.neonAuthBaseUrl).toBe("https://auth.example");
    expect(result.cookieSecret).toBe("secret");
  });

  it("detects upgraded Neon Auth apps from env markers", async () => {
    mocks.readEnvVarsOrEmpty.mockResolvedValue([
      { key: "NEON_AUTH_BASE_URL", value: "https://auth.old" },
    ]);
    mocks.ensureNeonAuth.mockResolvedValue("https://auth.example");

    const result = await createTempTestBranch(makeApp());

    expect(mocks.ensureNeonAuth).toHaveBeenCalledWith({
      projectId: "proj-1",
      branchId: "test-new-branch-id",
    });
    expect(result.neonAuthBaseUrl).toBe("https://auth.example");
  });

  it("skips Neon Auth provisioning when the app does not use Neon Auth", async () => {
    mocks.ensureNeonAuth.mockResolvedValue("https://auth.example");
    const result = await createTempTestBranch(makeApp());
    expect(mocks.ensureNeonAuth).not.toHaveBeenCalled();
    expect(result.neonAuthBaseUrl).toBeUndefined();
    expect(result.cookieSecret).toBeUndefined();
  });

  it("fails closed when env inspection for Neon Auth markers fails", async () => {
    mocks.readEnvVarsOrEmpty.mockRejectedValue(new Error("env read failed"));

    await expect(createTempTestBranch(makeApp())).rejects.toThrow(/Neon Auth/);

    expect(mocks.ensureNeonAuth).toHaveBeenCalledWith({
      projectId: "proj-1",
      branchId: "test-new-branch-id",
    });
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "test-new-branch-id",
    );
  });

  it("dead-ends when the app uses Neon Auth but provisioning fails", async () => {
    // ensureNeonAuth resolves undefined (default) → auth could not be activated.
    await expect(
      createTempTestBranch(
        makeApp({ neonDevelopmentAuthCookieSecret: "dev-secret" }),
      ),
    ).rejects.toThrow(/Neon Auth/);
    // The just-created branch is deleted and the column cleared so we don't
    // orphan it or run the app against real auth with an isolated DB branch.
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "test-new-branch-id",
    );
    expect(mocks.set).toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("keeps the column set when the dead-end branch delete fails", async () => {
    // Auth provisioning fails (dead-end) AND the just-created branch can't be
    // deleted — the column must stay pointing at it so the startup
    // reconciliation sweep can retry the delete.
    mocks.deleteProjectBranch.mockRejectedValueOnce(new Error("neon down"));
    await expect(
      createTempTestBranch(
        makeApp({ neonDevelopmentAuthCookieSecret: "dev-secret" }),
      ),
    ).rejects.toThrow(/Neon Auth/);
    expect(mocks.set).not.toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("deletes a partially-created branch when Neon omits the connection string", async () => {
    // Neon created the branch but returned no connection_uris. The id was never
    // persisted, so nothing could ever reconcile it — delete it best-effort.
    mocks.createProjectBranch.mockResolvedValueOnce({
      data: { branch: { id: "partial-br" }, connection_uris: [] },
    });
    await expect(createTempTestBranch(makeApp())).rejects.toThrow(
      /connection string/,
    );
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "partial-br",
    );
  });

  it("does not overwrite the column when the prior branch cleanup fails", async () => {
    // The prior leaked branch can't be deleted (Neon rejects), so we must keep
    // the column pointing at it for the reconciliation sweep instead of the new
    // branch id.
    mocks.deleteProjectBranch.mockRejectedValueOnce(new Error("neon down"));
    await expect(
      createTempTestBranch(makeApp({ neonTestBranchId: "old-br" })),
    ).rejects.toThrow(/previous Neon test branch/);
    expect(mocks.set).not.toHaveBeenCalledWith({
      neonTestBranchId: "test-new-branch-id",
    });
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

  it("clears the column when Neon reports the branch is already gone (404)", async () => {
    // A prior teardown deleted the branch but crashed before clearing the
    // column. Neon now 404s — treat that as success so we stop dead-ending on
    // the stale id forever.
    mocks.deleteProjectBranch.mockRejectedValueOnce({
      response: { status: 404 },
    });
    await deleteTempTestBranch(makeApp({ neonTestBranchId: "gone-br" }));
    expect(mocks.set).toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("keeps the column set when the delete fails for a non-404 reason", async () => {
    mocks.deleteProjectBranch.mockRejectedValueOnce({
      response: { status: 500 },
    });
    await deleteTempTestBranch(makeApp({ neonTestBranchId: "test-br" }));
    expect(mocks.set).not.toHaveBeenCalledWith({ neonTestBranchId: null });
  });
});

describe("reconcileOrphanTestBranches", () => {
  it("restores the real env before deleting orphaned branches found at startup", async () => {
    mocks.selectWhere.mockResolvedValue([
      makeApp({
        neonTestBranchId: "leaked-br",
        neonDevelopmentAuthCookieSecret: "dev-secret",
      }),
    ]);
    mocks.ensureNeonAuth.mockResolvedValue("https://real-auth");

    await reconcileOrphanTestBranches();

    expect(mocks.updateNeonEnvVars).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: "/apps/7",
        connectionUri: "postgres://real",
        neonAuthBaseUrl: "https://real-auth",
        cookieSecret: "secret",
        preserveExistingAuth: false,
      }),
    );
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-br",
    );
    expect(mocks.updateNeonEnvVars.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteProjectBranch.mock.invocationCallOrder[0],
    );
  });

  it("keeps the orphan branch tracked when real env repair fails", async () => {
    mocks.selectWhere.mockResolvedValue([
      makeApp({ neonTestBranchId: "leaked-br" }),
    ]);
    mocks.getConnectionUri.mockRejectedValue(new Error("neon down"));

    await reconcileOrphanTestBranches();

    expect(mocks.deleteProjectBranch).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("never throws when the query fails", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("db down"));
    await expect(reconcileOrphanTestBranches()).resolves.toBeUndefined();
  });
});
