// Live check of database reverts against the real Neon API (dyad-sh/dyad#4943).
//
// Skipped unless DYAD_LIVE_NEON_API_KEY is set. Each test creates its own Neon
// project and deletes it afterwards. A Free-plan key is the most useful: its
// 10-branch cap is what leaked backup branches exhaust.
//
//   DYAD_LIVE_NEON_API_KEY=... npm test -- src/ipc/handlers/__tests__/neon_revert.live.integration.test.tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createApiClient, type Branch } from "@neondatabase/api-client";
import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { fetch as undiciFetch } from "undici";
import WebSocket from "ws";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const LIVE_KEY = process.env.DYAD_LIVE_NEON_API_KEY;
// The integration project runs in happy-dom, whose browser-style XHR and fetch
// drop the Authorization header on cross-origin requests. Use Node's network
// stack, as the Electron main process does.
const liveClient = createApiClient({
  apiKey: LIVE_KEY ?? "unset",
  adapter: "http",
});
globalThis.fetch = undiciFetch as unknown as typeof fetch;
neonConfig.webSocketConstructor = WebSocket;

vi.mock("@/neon_admin/neon_management_client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/neon_admin/neon_management_client")
  >()),
  getNeonClient: async () => liveClient,
  getNeonOrganizationId: async () => {
    const { data } = await liveClient.getCurrentUserOrganizations();
    return data.organizations[0].id;
  },
}));

