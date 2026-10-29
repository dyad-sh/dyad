// Database reverts must not leak Neon backup branches (dyad-sh/dyad#4943).
//
// Drives the real revert, create-project, and development-branch status and
// migrate handlers (sqlite, git, .env.local)
// against FakeNeonBranchApi, which models the Neon branch-tree behaviour
// verified on the live API. SQL against branch databases is stubbed here; the
// live counterpart, neon_revert.live.integration.test.tsx, covers it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  FakeNeonBranchApi,
  type FakeBranch,
} from "@/testing/fake_neon_branch_api";
import { CopyVerificationError } from "@/ipc/utils/neon_branch_data";

let fakeNeon = new FakeNeonBranchApi();

vi.mock("@/neon_admin/neon_management_client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/neon_admin/neon_management_client")
  >()),
  getNeonClient: async () => fakeNeon.client(),
  getNeonOrganizationId: async () => "fake-org",
}));

const branchData = vi.hoisted(() => ({
  prepareSchemaOnlyBranchForNeonAuth: vi.fn(async (_uri: string) => {}),
  listForeignKeys: vi.fn(async (_uri: string) => []),
  exportBranchDataAsSql: vi.fn(
    async (_args: { sourceUri: string; filePath: string; title: string }) => ({
      tables: 2,
      rows: 5,
    }),
  ),
  findMigrationBlockers: vi.fn(
    async (
      _uri: string,
      _options: { neonAuth: boolean },
    ): Promise<string[]> => [],
  ),
  copyBranchData: vi.fn(
    async (_args: { sourceUri: string; targetUri: string }) => ({
      tables: 2,
      rows: 5,
    }),
  ),
}));
vi.mock("@/ipc/utils/neon_branch_data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/neon_branch_data")>()),
  ...branchData,
}));

const telemetry = vi.hoisted(() => ({ sendTelemetryEvent: vi.fn() }));
vi.mock("@/ipc/utils/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/telemetry")>()),
  sendTelemetryEvent: telemetry.sendTelemetryEvent,
}));

// Reading the database clock needs a real Postgres connection.
const DB_NOW = vi.hoisted(() => "2026-10-05T00:00:00Z");
vi.mock("@/ipc/utils/neon_timestamp_utils", () => ({
  storeDbTimestampAtCurrentVersion: vi.fn(async () => ({ timestamp: DB_NOW })),
  getPreciseNeonTimestamp: vi.fn(async () => DB_NOW),
}));

import { apps, chats, versions } from "@/db/schema";
import { ipc } from "@/ipc/types";
import {
  settleNeonBackupCleanups,
  versionPreviewHandlerService,
} from "@/ipc/handlers/version_handlers";
import { detachWait } from "@/ipc/utils/neon_dev_branch";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const LEGACY_BACKUP = (n: number) =>
  `preserve_${"ab".repeat(20)}-170000000000${n}`;

