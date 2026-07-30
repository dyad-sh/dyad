// Portalis — checkpoint 2 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 2)" + "Security probes (checkpoint 2)").
// 12 CUJs (3 regression + 9 new) + 7 probes.
//
// Every test is independent: it provisions exactly the world its design-table
// row names (admin / member / non-member admin of another org / pending
// invite) through the `world` fixture, so any test can be run alone with
//   npx playwright test portalis/checkpoint-2.spec.ts -g "S2-04"
// and a failure can never skip another test.
import {
  RUN_ID,
  UUID_RE,
  appBaseURL,
  expect,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  inviteRow,
  memberRow,
  membershipRoles,
  numericText,
  provisionInvite,
  provisionOrg,
  provisionProject,
  provisionWorkspace,
  removeMemberVia,
  scopedName,
  setupOrgWithMember,
  switchOrg,
  test,
  tokenFromInviteLink,
} from "./fixtures";

test.describe("portalis checkpoint 2", () => {
  // ---- regression ---------------------------------------------------------

  test("P1-03 create org (regression)", async ({ world }) => {
    const a = await world.signUp("m2-p1-03", "a");
    expect(a.id).not.toHaveLength(0);

    const org = await provisionOrg(a, "m2-p1-03", "Acme2");
    expect(org.id).toMatch(UUID_RE);
    await expect(a.page.getByTestId("org-header-name")).toContainText(org.name);
  });

  test("P1-06 fresh org lists its creator as org_admin (regression)", async ({
    world,
  }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m2-p1-06", {
      orgLabel: "Acme2",
    });

    await a.page.goto(`/orgs/${org.id}/members`);
    expect(await numericText(a.page.getByTestId("member-count").first())).toBe(
      1,
    );
    const row = memberRow(a.page, a.email);
    await expect(row.getByTestId("member-role")).toContainText("org_admin");
    expect(await row.getAttribute("data-user-id")).toBe(a.id);
  });

  test("P1-07 signed-out routes redirect (regression)", async ({ world }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m2-p1-07", {
      orgLabel: "Acme2",
    });

    const fresh = await world.context();
    const page = await fresh.newPage();
    for (const route of ["/", "/orgs", `/orgs/${org.id}`]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      expectNoLeak(await page.content(), [org.name, a.email], route);
    }
  });

  // ---- new ----------------------------------------------------------------

  test("P2-01 invite is pending with an absolute accept link", async ({
    world,
  }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m2-p2-01", {
      orgLabel: "Acme2",
    });

    // The invitee is a plain email address here: nobody has signed up for it.
    const invite = await provisionInvite(a, org, "m2-p2-01", "b");
    const row = inviteRow(a.page, invite.email);
    await expect(row.getByTestId("invite-status")).toContainText("pending", {
      timeout: 15_000,
    });

    const link = invite.link;
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
    ).not.toContain(invite.email.split("@")[0].toLowerCase());
  });

  test("P2-02 invitee accepts and joins with the invited role", async ({
    world,
  }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m2-p2-02", {
      orgLabel: "Acme2",
    });
    const invite = await provisionInvite(a, org, "m2-p2-02", "b");

    // Accepting is the CUJ itself, so B does it by hand rather than through
    // provisionMember().
    const b = await world.signUp("m2-p2-02", "b");
    await b.page.goto(invite.link);
    await expect(b.page.getByTestId("accept-invite-org-name")).toContainText(
      org.name,
      { timeout: 15_000 },
    );
    await b.page.getByTestId("accept-invite-submit").click();
    await b.page.goto(`/orgs/${org.id}`);
    await expect(b.page.getByTestId("org-header-name")).toContainText(
      org.name,
      {
        timeout: 15_000,
      },
    );

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

  test("P2-03 org switcher lists every org the user belongs to", async ({
    world,
  }) => {
    const { org: orgA1, member: b } = await setupOrgWithMember(
      world,
      "m2-p2-03",
      { orgLabel: "Acme2", projects: 0 },
    );

    const orgB = await provisionOrg(b, "m2-p2-03", "Bravo");
    await b.page.goto(`/orgs/${orgB.id}`);
    const options = b.page.getByTestId("org-switcher-option");
    await expect(options).toHaveCount(2, { timeout: 15_000 });
    const ids = await options.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-org-id") ?? ""),
    );
    expect(new Set(ids.filter(Boolean)).size).toBe(2);
    await switchOrg(b.page, orgA1.id, orgA1.name);
  });

  test("P2-04 member sees no admin controls", async ({ world }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m2-p2-04", {
      orgLabel: "Acme2",
      projects: 0,
    });

    await b.page.goto(`/orgs/${org.id}/members`);
    await expect(b.page.getByTestId("invite-submit")).toHaveCount(0);
    await expect(b.page.getByTestId("member-remove")).toHaveCount(0);
    await expect(b.page.getByTestId("member-role-select")).toHaveCount(0);

    await b.page.goto(`/orgs/${org.id}/settings`);
    if (await b.page.getByTestId("not-authorized").count()) {
      expect(
        await b.page.getByTestId("not-authorized").count(),
      ).toBeGreaterThan(0);
    } else {
      // Inputs must be inert AND saving must not change anything.
      const nameInput = b.page.getByTestId("settings-name-input").first();
      if (await nameInput.count()) {
        const disabled = await nameInput.isDisabled();
        if (!disabled) {
          await nameInput.fill(`Hijacked ${RUN_ID}`);
          const save = b.page.getByTestId("settings-save").first();
          if ((await save.count()) && !(await save.isDisabled())) {
            await save.click();
            await b.page.waitForTimeout(1_000);
          }
        }
      }
      await a.page.goto(`/orgs/${org.id}/settings`);
      await expect(a.page.getByTestId("settings-name-input")).toHaveValue(
        org.name,
        { timeout: 15_000 },
      );
    }
  });

  test("P2-05 admin creates, edits and deletes projects", async ({ world }) => {
    const { admin: a, org } = await provisionWorkspace(world, "m2-p2-05", {
      orgLabel: "Acme2",
    });

    const p1 = await provisionProject(a, org, "m2-p2-05", "Apollo");
    expect(p1.id).toMatch(UUID_RE);
    const p2 = await provisionProject(a, org, "m2-p2-05", "Doomed");
    const p1Renamed = scopedName("m2-p2-05", "Apollo II");

    await a.page.goto(`/orgs/${org.id}/projects/${p1.id}`);
    await a.page.getByTestId("project-edit-name-input").fill(p1Renamed);
    await a.page.getByTestId("project-save").click();
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row-name").filter({ hasText: p1Renamed }),
    ).toHaveCount(1, { timeout: 15_000 });

    await a.page.goto(`/orgs/${org.id}/projects/${p2.id}`);
    await a.page.getByTestId("project-delete").click();
    const confirm = a.page.getByTestId("project-delete-confirm");
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.click();
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row").filter({ hasText: p2.name }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("P2-06 member can create and edit a project", async ({ world }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m2-p2-06", {
      orgLabel: "Acme2",
      projects: 0,
    });

    const p3 = await provisionProject(b, org, "m2-p2-06", "Member Project");
    const p3Renamed = scopedName("m2-p2-06", "Member Project v2");
    await b.page.goto(`/orgs/${org.id}/projects/${p3.id}`);
    await b.page.getByTestId("project-edit-name-input").fill(p3Renamed);
    await b.page.getByTestId("project-save").click();

    await b.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      b.page.getByTestId("project-row-name").filter({ hasText: p3Renamed }),
    ).toHaveCount(1, { timeout: 15_000 });
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row-name").filter({ hasText: p3Renamed }),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test("P2-07 member cannot delete a project", async ({ world }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m2-p2-07", {
      orgLabel: "Acme2",
      projects: 0,
    });
    // P3 is the member's own project, exactly as in P2-06.
    const p3 = await provisionProject(b, org, "m2-p2-07", "Member Project");

    await b.page.goto(`/orgs/${org.id}/projects/${p3.id}`);
    const del = b.page.getByTestId("project-delete");
    if (await del.count()) {
      expect(
        await del.first().isDisabled(),
        "project-delete must be absent or disabled for a member",
      ).toBeTruthy();
    } else {
      await expect(del).toHaveCount(0);
    }
    // Server-side truth: the project survives.
    const resp = await b.ctx.request.delete(
      `/api/orgs/${org.id}/projects/${p3.id}`,
      { maxRedirects: 0 },
    );
    expect([403], `member DELETE project (got ${resp.status()})`).toContain(
      resp.status(),
    );
    await a.page.goto(`/orgs/${org.id}/projects`);
    await expect(
      a.page.getByTestId("project-row-name").filter({ hasText: p3.name }),
    ).toHaveCount(1);
  });

  test("P2-08 projects do not leak across orgs", async ({ world }) => {
    const { admin: a, org: orgA1 } = await provisionWorkspace(
      world,
      "m2-p2-08",
      { orgLabel: "Acme2" },
    );

    const orgA2 = await provisionOrg(a, "m2-p2-08", "Delta");
    const p4 = await provisionProject(a, orgA2, "m2-p2-08", "Delta Project");

    await a.page.goto(`/orgs/${orgA1.id}/projects`);
    await expect(
      a.page.getByTestId("project-row").filter({ hasText: p4.name }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expectDeniedPage(a.page, `/orgs/${orgA1.id}/projects/${p4.id}`, [
      p4.name,
    ]);
  });

  test("P2-09 promote, revoke an invite, and remove a member", async ({
    world,
  }) => {
    const {
      admin: a,
      org,
      member: b,
    } = await setupOrgWithMember(world, "m2-p2-09", {
      orgLabel: "Acme2",
      projects: 0,
    });

    // Promote B, sourcing B's id from the pinned member row.
    await a.page.goto(`/orgs/${org.id}/members`);
    const bRow = memberRow(a.page, b.email);
    expect(await bRow.getAttribute("data-user-id")).toBe(b.id);
    await bRow
      .getByTestId("member-role-select")
      .first()
      .selectOption("org_admin");
    await expect
      .poll(async () => membershipRoles(await getMe(b.ctx), org.id).join(","), {
        timeout: 20_000,
      })
      .toContain("org_admin");
    await b.page.goto(`/orgs/${org.id}/members`);
    await expect(b.page.getByTestId("invite-submit")).toHaveCount(1, {
      timeout: 15_000,
    });

    // Invite C, capture the link, then revoke it.
    const cInvite = await provisionInvite(a, org, "m2-p2-09", "c");
    await inviteRow(a.page, cInvite.email)
      .getByTestId("invite-revoke")
      .first()
      .click();
    await expect(
      inviteRow(a.page, cInvite.email).getByTestId("invite-status"),
    ).toContainText("revoked", { timeout: 15_000 });

    const c = await world.signUp("m2-p2-09", "c");
    const resp = await c.page.goto(cInvite.link, {
      waitUntil: "domcontentloaded",
    });
    const errored = await c.page.getByTestId("accept-invite-error").count();
    expect(
      errored > 0 || (resp?.status() ?? 0) === 404,
      "revoked invite link must fail",
    ).toBeTruthy();
    expect(membershipRoles(await getMe(c.ctx), org.id)).toHaveLength(0);

    // Remove B.
    await removeMemberVia(a.page, org.id, b.email);
    await expect
      .poll(
        async () =>
          numericText(a.page.getByTestId("member-count").first()).catch(
            () => NaN,
          ),
        { timeout: 20_000 },
      )
      .toBe(1);

    await b.page.goto("/orgs");
    expectNoLeak(await b.page.content(), [org.name], "B's /orgs after removal");
    expect(membershipRoles(await getMe(b.ctx), org.id)).toHaveLength(0);
  });

  // ---- probes -------------------------------------------------------------

  test("S2-01 non-member browser navigation is denied", async ({ world }) => {
    // A owns O1 with project P1; the attacker administers an unrelated org.
    const { admin: pa, org: orgP } = await provisionWorkspace(
      world,
      "m2-s2-01",
      { adminWho: "pa", orgLabel: "Probe" },
    );
    const pp1 = await provisionProject(pa, orgP, "m2-s2-01", "Probe Project");

    const po = await world.signUp("m2-s2-01", "po");
    await provisionOrg(po, "m2-s2-01", "Outer");

    for (const route of [
      `/orgs/${orgP.id}/projects`,
      `/orgs/${orgP.id}/projects/${pp1.id}`,
    ]) {
      await expectDeniedPage(po.page, route, [pp1.name, pa.email]);
    }
  });

  test("S2-02 non-member raw project API returns 404", async ({ world }) => {
    const { admin: pa, org: orgP } = await provisionWorkspace(
      world,
      "m2-s2-02",
      { adminWho: "pa", orgLabel: "Probe" },
    );
    const pp1 = await provisionProject(pa, orgP, "m2-s2-02", "Probe Project");

    const po = await world.signUp("m2-s2-02", "po");
    await provisionOrg(po, "m2-s2-02", "Outer");

    for (const path of [
      `/api/orgs/${orgP.id}/projects`,
      `/api/orgs/${orgP.id}/projects/${pp1.id}`,
    ]) {
      const resp = await po.ctx.request.get(path, { maxRedirects: 0 });
      expect(
        resp.status(),
        `${path} with a non-member cookie must be 404 (existence must not leak)`,
      ).toBe(404);
      expectNoLeak(await resp.text(), [pp1.name], path);
    }
  });

  test("S2-03 member cannot invite", async ({ world }) => {
    const {
      admin: pa,
      org: orgP,
      member: pm,
    } = await setupOrgWithMember(world, "m2-s2-03", {
      adminWho: "pa",
      memberWho: "pm",
      orgLabel: "Probe",
      projects: 0,
    });
    const pwn = `pwn-m2-s2-03-${RUN_ID}`;

    const resp = await pm.ctx.request.post(`/api/orgs/${orgP.id}/invites`, {
      data: { email: `${pwn}@example.test`, role: "org_admin" },
      maxRedirects: 0,
    });
    expect(
      resp.status(),
      `member POST invites must be 403 (got ${resp.status()})`,
    ).toBe(403);

    await pa.page.goto(`/orgs/${orgP.id}/members`);
    await expect(
      pa.page.getByTestId("invite-row").filter({ hasText: pwn }),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test("S2-04 member cannot delete projects or change memberships", async ({
    world,
  }) => {
    const {
      admin: pa,
      org: orgP,
      member: pm,
      projects,
    } = await setupOrgWithMember(world, "m2-s2-04", {
      adminWho: "pa",
      memberWho: "pm",
      orgLabel: "Probe",
      projectLabels: ["Probe Project"],
    });
    const pp1 = projects[0];

    // Ids come only from surfaces PM may read: its own /api/me, its own
    // project list, and PA's member row on the member list PM can view.
    const pmProjects = await pm.ctx.request.get(
      `/api/orgs/${orgP.id}/projects`,
    );
    expect(pmProjects.status()).toBe(200);
    expect(await pmProjects.text()).toContain(pp1.name);

    await pm.page.goto(`/orgs/${orgP.id}/members`);
    const adminRowId = await memberRow(pm.page, pa.email).getAttribute(
      "data-user-id",
    );
    expect(adminRowId, "PA's id from the member list PM may view").toBe(pa.id);

    const attempts: Array<[string, number]> = [
      [
        `DELETE /api/orgs/${orgP.id}/projects/${pp1.id}`,
        (
          await pm.ctx.request.delete(
            `/api/orgs/${orgP.id}/projects/${pp1.id}`,
            { maxRedirects: 0 },
          )
        ).status(),
      ],
      [
        `PATCH /api/orgs/${orgP.id}/members/${pm.id} (self-promotion)`,
        (
          await pm.ctx.request.patch(`/api/orgs/${orgP.id}/members/${pm.id}`, {
            data: { role: "org_admin" },
            maxRedirects: 0,
          })
        ).status(),
      ],
      [
        `DELETE /api/orgs/${orgP.id}/members/${adminRowId} (evict admin)`,
        (
          await pm.ctx.request.delete(
            `/api/orgs/${orgP.id}/members/${adminRowId}`,
            { maxRedirects: 0 },
          )
        ).status(),
      ],
    ];
    for (const [label, status] of attempts) {
      expect(status, `${label} must be 403`).toBe(403);
    }

    await pa.page.goto(`/orgs/${orgP.id}/projects`);
    await expect(
      pa.page.getByTestId("project-row").filter({ hasText: pp1.name }),
    ).toHaveCount(1);
    await pa.page.goto(`/orgs/${orgP.id}/members`);
    await expect(
      memberRow(pa.page, pm.email).getByTestId("member-role"),
    ).toContainText("org_member");
    expect(membershipRoles(await getMe(pm.ctx), orgP.id)).toContain(
      "org_member",
    );
    expect(membershipRoles(await getMe(pm.ctx), orgP.id)).not.toContain(
      "org_admin",
    );
    await expect(
      memberRow(pa.page, pa.email).getByTestId("member-role"),
    ).toContainText("org_admin");
  });

  test("S2-05 cross-org project addressing returns 404", async ({ world }) => {
    // PO administers orgO (with its own project P4); PP1 belongs to orgP.
    // Addressing PP1 under orgO must 404 on every verb.
    const { admin: pa, org: orgP } = await provisionWorkspace(
      world,
      "m2-s2-05",
      { adminWho: "pa", orgLabel: "Probe" },
    );
    const pp1 = await provisionProject(pa, orgP, "m2-s2-05", "Probe Project");

    const po = await world.signUp("m2-s2-05", "po");
    const orgO = await provisionOrg(po, "m2-s2-05", "Outer");
    const p4 = await provisionProject(po, orgO, "m2-s2-05", "Outer Project");

    const target = `/api/orgs/${orgO.id}/projects/${pp1.id}`;
    const get = await po.ctx.request.get(target, { maxRedirects: 0 });
    const patch = await po.ctx.request.patch(target, {
      data: { name: `pwned ${RUN_ID}` },
      maxRedirects: 0,
    });
    const del = await po.ctx.request.delete(target, { maxRedirects: 0 });
    for (const [label, resp] of [
      ["GET", get],
      ["PATCH", patch],
      ["DELETE", del],
    ] as const) {
      expect(resp.status(), `${label} ${target} must be 404`).toBe(404);
      expectNoLeak(await resp.text(), [pp1.name], `${label} ${target}`);
    }

    // Unmodified when re-read by its owner.
    const owner = await pa.ctx.request.get(`/api/orgs/${orgP.id}/projects`);
    const body = await owner.text();
    expect(body).toContain(pp1.name);
    expect(body).not.toContain(`pwned ${RUN_ID}`);

    // Ids are UUIDs and not sequential.
    const ids = [orgP.id, orgO.id, pp1.id, p4.id].filter(Boolean);
    for (const id of ids) expect(id, `${id} must be a UUID`).toMatch(UUID_RE);
    const numeric = ids.filter((id) => /^\d+$/.test(id));
    expect(numeric, "no integer ids").toHaveLength(0);
  });

  test("S2-06 unauthenticated invite accept and project read are denied", async ({
    world,
  }) => {
    const { admin: pa, org: orgP } = await provisionWorkspace(
      world,
      "m2-s2-06",
      { adminWho: "pa", orgLabel: "Probe" },
    );
    const pp1 = await provisionProject(pa, orgP, "m2-s2-06", "Probe Project");
    const invite = await provisionInvite(pa, orgP, "m2-s2-06", "pi");

    const anon = await world.anon();
    const accept = await anon.post(`/api/invites/${invite.token}/accept`, {
      maxRedirects: 0,
    });
    expect(
      [301, 302, 303, 307, 308, 401, 403],
      `anonymous accept (got ${accept.status()})`,
    ).toContain(accept.status());
    const projects = await anon.get(`/api/orgs/${orgP.id}/projects`, {
      maxRedirects: 0,
    });
    expect(
      [301, 302, 303, 307, 308, 401, 403],
      `anonymous project read (got ${projects.status()})`,
    ).toContain(projects.status());
    expectNoLeak(await projects.text(), [pp1.name], "anonymous project read");

    // No membership was created by the anonymous accept.
    const pi = await world.signUp("m2-s2-06", "pi");
    expect(membershipRoles(await getMe(pi.ctx), orgP.id)).toHaveLength(0);
  });

  test("S2-07 invite tokens cannot be tampered, guessed, or replayed", async ({
    world,
  }) => {
    const { admin: pa, org: orgP } = await provisionWorkspace(
      world,
      "m2-s2-07",
      { adminWho: "pa", orgLabel: "Probe" },
    );
    // The org named in the tampered accept body: a real org the invitee must
    // never end up in.
    const orgO = await provisionOrg(pa, "m2-s2-07", "Outer");
    const invite = await provisionInvite(pa, orgP, "m2-s2-07", "pi");
    const pi = await world.signUp("m2-s2-07", "pi");

    // Body cannot upgrade the role or redirect the org.
    const accept = await pi.ctx.request.post(
      `/api/invites/${invite.token}/accept`,
      { data: { role: "org_admin", orgId: orgO.id }, maxRedirects: 0 },
    );
    expect([200, 201, 204]).toContain(accept.status());
    await expect
      .poll(
        async () => membershipRoles(await getMe(pi.ctx), orgP.id).join(","),
        { timeout: 20_000 },
      )
      .toContain("org_member");
    expect(membershipRoles(await getMe(pi.ctx), orgP.id)).not.toContain(
      "org_admin",
    );
    expect(membershipRoles(await getMe(pi.ctx), orgO.id)).toHaveLength(0);

    // A one-character-different token is unknown.
    const last = invite.token.slice(-1);
    const flipped =
      invite.token.slice(0, -1) + (last.toLowerCase() === "a" ? "b" : "a");
    expect(flipped).not.toBe(invite.token);
    const tampered = await pi.ctx.request.post(
      `/api/invites/${flipped}/accept`,
      { maxRedirects: 0 },
    );
    expect(
      tampered.status(),
      `tampered token must be 4xx (got ${tampered.status()})`,
    ).toBeGreaterThanOrEqual(400);
    expect(tampered.status()).toBeLessThan(500);

    // Replay after removal must not re-add the user.
    await removeMemberVia(pa.page, orgP.id, pi.email);
    await expect
      .poll(async () => membershipRoles(await getMe(pi.ctx), orgP.id).length, {
        timeout: 20_000,
      })
      .toBe(0);

    const replay = await pi.ctx.request.post(
      `/api/invites/${invite.token}/accept`,
      { maxRedirects: 0 },
    );
    expect(
      replay.status(),
      `replayed accepted token must be 4xx (got ${replay.status()})`,
    ).toBeGreaterThanOrEqual(400);
    expect(replay.status()).toBeLessThan(500);
    expect(membershipRoles(await getMe(pi.ctx), orgP.id)).toHaveLength(0);
  });
});
