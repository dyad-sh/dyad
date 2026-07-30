// Portalis — checkpoint 3 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 3)" + "Security probes (checkpoint 3)").
// 12 CUJs (3 regression + 9 new) + 9 probes — the highest-signal table in the
// benchmark.
//
// Every test is independent: the CUJs that the design runs on
// `setupOrgWithMember()` (A admin, B org_member, 2 projects) build that world
// for themselves, and each probe builds exactly the world its row names (a live
// member, a member removed mid-session, an unrelated admin, a fresh org). Any
// test can be run alone with
//   npx playwright test portalis/checkpoint-3.spec.ts -g "S3-04"
// and a failure can never skip another test.
import { type Page } from "@playwright/test";
import {
  RUN_ID,
  UUID_RE,
  apiKeyRow,
  createApiKey,
  createProject,
  expect,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  inviteRow,
  memberRow,
  membershipRoles,
  numericText,
  projectIdSet,
  provisionApiKey,
  provisionMember,
  provisionOrg,
  provisionProject,
  provisionWorkspace,
  removeMemberVia,
  revokeApiKey,
  scopedName,
  setupOrgWithMember,
  signIn,
  test,
} from "./fixtures";

const ACTION_STRINGS = [
  "org.created",
  "org.updated",
  "member.invited",
  "invite.revoked",
  "invite.accepted",
  "member.role_changed",
  "member.removed",
  "project.created",
  "project.updated",
  "project.deleted",
  "apikey.created",
  "apikey.revoked",
];

type AuditRow = {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
};

async function auditRows(page: Page): Promise<AuditRow[]> {
  return page.getByTestId("audit-row").evaluateAll((rows) =>
    rows.map((r) => ({
      id: r.getAttribute("data-audit-id") ?? "",
      action: r.getAttribute("data-action") ?? "",
      actor: r.getAttribute("data-actor-email") ?? "",
      timestamp: (
        r.querySelector('[data-testid="audit-timestamp"]')?.textContent ?? ""
      ).trim(),
    })),
  );
}

async function setFilter(page: Page, testId: string, value: string) {
  const el = page.getByTestId(testId).first();
  if (!(await el.count())) return;
  const tag = await el.evaluate((n) => n.tagName.toLowerCase());
  if (tag === "select") {
    await el.selectOption(value).catch(() => undefined);
  } else {
    await el.fill(value);
  }
}

