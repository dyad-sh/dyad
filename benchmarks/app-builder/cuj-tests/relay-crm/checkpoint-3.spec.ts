// Relay CRM — checkpoint 3 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 3)" + "Security probes (checkpoint 3)").
// 12 CUJs (4 regression + 8 new) + 8 probes. Same conventions as checkpoint 1.
import {
  test,
  expect,
  request as pwRequest,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  RUN_ID,
  identity,
  signUp,
  expectSignedIn,
  findIdByValue,
  getMe,
  switchWorkspace,
  acceptInvite,
} from "./fixtures";

const OWNER = identity("owner3");
const MEMBER = identity("member3");
const VIEWER = identity("viewer");
const OUTSIDER = identity("outsider3");

const ADA = `Ada3 ${RUN_ID}`;
const TEMP = `Temp3 ${RUN_ID}`;
const MINE = `Mine ${RUN_ID}`;
const OTHER = `Other ${RUN_ID}`;
const PWN = `Pwn ${RUN_ID}`;
const NOTE = `Called ${RUN_ID}`;
const FORGED = `forged ${RUN_ID}`;
const DEAL = `Deal3 ${RUN_ID}`;
const EXPORT_W2 = `Export W2 ${RUN_ID}`;
const CSV_HEADER = "name,email,phone,title,company";

async function inviteWithRole(
  ownerPage: Page,
  email: string,
  role: "member" | "viewer",
) {
  await ownerPage.goto("/settings/members");
  await ownerPage.getByTestId("invite-email-input").fill(email);
  const roleSelect = ownerPage.getByTestId("invite-role-select");
  if (await roleSelect.count()) {
    await roleSelect.first().selectOption(role);
  }
  await ownerPage.getByTestId("invite-submit").click();
  await expect(
    ownerPage
      .getByTestId("pending-invite-row")
      .filter({ hasText: email })
      .first(),
  ).toBeVisible();
}

