// Portalis — checkpoint 2 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 2)" + "Security probes (checkpoint 2)").
// 12 CUJs (3 regression + 9 new) + 7 probes.
//
// The CUJ table ends by removing B from O1 (P2-09), while the probe table
// needs B as a *live* org_member of O1 (S2-03/S2-04) and, separately, a
// non-member who administers another org (S2-01/S2-02/S2-05). The probes
// therefore build their own world with distinct personas, which preserves
// every probe's stated setup without weakening the CUJs.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  RUN_ID,
  UUID_RE,
  anonContext,
  appBaseURL,
  createOrg,
  createProject,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  identity,
  inviteLinkFor,
  inviteMember,
  inviteRow,
  acceptInviteAt,
  memberRow,
  membershipRoles,
  numericText,
  signUpAndLand,
  switchOrg,
  tokenFromInviteLink,
} from "./fixtures";

const A = identity("m2", "a");
const B = identity("m2", "b");
const C = identity("m2", "c");
// Probe-world personas (see header note).
const PA = identity("m2", "pa"); // admin of orgP
const PM = identity("m2", "pm"); // org_member of orgP
const PO = identity("m2", "po"); // admin of orgO, never a member of orgP
const PI = identity("m2", "pi"); // invitee used for token-tampering probes

const ORG_A1 = `Acme2 ${RUN_ID}`;
const ORG_A2 = `Delta ${RUN_ID}`;
const ORG_B = `Bravo ${RUN_ID}`;
const ORG_P = `Probe ${RUN_ID}`;
const ORG_O = `Outer ${RUN_ID}`;
const P1 = `Apollo ${RUN_ID}`;
const P1_RENAMED = `Apollo II ${RUN_ID}`;
const P2 = `Doomed ${RUN_ID}`;
const P3 = `Member Project ${RUN_ID}`;
const P3_RENAMED = `Member Project v2 ${RUN_ID}`;
const P4 = `Delta Project ${RUN_ID}`;
const PP1 = `Probe Project ${RUN_ID}`;

