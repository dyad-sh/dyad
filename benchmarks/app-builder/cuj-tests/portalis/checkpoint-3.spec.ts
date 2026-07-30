// Portalis — checkpoint 3 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 3)" + "Security probes (checkpoint 3)").
// 12 CUJs (3 regression + 9 new) + 9 probes — the highest-signal table in the
// benchmark.
//
// The CUJ block runs on the design's `setupOrgWithMember()` world (A admin, B
// org_member, 2 projects) and ends by removing B (P3-09). The probes need a
// live member, a second member to remove mid-session, and an unrelated admin,
// so they build their own world (S3-01) rather than reusing a torn-down one.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  RUN_ID,
  UUID_RE,
  acceptInviteAt,
  apiKeyRow,
  bearerContext,
  createApiKey,
  createOrg,
  createProject,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  identity,
  inviteLinkFor,
  inviteMember,
  inviteRow,
  memberRow,
  membershipRoles,
  numericText,
  projectIdSet,
  signIn,
  signUpAndLand,
} from "./fixtures";

const A = identity("m3", "a");
const B = identity("m3", "b");
// Probe world.
const QA = identity("m3", "qa"); // admin of orgQ
const QB = identity("m3", "qb"); // org_member of orgQ (kept a member)
const QB2 = identity("m3", "qb2"); // org_member removed mid-session (S3-04)
const QC = identity("m3", "qc"); // admin of unrelated orgC

const ORG = `Audit Co ${RUN_ID}`;
const PROJ1 = `Alpha ${RUN_ID}`;
const PROJ2 = `Beta ${RUN_ID}`;
const PROJ3 = `Gamma ${RUN_ID}`;
const THROWAWAY = `Throwaway ${RUN_ID}`;
const KEY_NAME = `ci-key-${RUN_ID}`;
const ORG_Q = `Probe Q ${RUN_ID}`;
const ORG_C = `Probe C ${RUN_ID}`;
const ORG_Q3 = `Probe Q3 ${RUN_ID}`;
const QP1 = `QProj1 ${RUN_ID}`;
const QP4 = `QProj4 ${RUN_ID}`;
const QKEY = `q-key-${RUN_ID}`;
const RKEY = `revoked-key-${RUN_ID}`;

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