test.describe.serial("relay-crm checkpoint 3", () => {
  let owner: BrowserContext;
  let ownerPage: Page;
  let member: BrowserContext;
  let memberPage: Page;
  let viewer: BrowserContext;
  let viewerPage: Page;
  let outsider: BrowserContext;
  let workspaceName = "";
  let w1Id: string | null = null;
  let adaContactId: string | null = null;
  let dealId: string | null = null;
  let dealColumnAtRest = "qualified";
  let noteType = "";

  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    ownerPage = await owner.newPage();
  });

  test.afterAll(async () => {
    await owner?.close();
    await member?.close();
    await viewer?.close();
    await outsider?.close();
  });

  test("crm-m1-01 sign-up creates session (regression)", async () => {
    await signUp(ownerPage, OWNER);
    await expectSignedIn(ownerPage, OWNER.email);
    const me = await getMe(owner);
    expect(me.email).toBe(OWNER.email);
    workspaceName = (
      (await ownerPage
        .getByTestId("workspace-current-name")
        .first()
        .textContent()) ?? ""
    ).trim();
    expect(workspaceName.length).toBeGreaterThan(0);
    const membership = (me.memberships ?? []).find(
      (m: any) => String(m.workspaceName) === workspaceName,
    );
    w1Id = membership ? String(membership.workspaceId) : null;
    expect(w1Id, "W1 id from owner's own /api/me").toBeTruthy();
    // Seed the suite's main contact.
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(ADA);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`ada3-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    adaContactId = await findIdByValue(owner, "/api/contacts", ADA);
    expect(adaContactId).toBeTruthy();
  });

  test("crm-m1-08 create then delete a contact (regression)", async () => {
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(TEMP);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`temp3-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    const tempId = await findIdByValue(owner, "/api/contacts", TEMP);
    expect(tempId).toBeTruthy();
    await ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: TEMP })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await ownerPage.getByTestId("contact-delete-button").click();
    await ownerPage.getByTestId("contact-delete-confirm").click();
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: TEMP }),
    ).toHaveCount(0);
    const resp = await owner.request.get(`/contacts/${tempId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(TEMP);
    } else {
      expect([301, 302, 303, 307, 308, 404, 410]).toContain(resp.status());
    }
  });

  test("crm-m2-03 invite member who accepts (regression)", async ({
    browser,
  }) => {
    await inviteWithRole(ownerPage, MEMBER.email, "member");
    member = await browser.newContext();
    memberPage = await member.newPage();
    await signUp(memberPage, MEMBER);
    await expectSignedIn(memberPage, MEMBER.email);
    await acceptInvite(memberPage, workspaceName);
    await switchWorkspace(memberPage, workspaceName);
    await memberPage.goto("/contacts");
    await expect(
      memberPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m2-06 deal stage change persists (regression)", async () => {
    await ownerPage.goto("/deals");
    await ownerPage.getByTestId("deal-new-button").click();
    await ownerPage.getByTestId("deal-form-title").fill(DEAL);
    await ownerPage.getByTestId("deal-form-amount").fill("4000");
    await ownerPage.getByTestId("deal-form-stage").selectOption("lead");
    await ownerPage
      .getByTestId("deal-form-contact")
      .selectOption({ label: ADA });
    await ownerPage.getByTestId("deal-form-submit").click();
    await ownerPage.goto("/deals");
    const card = ownerPage
      .getByTestId("kanban-column-lead")
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first();
    await card.getByTestId("deal-card-stage-select").selectOption("qualified");
    await ownerPage.reload();
    await expect(
      ownerPage
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    dealColumnAtRest = "qualified";
    dealId = await findIdByValue(owner, "/api/deals", DEAL);
    expect(dealId).toBeTruthy();
  });

  test("crm-m3-01 invite viewer with viewer role", async ({ browser }) => {
    await inviteWithRole(ownerPage, VIEWER.email, "viewer");
    viewer = await browser.newContext();
    viewerPage = await viewer.newPage();
    await signUp(viewerPage, VIEWER);
    await expectSignedIn(viewerPage, VIEWER.email);
    await acceptInvite(viewerPage, workspaceName);
    await switchWorkspace(viewerPage, workspaceName);
    await ownerPage.goto("/settings/members");
    const viewerRow = ownerPage
      .getByTestId("member-row")
      .filter({ hasText: VIEWER.email })
      .first();
    await expect(viewerRow.getByTestId("member-row-role")).toContainText(
      /viewer/i,
    );
    const viewerMe = await getMe(viewer);
    const membership = (viewerMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(membership, "viewer's own W1 membership in /api/me").toBeTruthy();
    expect(String(membership.role).toLowerCase()).toBe("viewer");
  });

  test("crm-m3-02 viewer UI hides mutating controls", async () => {
    await viewerPage.goto("/contacts");
    await expect(
      viewerPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await expect(
      viewerPage.getByTestId("contact-new-button"),
    ).not.toBeVisible();
    await expect(viewerPage.getByTestId("nav-members")).not.toBeVisible();
    await viewerPage
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await expect(viewerPage.getByTestId("contact-detail-name")).toContainText(
      ADA,
    );
    await expect(
      viewerPage.getByTestId("contact-edit-button"),
    ).not.toBeVisible();
    await expect(
      viewerPage.getByTestId("contact-delete-button"),
    ).not.toBeVisible();
    await expect(
      viewerPage.getByTestId("activity-note-submit"),
    ).not.toBeVisible();
  });

  test("crm-m3-03 viewer direct navigation is forbidden", async () => {
    for (const route of ["/contacts/new", "/settings/members"]) {
      await viewerPage.goto(route);
      const forbidden = viewerPage.getByTestId("forbidden-message");
      const redirected = !viewerPage.url().includes(route);
      if (!redirected) {
        await expect(forbidden).toBeVisible({ timeout: 10_000 });
      }
    }
    const before = (await (
      await owner.request.get("/api/contacts")
    ).json()) as unknown[];
    expect(Array.isArray(before)).toBe(true);
  });

  test("crm-m3-04 member cannot reach members management", async () => {
    await memberPage.goto("/settings/members");
    const redirected = !memberPage.url().includes("/settings/members");
    if (!redirected) {
      await expect(memberPage.getByTestId("forbidden-message")).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(memberPage.getByTestId("invite-submit")).not.toBeVisible();
  });

  test("crm-m3-05 manual note lands atop the timeline", async () => {
    await ownerPage.goto(`/contacts/${adaContactId}`);
    await ownerPage.getByTestId("activity-note-input").fill(NOTE);
    await ownerPage.getByTestId("activity-note-submit").click();
    const newest = ownerPage.getByTestId("activity-item").first();
    await expect(newest.getByTestId("activity-item-body")).toContainText(NOTE);
    await expect(newest.getByTestId("activity-item-actor")).toContainText(
      OWNER.name,
    );
    noteType = (
      (await newest.getByTestId("activity-item-type").textContent()) ?? ""
    ).trim();
    await ownerPage.reload();
    await expect(
      ownerPage
        .getByTestId("activity-item")
        .first()
        .getByTestId("activity-item-body"),
    ).toContainText(NOTE);
  });

  test("crm-m3-06 system entries record edits and stage changes", async () => {
    await ownerPage.goto(`/contacts/${adaContactId}`);
    const countBefore = await ownerPage.getByTestId("activity-item").count();
    await ownerPage.getByTestId("contact-edit-button").click();
    await ownerPage.getByTestId("contact-form-title").fill(`CTO ${RUN_ID}`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/deals");
    await ownerPage
      .getByTestId(`kanban-column-${dealColumnAtRest}`)
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first()
      .getByTestId("deal-card-stage-select")
      .selectOption("proposal");
    dealColumnAtRest = "proposal";
    await ownerPage.goto(`/contacts/${adaContactId}`);
    await expect(async () => {
      const count = await ownerPage.getByTestId("activity-item").count();
      expect(count).toBeGreaterThanOrEqual(countBefore + 2);
    }).toPass({ timeout: 15_000 });
    const types = await ownerPage
      .getByTestId("activity-item")
      .getByTestId("activity-item-type")
      .allTextContents();
    const nonNote = types.filter((t) => t.trim() !== noteType);
    expect(nonNote.length).toBeGreaterThanOrEqual(2);
    // Newest-first: the top entry is one of the fresh system entries, not the
    // older manual note.
    expect(types[0]?.trim()).not.toBe(noteType);
  });

  test("crm-m3-07 CSV export is correct and workspace-scoped", async () => {
    // A second workspace with its own contact proves scoping.
    await ownerPage.goto("/workspaces");
    await ownerPage.getByTestId("workspace-create-button").click();
    await ownerPage.getByTestId("workspace-form-name").fill(EXPORT_W2);
    await ownerPage.getByTestId("workspace-form-submit").click();
    await switchWorkspace(ownerPage, EXPORT_W2);
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(OTHER);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`other-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await switchWorkspace(ownerPage, workspaceName);
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("export-contacts-button").first(),
    ).toBeVisible();

    const resp = await owner.request.get("/api/export/contacts.csv");
    expect(resp.status()).toBe(200);
    expect(resp.headers()["content-type"] ?? "").toMatch(/^text\/csv/);
    expect(resp.headers()["content-disposition"] ?? "").toContain("attachment");
    const body = await resp.text();
    const lines = body.trim().split(/\r?\n/);
    expect(lines[0]).toBe(CSV_HEADER);
    const contacts = (await (
      await owner.request.get("/api/contacts")
    ).json()) as Array<Record<string, unknown>>;
    for (const contact of contacts) {
      expect(body).toContain(String(contact.name));
    }
    expect(body).not.toContain(OTHER);
  });

  test("crm-m3-08 server-side validation surfaces in the form", async () => {
    const before = (
      (await (await owner.request.get("/api/contacts")).json()) as unknown[]
    ).length;
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill("");
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`valid-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await expect(ownerPage.getByTestId("contact-form-error")).toBeVisible();
    await expect(ownerPage.getByTestId("contact-form-error")).not.toBeEmpty();
    await ownerPage.getByTestId("contact-form-name").fill(`Valid ${RUN_ID}`);
    await ownerPage.getByTestId("contact-form-email").fill("not-an-email");
    await ownerPage.getByTestId("contact-form-submit").click();
    await expect(ownerPage.getByTestId("contact-form-error")).toBeVisible();
    await expect(ownerPage.getByTestId("contact-form-error")).not.toBeEmpty();
    await ownerPage.goto("/contacts");
    const after = (
      (await (await owner.request.get("/api/contacts")).json()) as unknown[]
    ).length;
    expect(after).toBe(before);
  });

  test("crm-m3-s01 viewer writes are rejected server-side", async () => {
    const live = await viewer.request.get("/api/contacts");
    const allowed = live.status() === 200 ? [401, 403] : [403];
    const attempts = [
      await viewer.request.post("/api/contacts", {
        data: { name: PWN },
        maxRedirects: 0,
      }),
      await viewer.request.patch(`/api/contacts/${adaContactId}`, {
        data: { name: PWN },
        maxRedirects: 0,
      }),
      await viewer.request.delete(`/api/contacts/${adaContactId}`, {
        maxRedirects: 0,
      }),
      await viewer.request.post("/api/deals", {
        data: { title: PWN, amount: 1, stage: "lead" },
        maxRedirects: 0,
      }),
    ];
    for (const resp of attempts) {
      expect(allowed, `viewer write got ${resp.status()}`).toContain(
        resp.status(),
      );
    }
    const ownerList = await (await owner.request.get("/api/contacts")).text();
    expect(ownerList).not.toContain(PWN);
    expect(ownerList).toContain(ADA);
  });

  test("crm-m3-s02 member cannot manage memberships", async () => {
    const memberMe = await getMe(member);
    const ownMembership = (memberMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(ownMembership?.membershipId).toBeTruthy();
    const ownersView = (await (
      await owner.request.get(`/api/workspaces/${w1Id}/members`)
    ).json()) as Array<Record<string, unknown>>;
    const ownerMembership = ownersView.find(
      (m) => String(m.email) === OWNER.email,
    );
    expect(
      ownerMembership?.id,
      "owner membership id (owner-read)",
    ).toBeTruthy();

    const enumerate = await member.request.get(
      `/api/workspaces/${w1Id}/members`,
      { maxRedirects: 0 },
    );
    expect([403, 404]).toContain(enumerate.status());
    const enumBody = await enumerate.text();
    expect(enumBody).not.toContain(OWNER.email);
    expect(enumBody).not.toContain(String(ownerMembership!.id));

    const inviteOwner = await member.request.post(
      `/api/workspaces/${w1Id}/invites`,
      { data: { email: "x@example.com", role: "owner" }, maxRedirects: 0 },
    );
    expect(inviteOwner.status()).toBe(403);
    const removeOwner = await member.request.delete(
      `/api/workspaces/${w1Id}/members/${ownerMembership!.id}`,
      { maxRedirects: 0 },
    );
    expect(removeOwner.status()).toBe(403);
    const selfPromote = await member.request.patch(
      `/api/workspaces/${w1Id}/members/${ownMembership.membershipId}`,
      { data: { role: "owner" }, maxRedirects: 0 },
    );
    expect(selfPromote.status()).toBe(403);

    await ownerPage.goto("/settings/members");
    await expect(
      ownerPage
        .getByTestId("member-row")
        .filter({ hasText: OWNER.email })
        .first(),
    ).toBeVisible();
    await expect(
      ownerPage.getByTestId("pending-invite-row").filter({
        hasText: "x@example.com",
      }),
    ).toHaveCount(0);
    const recheck = await getMe(member);
    const still = (recheck.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(String(still.role).toLowerCase()).toBe("member");
  });

  test("crm-m3-s03 viewer cannot change own role", async () => {
    const viewerMe = await getMe(viewer);
    const own = (viewerMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(own?.membershipId).toBeTruthy();
    for (const role of ["owner", "member"]) {
      const resp = await viewer.request.patch(
        `/api/workspaces/${w1Id}/members/${own.membershipId}`,
        { data: { role }, maxRedirects: 0 },
      );
      expect(resp.status()).toBe(403);
    }
    const recheck = await getMe(viewer);
    const still = (recheck.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(String(still.role).toLowerCase()).toBe("viewer");
    const write = await viewer.request.post("/api/contacts", {
      data: { name: PWN },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(write.status());
  });

  test("crm-m3-s04 mass-assignment cannot re-home a record", async ({
    browser,
  }) => {
    outsider = await browser.newContext();
    const outsiderPage = await outsider.newPage();
    await signUp(outsiderPage, OUTSIDER);
    await expectSignedIn(outsiderPage, OUTSIDER.email);
    const outsiderMe = await getMe(outsider);
    const w3 = (outsiderMe.memberships ?? [])[0];
    expect(w3?.workspaceId, "outsider's own W3 id").toBeTruthy();

    const create = await member.request.post("/api/contacts", {
      data: { name: MINE, email: `mine-${RUN_ID}@example.com` },
    });
    expect([200, 201]).toContain(create.status());
    const mineId = String(((await create.json()) as any).id ?? "");
    expect(mineId).toBeTruthy();

    await member.request.patch(`/api/contacts/${mineId}`, {
      data: {
        name: `Renamed ${RUN_ID}`,
        workspaceId: String(w3.workspaceId),
        workspace_id: String(w3.workspaceId),
        ownerId: String(outsiderMe.id),
        id: String(adaContactId),
      },
      maxRedirects: 0,
    });
    const ownerList = await (await owner.request.get("/api/contacts")).text();
    expect(ownerList).toContain(MINE.split(" ")[0]); // still in W1 (any name)
    expect(ownerList).toContain(ADA); // Ada not overwritten
    const outsiderList = await (
      await outsider.request.get("/api/contacts")
    ).text();
    expect(outsiderList).not.toContain(MINE);
    expect(outsiderList).not.toContain(`Renamed ${RUN_ID}`);
  });

  test("crm-m3-s05 outsider cannot touch the activity timeline", async () => {
    const post = await outsider.request.post(
      `/api/contacts/${adaContactId}/activities`,
      { data: { body: FORGED }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(post.status());
    const get = await outsider.request.get(
      `/api/contacts/${adaContactId}/activities`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(get.status());
    await ownerPage.goto(`/contacts/${adaContactId}`);
    expect(await ownerPage.content()).not.toContain(FORGED);
  });

  test("crm-m3-s06 CSV export denies outsiders and anonymous", async () => {
    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const anonResp = await anon.get("/api/export/contacts.csv", {
      maxRedirects: 0,
    });
    expect([401, 403, 301, 302, 303, 307, 308]).toContain(anonResp.status());
    await anon.dispose();
    const outsiderResp = await outsider.request.get(
      "/api/export/contacts.csv",
      { maxRedirects: 0 },
    );
    if (outsiderResp.status() === 200) {
      const body = await outsiderResp.text();
      expect(body).not.toContain(ADA);
      expect(body).not.toContain(MINE);
    }
  });

  test("crm-m3-s07 removed member loses access with live session", async () => {
    const memberMe = await getMe(member);
    await ownerPage.goto("/settings/members");
    const row = ownerPage.locator(
      `[data-testid="member-row"][data-user-id="${memberMe.id}"]`,
    );
    await expect(row.first()).toBeVisible();
    await row.first().getByTestId("member-remove-button").click();
    await ownerPage.getByTestId("member-remove-confirm").click();
    await expect(
      ownerPage.getByTestId("member-row").filter({ hasText: MEMBER.email }),
    ).toHaveCount(0);

    for (const p of [
      "/api/contacts",
      "/api/deals",
      "/api/export/contacts.csv",
    ]) {
      const resp = await member.request.get(p, { maxRedirects: 0 });
      if (resp.status() === 200) {
        const text = await resp.text();
        expect(text).not.toContain(ADA);
        expect(text).not.toContain(DEAL);
      } else {
        expect([401, 403, 404]).toContain(resp.status());
      }
    }
    const meAfter = await getMe(member);
    const names = (meAfter.memberships ?? []).map((m: any) =>
      String(m.workspaceId),
    );
    expect(names).not.toContain(String(w1Id));
    const html = await (
      await member.request.get("/contacts", { maxRedirects: 0 })
    ).text();
    expect(html).not.toContain(ADA);
  });

  test("crm-m3-s08 viewer cannot mutate deals or add notes", async () => {
    const patch = await viewer.request.patch(`/api/deals/${dealId}`, {
      data: { stage: "won" },
      maxRedirects: 0,
    });
    expect(patch.status()).toBe(403);
    const note = await viewer.request.post(
      `/api/contacts/${adaContactId}/activities`,
      { data: { body: "viewer note" }, maxRedirects: 0 },
    );
    expect(note.status()).toBe(403);
    await ownerPage.goto("/deals");
    await expect(
      ownerPage
        .getByTestId(`kanban-column-${dealColumnAtRest}`)
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    await ownerPage.goto(`/contacts/${adaContactId}`);
    expect(await ownerPage.content()).not.toContain("viewer note");
  });
});