test.describe.serial("portalis checkpoint 2", () => {
  let a: BrowserContext;
  let aPage: Page;
  let b: BrowserContext;
  let bPage: Page;
  let c: BrowserContext;
  let aId = "";
  let bId = "";
  let orgA1 = "";
  let orgA2 = "";
  let orgB = "";
  let p1Id = "";
  let p3Id = "";
  let p4Id = "";

  // Probe world.
  let pa: BrowserContext;
  let paPage: Page;
  let pm: BrowserContext;
  let po: BrowserContext;
  let pi: BrowserContext;
  let piPage: Page;
  let orgP = "";
  let orgO = "";
  let pp1Id = "";
  let paId = "";
  let pmId = "";
  let piToken = "";

  test.beforeAll(async ({ browser }) => {
    a = await browser.newContext();
    aPage = await a.newPage();
  });

  test.afterAll(async () => {
    for (const ctx of [a, b, c, pa, pm, po, pi]) await ctx?.close();
  });

  // ---- regression ---------------------------------------------------------

  test("P1-03 create org (regression)", async () => {
    await signUpAndLand(aPage, A);
    aId = String((await getMe(a)).id ?? "");
    expect(aId).not.toHaveLength(0);
    orgA1 = await createOrg(aPage, ORG_A1, `acme2-${RUN_ID}`);
    expect(orgA1).toMatch(UUID_RE);
    await expect(aPage.getByTestId("org-header-name")).toContainText(ORG_A1);
  });

  test("P1-06 fresh org lists its creator as org_admin (regression)", async () => {
    await aPage.goto(`/orgs/${orgA1}/members`);
    expect(await numericText(aPage.getByTestId("member-count").first())).toBe(
      1,
    );
    const row = memberRow(aPage, A.email);
    await expect(row.getByTestId("member-role")).toContainText("org_admin");
    expect(await row.getAttribute("data-user-id")).toBe(aId);
  });

  test("P1-07 signed-out routes redirect (regression)", async ({ browser }) => {
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    for (const route of ["/", "/orgs", `/orgs/${orgA1}`]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      expectNoLeak(await page.content(), [ORG_A1, A.email], route);
    }
    await fresh.close();
  });

  // ---- new ----------------------------------------------------------------

  test("P2-01 invite is pending with an absolute accept link", async () => {
    await inviteMember(aPage, orgA1, B.email, "org_member");
    const row = inviteRow(aPage, B.email);
    await expect(row.getByTestId("invite-status")).toContainText("pending", {
      timeout: 15_000,
    });

    const link = await inviteLinkFor(aPage, orgA1, B.email);
    const base = appBaseURL();
    expect(link, "invite-link text must be an absolute URL").toMatch(
      /^https?:\/\//,
    );
    expect(new URL(link).origin, "invite link origin").toBe(
      new URL(base).origin,
    );
    expect(new URL(link).pathname).toContain("/invite/");
    expect(
      tokenFromInviteLink(link).length,
      "invite token length",
    ).toBeGreaterThanOrEqual(24);
    expect(
      tokenFromInviteLink(link).toLowerCase(),
      "token must not be derived from the email",
    ).not.toContain(B.email.split("@")[0].toLowerCase());
  });

  test("P2-02 invitee accepts and joins with the invited role", async ({
    browser,
  }) => {
    const link = await inviteLinkFor(aPage, orgA1, B.email);
    b = await browser.newContext();
    bPage = await b.newPage();
    await signUpAndLand(bPage, B);
    bId = String((await getMe(b)).id ?? "");
    expect(bId).not.toHaveLength(0);

    await bPage.goto(link);
    await expect(bPage.getByTestId("accept-invite-org-name")).toContainText(
      ORG_A1,
      { timeout: 15_000 },
    );
    await bPage.getByTestId("accept-invite-submit").click();
    await bPage.goto(`/orgs/${orgA1}`);
    await expect(bPage.getByTestId("org-header-name")).toContainText(ORG_A1, {
      timeout: 15_000,
    });

    await aPage.goto(`/orgs/${orgA1}/members`);
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

  test("P2-03 org switcher lists every org the user belongs to", async () => {
    orgB = await createOrg(bPage, ORG_B, `bravo-${RUN_ID}`);
    await bPage.goto(`/orgs/${orgB}`);
    const options = bPage.getByTestId("org-switcher-option");
    await expect(options).toHaveCount(2, { timeout: 15_000 });
    const ids = await options.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-org-id") ?? ""),
    );
    expect(new Set(ids.filter(Boolean)).size).toBe(2);
    await switchOrg(bPage, orgA1, ORG_A1);
  });

  test("P2-04 member sees no admin controls", async () => {
    await bPage.goto(`/orgs/${orgA1}/members`);
    await expect(bPage.getByTestId("invite-submit")).toHaveCount(0);
    await expect(bPage.getByTestId("member-remove")).toHaveCount(0);
    await expect(bPage.getByTestId("member-role-select")).toHaveCount(0);

    await bPage.goto(`/orgs/${orgA1}/settings`);
    if (await bPage.getByTestId("not-authorized").count()) {
      expect(await bPage.getByTestId("not-authorized").count()).toBeGreaterThan(
        0,
      );
    } else {
      // Inputs must be inert AND saving must not change anything.
      const nameInput = bPage.getByTestId("settings-name-input").first();
      if (await nameInput.count()) {
        const disabled = await nameInput.isDisabled();
        if (!disabled) {
          await nameInput.fill(`Hijacked ${RUN_ID}`);
          const save = bPage.getByTestId("settings-save").first();
          if ((await save.count()) && !(await save.isDisabled())) {
            await save.click();
            await bPage.waitForTimeout(1_000);
          }
        }
      }
      await aPage.goto(`/orgs/${orgA1}/settings`);
      await expect(aPage.getByTestId("settings-name-input")).toHaveValue(
        ORG_A1,
        { timeout: 15_000 },
      );
    }
  });

  test("P2-05 admin creates, edits and deletes projects", async () => {
    p1Id = await createProject(aPage, orgA1, P1);
    expect(p1Id).toMatch(UUID_RE);
    const p2Id = await createProject(aPage, orgA1, P2);

    await aPage.goto(`/orgs/${orgA1}/projects/${p1Id}`);
    await aPage.getByTestId("project-edit-name-input").fill(P1_RENAMED);
    await aPage.getByTestId("project-save").click();
    await aPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      aPage.getByTestId("project-row-name").filter({ hasText: P1_RENAMED }),
    ).toHaveCount(1, { timeout: 15_000 });

    await aPage.goto(`/orgs/${orgA1}/projects/${p2Id}`);
    await aPage.getByTestId("project-delete").click();
    const confirm = aPage.getByTestId("project-delete-confirm");
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.click();
    await aPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      aPage.getByTestId("project-row").filter({ hasText: P2 }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("P2-06 member can create and edit a project", async () => {
    await switchOrg(bPage, orgA1, ORG_A1).catch(() => undefined);
    p3Id = await createProject(bPage, orgA1, P3);
    await bPage.goto(`/orgs/${orgA1}/projects/${p3Id}`);
    await bPage.getByTestId("project-edit-name-input").fill(P3_RENAMED);
    await bPage.getByTestId("project-save").click();

    await bPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      bPage.getByTestId("project-row-name").filter({ hasText: P3_RENAMED }),
    ).toHaveCount(1, { timeout: 15_000 });
    await aPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      aPage.getByTestId("project-row-name").filter({ hasText: P3_RENAMED }),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test("P2-07 member cannot delete a project", async () => {
    await bPage.goto(`/orgs/${orgA1}/projects/${p3Id}`);
    const del = bPage.getByTestId("project-delete");
    if (await del.count()) {
      expect(
        await del.first().isDisabled(),
        "project-delete must be absent or disabled for a member",
      ).toBeTruthy();
    } else {
      await expect(del).toHaveCount(0);
    }
    // Server-side truth: the project survives.
    const resp = await b.request.delete(`/api/orgs/${orgA1}/projects/${p3Id}`, {
      maxRedirects: 0,
    });
    expect([403], `member DELETE project (got ${resp.status()})`).toContain(
      resp.status(),
    );
    await aPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      aPage.getByTestId("project-row-name").filter({ hasText: P3_RENAMED }),
    ).toHaveCount(1);
  });

  test("P2-08 projects do not leak across orgs", async () => {
    orgA2 = await createOrg(aPage, ORG_A2, `delta-${RUN_ID}`);
    p4Id = await createProject(aPage, orgA2, P4);

    await aPage.goto(`/orgs/${orgA1}/projects`);
    await expect(
      aPage.getByTestId("project-row").filter({ hasText: P4 }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expectDeniedPage(aPage, `/orgs/${orgA1}/projects/${p4Id}`, [P4]);
  });

  test("P2-09 promote, revoke an invite, and remove a member", async ({
    browser,
  }) => {
    // Promote B, sourcing B's id from the pinned member row.
    await aPage.goto(`/orgs/${orgA1}/members`);
    const bRow = memberRow(aPage, B.email);
    expect(await bRow.getAttribute("data-user-id")).toBe(bId);
    await bRow
      .getByTestId("member-role-select")
      .first()
      .selectOption("org_admin");
    await expect
      .poll(async () => membershipRoles(await getMe(b), orgA1).join(","), {
        timeout: 20_000,
      })
      .toContain("org_admin");
    await bPage.goto(`/orgs/${orgA1}/members`);
    await expect(bPage.getByTestId("invite-submit")).toHaveCount(1, {
      timeout: 15_000,
    });

    // Invite C, capture the link, then revoke it.
    await inviteMember(aPage, orgA1, C.email, "org_member");
    const cLink = await inviteLinkFor(aPage, orgA1, C.email);
    await inviteRow(aPage, C.email)
      .getByTestId("invite-revoke")
      .first()
      .click();
    await expect(
      inviteRow(aPage, C.email).getByTestId("invite-status"),
    ).toContainText("revoked", { timeout: 15_000 });

    c = await browser.newContext();
    const cPage = await c.newPage();
    await signUpAndLand(cPage, C);
    const resp = await cPage.goto(cLink, { waitUntil: "domcontentloaded" });
    const errored = await cPage.getByTestId("accept-invite-error").count();
    expect(
      errored > 0 || (resp?.status() ?? 0) === 404,
      "revoked invite link must fail",
    ).toBeTruthy();
    expect(membershipRoles(await getMe(c), orgA1)).toHaveLength(0);

    // Remove B.
    await aPage.goto(`/orgs/${orgA1}/members`);
    const row = memberRow(aPage, B.email);
    await row.getByTestId("member-remove").first().click();
    const confirmScoped = row.getByTestId("member-remove-confirm");
    if (await confirmScoped.count()) {
      await confirmScoped.first().click();
    } else {
      await aPage.getByTestId("member-remove-confirm").first().click();
    }
    await expect
      .poll(
        async () =>
          numericText(aPage.getByTestId("member-count").first()).catch(
            () => NaN,
          ),
        { timeout: 20_000 },
      )
      .toBe(1);

    await bPage.goto("/orgs");
    expectNoLeak(await bPage.content(), [ORG_A1], "B's /orgs after removal");
    expect(membershipRoles(await getMe(b), orgA1)).toHaveLength(0);
  });

  // ---- probes -------------------------------------------------------------

  test("S2-01 non-member browser navigation is denied", async ({ browser }) => {
    // Probe world: PA admins orgP (project PP1), PM is an org_member of orgP,
    // PO admins an unrelated orgO and is never a member of orgP.
    pa = await browser.newContext();
    paPage = await pa.newPage();
    await signUpAndLand(paPage, PA);
    paId = String((await getMe(pa)).id ?? "");
    orgP = await createOrg(paPage, ORG_P, `probe-${RUN_ID}`);
    pp1Id = await createProject(paPage, orgP, PP1);

    await inviteMember(paPage, orgP, PM.email, "org_member");
    const pmLink = await inviteLinkFor(paPage, orgP, PM.email);
    pm = await browser.newContext();
    const pmPage = await pm.newPage();
    await signUpAndLand(pmPage, PM);
    pmId = String((await getMe(pm)).id ?? "");
    await acceptInviteAt(pmPage, pmLink);
    await expect
      .poll(async () => membershipRoles(await getMe(pm), orgP).join(","), {
        timeout: 20_000,
      })
      .toContain("org_member");

    po = await browser.newContext();
    const poPage = await po.newPage();
    await signUpAndLand(poPage, PO);
    orgO = await createOrg(poPage, ORG_O, `outer-${RUN_ID}`);

    for (const route of [
      `/orgs/${orgP}/projects`,
      `/orgs/${orgP}/projects/${pp1Id}`,
    ]) {
      await expectDeniedPage(poPage, route, [PP1, PA.email]);
    }
  });

  test("S2-02 non-member raw project API returns 404", async () => {
    for (const path of [
      `/api/orgs/${orgP}/projects`,
      `/api/orgs/${orgP}/projects/${pp1Id}`,
    ]) {
      const resp = await po.request.get(path, { maxRedirects: 0 });
      expect(
        resp.status(),
        `${path} with a non-member cookie must be 404 (existence must not leak)`,
      ).toBe(404);
      expectNoLeak(await resp.text(), [PP1], path);
    }
  });

  test("S2-03 member cannot invite", async () => {
    const resp = await pm.request.post(`/api/orgs/${orgP}/invites`, {
      data: { email: `pwn-${RUN_ID}@example.test`, role: "org_admin" },
      maxRedirects: 0,
    });
    expect(
      resp.status(),
      `member POST invites must be 403 (got ${resp.status()})`,
    ).toBe(403);

    await paPage.goto(`/orgs/${orgP}/members`);
    await expect(
      paPage.getByTestId("invite-row").filter({ hasText: `pwn-${RUN_ID}` }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("S2-04 member cannot delete projects or change memberships", async () => {
    // Ids come only from surfaces PM may read: its own /api/me, its own
    // project list, and PA's member row on the member list PM can view.
    const pmProjects = await pm.request.get(`/api/orgs/${orgP}/projects`);
    expect(pmProjects.status()).toBe(200);
    expect(await pmProjects.text()).toContain(PP1);

    const pmPage = pm.pages()[0];
    await pmPage.goto(`/orgs/${orgP}/members`);
    const adminRowId = await memberRow(pmPage, PA.email).getAttribute(
      "data-user-id",
    );
    expect(adminRowId, "PA's id from the member list PM may view").toBe(paId);

    const attempts: Array<[string, number]> = [
      [
        `DELETE /api/orgs/${orgP}/projects/${pp1Id}`,
        (
          await pm.request.delete(`/api/orgs/${orgP}/projects/${pp1Id}`, {
            maxRedirects: 0,
          })
        ).status(),
      ],
      [
        `PATCH /api/orgs/${orgP}/members/${pmId} (self-promotion)`,
        (
          await pm.request.patch(`/api/orgs/${orgP}/members/${pmId}`, {
            data: { role: "org_admin" },
            maxRedirects: 0,
          })
        ).status(),
      ],
      [
        `DELETE /api/orgs/${orgP}/members/${adminRowId} (evict admin)`,
        (
          await pm.request.delete(`/api/orgs/${orgP}/members/${adminRowId}`, {
            maxRedirects: 0,
          })
        ).status(),
      ],
    ];
    for (const [label, status] of attempts) {
      expect(status, `${label} must be 403`).toBe(403);
    }

    await paPage.goto(`/orgs/${orgP}/projects`);
    await expect(
      paPage.getByTestId("project-row").filter({ hasText: PP1 }),
    ).toHaveCount(1);
    await paPage.goto(`/orgs/${orgP}/members`);
    await expect(
      memberRow(paPage, PM.email).getByTestId("member-role"),
    ).toContainText("org_member");
    expect(membershipRoles(await getMe(pm), orgP)).toContain("org_member");
    expect(membershipRoles(await getMe(pm), orgP)).not.toContain("org_admin");
    await expect(
      memberRow(paPage, PA.email).getByTestId("member-role"),
    ).toContainText("org_admin");
  });

  test("S2-05 cross-org project addressing returns 404", async () => {
    // PO administers orgO; PP1 belongs to orgP. Addressing PP1 under orgO
    // must 404 on every verb.
    const target = `/api/orgs/${orgO}/projects/${pp1Id}`;
    const get = await po.request.get(target, { maxRedirects: 0 });
    const patch = await po.request.patch(target, {
      data: { name: `pwned ${RUN_ID}` },
      maxRedirects: 0,
    });
    const del = await po.request.delete(target, { maxRedirects: 0 });
    for (const [label, resp] of [
      ["GET", get],
      ["PATCH", patch],
      ["DELETE", del],
    ] as const) {
      expect(resp.status(), `${label} ${target} must be 404`).toBe(404);
      expectNoLeak(await resp.text(), [PP1], `${label} ${target}`);
    }

    // Unmodified when re-read by its owner.
    const owner = await pa.request.get(`/api/orgs/${orgP}/projects`);
    const body = await owner.text();
    expect(body).toContain(PP1);
    expect(body).not.toContain(`pwned ${RUN_ID}`);

    // Ids are UUIDs and not sequential.
    const ids = [orgP, orgO, pp1Id, orgA1, orgA2, p1Id, p3Id, p4Id].filter(
      Boolean,
    );
    for (const id of ids) expect(id, `${id} must be a UUID`).toMatch(UUID_RE);
    const numeric = ids.filter((id) => /^\d+$/.test(id));
    expect(numeric, "no integer ids").toHaveLength(0);
  });

  test("S2-06 unauthenticated invite accept and project read are denied", async ({
    browser,
  }) => {
    await inviteMember(paPage, orgP, PI.email, "org_member");
    const link = await inviteLinkFor(paPage, orgP, PI.email);
    piToken = tokenFromInviteLink(link);

    const anon = await anonContext();
    const accept = await anon.post(`/api/invites/${piToken}/accept`, {
      maxRedirects: 0,
    });
    expect(
      [301, 302, 303, 307, 308, 401, 403],
      `anonymous accept (got ${accept.status()})`,
    ).toContain(accept.status());
    const projects = await anon.get(`/api/orgs/${orgP}/projects`, {
      maxRedirects: 0,
    });
    expect(
      [301, 302, 303, 307, 308, 401, 403],
      `anonymous project read (got ${projects.status()})`,
    ).toContain(projects.status());
    expectNoLeak(await projects.text(), [PP1], "anonymous project read");
    await anon.dispose();

    // No membership was created by the anonymous accept.
    pi = await browser.newContext();
    piPage = await pi.newPage();
    await signUpAndLand(piPage, PI);
    expect(membershipRoles(await getMe(pi), orgP)).toHaveLength(0);
  });

  test("S2-07 invite tokens cannot be tampered, guessed, or replayed", async () => {
    // Body cannot upgrade the role or redirect the org.
    const accept = await pi.request.post(`/api/invites/${piToken}/accept`, {
      data: { role: "org_admin", orgId: orgO },
      maxRedirects: 0,
    });
    expect([200, 201, 204]).toContain(accept.status());
    await expect
      .poll(async () => membershipRoles(await getMe(pi), orgP).join(","), {
        timeout: 20_000,
      })
      .toContain("org_member");
    expect(membershipRoles(await getMe(pi), orgP)).not.toContain("org_admin");
    expect(membershipRoles(await getMe(pi), orgO)).toHaveLength(0);

    // A one-character-different token is unknown.
    const last = piToken.slice(-1);
    const flipped =
      piToken.slice(0, -1) + (last.toLowerCase() === "a" ? "b" : "a");
    expect(flipped).not.toBe(piToken);
    const tampered = await pi.request.post(`/api/invites/${flipped}/accept`, {
      maxRedirects: 0,
    });
    expect(
      tampered.status(),
      `tampered token must be 4xx (got ${tampered.status()})`,
    ).toBeGreaterThanOrEqual(400);
    expect(tampered.status()).toBeLessThan(500);

    // Replay after removal must not re-add the user.
    await paPage.goto(`/orgs/${orgP}/members`);
    const row = memberRow(paPage, PI.email);
    await row.getByTestId("member-remove").first().click();
    const scoped = row.getByTestId("member-remove-confirm");
    if (await scoped.count()) {
      await scoped.first().click();
    } else {
      await paPage.getByTestId("member-remove-confirm").first().click();
    }
    await expect
      .poll(async () => membershipRoles(await getMe(pi), orgP).length, {
        timeout: 20_000,
      })
      .toBe(0);

    const replay = await pi.request.post(`/api/invites/${piToken}/accept`, {
      maxRedirects: 0,
    });
    expect(
      replay.status(),
      `replayed accepted token must be 4xx (got ${replay.status()})`,
    ).toBeGreaterThanOrEqual(400);
    expect(replay.status()).toBeLessThan(500);
    expect(membershipRoles(await getMe(pi), orgP)).toHaveLength(0);
  });
});
