import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const selectWhere = vi.fn().mockResolvedValue([]);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const findFirst = vi.fn();
  return {
    db: { update, select, query: { apps: { findFirst } } },
    update,
    set,
    where,
    select,
    from,
    selectWhere,
    findFirst,
    freshApps: new Map<number, any>(),
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
  isTestBranchCleanupOnly,
  markAndDeleteTempTestBranch,
  reconcileOrphanTestBranches,
  restoreAppFromTestBranch,
} from "./neon_test_branch";
import { appOperationCoordinator } from "../services/app_operation_coordinator";

type AppRow = any;

function makeApp(overrides: Partial<AppRow> = {}): AppRow {
  const app = {
    id: 7,
    path: "/apps/7",
    neonProjectId: "proj-1",
    neonPreviewBranchId: "preview-br",
    neonActiveBranchId: "active-br",
    neonDevelopmentBranchId: "dev-br",
    neonTestBranchId: null,
    ...overrides,
  };
  mocks.freshApps.set(app.id, app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.where.mockResolvedValue(undefined);
  mocks.selectWhere.mockResolvedValue([]);
  mocks.freshApps.clear();
  mocks.findFirst.mockImplementation(({ where }) =>
    Promise.resolve(mocks.freshApps.get(where.b)),
  );
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

  it("persists the cleanup-only marker before provisioning, when asked", async () => {
    // The E2E sandbox never points the real app at this branch. Everything
    // after this write — Neon Auth provisioning, the cookie secret, their
    // retries — takes seconds, and a crash in that window would otherwise leave
    // a RAW marker that `restoreAppFromTestBranch` reads as the recorder's env
    // swap and "restores" by rewriting the user's real `.env.local`.
    //
    // An auth-enabled app, so provisioning actually runs, and the assertion
    // lives INSIDE it: checking the marker after the call returns would pass
    // just as happily if the write had come second.
    mocks.ensureNeonAuth.mockImplementationOnce(async () => {
      expect(mocks.set).toHaveBeenCalledWith({
        neonTestBranchId: "dyad-cleanup-only:v1:test-new-branch-id",
      });
      return "https://auth.example";
    });

    await createTempTestBranch(
      makeApp({ neonDevelopmentAuthCookieSecret: "dev-secret" }),
      { cleanupOnly: true },
    );

    expect(mocks.ensureNeonAuth).toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalledWith({
      neonTestBranchId: "test-new-branch-id",
    });
  });

  it("refuses a cleanup-only run when a raw marker is still on the row", async () => {
    // The raw marker means the user's own `.env.local` is still pointed at that
    // branch. Deleting it and relabelling the row cleanup-only would leave the
    // app configured against a branch that no longer exists, with the one
    // record startup recovery uses to fix it overwritten.
    //
    // Refused rather than repaired here: the repair rewrites the live working
    // tree, and this runs inside a run stage whose coordinator claims
    // deliberately do not cover it. The caller performs the recovery under its
    // own claim before the snapshot; this is the guard for when it did not.
    await expect(
      createTempTestBranch(makeApp({ neonTestBranchId: "leaked-branch-id" }), {
        cleanupOnly: true,
      }),
    ).rejects.toThrow(/real database settings pointing at a previous session/i);

    // Nothing touched: the row still names the leaked branch for the sweep.
    expect(mocks.updateNeonEnvVars).not.toHaveBeenCalled();
    expect(mocks.deleteProjectBranch).not.toHaveBeenCalled();
    expect(mocks.createProjectBranch).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("still deletes a prior branch for the recorder's own run", async () => {
    // The recorder path swaps the real env itself and snapshots it first, so a
    // prior raw marker is its own to clean up and overwrite.
    await createTempTestBranch(
      makeApp({ neonTestBranchId: "leaked-branch-id" }),
    );

    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-branch-id",
    );
    expect(mocks.set).toHaveBeenCalledWith({
      neonTestBranchId: "test-new-branch-id",
    });
  });

  it("leaves a cleanup-only marker to the plain delete path", async () => {
    // Nothing pointed the real app at that branch, so there is no env to put
    // back — restoring one would rewrite a file this run never touched.
    await createTempTestBranch(
      makeApp({ neonTestBranchId: "dyad-cleanup-only:v1:leaked-branch-id" }),
      { cleanupOnly: true },
    );

    expect(mocks.updateNeonEnvVars).not.toHaveBeenCalled();
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-branch-id",
    );
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

  it("reports success when only the marker write fails after the delete", async () => {
    // The branch IS gone, which is what this reports. The stale marker is
    // re-read by the next sweep, whose 404 clears it — so calling this a failed
    // cleanup would warn the user about a leak that doesn't exist.
    mocks.where.mockRejectedValue(new Error("database is locked"));

    await expect(
      deleteTempTestBranch(makeApp({ neonTestBranchId: "test-br" })),
    ).resolves.toBe(true);
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith("proj-1", "test-br");
  });

  it("strips a cleanup-only marker before calling Neon", async () => {
    await deleteTempTestBranch(
      makeApp({ neonTestBranchId: "dyad-cleanup-only:v1:test-br" }),
    );
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith("proj-1", "test-br");
    expect(mocks.set).toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("is a no-op when no test branch is set", async () => {
    await deleteTempTestBranch(makeApp({ neonTestBranchId: null }));
    expect(mocks.deleteProjectBranch).not.toHaveBeenCalled();
  });

  it("reports failure when a branch is tracked but the project is not", async () => {
    // Neon was unlinked after the branch was created, so nothing here can
    // address it. Answering "true" would tell app deletion the branch was
    // cleaned up, and it would drop the row that is the last record of it.
    await expect(
      deleteTempTestBranch(
        makeApp({ neonTestBranchId: "test-br", neonProjectId: null }),
      ),
    ).resolves.toBe(false);
    expect(mocks.deleteProjectBranch).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalledWith({ neonTestBranchId: null });
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

  it("reports whether the branch is actually gone", async () => {
    // The delete is best-effort and resolves either way, so a caller that can't
    // rely on the startup sweep to retry — app deletion removes the row the
    // sweep reads — has no other way to tell a leak from a clean teardown.
    await expect(
      deleteTempTestBranch(makeApp({ neonTestBranchId: "test-br" })),
    ).resolves.toBe(true);
    await expect(
      deleteTempTestBranch(makeApp({ neonTestBranchId: null })),
    ).resolves.toBe(true);

    mocks.deleteProjectBranch.mockRejectedValueOnce({
      response: { status: 500 },
    });
    await expect(
      deleteTempTestBranch(makeApp({ neonTestBranchId: "test-br" })),
    ).resolves.toBe(false);
  });
});

// The mark-then-delete tail both the isolation teardown and the recovery path
// run. Shared so the marker scheme and — more importantly — the ordering it
// depends on are written down once.
describe("markAndDeleteTempTestBranch", () => {
  it("persists the cleanup-only marker before deleting the branch", async () => {
    // Ordering is the point: a crash between the two must leave a row saying
    // the env is real and only the remote branch is outstanding, so a later Run
    // proceeds while the startup sweep keeps retrying cleanup.
    await markAndDeleteTempTestBranch(
      makeApp({ neonTestBranchId: "test-br" }),
      "test-br",
    );
    expect(mocks.set).toHaveBeenCalledWith({
      neonTestBranchId: "dyad-cleanup-only:v1:test-br",
    });
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith("proj-1", "test-br");
    const markedAt = mocks.set.mock.invocationCallOrder[0];
    const deletedAt = mocks.deleteProjectBranch.mock.invocationCallOrder[0];
    expect(markedAt).toBeLessThan(deletedAt);
  });

  it("still deletes with the raw id when persisting the marker fails", async () => {
    // A transient SQLite failure must not turn best-effort cleanup into a
    // guaranteed Neon leak.
    mocks.where.mockRejectedValueOnce(new Error("sqlite busy"));
    await markAndDeleteTempTestBranch(
      makeApp({ neonTestBranchId: "test-br" }),
      "test-br",
    );
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith("proj-1", "test-br");
  });

  it("reports the failure without throwing when the remote delete fails", async () => {
    // Callers promise the user "Dyad will retry remote cleanup on next
    // startup", so they need the verdict — but a teardown must never throw.
    mocks.deleteProjectBranch.mockRejectedValueOnce({
      response: { status: 500 },
    });
    await expect(
      markAndDeleteTempTestBranch(
        makeApp({ neonTestBranchId: "test-br" }),
        "test-br",
      ),
    ).resolves.toBe(false);
  });

  it("reports success when the branch is gone", async () => {
    await expect(
      markAndDeleteTempTestBranch(
        makeApp({ neonTestBranchId: "test-br" }),
        "test-br",
      ),
    ).resolves.toBe(true);
  });
});

describe("restoreAppFromTestBranch", () => {
  it("re-reads the app path and provider after coordinator admission", async () => {
    const stale = makeApp({
      path: "/apps/old",
      neonProjectId: "old-project",
      neonActiveBranchId: "old-real-branch",
      neonTestBranchId: "old-test-branch",
    });
    makeApp({
      path: "/apps/moved",
      neonProjectId: "current-project",
      neonActiveBranchId: "current-real-branch",
      neonTestBranchId: "current-test-branch",
    });

    await expect(restoreAppFromTestBranch(stale)).resolves.toBe(true);

    expect(mocks.getConnectionUri).toHaveBeenCalledWith({
      projectId: "current-project",
      branchId: "current-real-branch",
    });
    expect(mocks.updateNeonEnvVars).toHaveBeenCalledWith(
      expect.objectContaining({ appPath: "/apps/moved" }),
    );
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "current-project",
      "current-test-branch",
    );
  });

  it("persists cleanup-only state before a fallible branch delete", async () => {
    mocks.deleteProjectBranch.mockRejectedValueOnce({
      response: { status: 500 },
    });

    await expect(
      restoreAppFromTestBranch(
        makeApp({
          neonTestBranchId: "leaked-br",
        }),
      ),
    ).resolves.toBe(true);

    expect(isTestBranchCleanupOnly("dyad-cleanup-only:v1:leaked-br")).toBe(
      true,
    );
    expect(mocks.set).toHaveBeenCalledWith({
      neonTestBranchId: "dyad-cleanup-only:v1:leaked-br",
    });
    expect(mocks.set).not.toHaveBeenCalledWith({ neonTestBranchId: null });
  });

  it("does not rewrite env for cleanup-only residue", async () => {
    await expect(
      restoreAppFromTestBranch(
        makeApp({
          neonTestBranchId: "dyad-cleanup-only:v1:leaked-br",
        }),
      ),
    ).resolves.toBe(true);

    expect(mocks.updateNeonEnvVars).not.toHaveBeenCalled();
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-br",
    );
  });

  it("reports the env restored when branch cleanup persistence fails", async () => {
    // The Neon API helper already absorbs API failures. Exercise the remaining
    // throw path: Neon deleted the branch, but clearing its durable row marker
    // failed. The env is still real and relaunch is safe.
    mocks.where.mockRejectedValueOnce(new Error("db down"));

    await expect(
      restoreAppFromTestBranch(
        makeApp({
          neonTestBranchId: "leaked-br",
        }),
      ),
    ).resolves.toBe(true);

    expect(mocks.updateNeonEnvVars).toHaveBeenCalled();
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "leaked-br",
    );
    expect(mocks.set).toHaveBeenCalledWith({ neonTestBranchId: null });
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

  it("continues reconciling other apps when one app rejects admission", async () => {
    mocks.selectWhere.mockResolvedValue([
      makeApp({ id: 7, neonTestBranchId: "blocked-branch" }),
      makeApp({ id: 8, path: "/apps/8", neonTestBranchId: "next-branch" }),
    ]);
    const deletion = appOperationCoordinator.beginAppDeletion(7);
    try {
      await reconcileOrphanTestBranches();
    } finally {
      deletion.release();
    }

    expect(mocks.deleteProjectBranch).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProjectBranch).toHaveBeenCalledWith(
      "proj-1",
      "next-branch",
    );
  });
});