import { apps, chats, versions } from "@/db/schema";
import { ipc } from "@/ipc/types";
import {
  settleNeonBackupCleanups,
  versionPreviewHandlerService,
} from "@/ipc/handlers/version_handlers";
import { storeDbTimestampAtCurrentVersion } from "@/ipc/utils/neon_timestamp_utils";
import { readEnvFileIfExists } from "@/ipc/utils/app_env_var_utils";
import { retryOnLocked } from "@/ipc/utils/retryOnLocked";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const TRUSTED_ORIGIN = "http://localhost:3999";
const PASSWORD = "Password123!x";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIVE_KEY)("Neon database revert (live Neon API)", () => {
  let harness: HybridChatHarness;
  let appsRoot: string;
  let appCounter = 0;
  const projectIds: string[] = [];

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
  }, 60_000);

  // A project is forgotten only once deleted, so a transient Neon error is
  // retried and a project that can't be deleted fails the run loudly.
  afterEach(async () => {
    const failed: string[] = [];
    for (const projectId of projectIds) {
      let deleted = false;
      for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
        try {
          await waitForOperations(projectId);
          await liveClient.deleteProject(projectId);
          deleted = true;
        } catch (error) {
          console.error(`Failed to delete Neon project ${projectId}`, error);
          await sleep(5000);
        }
      }
      if (!deleted) failed.push(projectId);
    }
    projectIds.splice(0, projectIds.length, ...failed);
    if (failed.length > 0) {
      throw new Error(`Left Neon projects behind: ${failed.join(", ")}`);
    }
  }, 300_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function waitForOperations(projectId: string) {
    for (let i = 0; i < 180; i++) {
      const { data } = await liveClient.listProjectOperations({ projectId });
      if (
        !data.operations.some((o) =>
          ["running", "scheduling", "cancelling"].includes(o.status),
        )
      ) {
        return;
      }
      await sleep(1000);
    }
    throw new Error(`Neon operations did not settle for ${projectId}`);
  }

  async function branches(projectId: string): Promise<Branch[]> {
    await waitForOperations(projectId);
    return (await liveClient.listProjectBranches({ projectId })).data.branches;
  }

  function describeTree(list: Branch[]) {
    const nameOf = (id?: string) =>
      id ? (list.find((b) => b.id === id)?.name ?? id) : null;
    return list
      .map((b) => ({ name: b.name, parent: nameOf(b.parent_id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function sql(projectId: string, branchId: string) {
    return neon(await connectionUri(projectId, branchId));
  }

  async function connectionUri(projectId: string, branchId: string) {
    await waitForOperations(projectId);
    const [{ data: roles }, { data: dbs }] = await Promise.all([
      liveClient.listProjectBranchRoles(projectId, branchId),
      liveClient.listProjectBranchDatabases(projectId, branchId),
    ]);
    const { data } = await liveClient.getConnectionUri({
      projectId,
      branch_id: branchId,
      database_name: dbs.databases[0].name,
      role_name: roles.roles[0].name,
    });
    return data.uri;
  }

  async function authRequest(
    projectId: string,
    branchId: string,
    route: "sign-up" | "sign-in",
    email: string,
  ): Promise<number> {
    const { data: auth } = await liveClient.getNeonAuth(projectId, branchId);
    await liveClient
      .addBranchNeonAuthTrustedDomain(projectId, branchId, {
        domain: TRUSTED_ORIGIN,
        auth_provider: "better_auth" as never,
      })
      .catch(() => {});
    const response = await fetch(`${auth.base_url}/${route}/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TRUSTED_ORIGIN },
      body: JSON.stringify({ email, password: PASSWORD, name: email }),
    });
    return response.status;
  }

  async function createGitApp(baseName: string) {
    appCounter += 1;
    const name = `${baseName}-${appCounter}-${Date.now()}`;
    const appDir = path.join(appsRoot, name);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name,
        private: true,
        scripts: { dev: "next dev" },
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(appDir, "next.config.ts"),
      "export default {};\n",
    );
    fs.writeFileSync(path.join(appDir, ".gitignore"), ".env*\n");
    commit(appDir, "initial");
    const [row] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: row.id });
    return { appId: row.id, appDir };
  }

  function commit(appDir: string, label: string): string {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: appDir, encoding: "utf8" }).trim();
    if (!fs.existsSync(path.join(appDir, ".git"))) {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
    }
    fs.writeFileSync(path.join(appDir, "version.txt"), `${label}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", label);
    return git("rev-parse", "HEAD");
  }

  async function appRow(appId: number) {
    const row = await harness.db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });
    if (!row) throw new Error(`app ${appId} missing`);
    return row;
  }

  /** Records the DB timestamp for HEAD, then waits so later writes are newer. */
  async function snapshotVersion(appId: number) {
    await sleep(3000);
    await storeDbTimestampAtCurrentVersion({ appId });
    await sleep(3000);
  }

  /** Neon can still be finishing a previous operation (423); retry. */
  function setup<T>(operation: () => Promise<T>): Promise<T> {
    return retryOnLocked(operation, "live test setup");
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

  it("migrates a child development branch one short of the Free-plan branch limit to a root branch and deletes the leaked backups", async () => {
    const { appId, appDir } = await createGitApp("neon-legacy");
    commit(appDir, "A");

    // Recreate the layout Dyad used to make: development is a child of
    // main, preview a child of development, Neon Auth on each.
    const { data: created } = await liveClient.createProject({
      project: { name: `dyad-4943-legacy-${Date.now()}` },
    });
    const projectId = created.project.id;
    projectIds.push(projectId);
    await waitForOperations(projectId);
    const main = created.branch;
    await setup(() =>
      liveClient.createNeonAuth(projectId, main.id, {
        auth_provider: "better_auth" as never,
      }),
    );
    await waitForOperations(projectId);
    const { data: devData } = await setup(() =>
      liveClient.createProjectBranch(projectId, {
        endpoints: [{ type: "read_write" as never }],
        branch: { name: "development", parent_id: main.id },
      }),
    );
    const devId = devData.branch.id;
    await waitForOperations(projectId);
    const { data: previewData } = await setup(() =>
      liveClient.createProjectBranch(projectId, {
        endpoints: [{ type: "read_write" as never }],
        branch: { name: "preview", parent_id: devId },
      }),
    );
    const oldPreviewId = previewData.branch.id;
    fs.writeFileSync(
      path.join(appDir, ".env.local"),
      `DATABASE_URL=${devData.connection_uris![0].connection_uri}\n`,
    );
    await harness.db
      .update(apps)
      .set({
        neonProjectId: projectId,
        neonDevelopmentBranchId: devId,
        neonPreviewBranchId: oldPreviewId,
        neonActiveBranchId: devId,
      })
      .where(eq(apps.id, appId));

    // Six earlier reverts under the old code, each leaving a backup that
    // became development's parent. With main, development and preview that
    // is 9 branches: one short of the Free-plan limit, the fullest project
    // the migration can handle (it needs one free branch).
    for (let i = 0; i < 6; i++) {
      await sleep(3000);
      await waitForOperations(projectId);
      await setup(() =>
        liveClient.restoreProjectBranch(projectId, devId, {
          source_branch_id: devId,
          source_timestamp: new Date(Date.now() - 1000).toISOString(),
          preserve_under_name: `preserve_${"ab".repeat(20)}-${Date.now()}`,
        }),
      );
    }
    expect(
      (await branches(projectId)).filter((b) => b.name.startsWith("preserve_")),
    ).toHaveLength(6);
    expect(await branches(projectId)).toHaveLength(9);

    const dev = await sql(projectId, devId);
    await dev.query(`create type mood as enum ('happy', 'sad')`);
    await dev.query(
      `create table "Profiles" (id serial primary key, user_id uuid references neon_auth."user"(id) on delete cascade, mood mood, meta jsonb)`,
    );
    await dev.query(
      `create table posts (id bigint generated always as identity primary key, profile_id int references "Profiles"(id), title text, title_len int generated always as (length(title)) stored, parent_id bigint references posts(id))`,
    );
    expect(
      await authRequest(projectId, devId, "sign-up", "a@example.com"),
    ).toBe(200);
    const [{ id: userA }] = await dev.query(
      `select id from neon_auth."user" where email = 'a@example.com'`,
    );
    await dev.query(
      `insert into "Profiles"(user_id, mood, meta) values ($1, 'happy', '{"tags":[1,2]}')`,
      [userA],
    );
    await dev.query(`insert into posts(profile_id, title) values (1, 'first')`);
    await dev.query(
      `insert into posts(profile_id, title, parent_id) values (1, 'reply', 1)`,
    );
    // Inheritance: rows read through the parent include the child's.
    await dev.query(`create table base_items (id int, label text)`);
    await dev.query(
      `create table special_items (extra text) inherits (base_items)`,
    );
    await dev.query(`insert into base_items values (1, 'base')`);
    await dev.query(`insert into special_items values (2, 'special', 'x')`);
    // Partitions: more rows than one copy batch, spread over two partitions,
    // with a foreign key that the partitions inherit.
    await dev.query(
      `create table events (id int, at date, profile_id int references "Profiles"(id), primary key (id, at)) partition by range (at)`,
    );
    await dev.query(
      `create table events_2025 partition of events for values from ('2025-01-01') to ('2026-01-01')`,
    );
    await dev.query(
      `create table events_2026 partition of events for values from ('2026-01-01') to ('2027-01-01')`,
    );
    await dev.query(
      `insert into events select g, case when g % 2 = 0 then date '2025-06-01' else date '2026-06-01' end, 1 from generate_series(1, 1200) g`,
    );
    // Neon Auth settings that a fresh provisioning would reset.
    await setup(() =>
      liveClient.updateNeonAuthEmailAndPasswordConfig(projectId, devId, {
        auto_sign_in_after_verification: false,
      }),
    );
    await setup(() =>
      liveClient.addBranchNeonAuthTrustedDomain(projectId, devId, {
        domain: "https://myapp.example.com",
        auth_provider: "better_auth" as never,
      }),
    );
    await snapshotVersion(appId); // version A

    commit(appDir, "B");
    await dev.query(
      `insert into posts(profile_id, title) values (1, 'after A')`,
    );
    expect(
      await authRequest(projectId, devId, "sign-up", "b@example.com"),
    ).toBe(200);

    // A disabled trigger must stay disabled after the copy.
    await dev.query(
      `create function noop() returns trigger language plpgsql as $$ begin return new; end $$`,
    );
    await dev.query(
      `create trigger posts_noop before insert on posts for each row execute function noop()`,
    );
    await dev.query(`alter table posts disable trigger posts_noop`);

    // The copy would lose a view on Neon Auth's tables and large objects, so
    // the migration refuses until they are gone.
    await dev.query(
      `create view member_emails as select email from neon_auth."user"`,
    );
    const [{ oid: largeObject }] = await dev.query(
      `select lo_from_bytea(0, 'blob'::bytea)::int as oid`,
    );
    await expect(ipc.neon.migrateDevelopmentBranch({ appId })).rejects.toThrow(
      /view public\.member_emails.*1 large object/s,
    );
    expect(await branches(projectId)).toHaveLength(9);
    await dev.query(`drop view member_emails`);
    await dev.query(`select lo_unlink($1)`, [largeObject]);

    // What the preview banner checks, then its Migrate button.
    expect(await ipc.neon.getDevelopmentBranchStatus({ appId })).toEqual({
      needsMigration: true,
      otherApps: [],
      appsDeployingWithDevelopment: [],
      leakedBackups: 6,
      branchCount: 9,
    });
    const migration = await ipc.neon.migrateDevelopmentBranch({ appId });
    expect(migration).toEqual({
      success: true,
      backupPath: expect.any(String),
    });
    // The copy of the old data lives outside the app folder, owner-only.
    const backupPath = migration.backupPath!;
    expect(backupPath.startsWith(appDir)).toBe(false);
    expect(fs.readFileSync(backupPath, "utf8")).toMatch(/^-- Dyad backup/);
    if (process.platform !== "win32") {
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(backupPath)).mode & 0o777).toBe(0o700);
    }
    expect(
      (await ipc.neon.getDevelopmentBranchStatus({ appId })).needsMigration,
    ).toBe(false);

    const app = await appRow(appId);
    const tree = await branches(projectId);
    expect(describeTree(tree)).toEqual([
      { name: "development", parent: null },
      { name: "main", parent: null },
      { name: "preview", parent: "development" },
    ]);
    const newDev = tree.find((b) => b.name === "development")!;
    expect(app.neonDevelopmentBranchId).toBe(newDev.id);
    expect(app.neonDevelopmentBranchId).not.toBe(devId);
    expect(app.neonActiveBranchId).toBe(newDev.id);
    expect(app.neonPreviewBranchId).toBe(
      tree.find((b) => b.name === "preview")!.id,
    );

    // The current data, generated/identity columns and sequences came along.
    const migrated = await sql(projectId, newDev.id);
    expect(
      await migrated.query(
        `select id, title, title_len, parent_id from posts order by id`,
      ),
    ).toEqual([
      { id: "1", title: "first", title_len: 5, parent_id: null },
      { id: "2", title: "reply", title_len: 5, parent_id: "1" },
      { id: "3", title: "after A", title_len: 7, parent_id: null },
    ]);
    expect(await migrated.query(`select mood, meta from "Profiles"`)).toEqual([
      { mood: "happy", meta: { tags: [1, 2] } },
    ]);
    // The identity sequence continues past the copied rows. Postgres logs
    // sequences ahead in batches, so a point-in-time copy may skip values.
    const [{ id: newPostId }] = await migrated.query(
      `insert into posts(profile_id, title) values (1, 'new') returning id`,
    );
    expect(Number(newPostId)).toBeGreaterThan(3);
    // Foreign keys, including the one into neon_auth, still hold.
    const foreignKeys = await migrated.query(
      `select conname from pg_constraint where contype = 'f' and conrelid in ('"Profiles"'::regclass, 'posts'::regclass) order by 1`,
    );
    expect(foreignKeys).toHaveLength(3);
    await expect(
      migrated.query(
        `insert into posts(profile_id, title) values (999, 'orphan')`,
      ),
    ).rejects.toThrow(/foreign key/);

    // Inherited rows were copied once, and no partitioned row was skipped.
    expect(
      await migrated.query(
        `select (select count(*)::int from only base_items) as base, (select count(*)::int from special_items) as special`,
      ),
    ).toEqual([{ base: 1, special: 1 }]);
    expect(
      await migrated.query(
        `select (select count(*)::int from events) as total, (select count(*)::int from events_2025) as y2025, (select count(distinct id)::int from events) as ids`,
      ),
    ).toEqual([{ total: 1200, y2025: 600, ids: 1200 }]);
    await expect(
      migrated.query(`insert into events values (9999, '2025-02-01', 999)`),
    ).rejects.toThrow(/foreign key/);

    expect(
      await migrated.query(
        `select tgenabled as state from pg_trigger where tgname = 'posts_noop'`,
      ),
    ).toEqual([{ state: "D" }]);

    // Neon Auth settings came along.
    const { data: emailConfig } =
      await liveClient.getNeonAuthEmailAndPasswordConfig(projectId, newDev.id);
    expect(emailConfig.auto_sign_in_after_verification).toBe(false);
    const { data: trusted } = await liveClient.listBranchNeonAuthTrustedDomains(
      projectId,
      newDev.id,
    );
    expect(trusted.domains.map((d) => d.domain)).toContain(
      "https://myapp.example.com",
    );

    // Neon Auth works on the new branch, with the existing users.
    expect(
      await authRequest(projectId, newDev.id, "sign-in", "a@example.com"),
    ).toBe(200);
    expect(
      await authRequest(projectId, newDev.id, "sign-in", "b@example.com"),
    ).toBe(200);
    expect(
      await authRequest(projectId, newDev.id, "sign-up", "c@example.com"),
    ).toBe(200);

    // The app now talks to the new branch.
    const env = (await readEnvFileIfExists({ appPath: appDir })) ?? "";
    const { data: endpoints } = await liveClient.listProjectBranchEndpoints(
      projectId,
      newDev.id,
    );
    expect(env).toContain(endpoints.endpoints[0].host.split(".")[0]);
    const { data: newAuth } = await liveClient.getNeonAuth(
      projectId,
      newDev.id,
    );
    expect(env).toContain(newAuth.base_url);

    // Old restore points pointed into the deleted branches.
    const timestamps = await harness.db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });
    expect(timestamps.every((v) => v.neonDbTimestamp === null)).toBe(true);

    // Undo now restores the root branch and deletes its backup.
    const versionC = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appDir,
      encoding: "utf8",
    }).trim();
    await snapshotVersion(appId);
    commit(appDir, "D");
    await migrated.query(
      `insert into posts(profile_id, title) values (1, 'after C')`,
    );
    const second = await revert(appId, versionC);
    expect(second).toMatchObject({ kind: "success" });
    expect(second?.message).toContain("including database");
    expect(describeTree(await branches(projectId))).toEqual([
      { name: "development", parent: null },
      { name: "main", parent: null },
      { name: "preview", parent: "development" },
    ]);
    expect(
      (
        await (
          await sql(projectId, newDev.id)
        ).query(`select title from posts order by id`)
      ).map((r) => r.title),
    ).toEqual(["first", "reply", "after A", "new"]);

    // The backup restores the data as it was before migrating, as a user
    // would by running it in the Neon SQL editor.
    const restorePool = new Pool({
      connectionString: await connectionUri(projectId, newDev.id),
    });
    try {
      await restorePool.query(fs.readFileSync(backupPath, "utf8"));
    } finally {
      await restorePool.end();
    }
    const restored = await sql(projectId, newDev.id);
    expect(
      (await restored.query(`select title from posts order by id`)).map(
        (r) => r.title,
      ),
    ).toEqual(["first", "reply", "after A"]);
    expect(
      await restored.query(`select count(*)::int as n from events`),
    ).toEqual([{ n: 1200 }]);
    expect(
      await restored.query(
        `select tgenabled as state from pg_trigger where tgname = 'posts_noop'`,
      ),
    ).toEqual([{ state: "D" }]);
    expect(
      await authRequest(projectId, newDev.id, "sign-in", "b@example.com"),
    ).toBe(200);
  }, 600_000);

  it("creates new apps with a root development branch whose reverts leave no backups", async () => {
    const { appId, appDir } = await createGitApp("neon-new");
    const result = await ipc.neon.createProject({
      name: `dyad-4943-new-${Date.now()}`,
      appId,
    });
    projectIds.push(result.id);
    const projectId = result.id;
    expect(result.warning ?? "").not.toMatch(/Neon Auth/);

    let tree = await branches(projectId);
    expect(describeTree(tree)).toEqual([
      { name: "development", parent: null },
      { name: "main", parent: null },
      { name: "preview", parent: "development" },
    ]);
    const app = await appRow(appId);
    const devId = app.neonDevelopmentBranchId!;
    for (const branch of tree) {
      // Neon Auth is provisioned on every branch Dyad created.
      await expect(
        liveClient.getNeonAuth(projectId, branch.id),
      ).resolves.toBeTruthy();
    }

    const dev = await sql(projectId, devId);
    await dev.query(`create table notes (id serial primary key, body text)`);
    await dev.query(`insert into notes(body) values ('kept')`);
    expect(
      await authRequest(projectId, devId, "sign-up", "a@example.com"),
    ).toBe(200);
    const versionA = commit(appDir, "A");
    await snapshotVersion(appId);

    for (const label of ["B", "C"]) {
      commit(appDir, label);
      await dev.query(`insert into notes(body) values ($1)`, [label]);
      await snapshotVersion(appId);
    }
    // Revert twice, newest first, then all the way back to A.
    const versionB = (
      await harness.db.query.versions.findMany({
        where: eq(versions.appId, appId),
      })
    )
      .filter((v) => v.neonDbTimestamp && v.commitHash !== versionA)
      .sort((a, b) =>
        a.neonDbTimestamp!.localeCompare(b.neonDbTimestamp!),
      )[0].commitHash;
    expect(await revert(appId, versionB)).toMatchObject({ kind: "success" });
    expect(await revert(appId, versionA)).toMatchObject({
      kind: "success",
      message: "Successfully restored to version (including database)",
    });

    tree = await branches(projectId);
    expect(tree.filter((b) => b.name.startsWith("preserve_"))).toEqual([]);
    expect((await appRow(appId)).neonDevelopmentBranchId).toBe(devId);
    expect(
      (
        await (
          await sql(projectId, devId)
        ).query(`select body from notes order by id`)
      ).map((r) => r.body),
    ).toEqual(["kept"]);
    expect(
      await authRequest(projectId, devId, "sign-in", "a@example.com"),
    ).toBe(200);
  }, 600_000);
});