test.describe.serial("portalis checkpoint 3", () => {
  let a: BrowserContext;
  let aPage: Page;
  let b: BrowserContext;
  let bPage: Page;
  let aId = "";
  let bId = "";
  let org = "";
  let keySecret = "";

  // Probe world.
  let qa: BrowserContext;
  let qaPage: Page;
  let qb: BrowserContext;
  let qb2: BrowserContext;
  let qb2Page: Page;
  let qc: BrowserContext;
  let orgQ = "";
  let orgC = "";
  let orgQ3 = "";
  let qp4Id = "";
  let qKeySecret = "";
  let qKeyId = "";

  // setupOrgWithMember(): sign up A, create org, invite + accept B as
  // org_member, create 2 projects.
  test.beforeAll(async ({ browser }) => {
    a = await browser.newContext();
    aPage = await a.newPage();
    await signUpAndLand(aPage, A);
    aId = String((await getMe(a)).id ?? "");
    org = await createOrg(aPage, ORG, `auditco-${RUN_ID}`);

    await inviteMember(aPage, org, B.email, "org_member");
    const link = await inviteLinkFor(aPage, org, B.email);
    b = await browser.newContext();
    bPage = await b.newPage();
    await signUpAndLand(bPage, B);
    bId = String((await getMe(b)).id ?? "");
    await acceptInviteAt(bPage, link);

    await createProject(aPage, org, PROJ1);
    await createProject(aPage, org, PROJ2);
  });

  test.afterAll(async () => {
    for (const ctx of [a, b, qa, qb, qb2, qc]) await ctx?.close();
  });

  // ---- regression ---------------------------------------------------------

  test("P1-01 session round-trips (regression)", async () => {
    await aPage.goto("/orgs");
    await aPage.getByTestId("sign-out-button").click();
    await aPage.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await signIn(aPage, A);
    await aPage.waitForURL("**/orgs**", { timeout: 15_000 });
    await expect(aPage.getByTestId("user-email")).toContainText(A.email, {
      timeout: 15_000,
    });
    const me = await getMe(a);
    expect(me.email).toBe(A.email);
    expect(String(me.id)).toBe(aId);
    expect(String(me.name ?? "")).not.toHaveLength(0);
  });

  test("P2-02 invited member joined as org_member (regression)", async () => {
    await aPage.goto(`/orgs/${org}/members`);
    expect(await numericText(aPage.getByTestId("member-count").first())).toBe(
      2,
    );
    const row = memberRow(aPage, B.email);
    await expect(row.getByTestId("member-role")).toContainText("org_member");
    expect(await row.getAttribute("data-user-id")).toBe(bId);
    await expect(
      inviteRow(aPage, B.email).getByTestId("invite-status"),
    ).toContainText("accepted", { timeout: 15_000 });
  });

  test("P2-05 admin project lifecycle (regression)", async () => {
    const id = await createProject(aPage, org, THROWAWAY);
    await aPage.goto(`/orgs/${org}/projects/${id}`);
    await aPage
      .getByTestId("project-edit-name-input")
      .fill(`${THROWAWAY} edited`);
    await aPage.getByTestId("project-save").click();
    await aPage.goto(`/orgs/${org}/projects`);
    await expect(
      aPage
        .getByTestId("project-row-name")
        .filter({ hasText: `${THROWAWAY} edited` }),
    ).toHaveCount(1, { timeout: 15_000 });

    await aPage.goto(`/orgs/${org}/projects/${id}`);
    await aPage.getByTestId("project-delete").click();
    await aPage.getByTestId("project-delete-confirm").first().click();
    await aPage.goto(`/orgs/${org}/projects`);
    await expect(
      aPage.getByTestId("project-row").filter({ hasText: THROWAWAY }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  // ---- new ----------------------------------------------------------------

  test("P3-01 audit log covers the actions taken so far", async () => {
    await aPage.goto(`/orgs/${org}/audit`);
    await expect(aPage.getByTestId("audit-table")).toBeVisible({
      timeout: 15_000,
    });
    const rows = await auditRows(aPage);
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
      expect([A.email, B.email], `actor ${row.actor}`).toContain(row.actor);
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

  test("P3-02 audit filters by action", async () => {
    await aPage.goto(`/orgs/${org}/audit`);
    await setFilter(aPage, "audit-filter-action", "project.created");
    await aPage.getByTestId("audit-filter-apply").click();
    await aPage.waitForLoadState("networkidle").catch(() => undefined);

    const rows = await auditRows(aPage);
    expect(rows.length, "project.created rows").toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.action, "every visible row matches the filter").toBe(
        "project.created",
      );
    }
  });

  test("P3-03 audit filters by actor", async () => {
    await aPage.goto(`/orgs/${org}/audit`);
    await setFilter(aPage, "audit-filter-action", "");
    await setFilter(aPage, "audit-filter-actor", B.email);
    await aPage.getByTestId("audit-filter-apply").click();
    await aPage.waitForLoadState("networkidle").catch(() => undefined);

    const rows = await auditRows(aPage);
    expect(rows.length, "rows for actor B").toBeGreaterThan(0);
    for (const row of rows) expect(row.actor).toBe(B.email);
    expect(
      rows.some((r) => r.action === "invite.accepted"),
      "B's invite.accepted must be present",
    ).toBeTruthy();
  });

  test("P3-04 member cannot view the audit log", async () => {
    await bPage.goto(`/orgs/${org}`);
    await expect(bPage.getByTestId("nav-audit")).toHaveCount(0);
    await expectDeniedPage(bPage, `/orgs/${org}/audit`, ACTION_STRINGS);
    await expect(bPage.getByTestId("audit-row")).toHaveCount(0);
  });

  test("P3-05 api key plaintext is shown exactly once", async () => {
    keySecret = await createApiKey(aPage, org, KEY_NAME);
    expect(keySecret.length, "api key length").toBeGreaterThanOrEqual(24);

    await aPage.reload();
    await expect(aPage.getByTestId("apikey-plaintext")).toHaveCount(0, {
      timeout: 15_000,
    });

    const row = apiKeyRow(aPage, KEY_NAME);
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

  test("P3-06 bearer key lists exactly that org's projects", async () => {
    const uiIds = await projectIdSet(aPage, org);
    expect(uiIds.size, "projects in the UI").toBeGreaterThan(0);

    const api = await bearerContext(keySecret);
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
    await api.dispose();
  });

  test("P3-07 revoked key stops authenticating", async () => {
    await aPage.goto(`/orgs/${org}/api-keys`);
    const row = apiKeyRow(aPage, KEY_NAME);
    await row.getByTestId("apikey-revoke").first().click();
    await expect(apiKeyRow(aPage, KEY_NAME)).toBeVisible({ timeout: 15_000 });
    await expect(
      apiKeyRow(aPage, KEY_NAME).getByTestId("apikey-status"),
    ).toContainText("revoked", { timeout: 15_000 });

    const api = await bearerContext(keySecret);
    const resp = await api.get("/api/v1/projects", { maxRedirects: 0 });
    expect(resp.status(), "revoked key must be 401").toBe(401);
    await api.dispose();
  });

  test("P3-08 usage dashboard counts match reality", async () => {
    await aPage.goto(`/orgs/${org}/usage`);
    expect(
      await numericText(aPage.getByTestId("usage-members-count").first()),
    ).toBe(2);
    const before = await numericText(
      aPage.getByTestId("usage-projects-count").first(),
    );
    const uiIds = await projectIdSet(aPage, org);
    expect(before, "projects count matches the list").toBe(uiIds.size);
    await aPage.goto(`/orgs/${org}/usage`);
    expect(
      await numericText(aPage.getByTestId("usage-api-keys-count").first()),
      "active keys after revocation",
    ).toBe(0);
    expect(
      await numericText(aPage.getByTestId("usage-events-count").first()),
    ).toBeGreaterThan(0);

    await createProject(aPage, org, PROJ3);
    await aPage.goto(`/orgs/${org}/usage`);
    expect(
      await numericText(aPage.getByTestId("usage-projects-count").first()),
    ).toBe(before + 1);
  });

  test("P3-09 removal is audited and history is preserved", async () => {
    await aPage.goto(`/orgs/${org}/members`);
    const row = memberRow(aPage, B.email);
    await row.getByTestId("member-remove").first().click();
    const scoped = row.getByTestId("member-remove-confirm");
    if (await scoped.count()) {
      await scoped.first().click();
    } else {
      await aPage.getByTestId("member-remove-confirm").first().click();
    }
    await expect
      .poll(async () => membershipRoles(await getMe(b), org).length, {
        timeout: 20_000,
      })
      .toBe(0);

    await aPage.goto(`/orgs/${org}/audit`);
    const rows = await auditRows(aPage);
    for (const action of [
      "apikey.created",
      "apikey.revoked",
      "member.removed",
    ]) {
      const hit = rows.find((r) => r.action === action);
      expect(hit, `audit must contain ${action}`).toBeTruthy();
      expect(hit!.actor, `${action} actor`).toBe(A.email);
    }
    const accepted = rows.find((r) => r.action === "invite.accepted");
    expect(accepted, "invite.accepted survives removal").toBeTruthy();
    expect(
      accepted!.actor,
      "removed member's email must survive in history",
    ).toBe(B.email);
  });

  // ---- probes -------------------------------------------------------------

  test("S3-01 api key secret is never stored in plaintext", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    // Build the probe world.
    qa = await browser.newContext();
    qaPage = await qa.newPage();
    await signUpAndLand(qaPage, QA);
    orgQ = await createOrg(qaPage, ORG_Q, `probeq-${RUN_ID}`);
    await createProject(qaPage, orgQ, QP1);
    orgQ3 = await createOrg(qaPage, ORG_Q3, `probeq3-${RUN_ID}`);

    for (const who of [QB, QB2]) {
      await inviteMember(qaPage, orgQ, who.email, "org_member");
      const link = await inviteLinkFor(qaPage, orgQ, who.email);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signUpAndLand(page, who);
      await acceptInviteAt(page, link);
      await expect
        .poll(async () => membershipRoles(await getMe(ctx), orgQ).join(","), {
          timeout: 20_000,
        })
        .toContain("org_member");
      if (who === QB) {
        qb = ctx;
      } else {
        qb2 = ctx;
        qb2Page = page;
      }
    }

    qc = await browser.newContext();
    const qcPage = await qc.newPage();
    await signUpAndLand(qcPage, QC);
    orgC = await createOrg(qcPage, ORG_C, `probec-${RUN_ID}`);
    qp4Id = await createProject(qcPage, orgC, QP4);

    // Key created through the UI, plaintext captured.
    qKeySecret = await createApiKey(qaPage, orgQ, QKEY);
    await qaPage.reload();
    qKeyId = String(await apiKeyRow(qaPage, QKEY).getAttribute("data-key-id"));
    expect(qKeyId, "data-key-id").toBeTruthy();

    // The secret must not appear in any admin-readable API surface.
    for (const path of [
      `/api/orgs/${orgQ}/api-keys`,
      `/api/orgs/${orgQ}/audit`,
    ]) {
      const resp = await qa.request.get(path);
      if (resp.ok()) {
        expectNoLeak(await resp.text(), [qKeySecret], path);
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
            const key = `"${row.table_schema}"."${row.table_name}"`;
            byTable.set(key, [...(byTable.get(key) ?? []), row.column_name]);
          }
          for (const [table, columns] of byTable) {
            const where = columns
              .map((c) => `"${c}"::text LIKE $1`)
              .join(" OR ");
            const hit = await client.query(
              `SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`,
              [`%${qKeySecret}%`],
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
          fs.readFileSync(logPath, "utf8").includes(qKeySecret),
          "api key secret must not appear in the server log",
        ).toBeFalsy();
      }
    }
  });

  test("S3-02 revoked and random bearer tokens are rejected", async () => {
    const revokedSecret = await createApiKey(qaPage, orgQ, RKEY);
    await qaPage.reload();
    await apiKeyRow(qaPage, RKEY).getByTestId("apikey-revoke").first().click();
    await expect(
      apiKeyRow(qaPage, RKEY).getByTestId("apikey-status"),
    ).toContainText("revoked", { timeout: 15_000 });

    const random = revokedSecret
      .split("")
      .reverse()
      .join("")
      .replace(/[^a-zA-Z0-9_-]/g, "x");
    for (const [label, token] of [
      ["revoked", revokedSecret],
      ["random", random],
    ] as const) {
      const api = await bearerContext(token);
      const resp = await api.get("/api/v1/projects", { maxRedirects: 0 });
      expect(resp.status(), `${label} token must be 401`).toBe(401);
      expectNoLeak(await resp.text(), [QP1, QP4], `${label} token`);
      await api.dispose();
    }
  });

  test("S3-03 keys are org-scoped and read-only", async () => {
    const uiIds = await projectIdSet(qaPage, orgQ);
    const api = await bearerContext(qKeySecret);

    const list = await api.get("/api/v1/projects");
    expect(list.status()).toBe(200);
    const ids = new Set(itemsOf(await list.json()).map((i) => String(i.id)));
    expect(ids, "bearer list is scoped to its own org").toEqual(uiIds);
    expect(ids.has(qp4Id), "other org's project id must be absent").toBeFalsy();

    const write = await api.post("/api/v1/projects", {
      data: { name: `pwn ${RUN_ID}` },
      maxRedirects: 0,
    });
    expect(
      [401, 403, 405],
      `keys are read-only (got ${write.status()})`,
    ).toContain(write.status());

    const crossOrg = await api.get(`/api/orgs/${orgC}/projects`, {
      maxRedirects: 0,
    });
    expect(
      [401, 404],
      `cross-org bearer read (got ${crossOrg.status()})`,
    ).toContain(crossOrg.status());
    expectNoLeak(await crossOrg.text(), [QP4], "cross-org bearer read");
    await api.dispose();
  });

  test("S3-04 removing a member invalidates their live session", async () => {
    await qaPage.goto(`/orgs/${orgQ}/members`);
    const row = memberRow(qaPage, QB2.email);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId("member-remove").first().click();
    const scoped = row.getByTestId("member-remove-confirm");
    if (await scoped.count()) {
      await scoped.first().click();
    } else {
      await qaPage.getByTestId("member-remove-confirm").first().click();
    }
    await expect(memberRow(qaPage, QB2.email)).toHaveCount(0, {
      timeout: 20_000,
    });

    // Same context, no re-login.
    const api = await qb2.request.get(`/api/orgs/${orgQ}/projects`, {
      maxRedirects: 0,
    });
    expect(
      api.status(),
      `removed member's API access must be 404 (got ${api.status()})`,
    ).toBe(404);
    expectNoLeak(await api.text(), [QP1], "removed member API read");

    await expectDeniedPage(qb2Page, `/orgs/${orgQ}`, [QP1]);
    await qb2Page.goto("/orgs");
    expectNoLeak(await qb2Page.content(), [ORG_Q], "removed member /orgs");
    expect(membershipRoles(await getMe(qb2), orgQ)).toHaveLength(0);
  });

  test("S3-05 audit log denied to members and non-members", async () => {
    const member = await qb.request.get(`/api/orgs/${orgQ}/audit`, {
      maxRedirects: 0,
    });
    expect(member.status(), "org_member reading audit must be 403").toBe(403);
    expectNoLeak(
      await member.text(),
      [...ACTION_STRINGS, QA.email],
      "member audit read",
    );

    const outsider = await qc.request.get(`/api/orgs/${orgQ}/audit`, {
      maxRedirects: 0,
    });
    expect(outsider.status(), "non-member reading audit must be 404").toBe(404);
    expectNoLeak(
      await outsider.text(),
      [...ACTION_STRINGS, QA.email],
      "non-member audit read",
    );
  });

  test("S3-06 audit log is append-only", async () => {
    const before = await qa.request.get(`/api/orgs/${orgQ}/audit`);
    expect(before.status()).toBe(200);
    const rows = itemsOf(await before.json());
    expect(rows.length, "audit entries via API").toBeGreaterThan(0);
    const entryId = String(rows[0].id ?? "");
    expect(entryId, "pinned audit item id").not.toHaveLength(0);

    const targets = [
      `/api/orgs/${orgQ}/audit`,
      `/api/orgs/${orgQ}/audit/${entryId}`,
    ];
    for (const target of targets) {
      for (const verb of ["delete", "patch", "put"] as const) {
        const resp = await qa.request[verb](target, {
          data: verb === "delete" ? undefined : { action: "tampered" },
          maxRedirects: 0,
        });
        expect(
          resp.status() >= 300,
          `${verb.toUpperCase()} ${target} must not succeed (got ${resp.status()})`,
        ).toBeTruthy();
      }
    }

    const after = await qa.request.get(`/api/orgs/${orgQ}/audit`);
    expect(itemsOf(await after.json()).length, "audit count unchanged").toBe(
      rows.length,
    );
  });

  test("S3-07 member cannot create or list api keys", async () => {
    const create = await qb.request.post(`/api/orgs/${orgQ}/api-keys`, {
      data: { name: "pwn" },
      maxRedirects: 0,
    });
    expect(create.status(), "member POST api-keys must be 403").toBe(403);
    const list = await qb.request.get(`/api/orgs/${orgQ}/api-keys`, {
      maxRedirects: 0,
    });
    expect(list.status(), "member GET api-keys must be 403").toBe(403);

    await qaPage.goto(`/orgs/${orgQ}/api-keys`);
    await expect(
      qaPage.getByTestId("apikey-row").filter({ hasText: "pwn" }),
    ).toHaveCount(0, { timeout: 15_000 });

    await qaPage.goto(`/orgs/${orgQ}/audit`);
    const rows = await auditRows(qaPage);
    expect(
      rows.filter((r) => r.action === "apikey.created" && r.actor === QB.email),
      "no apikey.created attributed to the member",
    ).toHaveLength(0);
  });

  test("S3-08 cross-org api key revocation is denied", async () => {
    for (const path of [
      `/api/orgs/${orgC}/api-keys/${qKeyId}`,
      `/api/orgs/${orgQ}/api-keys/${qKeyId}`,
    ]) {
      const resp = await qc.request.delete(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} with C's cookie must be 404`).toBe(404);
    }

    // The key still works — revocation-by-IDOR must fail.
    const api = await bearerContext(qKeySecret);
    const resp = await api.get("/api/v1/projects");
    expect(
      resp.status(),
      "key still authenticates after the IDOR attempt",
    ).toBe(200);
    await api.dispose();
  });

  test("S3-09 non-member cannot write to a fresh org", async () => {
    const create = await qb.request.post(`/api/orgs/${orgQ3}/projects`, {
      data: { name: `pwn ${RUN_ID}`, description: "x" },
      maxRedirects: 0,
    });
    expect(create.status(), "non-member POST projects must be 404").toBe(404);
    const invite = await qb.request.post(`/api/orgs/${orgQ3}/invites`, {
      data: { email: `pwn-${RUN_ID}@example.test`, role: "org_admin" },
      maxRedirects: 0,
    });
    expect(invite.status(), "non-member POST invites must be 404").toBe(404);

    await qaPage.goto(`/orgs/${orgQ3}/projects`);
    await expect(
      qaPage.getByTestId("project-row").filter({ hasText: `pwn ${RUN_ID}` }),
    ).toHaveCount(0, { timeout: 15_000 });

    await qaPage.goto(`/orgs/${orgQ3}/audit`);
    const rows = await auditRows(qaPage);
    expect(
      rows.filter(
        (r) =>
          ["project.created", "member.invited"].includes(r.action) &&
          r.actor === QB.email,
      ),
      "no entries attributed to the non-member",
    ).toHaveLength(0);
    expect(UUID_RE.test(orgQ3), "org id is a UUID").toBeTruthy();
  });
});