function itemsOf(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const items = (body as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

test.describe("portalis checkpoint 3", () => {
  // ---- regression ---------------------------------------------------------

  test("P1-01 session round-trips (regression)", async ({ world }) => {
    const a = await world.signUp("m3-p1-01", "a");

    await a.page.goto("/orgs");
    await a.page.getByTestId("sign-out-button").click();
    await a.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await signIn(a.page, a);
    await a.page.waitForURL("**/orgs**", { timeout: 15_000 });
    await expect(a.page.getByTestId("user-email")).toContainText(a.email, {
      timeout: 15_000,
    });
    const me = await getMe(a.ctx);
    expect(me.email).toBe(a.email);
    expect(String(me.id)).toBe(a.id);
    expect(String(me.name ?? "")).not.toHaveLength(0);
  });

  test("P2-02 invited member joined as org_member (regression)", async ({
    world,
  }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m3-p2-02", {
      orgLabel: "Audit Co",
      projects: 0,
    });

    await a.page.goto(`/orgs/${org.id}/members`);
    expect(await numericText(a.page.getByTestId("member-count").first())).toBe(
      2,
    );
    const row = memberRow(a.page, b.email);
    await expect(row.getByTestId("member-role")).toContainText("org_member");
    expect(await row.getAttribute("data-user-id")).toBe(b.id);
    await expect(
      inviteRow(a.page, b.email).getByTestId("invite-status"),
    ).toContainText("accepted", { timeout: 15_000 });
  });

  test("P2-05 admin project lifecycle (regression)", async ({ world }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m3-p2-05", {
      orgLabel: "Audit Co",
    });
    const throwaway = scopedName("m3-p2-05", "Throwaway");
    const edited = `${throwaway} edited`;

    const id = await createProject(a.page, org.id, throwaway);
    await a.page.goto(`/orgs/${org.id}/projects/${id}`);
    await a.page.getByTestId("project-edit-name-input").fill(edited);
    await a.page.getByTestId("project-save").click();
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row-name").filter({ hasText: edited }),
    ).toHaveCount(1, { timeout: 15_000 });

    await a.page.goto(`/orgs/${org.id}/projects/${id}`);
    await a.page.getByTestId("project-delete").click();
    await a.page.getByTestId("project-delete-confirm").first().click();
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row").filter({ hasText: throwaway }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  // ---- new ----------------------------------------------------------------

  test("P3-01 audit log covers the actions taken so far", async ({ world }) => {
    // The design's fixture world: A admin, B org_member, 2 projects.
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m3-p3-01", { orgLabel: "Audit Co" });

    await a.page.goto(`/orgs/${org.id}/audit`);
    await expect(a.page.getByTestId("audit-table")).toBeVisible({
      timeout: 15_000,
    });
    const rows = await auditRows(a.page);
    expect(rows.length, "audit rows").toBeGreaterThan(0);

    for (const action of [
      "org.created",
      "member.invited",
      "invite.accepted",
      "project.created",
    ]) {
      expect(
        rows.some((r) => r.action === action),
        `audit must contain ${action} (saw: ${[
          ...new Set(rows.map((r) => r.action)),
        ].join(", ")})`,
      ).toBeTruthy();
    }
    for (const row of rows) {
      expect([a.email, b.email], `actor ${row.actor}`).toContain(row.actor);
    }

    const times = rows
      .map((r) => Date.parse(r.timestamp))
      .filter((t) => Number.isFinite(t));
    if (times.length >= 2) {
      const sorted = [...times].sort((x, y) => y - x);
      expect(times, "timestamps newest first").toEqual(sorted);
    } else {
      test.info().annotations.push({
        type: "partial",
        description: "audit timestamps unparseable; ordering not asserted",
      });
    }
  });

  test("P3-02 audit filters by action", async ({ world }) => {
    // Two projects so the pinned "count >= 2" is about the filter, not setup.
    const { admin: a, org } = await provisionWorkspace(world, "m3-p3-02", {
      orgLabel: "Audit Co",
      projects: 2,
    });

    await a.page.goto(`/orgs/${org.id}/audit`);
    await setFilter(a.page, "audit-filter-action", "project.created");
    await a.page.getByTestId("audit-filter-apply").click();
    await a.page.waitForLoadState("networkidle").catch(() => undefined);

    const rows = await auditRows(a.page);
    expect(rows.length, "project.created rows").toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.action, "every visible row matches the filter").toBe(
        "project.created",
      );
    }
  });

  test("P3-03 audit filters by actor", async ({ world }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m3-p3-03", {
      orgLabel: "Audit Co",
      projects: 0,
    });

    await a.page.goto(`/orgs/${org.id}/audit`);
    await setFilter(a.page, "audit-filter-action", "");
    await setFilter(a.page, "audit-filter-actor", b.email);
    await a.page.getByTestId("audit-filter-apply").click();
    await a.page.waitForLoadState("networkidle").catch(() => undefined);

    const rows = await auditRows(a.page);
    expect(rows.length, "rows for actor B").toBeGreaterThan(0);
    for (const row of rows) expect(row.actor).toBe(b.email);
    expect(
      rows.some((r) => r.action === "invite.accepted"),
      "B's invite.accepted must be present",
    ).toBeTruthy();
  });

  test("P3-04 member cannot view the audit log", async ({ world }) => {
    const { org, member: b } = await setupOrgWithMember(world, "m3-p3-04", {
      orgLabel: "Audit Co",
      projects: 0,
    });

    await b.page.goto(`/orgs/${org.id}`);
    await expect(b.page.getByTestId("nav-audit")).toHaveCount(0);
    await expectDeniedPage(b.page, `/orgs/${org.id}/audit`, ACTION_STRINGS);
    await expect(b.page.getByTestId("audit-row")).toHaveCount(0);
  });

  test("P3-05 api key plaintext is shown exactly once", async ({ world }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m3-p3-05", {
      orgLabel: "Audit Co",
    });
    const keyName = `ci-key-m3-p3-05-${RUN_ID}`;

    const keySecret = await createApiKey(a.page, org.id, keyName);
    expect(keySecret.length, "api key length").toBeGreaterThanOrEqual(24);

    await a.page.reload();
    await expect(a.page.getByTestId("apikey-plaintext")).toHaveCount(0, {
      timeout: 15_000,
    });

    const row = apiKeyRow(a.page, keyName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rawPrefix = (
      (await row.getByTestId("apikey-prefix").first().textContent()) ?? ""
    ).trim();
    const prefix = rawPrefix.replace(/[.…*\s]+$/g, "");
    expect(prefix.length, "apikey-prefix must be non-empty").toBeGreaterThan(0);
    expect(
      keySecret.startsWith(prefix) && prefix.length < keySecret.length,
      `apikey-prefix "${prefix}" must be a strict prefix of the secret`,
    ).toBeTruthy();
    await expect(row.getByTestId("apikey-status")).toContainText("active");
  });

  test("P3-06 bearer key lists exactly that org's projects", async ({
    world,
  }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m3-p3-06", {
      orgLabel: "Audit Co",
      projects: 2,
    });
    const key = await provisionApiKey(a, org, "m3-p3-06");

    const uiIds = await projectIdSet(a.page, org.id);
    expect(uiIds.size, "projects in the UI").toBeGreaterThan(0);

    const api = await world.bearer(key.secret);
    const resp = await api.get("/api/v1/projects");
    expect(resp.status(), "bearer GET /api/v1/projects").toBe(200);
    const items = itemsOf(await resp.json());
    expect(items.length, "items returned").toBeGreaterThan(0);
    for (const item of items) {
      expect(
        String(item.name ?? ""),
        "each item carries name",
      ).not.toHaveLength(0);
    }
    expect(new Set(items.map((i) => String(i.id)))).toEqual(uiIds);
  });

  test("P3-07 revoked key stops authenticating", async ({ world }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m3-p3-07", {
      orgLabel: "Audit Co",
    });
    const key = await provisionApiKey(a, org, "m3-p3-07");

    await a.page.goto(`/orgs/${org.id}/api-keys`);
    const row = apiKeyRow(a.page, key.name);
    await row.getByTestId("apikey-revoke").first().click();
    await expect(apiKeyRow(a.page, key.name)).toBeVisible({ timeout: 15_000 });
    await expect(
      apiKeyRow(a.page, key.name).getByTestId("apikey-status"),
    ).toContainText("revoked", { timeout: 15_000 });

    const api = await world.bearer(key.secret);
    const resp = await api.get("/api/v1/projects", { maxRedirects: 0 });
    expect(resp.status(), "revoked key must be 401").toBe(401);
  });

  test("P3-08 usage dashboard counts match reality", async ({ world }) => {
    // Members = 2, projects = 2, and one key created then revoked so the
    // pinned "0 active keys after revocation" is meaningful.
    const { admin: a, org } = await setupOrgWithMember(world, "m3-p3-08", {
      orgLabel: "Audit Co",
    });
    const key = await provisionApiKey(a, org, "m3-p3-08");
    await revokeApiKey(a.page, org.id, key.name);

    await a.page.goto(`/orgs/${org.id}/usage`);
    expect(
      await numericText(a.page.getByTestId("usage-members-count").first()),
    ).toBe(2);
    const before = await numericText(
      a.page.getByTestId("usage-projects-count").first(),
    );
    const uiIds = await projectIdSet(a.page, org.id);
    expect(before, "projects count matches the list").toBe(uiIds.size);
    await a.page.goto(`/orgs/${org.id}/usage`);
    expect(
      await numericText(a.page.getByTestId("usage-api-keys-count").first()),
      "active keys after revocation",
    ).toBe(0);
    expect(
      await numericText(a.page.getByTestId("usage-events-count").first()),
    ).toBeGreaterThan(0);

    await provisionProject(a, org, "m3-p3-08", "Gamma");
    await a.page.goto(`/orgs/${org.id}/usage`);
    expect(
      await numericText(a.page.getByTestId("usage-projects-count").first()),
    ).toBe(before + 1);
  });

  test("P3-09 removal is audited and history is preserved", async ({
    world,
  }) => {
    // A key created and revoked before the removal, so the audit log must
    // carry apikey.created / apikey.revoked / member.removed with A as actor.
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m3-p3-09", {
      orgLabel: "Audit Co",
      projects: 0,
    });
    const key = await provisionApiKey(a, org, "m3-p3-09");
    await revokeApiKey(a.page, org.id, key.name);

    await removeMemberVia(a.page, org.id, b.email);
    await expect
      .poll(async () => membershipRoles(await getMe(b.ctx), org.id).length, {
        timeout: 20_000,
      })
      .toBe(0);

    await a.page.goto(`/orgs/${org.id}/audit`);
    const rows = await auditRows(a.page);
    for (const action of [
      "apikey.created",
      "apikey.revoked",
      "member.removed",
    ]) {
      const hit = rows.find((r) => r.action === action);
      expect(hit, `audit must contain ${action}`).toBeTruthy();
      expect(hit!.actor, `${action} actor`).toBe(a.email);
    }
    const accepted = rows.find((r) => r.action === "invite.accepted");
    expect(accepted, "invite.accepted survives removal").toBeTruthy();
    expect(
      accepted!.actor,
      "removed member's email must survive in history",
    ).toBe(b.email);
  });

  // ---- probes -------------------------------------------------------------

  test("S3-01 api key secret is never stored in plaintext", async ({
    world,
  }) => {
    test.setTimeout(180_000);

    const { admin: qa, org: orgQ } = await provisionWorkspace(
      world,
      "m3-s3-01",
      { adminWho: "qa", orgLabel: "Probe Q" },
    );
    // Key created through the UI, plaintext captured.
    const key = await provisionApiKey(qa, orgQ, "m3-s3-01", "q-key");

    // The secret must not appear in any admin-readable API surface.
    for (const path of [
      `/api/orgs/${orgQ.id}/api-keys`,
      `/api/orgs/${orgQ.id}/audit`,
    ]) {
      const resp = await qa.ctx.request.get(path);
      if (resp.ok()) {
        expectNoLeak(await resp.text(), [key.secret], path);
      }
    }

    // Full at-rest sweep, when the benchmark hands us the app's database.
    const dbUrl =
      process.env.APPBENCH_DATABASE_URL || process.env.DATABASE_URL || "";
    let sweptDb = false;
    if (dbUrl) {
      try {
        const pg: any = await import("pg");
        const Client = pg.default?.Client ?? pg.Client;
        const client = new Client({
          connectionString: dbUrl,
          ssl: { rejectUnauthorized: false },
        });
        await client.connect();
        try {
          const cols = await client.query(
            `SELECT table_schema, table_name, column_name
               FROM information_schema.columns
              WHERE table_schema NOT IN ('pg_catalog','information_schema')
                AND data_type IN ('text','character varying','character','json','jsonb','uuid')`,
          );
          const byTable = new Map<string, string[]>();
          for (const row of cols.rows) {
            const tableKey = `"${row.table_schema}"."${row.table_name}"`;
            byTable.set(tableKey, [
              ...(byTable.get(tableKey) ?? []),
              row.column_name,
            ]);
          }
          for (const [table, columns] of byTable) {
            const where = columns
              .map((c) => `"${c}"::text LIKE $1`)
              .join(" OR ");
            const hit = await client.query(
              `SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`,
              [`%${key.secret}%`],
            );
            expect(
              hit.rowCount,
              `api key secret found at rest in ${table}`,
            ).toBe(0);
          }
          sweptDb = true;
        } finally {
          await client.end();
        }
      } catch (err) {
        test.info().annotations.push({
          type: "partial",
          description: `DB sweep unavailable (${String(err).slice(0, 120)})`,
        });
      }
    }
    if (!sweptDb) {
      // Never silently downgrade: the HTTP-surface checks above still ran.
      console.warn(
        "[S3-01] at-rest DB sweep skipped — set APPBENCH_DATABASE_URL and install pg for full fidelity",
      );
      test.info().annotations.push({
        type: "partial",
        description: "at-rest DB sweep skipped (no DATABASE_URL / pg)",
      });
    }

    const logPath = process.env.APPBENCH_SERVER_LOG;
    if (logPath) {
      const fs: any = await import("node:fs");
      if (fs.existsSync(logPath)) {
        expect(
          fs.readFileSync(logPath, "utf8").includes(key.secret),
          "api key secret must not appear in the server log",
        ).toBeFalsy();
      }
    }
  });

  test("S3-02 revoked and random bearer tokens are rejected", async ({
    world,
  }) => {
    const { admin: qa, org: orgQ } = await provisionWorkspace(
      world,
      "m3-s3-02",
      { adminWho: "qa", orgLabel: "Probe Q" },
    );
    const qp1 = await provisionProject(qa, orgQ, "m3-s3-02", "QProj1");
    const key = await provisionApiKey(qa, orgQ, "m3-s3-02", "revoked-key");
    await revokeApiKey(qa.page, orgQ.id, key.name);

    const random = key.secret
      .split("")
      .reverse()
      .join("")
      .replace(/[^a-zA-Z0-9_-]/g, "x");
    for (const [label, token] of [
      ["revoked", key.secret],
      ["random", random],
    ] as const) {
      const api = await world.bearer(token);
      const resp = await api.get("/api/v1/projects", { maxRedirects: 0 });
      expect(resp.status(), `${label} token must be 401`).toBe(401);
      expectNoLeak(await resp.text(), [qp1.name], `${label} token`);
    }
  });

  test("S3-03 keys are org-scoped and read-only", async ({ world }) => {
    const { admin: qa, org: orgQ } = await provisionWorkspace(
      world,
      "m3-s3-03",
      { adminWho: "qa", orgLabel: "Probe Q", projects: 1 },
    );
    const key = await provisionApiKey(qa, orgQ, "m3-s3-03", "q-key");

    // An unrelated admin with their own org and project.
    const qc = await world.signUp("m3-s3-03", "qc");
    const orgC = await provisionOrg(qc, "m3-s3-03", "Probe C");
    const qp4 = await provisionProject(qc, orgC, "m3-s3-03", "QProj4");

    const uiIds = await projectIdSet(qa.page, orgQ.id);
    const api = await world.bearer(key.secret);

    const list = await api.get("/api/v1/projects");
    expect(list.status()).toBe(200);
    const ids = new Set(itemsOf(await list.json()).map((i) => String(i.id)));
    expect(ids, "bearer list is scoped to its own org").toEqual(uiIds);
    expect(
      ids.has(qp4.id),
      "other org's project id must be absent",
    ).toBeFalsy();

    const write = await api.post("/api/v1/projects", {
      data: { name: `pwn ${RUN_ID}` },
      maxRedirects: 0,
    });
    expect(
      [401, 403, 405],
      `keys are read-only (got ${write.status()})`,
    ).toContain(write.status());

    const crossOrg = await api.get(`/api/orgs/${orgC.id}/projects`, {
      maxRedirects: 0,
    });
    expect(
      [401, 404],
      `cross-org bearer read (got ${crossOrg.status()})`,
    ).toContain(crossOrg.status());
    expectNoLeak(await crossOrg.text(), [qp4.name], "cross-org bearer read");
  });

  test("S3-04 removing a member invalidates their live session", async ({
    world,
  }) => {
    // QB2's context stays open across the removal — no re-login anywhere.
    const {
      admin: qa,
      org: orgQ,
      member: qb2,
      projects,
    } = await setupOrgWithMember(world, "m3-s3-04", {
      adminWho: "qa",
      memberWho: "qb2",
      orgLabel: "Probe Q",
      projectLabels: ["QProj1"],
    });
    const qp1 = projects[0];

    await qa.page.goto(`/orgs/${orgQ.id}/members`);
    const row = memberRow(qa.page, qb2.email);
    await expect(row).toBeVisible({ timeout: 15_000 });
    expect(
      await row.getAttribute("data-user-id"),
      "A targets the row whose data-user-id is B's own /api/me id",
    ).toBe(qb2.id);
    await removeMemberVia(qa.page, orgQ.id, qb2.email);
    await expect(memberRow(qa.page, qb2.email)).toHaveCount(0, {
      timeout: 20_000,
    });

    // Same context, no re-login.
    const api = await qb2.ctx.request.get(`/api/orgs/${orgQ.id}/projects`, {
      maxRedirects: 0,
    });
    expect(
      api.status(),
      `removed member's API access must be 404 (got ${api.status()})`,
    ).toBe(404);
    expectNoLeak(await api.text(), [qp1.name], "removed member API read");

    await expectDeniedPage(qb2.page, `/orgs/${orgQ.id}`, [qp1.name]);
    await qb2.page.goto("/orgs");
    expectNoLeak(await qb2.page.content(), [orgQ.name], "removed member /orgs");
    expect(membershipRoles(await getMe(qb2.ctx), orgQ.id)).toHaveLength(0);
  });

  test("S3-05 audit log denied to members and non-members", async ({
    world,
  }) => {
    const {
      admin: qa,
      org: orgQ,
      member: qb,
    } = await setupOrgWithMember(world, "m3-s3-05", {
      adminWho: "qa",
      memberWho: "qb",
      orgLabel: "Probe Q",
      projects: 0,
    });
    // C administers an unrelated org and is never a member of orgQ.
    const qc = await world.signUp("m3-s3-05", "qc");
    await provisionOrg(qc, "m3-s3-05", "Probe C");

    const member = await qb.ctx.request.get(`/api/orgs/${orgQ.id}/audit`, {
      maxRedirects: 0,
    });
    expect(member.status(), "org_member reading audit must be 403").toBe(403);
    expectNoLeak(
      await member.text(),
      [...ACTION_STRINGS, qa.email],
      "member audit read",
    );

    const outsider = await qc.ctx.request.get(`/api/orgs/${orgQ.id}/audit`, {
      maxRedirects: 0,
    });
    expect(outsider.status(), "non-member reading audit must be 404").toBe(404);
    expectNoLeak(
      await outsider.text(),
      [...ACTION_STRINGS, qa.email],
      "non-member audit read",
    );
  });

  test("S3-06 audit log is append-only", async ({ world }) => {
    const { admin: qa, org: orgQ } = await provisionWorkspace(
      world,
      "m3-s3-06",
      { adminWho: "qa", orgLabel: "Probe Q", projects: 1 },
    );

    const before = await qa.ctx.request.get(`/api/orgs/${orgQ.id}/audit`);
    expect(before.status()).toBe(200);
    const rows = itemsOf(await before.json());
    expect(rows.length, "audit entries via API").toBeGreaterThan(0);
    const entryId = String(rows[0].id ?? "");
    expect(entryId, "pinned audit item id").not.toHaveLength(0);

    const targets = [
      `/api/orgs/${orgQ.id}/audit`,
      `/api/orgs/${orgQ.id}/audit/${entryId}`,
    ];
    for (const target of targets) {
      for (const verb of ["delete", "patch", "put"] as const) {
        const resp = await qa.ctx.request[verb](target, {
          data: verb === "delete" ? undefined : { action: "tampered" },
          maxRedirects: 0,
        });
        expect(
          resp.status() >= 300,
          `${verb.toUpperCase()} ${target} must not succeed (got ${resp.status()})`,
        ).toBeTruthy();
      }
    }

    const after = await qa.ctx.request.get(`/api/orgs/${orgQ.id}/audit`);
    expect(itemsOf(await after.json()).length, "audit count unchanged").toBe(
      rows.length,
    );
  });

  test("S3-07 member cannot create or list api keys", async ({ world }) => {
    const {
      admin: qa,
      org: orgQ,
      member: qb,
    } = await setupOrgWithMember(world, "m3-s3-07", {
      adminWho: "qa",
      memberWho: "qb",
      orgLabel: "Probe Q",
      projects: 0,
    });

    const create = await qb.ctx.request.post(`/api/orgs/${orgQ.id}/api-keys`, {
      data: { name: "pwn" },
      maxRedirects: 0,
    });
    expect(create.status(), "member POST api-keys must be 403").toBe(403);
    const list = await qb.ctx.request.get(`/api/orgs/${orgQ.id}/api-keys`, {
      maxRedirects: 0,
    });
    expect(list.status(), "member GET api-keys must be 403").toBe(403);

    await qa.page.goto(`/orgs/${orgQ.id}/api-keys`);
    await expect(
      qa.page.getByTestId("apikey-row").filter({ hasText: "pwn" }),
    ).toHaveCount(0, { timeout: 15_000 });

    await qa.page.goto(`/orgs/${orgQ.id}/audit`);
    const rows = await auditRows(qa.page);
    expect(
      rows.filter((r) => r.action === "apikey.created" && r.actor === qb.email),
      "no apikey.created attributed to the member",
    ).toHaveLength(0);
  });

  test("S3-08 cross-org api key revocation is denied", async ({ world }) => {
    const { admin: qa, org: orgQ } = await provisionWorkspace(
      world,
      "m3-s3-08",
      { adminWho: "qa", orgLabel: "Probe Q", projects: 1 },
    );
    // KAid is read from A's own view and handed to the attacker on purpose.
    const key = await provisionApiKey(qa, orgQ, "m3-s3-08", "q-key");
    expect(key.id, "data-key-id").toBeTruthy();

    const qc = await world.signUp("m3-s3-08", "qc");
    const orgC = await provisionOrg(qc, "m3-s3-08", "Probe C");

    for (const path of [
      `/api/orgs/${orgC.id}/api-keys/${key.id}`,
      `/api/orgs/${orgQ.id}/api-keys/${key.id}`,
    ]) {
      const resp = await qc.ctx.request.delete(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} with C's cookie must be 404`).toBe(404);
    }

    // The key still works — revocation-by-IDOR must fail.
    const api = await world.bearer(key.secret);
    const resp = await api.get("/api/v1/projects");
    expect(
      resp.status(),
      "key still authenticates after the IDOR attempt",
    ).toBe(200);
  });

  test("S3-09 non-member cannot write to a fresh org", async ({ world }) => {
    // Fresh org O3 owned by A; B is a signed-up user who was never a member.
    const { admin: qa, org: orgQ3 } = await provisionWorkspace(
      world,
      "m3-s3-09",
      { adminWho: "qa", orgLabel: "Probe Q3" },
    );
    // B must be a member of SOME other org, not a membership-less user: an app
    // that authorizes on "caller belongs to any org" would deny a bare user for
    // the wrong reason and this probe would pass without exercising the
    // per-org check it exists for. The design only requires B is never a member
    // of O3.
    const orgOther = await provisionOrg(qa, "m3-s3-09-other", "Probe Q3 Other");
    const qb = await provisionMember(
      world,
      qa,
      orgOther,
      "m3-s3-09",
      "qb",
      "org_member",
    );

    const create = await qb.ctx.request.post(`/api/orgs/${orgQ3.id}/projects`, {
      data: { name: `pwn ${RUN_ID}`, description: "x" },
      maxRedirects: 0,
    });
    expect(create.status(), "non-member POST projects must be 404").toBe(404);
    const invite = await qb.ctx.request.post(`/api/orgs/${orgQ3.id}/invites`, {
      data: { email: `pwn-m3-s3-09-${RUN_ID}@example.test`, role: "org_admin" },
      maxRedirects: 0,
    });
    expect(invite.status(), "non-member POST invites must be 404").toBe(404);

    await qa.page.goto(`/orgs/${orgQ3.id}/projects`);
    await expect(
      qa.page.getByTestId("project-row").filter({ hasText: `pwn ${RUN_ID}` }),
    ).toHaveCount(0, { timeout: 15_000 });

    await qa.page.goto(`/orgs/${orgQ3.id}/audit`);
    const rows = await auditRows(qa.page);
    expect(
      rows.filter(
        (r) =>
          ["project.created", "member.invited"].includes(r.action) &&
          r.actor === qb.email,
      ),
      "no entries attributed to the non-member",
    ).toHaveLength(0);
    expect(UUID_RE.test(orgQ3.id), "org id is a UUID").toBeTruthy();
  });
});