describe("Neon database revert (integration)", () => {
  let harness: HybridChatHarness;
  let appsRoot: string;
  let appCounter = 0;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
  }, 60_000);

  beforeEach(() => {
    fakeNeon = new FakeNeonBranchApi();
    vi.clearAllMocks();
    detachWait.pollIntervalMs = 10;
    detachWait.timeoutMs = 5_000;
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  function git(appDir: string, ...args: string[]) {
    return execFileSync("git", args, { cwd: appDir, encoding: "utf8" }).trim();
  }

  function commit(appDir: string, label: string): string {
    fs.writeFileSync(path.join(appDir, "version.txt"), `${label}\n`);
    git(appDir, "add", "-A");
    git(appDir, "commit", "-q", "-m", label);
    return git(appDir, "rev-parse", "HEAD");
  }

  async function createGitApp() {
    appCounter += 1;
    const name = `neon-revert-${appCounter}`;
    const appDir = path.join(appsRoot, name);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({ name, dependencies: { next: "^15.0.0" } }),
    );
    fs.writeFileSync(path.join(appDir, ".gitignore"), ".env*\n");
    git(appDir, "init", "-q", "-b", "main");
    git(appDir, "config", "user.email", "test@example.com");
    git(appDir, "config", "user.name", "Test");
    commit(appDir, "initial");
    const [row] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: row.id });
    return { appId: row.id, appDir };
  }

  /**
   * An app connected to `fakeNeon`, with a database snapshot recorded for
   * version A and a later version B checked out.
   */
  async function connectApp() {
    const { appId, appDir } = await createGitApp();
    const development = fakeNeon.byName("development");
    const preview = fakeNeon.byName("preview");
    fs.writeFileSync(
      path.join(appDir, ".env.local"),
      `DATABASE_URL=${fakeNeon.connectionUri(development.id)}\nNEON_AUTH_BASE_URL=${fakeNeon.authBaseUrl(development.id)}\n`,
    );
    await harness.db
      .update(apps)
      .set({
        neonProjectId: fakeNeon.projectId,
        neonDevelopmentBranchId: development.id,
        neonPreviewBranchId: preview.id,
        neonActiveBranchId: development.id,
      })
      .where(eq(apps.id, appId));
    const versionA = commit(appDir, "A");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionA,
      neonDbTimestamp: "2026-10-01T00:00:00Z",
    });
    const versionB = commit(appDir, "B");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionB,
      neonDbTimestamp: "2026-10-02T00:00:00Z",
    });
    return { appId, appDir, versionA, versionB, development, preview };
  }

  /** The layout Dyad creates today: development is a root branch. */
  function rootLayout() {
    fakeNeon.addBranch("main", { neonAuth: true });
    fakeNeon.addBranch("development", {
      parent: "main",
      schemaOnly: true,
      neonAuth: true,
    });
    fakeNeon.addBranch("preview", { parent: "development", neonAuth: true });
  }

  /**
   * The layout Dyad created before the fix, after `legacyReverts` database
   * reverts: each one left a backup that took over as development's parent.
   */
  async function legacyLayout(legacyReverts: number) {
    fakeNeon.addBranch("main", { neonAuth: true });
    const development = fakeNeon.addBranch("development", {
      parent: "main",
      neonAuth: true,
    });
    fakeNeon.addBranch("preview", { parent: "development", neonAuth: true });
    for (let i = 1; i <= legacyReverts; i++) {
      await fakeNeon
        .client()
        .restoreProjectBranch(fakeNeon.projectId, development.id, {
          source_branch_id: development.id,
          source_timestamp: "2026-09-01T00:00:00Z",
          preserve_under_name: LEGACY_BACKUP(i),
        });
    }
  }

  async function revert(appId: number, previousVersionId: string) {
    const result = await versionPreviewHandlerService.revertVersion({
      appId,
      previousVersionId,
    });
    // The backup cleanup runs in the background once the revert is done.
    await settleNeonBackupCleanups();
    return result.notification;
  }

  async function appRow(appId: number) {
    const row = await harness.db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });
    if (!row) throw new Error(`app ${appId} missing`);
    return row;
  }

  it("deletes the backup once Neon detaches the restored root branch", async () => {
    rootLayout();
    fakeNeon.detachAfterPolls = 1;
    const { appId, versionA, development } = await connectApp();

    const notification = await revert(appId, versionA);

    expect(notification).toEqual({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    expect(fakeNeon.methodCalls("restoreProjectBranch")).toEqual([
      [
        fakeNeon.projectId,
        development.id,
        expect.objectContaining({
          source_branch_id: development.id,
          source_timestamp: "2026-10-01T00:00:00Z",
        }),
      ],
    ]);
    // The backup was deleted on the first try, after the detach.
    expect(fakeNeon.methodCalls("deleteProjectBranch")).toHaveLength(1);
    expect((await appRow(appId)).neonDevelopmentBranchId).toBe(development.id);
  });

  it("deletes a backup an earlier revert could not clean up", async () => {
    rootLayout();
    fakeNeon.addBranch("preserve_0123abcd-1700000000000");
    const { appId, versionA } = await connectApp();

    await revert(appId, versionA);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("keeps the backup for the next revert when Neon has not detached the branch yet", async () => {
    rootLayout();
    fakeNeon.detachAfterPolls = Number.POSITIVE_INFINITY;
    detachWait.timeoutMs = 0;
    const { appId, appDir, versionA } = await connectApp();

    expect(await revert(appId, versionA)).toMatchObject({ kind: "success" });
    const backups = () =>
      Object.keys(fakeNeon.tree()).filter((n) => n.startsWith("preserve_"));
    expect(backups()).toHaveLength(1);

    // Neon detaches it later; the next revert deletes the leftover.
    fakeNeon.finishDetach();
    fakeNeon.detachAfterPolls = 0;
    const versionC = commit(appDir, "C");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionC,
      neonDbTimestamp: "2026-10-03T00:00:00Z",
    });
    commit(appDir, "D");
    await revert(appId, versionC);
    expect(backups()).toEqual([]);
  });

  async function migrate(appId: number) {
    return ipc.neon.migrateDevelopmentBranch({ appId });
  }

  async function status(appId: number) {
    return ipc.neon.getDevelopmentBranchStatus({ appId });
  }

  it("reports apps on the old layout, with their leaked backups", async () => {
    await legacyLayout(3);
    const { appId } = await connectApp();

    expect(await status(appId)).toEqual({
      needsMigration: true,
      otherApps: [],
      appsDeployingWithDevelopment: [],
      leakedBackups: 3,
      branchCount: 6,
    });
  });

  it("reports old-layout apps that have not leaked a backup yet", async () => {
    await legacyLayout(0);
    const { appId } = await connectApp();

    expect(await status(appId)).toEqual({
      needsMigration: true,
      otherApps: [],
      appsDeployingWithDevelopment: [],
      leakedBackups: 0,
      branchCount: 3,
    });
  });

  it("does not migrate an app that deploys with its development database", async () => {
    await legacyLayout(2);
    const { appId, development } = await connectApp();
    await harness.db
      .update(apps)
      .set({ selectedDatabaseBranchType: "development" })
      .where(eq(apps.id, appId));
    const treeBefore = fakeNeon.tree();

    expect(await status(appId)).toMatchObject({
      needsMigration: true,
      appsDeployingWithDevelopment: [
        { id: appId, name: (await appRow(appId)).name },
      ],
    });
    await expect(migrate(appId)).rejects.toThrow(
      /deploys with it\. Deploy with your production database first/,
    );
    expect(fakeNeon.tree()).toEqual(treeBefore);
    expect((await appRow(appId)).neonDevelopmentBranchId).toBe(development.id);
  });

  it("moves every app on a shared development branch", async () => {
    await legacyLayout(2);
    const first = await connectApp();
    const second = await connectApp();
    const secondName = (await appRow(second.appId)).name;

    expect(await status(first.appId)).toMatchObject({
      needsMigration: true,
      otherApps: [{ id: second.appId, name: secondName }],
      appsDeployingWithDevelopment: [],
    });
    await migrate(first.appId);

    const newDevelopment = fakeNeon.byName("development");
    const newPreview = fakeNeon.byName("preview");
    for (const { appId, appDir } of [first, second]) {
      expect(await appRow(appId)).toMatchObject({
        neonDevelopmentBranchId: newDevelopment.id,
        neonPreviewBranchId: newPreview.id,
        neonActiveBranchId: newDevelopment.id,
      });
      expect(
        fs.readFileSync(path.join(appDir, ".env.local"), "utf8"),
      ).toContain(fakeNeon.connectionUri(newDevelopment.id));
    }
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("refuses to migrate a shared branch that another app deploys with", async () => {
    await legacyLayout(1);
    const first = await connectApp();
    const second = await connectApp();
    const secondName = (await appRow(second.appId)).name;
    await harness.db
      .update(apps)
      .set({ selectedDatabaseBranchType: "development" })
      .where(eq(apps.id, second.appId));
    const treeBefore = fakeNeon.tree();

    expect((await status(first.appId)).appsDeployingWithDevelopment).toEqual([
      { id: second.appId, name: secondName },
    ]);
    await expect(migrate(first.appId)).rejects.toThrow(
      new RegExp(`while ${secondName} deploys with it`),
    );
    expect(fakeNeon.tree()).toEqual(treeBefore);
  });

  it("reports a restore as done when only its backup cleanup fails", async () => {
    rootLayout();
    const { appId, versionA, versionB } = await connectApp();
    fakeNeon.failures.getProjectBranch = () => {
      throw new Error("network down");
    };

    expect(await revert(appId, versionA)).toEqual({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });
    // Newer restore points were cleared as for any restore.
    const rows = await harness.db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });
    expect(
      Object.fromEntries(rows.map((r) => [r.commitHash, r.neonDbTimestamp])),
    ).toMatchObject({ [versionA]: "2026-10-01T00:00:00Z", [versionB]: null });
  });

  it("undoes the branch swap when switching the apps over fails", async () => {
    await legacyLayout(1);
    const { appId, development, preview } = await connectApp();
    // SQLite rejects the app-row update, as it would when busy or full.
    harness.db.run(
      sql.raw(
        "CREATE TEMP TRIGGER fail_switch BEFORE UPDATE OF neon_development_branch_id ON apps BEGIN SELECT RAISE(ABORT, 'database is locked'); END",
      ),
    );
    try {
      await expect(migrate(appId)).rejects.toThrow(/database is locked/);
    } finally {
      harness.db.run(sql.raw("DROP TRIGGER fail_switch"));
    }

    // The old branch has its name back and the unfinished one is gone.
    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(
      [...fakeNeon.branches.values()].filter((b) => !b.parent_id),
    ).toHaveLength(1);
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: development.id,
      neonPreviewBranchId: preview.id,
    });
  });

  it("keeps a preview branch that lives outside the old tree", async () => {
    // A linked project whose preview branch hangs off main.
    fakeNeon.addBranch("main", { neonAuth: true });
    fakeNeon.addBranch("development", { parent: "main", neonAuth: true });
    fakeNeon.addBranch("preview", { parent: "main", neonAuth: true });
    const { appId, preview } = await connectApp();

    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "main",
    });
    expect(fakeNeon.byName("preview").id).toBe(preview.id);
    expect((await appRow(appId)).neonPreviewBranchId).toBe(preview.id);
  });

  it("carries the Neon Auth settings over to the new branch", async () => {
    await legacyLayout(1);
    const old = fakeNeon.byName("development");
    old.auth.email.require_email_verification = true;
    old.auth.trustedDomains.push("https://myapp.example.com");
    old.auth.providers.push(
      {
        id: "google",
        type: "standard",
        client_id: "g-id",
        client_secret: "g-secret",
      },
      // Neon did not return this one's secret, so it cannot be copied.
      { id: "github", type: "standard", client_id: "gh-id" },
    );
    const { appId } = await connectApp();

    const result = await migrate(appId);

    const auth = fakeNeon.byName("development").auth;
    expect(auth.email.require_email_verification).toBe(true);
    expect(auth.trustedDomains).toContain("https://myapp.example.com");
    expect(auth.providers).toContainEqual(
      expect.objectContaining({
        id: "google",
        client_id: "g-id",
        client_secret: "g-secret",
      }),
    );
    expect(auth.providers.some((p) => p.id === "github")).toBe(false);
    expect(result.warning).toMatch(
      /could not be copied to the new branch: github sign-in/,
    );
  });

  it("reports nothing to migrate for root development branches", async () => {
    rootLayout();
    const { appId } = await connectApp();

    expect(await status(appId)).toMatchObject({ needsMigration: false });
  });

  it("undo on an old-layout app restores in place and does not migrate", async () => {
    await legacyLayout(1);
    const { appId, versionA, development } = await connectApp();

    expect(await revert(appId, versionA)).toEqual({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });
    // One more backup, as before the fix; the banner still offers the move.
    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(
      Object.keys(fakeNeon.tree()).filter((n) => n.startsWith("preserve_")),
    ).toHaveLength(2);
    expect(branchData.copyBranchData).not.toHaveBeenCalled();
    expect((await status(appId)).needsMigration).toBe(true);
  });

  it("migrates an old-layout app to a root branch and deletes the old tree", async () => {
    await legacyLayout(3);
    // A test branch left behind by a crashed run. A later revert moved it
    // under a backup along with development's other children.
    fakeNeon.addBranch("dyad-test-1-1700000000000", {
      parent: LEGACY_BACKUP(2),
    });
    // The first backup took preview; each later one took only development.
    expect(fakeNeon.tree()).toMatchObject({
      development: LEGACY_BACKUP(3),
      preview: LEGACY_BACKUP(1),
      [LEGACY_BACKUP(3)]: LEGACY_BACKUP(2),
      [LEGACY_BACKUP(1)]: "main",
    });
    const {
      appId,
      appDir,
      development: oldDevelopment,
      preview: oldPreview,
    } = await connectApp();

    const result = await migrate(appId);
    expect(result).toEqual({
      success: true,
      backupPath: expect.stringMatching(/neon-backups[\\/].+\.sql$/),
    });
    // The backup is taken from the same data the new branch gets, first.
    expect(branchData.exportBranchDataAsSql).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUri: fakeNeon.connectionUri(oldPreview.id),
        filePath: result.backupPath,
      }),
    );
    expect(
      branchData.exportBranchDataAsSql.mock.invocationCallOrder[0],
    ).toBeLessThan(branchData.copyBranchData.mock.invocationCallOrder[0]);
    expect(result.backupPath).not.toContain(appDir);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    const newDevelopment = fakeNeon.byName("development");
    const newPreview = fakeNeon.byName("preview");
    expect(newDevelopment.id).not.toBe(oldDevelopment.id);
    expect(newDevelopment.init_source).toBe("parent-schema");
    expect(newDevelopment.neonAuth).toBe(true);
    expect(newPreview.id).not.toBe(oldPreview.id);

    // The new branch got the database as it is now (the database clock).
    expect(
      fakeNeon
        .methodCalls("createProjectBranch")
        .map(([, body]) => (body as any).branch),
    ).toContainEqual(
      expect.objectContaining({
        parent_id: oldDevelopment.id,
        parent_timestamp: DB_NOW,
        init_source: "schema-only",
      }),
    );
    expect(branchData.prepareSchemaOnlyBranchForNeonAuth).toHaveBeenCalledWith(
      fakeNeon.connectionUri(newDevelopment.id),
    );
    expect(branchData.copyBranchData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUri: fakeNeon.connectionUri(oldPreview.id),
        targetUri: fakeNeon.connectionUri(newDevelopment.id),
      }),
    );
    expect(fakeNeon.methodCalls("restoreProjectBranch").at(-1)).toEqual([
      fakeNeon.projectId,
      oldPreview.id,
      { source_branch_id: oldDevelopment.id, source_timestamp: DB_NOW },
    ]);

    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: newDevelopment.id,
      neonPreviewBranchId: newPreview.id,
      neonActiveBranchId: newDevelopment.id,
    });
    const env = fs.readFileSync(path.join(appDir, ".env.local"), "utf8");
    expect(env).toContain(fakeNeon.connectionUri(newDevelopment.id));
    expect(env).toContain(fakeNeon.authBaseUrl(newDevelopment.id));
    expect(env).not.toContain(oldDevelopment.id);
    // Restore points before the move pointed into the deleted branches.
    const rows = await harness.db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });
    expect(rows.map((r) => r.neonDbTimestamp)).toEqual([null, null]);
    expect((await status(appId)).needsMigration).toBe(false);

    // Undo now takes the root path and leaves no backup.
    const versionC = commit(appDir, "C");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionC,
      neonDbTimestamp: "2026-10-06T00:00:00Z",
    });
    commit(appDir, "D");
    expect(await revert(appId, versionC)).toEqual({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("deletes test branches left under the old preview and reads through it", async () => {
    await legacyLayout(1);
    fakeNeon.addBranch("dyad-test-1-1700000000000", { parent: "preview" });
    const { appId, preview: oldPreview } = await connectApp();

    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    expect(branchData.copyBranchData.mock.calls[0][0].sourceUri).toBe(
      fakeNeon.connectionUri(oldPreview.id),
    );
  });

  it("reads through a temporary branch when the app has no preview branch", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    fakeNeon.branches.delete(fakeNeon.byName("preview").id);
    await harness.db
      .update(apps)
      .set({ neonPreviewBranchId: null })
      .where(eq(apps.id, appId));

    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({ development: null, main: null });
    const source = fakeNeon
      .methodCalls("createProjectBranch")
      .map(([, body]) => (body as any).branch)
      .find((branch) => branch.name.startsWith("dyad-restore-source-"));
    expect(source).toMatchObject({
      parent_id: oldDevelopment.id,
      parent_timestamp: DB_NOW,
    });
    expect(branchData.copyBranchData.mock.calls[0][0].sourceUri).toContain(
      "br-dyad-restore-source-",
    );
    expect((await appRow(appId)).neonPreviewBranchId).toBeNull();
  });

  it("migrates past a source branch an interrupted attempt left behind", async () => {
    await legacyLayout(1);
    fakeNeon.addBranch("dyad-restore-source-1700000000000", {
      parent: "development",
    });
    const { appId } = await connectApp();

    expect((await status(appId)).needsMigration).toBe(true);
    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("finishes deleting an old tree a migration could not fully delete", async () => {
    rootLayout();
    // Left by a migration whose final cleanup failed: the replaced branch
    // under the backups it used to sit on.
    fakeNeon.addBranch(LEGACY_BACKUP(1), { parent: "main" });
    fakeNeon.addBranch(LEGACY_BACKUP(2), { parent: LEGACY_BACKUP(1) });
    fakeNeon.addBranch("development-replaced-1700000000000", {
      parent: LEGACY_BACKUP(2),
    });
    const { appId, versionA } = await connectApp();

    await revert(appId, versionA);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("returns from an undo before Neon detaches, and cleans up afterwards", async () => {
    rootLayout();
    fakeNeon.detachAfterPolls = Number.POSITIVE_INFINITY;
    const { appId, versionA } = await connectApp();

    const result = await versionPreviewHandlerService.revertVersion({
      appId,
      previousVersionId: versionA,
    });

    expect(result.notification).toEqual({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });
    // Still attached to its backup: an old-layout check must not be fooled.
    expect(fakeNeon.tree().development).toMatch(/^preserve_/);
    expect((await status(appId)).needsMigration).toBe(false);

    fakeNeon.finishDetach();
    await settleNeonBackupCleanups();
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("lets a second undo run while the first one's backup waits for its detach", async () => {
    rootLayout();
    fakeNeon.detachAfterPolls = Number.POSITIVE_INFINITY;
    const { appId, appDir, versionA } = await connectApp();
    await versionPreviewHandlerService.revertVersion({
      appId,
      previousVersionId: versionA,
    });
    const versionC = commit(appDir, "C");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionC,
      neonDbTimestamp: "2026-10-03T00:00:00Z",
    });
    commit(appDir, "D");

    // The first cleanup is still waiting (up to detachWait.timeoutMs); the
    // second undo must not queue behind it.
    const second = versionPreviewHandlerService.revertVersion({
      appId,
      previousVersionId: versionC,
    });
    const outcome = await Promise.race([
      second.then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
    ]);
    expect(outcome).toBe("done");

    fakeNeon.finishDetach();
    await settleNeonBackupCleanups();
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("never sweeps away a branch a Dyad app still uses", async () => {
    rootLayout();
    // Looks like a leftover by name, but another app runs on it: what a
    // migration interrupted after renaming its old branch leaves behind.
    const replaced = fakeNeon.addBranch("development-replaced-1700000000000", {
      parent: "main",
    });
    const { appId, versionA } = await connectApp();
    const { appId: otherAppId } = await createGitApp();
    await harness.db
      .update(apps)
      .set({
        neonProjectId: fakeNeon.projectId,
        neonDevelopmentBranchId: replaced.id,
      })
      .where(eq(apps.id, otherAppId));

    await revert(appId, versionA);

    expect(fakeNeon.branches.has(replaced.id)).toBe(true);
    expect(
      Object.keys(fakeNeon.tree()).filter((n) => n.startsWith("preserve_")),
    ).toEqual([]);
  });

  /**
   * The state a crash leaves between renaming the old development branch and
   * switching the apps: the old branch renamed (the apps still use it by id)
   * and the unfinished new branch holding the development name.
   */
  function interruptAfterRenames(oldDevelopment: FakeBranch) {
    const stamp = Date.now() - 1000;
    oldDevelopment.name = `development-replaced-${stamp}`;
    const unfinished = fakeNeon.addBranch("development", {
      parent: "main",
      schemaOnly: true,
      neonAuth: true,
    });
    return { stamp, unfinished };
  }

  function pointEnvAt(appDir: string, branchId: string) {
    fs.writeFileSync(
      path.join(appDir, ".env.local"),
      `DATABASE_URL=${fakeNeon.connectionUri(branchId)}\n`,
    );
  }

  it("rolls back an interrupted migration when no app moved to the new branch", async () => {
    await legacyLayout(2);
    const {
      appId,
      development: oldDevelopment,
      preview: oldPreview,
    } = await connectApp();
    const { unfinished } = interruptAfterRenames(oldDevelopment);

    await migrate(appId);

    // The unfinished branch is gone and the migration ran anew from the old
    // branch's data.
    expect(fakeNeon.branches.has(unfinished.id)).toBe(false);
    expect(branchData.copyBranchData.mock.calls[0][0].sourceUri).toBe(
      fakeNeon.connectionUri(oldPreview.id),
    );
    expect(
      fakeNeon
        .methodCalls("createProjectBranch")
        .map(([, body]) => (body as any).branch)
        .find((b) => b.init_source === "schema-only"),
    ).toMatchObject({ parent_id: oldDevelopment.id });
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      repair: "rolled-back",
    });
  });

  it("finishes an interrupted migration when the apps moved to the new branch", async () => {
    await legacyLayout(2);
    const { appId, appDir, development: oldDevelopment } = await connectApp();
    const { unfinished } = interruptAfterRenames(oldDevelopment);
    // The crash came after .env.local was rewritten, so the app has been
    // writing to the new branch since.
    pointEnvAt(appDir, unfinished.id);

    const result = await migrate(appId);

    // That branch is kept and finished, not copied again.
    expect(branchData.copyBranchData).not.toHaveBeenCalled();
    expect(branchData.exportBranchDataAsSql).not.toHaveBeenCalled();
    expect(result.backupPath).toBeUndefined();
    expect(fakeNeon.byName("development").id).toBe(unfinished.id);
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: unfinished.id,
      neonActiveBranchId: unfinished.id,
      neonPreviewBranchId: fakeNeon.byName("preview").id,
    });
    expect(fs.readFileSync(path.join(appDir, ".env.local"), "utf8")).toContain(
      fakeNeon.connectionUri(unfinished.id),
    );
    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      repair: "rolled-forward",
    });
  });

  it("refuses when an interrupted migration left apps on both branches", async () => {
    await legacyLayout(1);
    const first = await connectApp();
    const second = await connectApp();
    const { unfinished } = interruptAfterRenames(first.development);
    pointEnvAt(first.appDir, unfinished.id);
    const treeBefore = fakeNeon.tree();

    await expect(migrate(first.appId)).rejects.toThrow(
      /left .+ on the new branch and other apps on the old one/,
    );

    expect(fakeNeon.tree()).toEqual(treeBefore);
    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "refused",
      reason: "interrupted-migration",
    });
    void second;
  });

  it("refuses to delete a development branch an interrupted migration didn't create", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    oldDevelopment.name = `development-replaced-${Date.now() - 1000}`;
    // Created by the user after the crash: a child branch, not schema-only.
    const userBranch = fakeNeon.addBranch("development", { parent: "main" });
    const treeBefore = fakeNeon.tree();

    await expect(migrate(appId)).rejects.toThrow(
      /isn't the one an interrupted migration created/,
    );

    expect(fakeNeon.branches.has(userBranch.id)).toBe(true);
    expect(fakeNeon.tree()).toEqual(treeBefore);
  });

  it("recognises its unfinished branch when the computer's clock runs fast", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    const { unfinished } = interruptAfterRenames(oldDevelopment);
    // The local clock was 30 minutes ahead when the migration recorded its
    // start, so Neon's creation time looks earlier than the start.
    oldDevelopment.name = `development-replaced-${Date.now() + 30 * 60_000}`;

    await migrate(appId);

    expect(fakeNeon.branches.has(unfinished.id)).toBe(false);
    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      repair: "rolled-back",
    });
  });

  it("does not treat a branch from long before the migration as its unfinished one", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    const { unfinished } = interruptAfterRenames(oldDevelopment);
    // Everything else matches; only the creation time is two hours early.
    unfinished.created_at = new Date(
      Date.now() - 2 * 60 * 60_000,
    ).toISOString();

    await expect(migrate(appId)).rejects.toThrow(
      /isn't the one an interrupted migration created/,
    );
    expect(fakeNeon.branches.has(unfinished.id)).toBe(true);
  });

  it("rolls back a migration interrupted right after the first rename", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    const stamp = Date.now() - 1000;
    oldDevelopment.name = `development-replaced-${stamp}`;
    const unfinished = fakeNeon.addBranch(`dyad-migrating-${stamp}`, {
      parent: "main",
      schemaOnly: true,
    });

    await migrate(appId);

    expect(fakeNeon.branches.has(unfinished.id)).toBe(false);
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("finishes a repair that was itself interrupted", async () => {
    await legacyLayout(1);
    const { appId, development: oldDevelopment } = await connectApp();
    // The unfinished branch was already deleted, but the old branch never got
    // its name back.
    oldDevelopment.name = `development-replaced-${Date.now() - 1000}`;

    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      repair: "rolled-back",
    });
  });

  it("refuses to migrate when the copy would lose objects", async () => {
    await legacyLayout(1);
    branchData.findMigrationBlockers.mockResolvedValueOnce([
      "the view public.member_emails (it uses Neon Auth's tables)",
    ]);
    const { appId } = await connectApp();
    const treeBefore = fakeNeon.tree();

    await expect(migrate(appId)).rejects.toThrow(
      /would lose the view public\.member_emails/,
    );
    expect(fakeNeon.tree()).toEqual(treeBefore);
    expect(branchData.findMigrationBlockers).toHaveBeenCalledWith(
      fakeNeon.connectionUri(fakeNeon.byName("development").id),
      { neonAuth: true },
    );
  });

  it("refuses to migrate while an earlier version is being previewed", async () => {
    await legacyLayout(1);
    const { appId, appDir, versionA } = await connectApp();
    git(appDir, "checkout", "-q", versionA);
    const treeBefore = fakeNeon.tree();

    await expect(migrate(appId)).rejects.toThrow(/showing an earlier version/);
    expect(fakeNeon.tree()).toEqual(treeBefore);
  });

  it("puts everything back when the apps' .env.local cannot be updated", async () => {
    await legacyLayout(1);
    const { appId, appDir, development, preview } = await connectApp();
    const envBefore = fs.readFileSync(path.join(appDir, ".env.local"), "utf8");
    // Connection strings for the new (schema-only) branch cannot be fetched.
    fakeNeon.failures.getConnectionUri = (params: { branch_id: string }) => {
      if (
        fakeNeon.branches.get(params.branch_id)?.init_source === "parent-schema"
      ) {
        throw new Error("Neon is unavailable");
      }
    };

    await expect(migrate(appId)).rejects.toThrow(/Neon is unavailable/);

    expect(fs.readFileSync(path.join(appDir, ".env.local"), "utf8")).toBe(
      envBefore,
    );
    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(
      [...fakeNeon.branches.values()].filter((b) => !b.parent_id),
    ).toHaveLength(1);
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: development.id,
      neonPreviewBranchId: preview.id,
    });
  });

  it("gives the development name back when the new branch cannot be deleted", async () => {
    await legacyLayout(1);
    const { appId, development } = await connectApp();
    harness.db.run(
      sql.raw(
        "CREATE TEMP TRIGGER fail_switch BEFORE UPDATE OF neon_development_branch_id ON apps BEGIN SELECT RAISE(ABORT, 'database is locked'); END",
      ),
    );
    fakeNeon.failures.deleteProjectBranch = (
      _projectId: string,
      id: string,
    ) => {
      if (fakeNeon.branches.get(id)?.init_source === "parent-schema") {
        throw new Error("Neon is unavailable");
      }
    };
    try {
      await expect(migrate(appId)).rejects.toThrow(/database is locked/);
    } finally {
      harness.db.run(sql.raw("DROP TRIGGER fail_switch"));
    }

    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(
      [...fakeNeon.branches.values()].some((b) =>
        /^dyad-migrating-\d+$/.test(b.name),
      ),
    ).toBe(true);

    // The next attempt sweeps the leftover and succeeds.
    delete fakeNeon.failures.deleteProjectBranch;
    await migrate(appId);
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("does not migrate when the backup cannot be saved", async () => {
    await legacyLayout(1);
    branchData.exportBranchDataAsSql.mockRejectedValueOnce(
      new Error("ENOSPC: no space left on device"),
    );
    const { appId, development } = await connectApp();

    await expect(migrate(appId)).rejects.toThrow(/no space left/);

    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(
      [...fakeNeon.branches.values()].filter((b) => !b.parent_id),
    ).toHaveLength(1);
    expect(branchData.copyBranchData).not.toHaveBeenCalled();
    expect((await appRow(appId)).neonDevelopmentBranchId).toBe(development.id);
  });

  it("leaves the app unchanged when the data copy fails", async () => {
    await legacyLayout(1);
    branchData.copyBranchData.mockRejectedValueOnce(new Error("copy failed"));
    const { appId, development, preview } = await connectApp();
    const treeBefore = fakeNeon.tree();

    await expect(migrate(appId)).rejects.toThrow(/copy failed/);

    // The unfinished root branch is gone and nothing else moved, except that
    // preview was restored (from development) to be read from.
    expect(fakeNeon.tree()).toEqual({ ...treeBefore, preview: "development" });
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: development.id,
      neonPreviewBranchId: preview.id,
    });
    expect((await status(appId)).needsMigration).toBe(true);
  });

  it("migrates a Free-plan project with one branch to spare", async () => {
    // main, development, preview and 6 leaked backups: 9 of 10 branches.
    await legacyLayout(6);
    fakeNeon.branchLimit = 10;
    const { appId } = await connectApp();

    await migrate(appId);

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("asks a Free-plan project at its branch limit to upgrade before migrating", async () => {
    // main, development, preview and 7 leaked backups: 10 of 10 branches.
    await legacyLayout(7);
    fakeNeon.branchLimit = 10;
    const treeBefore = fakeNeon.tree();
    const { appId, development, preview } = await connectApp();

    await expect(migrate(appId)).rejects.toThrow(
      /branch limit.*upgrade this Neon project.*switch back to the Free plan/s,
    );
    expect(telemetry.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:leaked-backups-at-branch-limit",
      { leakedBackups: 7, branchCount: 10, during: "migrate" },
    );
    // Neon rejects every restore and branch creation at the limit.
    expect(fakeNeon.tree()).toEqual(treeBefore);
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: development.id,
      neonPreviewBranchId: preview.id,
    });

    // After upgrading, migrating works.
    fakeNeon.branchLimit = 500;
    await migrate(appId);
    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
  });

  it("points undo at the branch limit to upgrading and migrating", async () => {
    await legacyLayout(7);
    fakeNeon.branchLimit = 10;
    const { appId, versionA } = await connectApp();

    const notification = await revert(appId, versionA);

    expect(notification?.kind).toBe("warning");
    expect(notification?.message).toMatch(
      /database could not be restored.*branch limit.*upgrade this Neon project.*banner above the preview/s,
    );
    expect(telemetry.sendTelemetryEvent).toHaveBeenCalledWith(
      "neon:leaked-backups-at-branch-limit",
      { leakedBackups: 7, branchCount: 10, during: "restore" },
    );
  });

  it("does not offer or allow migrating when the old tree holds a branch Dyad did not create", async () => {
    await legacyLayout(2);
    fakeNeon.addBranch("feature-x", { parent: LEGACY_BACKUP(1) });
    const { appId, development } = await connectApp();

    expect((await status(appId)).needsMigration).toBe(false);
    await expect(migrate(appId)).rejects.toThrow(/feature-x/);

    expect(fakeNeon.byName("development").id).toBe(development.id);
    expect(fakeNeon.tree()["feature-x"]).toBe(LEGACY_BACKUP(1));
    expect(fakeNeon.methodCalls("deleteProjectBranch")).toEqual([]);
  });

  function telemetryEvents(name: string) {
    return telemetry.sendTelemetryEvent.mock.calls
      .filter(([event]) => event === name)
      .map(([, properties]) => properties);
  }

  it("reports a successful migration", async () => {
    await legacyLayout(3);
    const { appId } = await connectApp();

    await migrate(appId);

    expect(telemetryEvents("neon:migration")).toEqual([
      {
        outcome: "succeeded",
        appCount: 1,
        tables: 2,
        rows: 5,
        leakedBackups: 3,
        // The old development branch, its 3 backups, and the old preview.
        branchesDeleted: 5,
        branchesNotDeleted: 0,
        cleanupFailed: false,
        repair: "none",
        settingsNotCopied: 0,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("counts every old branch a failed delete leaves behind", async () => {
    await legacyLayout(3);
    const { appId } = await connectApp();
    // The old development branch can't be deleted, so its 3 backups stay too.
    fakeNeon.failures.deleteProjectBranch = (
      _projectId: string,
      id: string,
    ) => {
      if (/-replaced-\d+$/.test(fakeNeon.branches.get(id)?.name ?? "")) {
        throw new Error("Neon is unavailable");
      }
    };

    await migrate(appId);

    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      branchesDeleted: 1, // the old preview
      branchesNotDeleted: 4,
      cleanupFailed: false,
    });
  });

  it("flags a cleanup that stopped before it could count", async () => {
    await legacyLayout(2);
    const { appId } = await connectApp();
    // Listing branches fails once the old branch has been replaced.
    fakeNeon.failures.listProjectBranches = () => {
      if (
        [...fakeNeon.branches.values()].some((b) =>
          /-replaced-\d+$/.test(b.name),
        )
      ) {
        throw new Error("Neon is unavailable");
      }
    };

    await migrate(appId);

    expect(telemetryEvents("neon:migration")[0]).toMatchObject({
      outcome: "succeeded",
      branchesDeleted: 0,
      branchesNotDeleted: 0,
      cleanupFailed: true,
    });
  });

  it("reports a refused migration with its reason", async () => {
    await legacyLayout(1);
    fakeNeon.addBranch("feature-x", { parent: LEGACY_BACKUP(1) });
    const { appId } = await connectApp();

    await expect(migrate(appId)).rejects.toThrow(/feature-x/);

    expect(telemetryEvents("neon:migration")).toEqual([
      {
        outcome: "refused",
        reason: "foreign-branches",
        appCount: 1,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("reports refusals at the branch limit and for other apps' state", async () => {
    await legacyLayout(7);
    fakeNeon.branchLimit = 10;
    const { appId, appDir, versionA } = await connectApp();

    await expect(migrate(appId)).rejects.toThrow(/branch limit/);
    git(appDir, "checkout", "-q", versionA);
    await expect(migrate(appId)).rejects.toThrow(/earlier version/);

    expect(
      telemetryEvents("neon:migration").map((e) => (e as any).reason),
    ).toEqual(["branch-limit", "version-preview"]);
  });

  it("reports a failed migration with the step it failed at", async () => {
    await legacyLayout(1);
    const { appId } = await connectApp();
    branchData.copyBranchData.mockRejectedValueOnce(
      Object.assign(new Error("server error"), { response: { status: 503 } }),
    );
    await expect(migrate(appId)).rejects.toThrow(/server error/);
    branchData.copyBranchData.mockRejectedValueOnce(
      new CopyVerificationError("Copying t produced 1 rows instead of 2"),
    );
    await expect(migrate(appId)).rejects.toThrow(/instead of 2/);
    branchData.exportBranchDataAsSql.mockRejectedValueOnce(new Error("ENOSPC"));
    await expect(migrate(appId)).rejects.toThrow(/ENOSPC/);

    expect(telemetryEvents("neon:migration")).toEqual([
      {
        outcome: "failed",
        step: "copy",
        rowCountMismatch: false,
        neonStatus: 503,
        appCount: 1,
        durationMs: expect.any(Number),
      },
      {
        outcome: "failed",
        step: "copy",
        rowCountMismatch: true,
        appCount: 1,
        durationMs: expect.any(Number),
      },
      {
        outcome: "failed",
        step: "backup",
        rowCountMismatch: false,
        appCount: 1,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("reports what became of each restore's backup", async () => {
    rootLayout();
    const { appId, appDir, versionA } = await connectApp();
    await revert(appId, versionA);

    fakeNeon.detachAfterPolls = Number.POSITIVE_INFINITY;
    detachWait.timeoutMs = 0;
    const versionC = commit(appDir, "C");
    await harness.db.insert(versions).values({
      appId,
      commitHash: versionC,
      neonDbTimestamp: "2026-10-03T00:00:00Z",
    });
    commit(appDir, "D");
    await revert(appId, versionC);

    expect(
      telemetryEvents("neon:backup-cleanup").map((e) => (e as any).outcome),
    ).toEqual(["deleted", "detach-timed-out"]);
  });

  it("creates new projects with a root development branch", async () => {
    const { appId } = await createGitApp();

    await ipc.neon.createProject({ name: "new-project", appId });

    expect(fakeNeon.tree()).toEqual({
      development: null,
      main: null,
      preview: "development",
    });
    const development = fakeNeon.byName("development");
    expect(development.init_source).toBe("parent-schema");
    expect(branchData.prepareSchemaOnlyBranchForNeonAuth).toHaveBeenCalledWith(
      fakeNeon.connectionUri(development.id),
    );
    // Neon Auth on main comes after development is created, so the
    // schema-only copy does not inherit main's neon_auth schema.
    const order = fakeNeon.calls
      .filter(
        (c) =>
          c.method === "createNeonAuth" ||
          (c.method === "createProjectBranch" &&
            (c.args[1] as any).branch.name === "development"),
      )
      .map((c) =>
        c.method === "createNeonAuth"
          ? `auth:${fakeNeon.branches.get(c.args[1] as string)?.name}`
          : "create:development",
      );
    expect(order).toEqual([
      "create:development",
      "auth:main",
      "auth:development",
      "auth:preview",
    ]);
    expect(await appRow(appId)).toMatchObject({
      neonDevelopmentBranchId: development.id,
      neonPreviewBranchId: fakeNeon.byName("preview").id,
    });
    expect(telemetryEvents("neon:project-created")).toEqual([
      {
        outcome: "succeeded",
        developmentPrepared: true,
        authOnMain: true,
        authOnDevelopment: true,
        authOnPreview: true,
      },
    ]);
  });
});
