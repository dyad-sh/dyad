// Relay CRM — checkpoint 3 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 3)" + "Security probes (checkpoint 3)").
// 12 CUJs (4 regression + 8 new) + 8 probes. Same conventions as checkpoint 1:
// every test provisions its own personas (owner/member/viewer/outsider),
// records and roles through the `world` fixture and asserts only its own
// scenario — no `.serial`, no shared mutable state.
import { request as pwRequest } from "@playwright/test";
import {
  test,
  expect,
  RUN_ID,
  signUp,
  expectSignedIn,
  findIdByValue,
  getMe,
  switchWorkspace,
  acceptInvite,
  createContact,
  createContactWithId,
  createDeal,
  createDealWithId,
  createWorkspace,
  inviteMember,
  addNote,
  settleAfterSubmit,
} from "./fixtures";

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

test.describe("relay-crm checkpoint 3", () => {
  test("crm-m1-01 sign-up creates session (regression)", async ({ world }) => {
    const who = world.identity("owner3");
    const context = await world.newContext();
    const page = await context.newPage();
    await signUp(page, who);
    await expectSignedIn(page, who.email);
    const me = await getMe(context);
    expect(me.email).toBe(who.email);
    const workspaceName = (
      (await page
        .getByTestId("workspace-current-name")
        .first()
        .textContent()) ?? ""
    ).trim();
    expect(workspaceName.length).toBeGreaterThan(0);
    const membership = (me.memberships ?? []).find(
      (m: any) => String(m.workspaceName) === workspaceName,
    );
    const w1Id = membership ? String(membership.workspaceId) : null;
    expect(w1Id, "W1 id from owner's own /api/me").toBeTruthy();
    // The signed-in session can drive the CRM it just landed on.
    await page.goto("/contacts");
    await page.getByTestId("contact-new-button").click();
    await page.getByTestId("contact-form-name").fill(ADA);
    await page.getByTestId("contact-form-email").fill(world.email("ada3"));
    await page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(page);
    await page.goto("/contacts");
    const adaContactId = await findIdByValue(context, "/api/contacts", ADA);
    expect(adaContactId).toBeTruthy();
  });

  test("crm-m1-08 create then delete a contact (regression)", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");

    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(TEMP);
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("temp3"));
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    const tempId = await findIdByValue(owner.context, "/api/contacts", TEMP);
    expect(tempId).toBeTruthy();
    await owner.page
      .getByTestId("contact-row")
      .filter({ hasText: TEMP })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await owner.page.getByTestId("contact-delete-button").click();
    await owner.page.getByTestId("contact-delete-confirm").click();
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: TEMP }),
    ).toHaveCount(0);
    const resp = await owner.context.request.get(`/contacts/${tempId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(TEMP);
    } else {
      expect([301, 302, 303, 307, 308, 404, 410]).toContain(resp.status());
    }
  });

  test("crm-m2-03 invite member who accepts (regression)", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });
    const memberWho = world.identity("member3");

    await inviteMember(owner.page, memberWho.email, "member");
    const member = await world.signUp("member3");
    await acceptInvite(member.page, owner.workspaceName);
    await switchWorkspace(member.page, owner.workspaceName);
    await member.page.goto("/contacts");
    await expect(
      member.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m2-06 deal stage change persists (regression)", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });

    await owner.page.goto("/deals");
    await owner.page.getByTestId("deal-new-button").click();
    await owner.page.getByTestId("deal-form-title").fill(DEAL);
    await owner.page.getByTestId("deal-form-amount").fill("4000");
    await owner.page.getByTestId("deal-form-stage").selectOption("lead");
    await owner.page
      .getByTestId("deal-form-contact")
      .selectOption({ label: ADA });
    await owner.page.getByTestId("deal-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/deals");
    const card = owner.page
      .getByTestId("kanban-column-lead")
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first();
    await card.getByTestId("deal-card-stage-select").selectOption("qualified");
    await owner.page.reload();
    await expect(
      owner.page
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    const dealId = await findIdByValue(owner.context, "/api/deals", DEAL);
    expect(dealId).toBeTruthy();
  });

  test("crm-m3-01 invite viewer with viewer role", async ({ world }) => {
    const owner = await world.signUpOwner("owner3");
    const viewerWho = world.identity("viewer");

    await inviteMember(owner.page, viewerWho.email, "viewer");
    const viewer = await world.signUp("viewer");
    await acceptInvite(viewer.page, owner.workspaceName);
    await switchWorkspace(viewer.page, owner.workspaceName);
    await owner.page.goto("/settings/members");
    const viewerRow = owner.page
      .getByTestId("member-row")
      .filter({ hasText: viewer.email })
      .first();
    await expect(viewerRow.getByTestId("member-row-role")).toContainText(
      /viewer/i,
    );
    const viewerMe = await getMe(viewer.context);
    const membership = (viewerMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === owner.workspaceId,
    );
    expect(membership, "viewer's own W1 membership in /api/me").toBeTruthy();
    expect(String(membership.role).toLowerCase()).toBe("viewer");
  });

  test("crm-m3-02 viewer UI hides mutating controls", async ({ world }) => {
    const owner = await world.signUpOwner("owner3");
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });
    const viewer = await world.joinWorkspace(owner, {
      as: "viewer",
      role: "viewer",
    });

    await viewer.page.goto("/contacts");
    await expect(
      viewer.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await expect(
      viewer.page.getByTestId("contact-new-button"),
    ).not.toBeVisible();
    await expect(viewer.page.getByTestId("nav-members")).not.toBeVisible();
    await viewer.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await expect(viewer.page.getByTestId("contact-detail-name")).toContainText(
      ADA,
    );
    await expect(
      viewer.page.getByTestId("contact-edit-button"),
    ).not.toBeVisible();
    await expect(
      viewer.page.getByTestId("contact-delete-button"),
    ).not.toBeVisible();
    await expect(
      viewer.page.getByTestId("activity-note-submit"),
    ).not.toBeVisible();
  });

  test("crm-m3-03 viewer direct navigation is forbidden", async ({ world }) => {
    const owner = await world.signUpOwner("owner3");
    const viewer = await world.joinWorkspace(owner, {
      as: "viewer",
      role: "viewer",
    });

    for (const route of ["/contacts/new", "/settings/members"]) {
      await viewer.page.goto(route);
      const forbidden = viewer.page.getByTestId("forbidden-message");
      const redirected = !viewer.page.url().includes(route);
      if (!redirected) {
        await expect(forbidden).toBeVisible({ timeout: 10_000 });
      }
    }
    const before = (await (
      await owner.context.request.get("/api/contacts")
    ).json()) as unknown[];
    expect(Array.isArray(before)).toBe(true);
  });

  test("crm-m3-04 member cannot reach members management", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const member = await world.joinWorkspace(owner, {
      as: "member3",
      role: "member",
    });

    await member.page.goto("/settings/members");
    const redirected = !member.page.url().includes("/settings/members");
    if (!redirected) {
      await expect(member.page.getByTestId("forbidden-message")).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(member.page.getByTestId("invite-submit")).not.toBeVisible();
  });

  test("crm-m3-05 manual note lands atop the timeline", async ({ world }) => {
    const owner = await world.signUp("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });

    await owner.page.goto(`/contacts/${adaContactId}`);
    await owner.page.getByTestId("activity-note-input").fill(NOTE);
    await owner.page.getByTestId("activity-note-submit").click();
    const newest = owner.page.getByTestId("activity-item").first();
    await expect(newest.getByTestId("activity-item-body")).toContainText(NOTE);
    await expect(newest.getByTestId("activity-item-actor")).toContainText(
      owner.name,
    );
    await owner.page.reload();
    await expect(
      owner.page
        .getByTestId("activity-item")
        .first()
        .getByTestId("activity-item-body"),
    ).toContainText(NOTE);
  });

  test("crm-m3-06 system entries record edits and stage changes", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });
    await createDeal(owner.page, {
      title: DEAL,
      amount: 4000,
      stage: "qualified",
      contact: ADA,
    });
    // A manual note first, so system entries can be told apart from it.
    const noteType = await addNote(owner.page, adaContactId, NOTE);

    await owner.page.goto(`/contacts/${adaContactId}`);
    const countBefore = await owner.page.getByTestId("activity-item").count();
    await owner.page.getByTestId("contact-edit-button").click();
    await owner.page.getByTestId("contact-form-title").fill(`CTO ${RUN_ID}`);
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/deals");
    await owner.page
      .getByTestId("kanban-column-qualified")
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first()
      .getByTestId("deal-card-stage-select")
      .selectOption("proposal");
    await owner.page.goto(`/contacts/${adaContactId}`);
    await expect(async () => {
      const count = await owner.page.getByTestId("activity-item").count();
      expect(count).toBeGreaterThanOrEqual(countBefore + 2);
    }).toPass({ timeout: 15_000 });
    const types = await owner.page
      .getByTestId("activity-item")
      .getByTestId("activity-item-type")
      .allTextContents();
    const nonNote = types.filter((t) => t.trim() !== noteType);
    expect(nonNote.length).toBeGreaterThanOrEqual(2);
    // Newest-first: the top entry is one of the fresh system entries, not the
    // older manual note.
    expect(types[0]?.trim()).not.toBe(noteType);
  });

  test("crm-m3-07 CSV export is correct and workspace-scoped", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const workspaceName = owner.workspaceName;
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });

    // A second workspace with its own contact proves scoping.
    await createWorkspace(owner.page, EXPORT_W2);
    await switchWorkspace(owner.page, EXPORT_W2);
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(OTHER);
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("other"));
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await switchWorkspace(owner.page, workspaceName);
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("export-contacts-button").first(),
    ).toBeVisible();

    const resp = await owner.context.request.get("/api/export/contacts.csv");
    expect(resp.status()).toBe(200);
    expect(resp.headers()["content-type"] ?? "").toMatch(/^text\/csv/);
    expect(resp.headers()["content-disposition"] ?? "").toContain("attachment");
    const body = await resp.text();
    const lines = body.trim().split(/\r?\n/);
    expect(lines[0]).toBe(CSV_HEADER);
    const contacts = (await (
      await owner.context.request.get("/api/contacts")
    ).json()) as Array<Record<string, unknown>>;
    for (const contact of contacts) {
      expect(body).toContain(String(contact.name));
    }
    expect(body).not.toContain(OTHER);
  });

  test("crm-m3-08 server-side validation surfaces in the form", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");

    const before = (
      (await (
        await owner.context.request.get("/api/contacts")
      ).json()) as unknown[]
    ).length;
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill("");
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("valid"));
    await owner.page.getByTestId("contact-form-submit").click();
    await expect(owner.page.getByTestId("contact-form-error")).toBeVisible();
    await expect(owner.page.getByTestId("contact-form-error")).not.toBeEmpty();
    await owner.page.getByTestId("contact-form-name").fill(`Valid ${RUN_ID}`);
    await owner.page.getByTestId("contact-form-email").fill("not-an-email");
    await owner.page.getByTestId("contact-form-submit").click();
    await expect(owner.page.getByTestId("contact-form-error")).toBeVisible();
    await expect(owner.page.getByTestId("contact-form-error")).not.toBeEmpty();
    await owner.page.goto("/contacts");
    const after = (
      (await (
        await owner.context.request.get("/api/contacts")
      ).json()) as unknown[]
    ).length;
    expect(after).toBe(before);
  });

  test("crm-m3-s01 viewer writes are rejected server-side", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });
    const viewer = await world.joinWorkspace(owner, {
      as: "viewer",
      role: "viewer",
    });

    const live = await viewer.context.request.get("/api/contacts");
    const allowed = live.status() === 200 ? [401, 403] : [403];
    const attempts = [
      await viewer.context.request.post("/api/contacts", {
        data: { name: PWN },
        maxRedirects: 0,
      }),
      await viewer.context.request.patch(`/api/contacts/${adaContactId}`, {
        data: { name: PWN },
        maxRedirects: 0,
      }),
      await viewer.context.request.delete(`/api/contacts/${adaContactId}`, {
        maxRedirects: 0,
      }),
      await viewer.context.request.post("/api/deals", {
        data: { title: PWN, amount: 1, stage: "lead" },
        maxRedirects: 0,
      }),
    ];
    for (const resp of attempts) {
      expect(allowed, `viewer write got ${resp.status()}`).toContain(
        resp.status(),
      );
    }
    const ownerList = await (
      await owner.context.request.get("/api/contacts")
    ).text();
    expect(ownerList).not.toContain(PWN);
    expect(ownerList).toContain(ADA);
  });

  test("crm-m3-s02 member cannot manage memberships", async ({ world }) => {
    const owner = await world.signUpOwner("owner3");
    const w1Id = owner.workspaceId;
    const member = await world.joinWorkspace(owner, {
      as: "member3",
      role: "member",
    });

    const memberMe = await getMe(member.context);
    const ownMembership = (memberMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(ownMembership?.membershipId).toBeTruthy();
    const ownersView = (await (
      await owner.context.request.get(`/api/workspaces/${w1Id}/members`)
    ).json()) as Array<Record<string, unknown>>;
    const ownerMembership = ownersView.find(
      (m) => String(m.email) === owner.email,
    );
    expect(
      ownerMembership?.id,
      "owner membership id (owner-read)",
    ).toBeTruthy();

    const enumerate = await member.context.request.get(
      `/api/workspaces/${w1Id}/members`,
      { maxRedirects: 0 },
    );
    expect([403, 404]).toContain(enumerate.status());
    const enumBody = await enumerate.text();
    expect(enumBody).not.toContain(owner.email);
    expect(enumBody).not.toContain(String(ownerMembership!.id));

    const inviteOwner = await member.context.request.post(
      `/api/workspaces/${w1Id}/invites`,
      { data: { email: "x@example.com", role: "owner" }, maxRedirects: 0 },
    );
    expect(inviteOwner.status()).toBe(403);
    const removeOwner = await member.context.request.delete(
      `/api/workspaces/${w1Id}/members/${ownerMembership!.id}`,
      { maxRedirects: 0 },
    );
    expect(removeOwner.status()).toBe(403);
    const selfPromote = await member.context.request.patch(
      `/api/workspaces/${w1Id}/members/${ownMembership.membershipId}`,
      { data: { role: "owner" }, maxRedirects: 0 },
    );
    expect(selfPromote.status()).toBe(403);

    await owner.page.goto("/settings/members");
    await expect(
      owner.page
        .getByTestId("member-row")
        .filter({ hasText: owner.email })
        .first(),
    ).toBeVisible();
    await expect(
      owner.page.getByTestId("pending-invite-row").filter({
        hasText: "x@example.com",
      }),
    ).toHaveCount(0);
    const recheck = await getMe(member.context);
    const still = (recheck.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(String(still.role).toLowerCase()).toBe("member");
  });

  test("crm-m3-s03 viewer cannot change own role", async ({ world }) => {
    const owner = await world.signUpOwner("owner3");
    const w1Id = owner.workspaceId;
    const viewer = await world.joinWorkspace(owner, {
      as: "viewer",
      role: "viewer",
    });

    const viewerMe = await getMe(viewer.context);
    const own = (viewerMe.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(own?.membershipId).toBeTruthy();
    for (const role of ["owner", "member"]) {
      const resp = await viewer.context.request.patch(
        `/api/workspaces/${w1Id}/members/${own.membershipId}`,
        { data: { role }, maxRedirects: 0 },
      );
      expect(resp.status()).toBe(403);
    }
    const recheck = await getMe(viewer.context);
    const still = (recheck.memberships ?? []).find(
      (m: any) => String(m.workspaceId) === w1Id,
    );
    expect(String(still.role).toLowerCase()).toBe("viewer");
    const write = await viewer.context.request.post("/api/contacts", {
      data: { name: PWN },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(write.status());
  });

  test("crm-m3-s04 mass-assignment cannot re-home a record", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });
    const member = await world.joinWorkspace(owner, {
      as: "member3",
      role: "member",
    });
    const outsider = await world.signUp("outsider3");

    const outsiderMe = await getMe(outsider.context);
    const w3 = (outsiderMe.memberships ?? [])[0];
    expect(w3?.workspaceId, "outsider's own W3 id").toBeTruthy();

    const create = await member.context.request.post("/api/contacts", {
      data: { name: MINE, email: world.email("mine") },
    });
    expect([200, 201]).toContain(create.status());
    const mineId = String(((await create.json()) as any).id ?? "");
    expect(mineId).toBeTruthy();

    await member.context.request.patch(`/api/contacts/${mineId}`, {
      data: {
        name: `Renamed ${RUN_ID}`,
        workspaceId: String(w3.workspaceId),
        workspace_id: String(w3.workspaceId),
        ownerId: String(outsiderMe.id),
        id: String(adaContactId),
      },
      maxRedirects: 0,
    });
    const ownerList = await (
      await owner.context.request.get("/api/contacts")
    ).text();
    expect(ownerList).toContain(MINE.split(" ")[0]); // still in W1 (any name)
    expect(ownerList).toContain(ADA); // Ada not overwritten
    const outsiderList = await (
      await outsider.context.request.get("/api/contacts")
    ).text();
    expect(outsiderList).not.toContain(MINE);
    expect(outsiderList).not.toContain(`Renamed ${RUN_ID}`);
  });

  test("crm-m3-s05 outsider cannot touch the activity timeline", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });
    const outsider = await world.signUp("outsider3");

    const post = await outsider.context.request.post(
      `/api/contacts/${adaContactId}/activities`,
      { data: { body: FORGED }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(post.status());
    const get = await outsider.context.request.get(
      `/api/contacts/${adaContactId}/activities`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(get.status());
    await owner.page.goto(`/contacts/${adaContactId}`);
    expect(await owner.page.content()).not.toContain(FORGED);
  });

  test("crm-m3-s06 CSV export denies outsiders and anonymous", async ({
    world,
  }) => {
    const owner = await world.signUp("owner3");
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });
    // Two W1 contacts, so "no W1 name leaks into an outsider's CSV" is checked
    // against more than one record instead of a name nothing ever created.
    await createContact(owner.page, {
      name: MINE,
      email: world.email("mine3"),
    });
    const outsider = await world.signUp("outsider3");

    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const anonResp = await anon.get("/api/export/contacts.csv", {
        maxRedirects: 0,
      });
      expect([401, 403, 301, 302, 303, 307, 308]).toContain(anonResp.status());
    } finally {
      await anon.dispose();
    }
    const outsiderResp = await outsider.context.request.get(
      "/api/export/contacts.csv",
      { maxRedirects: 0 },
    );
    if (outsiderResp.status() === 200) {
      const body = await outsiderResp.text();
      expect(body).not.toContain(ADA);
      expect(body).not.toContain(MINE);
    }
  });

  test("crm-m3-s07 removed member loses access with live session", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const w1Id = owner.workspaceId;
    await createContact(owner.page, { name: ADA, email: world.email("ada3") });
    await createDeal(owner.page, { title: DEAL, amount: 4000, stage: "lead" });
    const member = await world.joinWorkspace(owner, {
      as: "member3",
      role: "member",
    });

    const memberMe = await getMe(member.context);
    await owner.page.goto("/settings/members");
    const row = owner.page.locator(
      `[data-testid="member-row"][data-user-id="${memberMe.id}"]`,
    );
    await expect(row.first()).toBeVisible();
    await row.first().getByTestId("member-remove-button").click();
    await owner.page.getByTestId("member-remove-confirm").click();
    await expect(
      owner.page.getByTestId("member-row").filter({ hasText: member.email }),
    ).toHaveCount(0);

    for (const p of [
      "/api/contacts",
      "/api/deals",
      "/api/export/contacts.csv",
    ]) {
      const resp = await member.context.request.get(p, { maxRedirects: 0 });
      if (resp.status() === 200) {
        const text = await resp.text();
        expect(text).not.toContain(ADA);
        expect(text).not.toContain(DEAL);
      } else {
        expect([401, 403, 404]).toContain(resp.status());
      }
    }
    const meAfter = await getMe(member.context);
    const names = (meAfter.memberships ?? []).map((m: any) =>
      String(m.workspaceId),
    );
    expect(names).not.toContain(String(w1Id));
    const html = await (
      await member.context.request.get("/contacts", { maxRedirects: 0 })
    ).text();
    expect(html).not.toContain(ADA);
  });

  test("crm-m3-s08 viewer cannot mutate deals or add notes", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner3");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada3"),
    });
    const dealColumnAtRest = "qualified";
    const dealId = await createDealWithId(owner.context, owner.page, {
      title: DEAL,
      amount: 4000,
      stage: dealColumnAtRest,
      contact: ADA,
    });
    const viewer = await world.joinWorkspace(owner, {
      as: "viewer",
      role: "viewer",
    });

    const patch = await viewer.context.request.patch(`/api/deals/${dealId}`, {
      data: { stage: "won" },
      maxRedirects: 0,
    });
    expect(patch.status()).toBe(403);
    const note = await viewer.context.request.post(
      `/api/contacts/${adaContactId}/activities`,
      { data: { body: "viewer note" }, maxRedirects: 0 },
    );
    expect(note.status()).toBe(403);
    await owner.page.goto("/deals");
    await expect(
      owner.page
        .getByTestId(`kanban-column-${dealColumnAtRest}`)
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    await owner.page.goto(`/contacts/${adaContactId}`);
    expect(await owner.page.content()).not.toContain("viewer note");
  });
});
