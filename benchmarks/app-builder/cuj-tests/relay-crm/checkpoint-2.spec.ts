// Relay CRM — checkpoint 2 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 2)" + "Security probes (checkpoint 2)").
// 12 CUJs (4 regression + 8 new) + 6 probes. Same conventions as checkpoint 1:
// every test provisions its own personas, workspaces and records through the
// `world` fixture and asserts only its own scenario — no `.serial`, no shared
// mutable state, so no test can be skipped by another test's failure.
import { request as pwRequest } from "@playwright/test";
import {
  test,
  expect,
  RUN_ID,
  signUp,
  expectSignedIn,
  getMe,
  switchWorkspace,
  acceptInvite,
  numericText,
  createContact,
  createContactWithId,
  createDeal,
  createDealWithId,
  createWorkspace,
  inviteMember,
  findIdByValue,
  settleAfterSubmit,
} from "./fixtures";

const ACME = `Acme2 ${RUN_ID}`;
const ADA = `Ada ${RUN_ID}`;
const ADA_TITLE_2 = `VP ${RUN_ID}`;
const BEE = `Bee ${RUN_ID}`;
const ZOE = `Zoe2 ${RUN_ID}`;
const TEAM_B = `Team B ${RUN_ID}`;
const DEAL = `Deal ${RUN_ID}`;
const DEAL_2 = `Deal2 ${RUN_ID}`;

test.describe("relay-crm checkpoint 2", () => {
  test("crm-m1-01 sign-up creates session (regression)", async ({ world }) => {
    const who = world.identity("owner2");
    const context = await world.newContext();
    const page = await context.newPage();
    await signUp(page, who);
    await expectSignedIn(page, who.email);
    const me = await getMe(context);
    expect(me.email).toBe(who.email);
  });

  test("crm-m1-05 create company + contact (regression)", async ({ world }) => {
    const owner = await world.signUp("owner2");

    await owner.page.goto("/companies");
    await owner.page.getByTestId("company-new-button").click();
    await owner.page.getByTestId("company-form-name").fill(ACME);
    await owner.page
      .getByTestId("company-form-domain")
      .fill(`${world.token("acme2")}.test`);
    await owner.page.getByTestId("company-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(ADA);
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("ada2"));
    await owner.page
      .getByTestId("contact-form-company")
      .selectOption({ label: ACME });
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    const row = owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("contact-row-company")).toContainText(ACME);
    const adaContactId = await findIdByValue(
      owner.context,
      "/api/contacts",
      ADA,
    );
    expect(adaContactId, "Ada's id from pinned GET /api/contacts").toBeTruthy();
  });

  test("crm-m1-07 edit contact title (regression)", async ({ world }) => {
    const owner = await world.signUp("owner2");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada2"),
    });

    await owner.page.goto(`/contacts/${adaContactId}/edit`);
    await owner.page.getByTestId("contact-form-title").fill(ADA_TITLE_2);
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto(`/contacts/${adaContactId}`);
    await expect(owner.page.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE_2,
    );
  });

  test("crm-m1-09 search filters contacts (regression)", async ({ world }) => {
    const owner = await world.signUp("owner2");
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });

    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(ZOE);
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("zoe2"));
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contacts-search").fill(ADA);
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: ZOE }),
    ).toHaveCount(0);
    await owner.page.getByTestId("contacts-search").fill("");
  });

  test("crm-m2-01 create second workspace, both in switcher and /api/me", async ({
    world,
  }) => {
    const owner = await world.signUp("owner2");

    // The auto-created workspace is the active one; record its name.
    const firstWorkspaceName = (
      (await owner.page
        .getByTestId("workspace-current-name")
        .first()
        .textContent()) ?? ""
    ).trim();
    expect(
      firstWorkspaceName.length,
      "auto-created workspace name",
    ).toBeGreaterThan(0);
    await owner.page.goto("/workspaces");
    await owner.page.getByTestId("workspace-create-button").click();
    await owner.page.getByTestId("workspace-form-name").fill(TEAM_B);
    await owner.page.getByTestId("workspace-form-submit").click();
    await owner.page.getByTestId("workspace-switcher").first().click();
    const options = owner.page.getByTestId("workspace-switcher-option");
    await expect(options.filter({ hasText: TEAM_B }).first()).toBeVisible();
    await expect(
      options.filter({ hasText: firstWorkspaceName }).first(),
    ).toBeVisible();
    await owner.page.keyboard.press("Escape");
    const me = await getMe(owner.context);
    const memberships = me.memberships ?? [];
    const names = memberships.map((m: any) => String(m.workspaceName));
    expect(names).toContain(TEAM_B);
    expect(names).toContain(firstWorkspaceName);
    for (const m of memberships) {
      expect(String(m.role).toLowerCase()).toBe("owner");
    }
    const w1 = memberships.find(
      (m: any) => String(m.workspaceName) === firstWorkspaceName,
    );
    const w1Id = w1 ? String(w1.workspaceId) : null;
    expect(w1Id, "W1 id from owner's own /api/me memberships").toBeTruthy();
  });

  test("crm-m2-02 workspace data isolation for contacts", async ({ world }) => {
    const owner = await world.signUpOwner("owner2");
    const firstWorkspaceName = owner.workspaceName;
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });
    await createWorkspace(owner.page, TEAM_B);

    await switchWorkspace(owner.page, TEAM_B);
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(BEE);
    await owner.page.getByTestId("contact-form-email").fill(world.email("bee"));
    await owner.page.getByTestId("contact-form-submit").click();
    await switchWorkspace(owner.page, firstWorkspaceName);
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: BEE }),
    ).toHaveCount(0);
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await switchWorkspace(owner.page, TEAM_B);
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: BEE }).first(),
    ).toBeVisible();
    // Leave W1 active, as an owner would find it.
    await switchWorkspace(owner.page, firstWorkspaceName);
  });

  test("crm-m2-03 invite flow adds member to owner's workspace", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const firstWorkspaceName = owner.workspaceName;
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });
    const memberWho = world.identity("member");

    await owner.page.goto("/settings/members");
    await owner.page.getByTestId("invite-email-input").fill(memberWho.email);
    await owner.page.getByTestId("invite-submit").click();
    await expect(
      owner.page
        .getByTestId("pending-invite-row")
        .filter({ hasText: memberWho.email })
        .first(),
    ).toBeVisible();

    const member = await world.signUp("member");
    await member.page.goto("/invites");
    await expect(
      member.page
        .getByTestId("invite-row-workspace")
        .filter({ hasText: firstWorkspaceName })
        .first(),
    ).toBeVisible();
    await acceptInvite(member.page, firstWorkspaceName);
    await member.page.getByTestId("workspace-switcher").first().click();
    await expect(
      member.page
        .getByTestId("workspace-switcher-option")
        .filter({ hasText: firstWorkspaceName })
        .first(),
    ).toBeVisible();
    await member.page.keyboard.press("Escape");
    await switchWorkspace(member.page, firstWorkspaceName);
    await member.page.goto("/contacts");
    await expect(
      member.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m2-04 members list shows both with data-user-id", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const member = await world.joinWorkspace(owner, { as: "member" });

    const memberMe = await getMe(member.context);
    await owner.page.goto("/settings/members");
    await expect(owner.page.getByTestId("member-row")).toHaveCount(2);
    const memberRow = owner.page
      .getByTestId("member-row")
      .filter({ hasText: member.email })
      .first();
    await expect(memberRow.getByTestId("member-row-email")).toContainText(
      member.email,
    );
    await expect(memberRow.getByTestId("member-row-role")).toContainText(
      /member/i,
    );
    expect(await memberRow.getAttribute("data-user-id")).toBe(
      String(memberMe.id),
    );
    await expect(
      owner.page
        .getByTestId("pending-invite-row")
        .filter({ hasText: member.email }),
    ).toHaveCount(0);
  });

  test("crm-m2-05 create deal linked to contact", async ({ world }) => {
    const owner = await world.signUp("owner2");
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });

    await owner.page.goto("/deals");
    await owner.page.getByTestId("deal-new-button").click();
    await owner.page.getByTestId("deal-form-title").fill(DEAL);
    await owner.page.getByTestId("deal-form-amount").fill("5000");
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
    await expect(card).toBeVisible();
    expect(await numericText(card.getByTestId("deal-card-amount"))).toBe(5000);
    const dealId = await findIdByValue(owner.context, "/api/deals", DEAL);
    expect(dealId, "deal id from pinned GET /api/deals").toBeTruthy();
  });

  test("crm-m2-06 stage select persists across reload", async ({ world }) => {
    const owner = await world.signUp("owner2");
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });
    await createDeal(owner.page, {
      title: DEAL,
      amount: 5000,
      stage: "lead",
      contact: ADA,
    });

    const card = owner.page
      .getByTestId("kanban-column-lead")
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first();
    await card.getByTestId("deal-card-stage-select").selectOption("qualified");
    await expect(
      owner.page
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    await owner.page.reload();
    await expect(
      owner.page
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
  });

  test("crm-m2-07 column count and total aggregate", async ({ world }) => {
    const owner = await world.signUp("owner2");
    // The first deal sits in `qualified` (where CUJ 10 leaves it).
    await createDeal(owner.page, {
      title: DEAL,
      amount: 5000,
      stage: "qualified",
    });

    await owner.page.goto("/deals");
    await owner.page.getByTestId("deal-new-button").click();
    await owner.page.getByTestId("deal-form-title").fill(DEAL_2);
    await owner.page.getByTestId("deal-form-amount").fill("2500");
    await owner.page.getByTestId("deal-form-stage").selectOption("qualified");
    await owner.page.getByTestId("deal-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/deals");
    const column = owner.page.getByTestId("kanban-column-qualified");
    await expect(
      column.getByTestId("deal-card").filter({ hasText: DEAL_2 }).first(),
    ).toBeVisible();
    expect(await numericText(column.getByTestId("column-count"))).toBe(2);
    expect(await numericText(column.getByTestId("column-total"))).toBe(7500);
  });

  test("crm-m2-08 member sees shared deals; personal board is empty", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const firstWorkspaceName = owner.workspaceName;
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });
    await createDeal(owner.page, {
      title: DEAL,
      amount: 5000,
      stage: "qualified",
      contact: ADA,
    });
    await createDeal(owner.page, {
      title: DEAL_2,
      amount: 2500,
      stage: "qualified",
    });
    const member = await world.joinWorkspace(owner, { as: "member" });

    await member.page.goto("/deals");
    await expect(
      member.page.getByTestId("deal-card").filter({ hasText: DEAL }).first(),
    ).toBeVisible();
    await expect(
      member.page.getByTestId("deal-card").filter({ hasText: DEAL_2 }).first(),
    ).toBeVisible();
    const memberMe = await getMe(member.context);
    const personal = (memberMe.memberships ?? []).find(
      (m: any) => String(m.workspaceName) !== firstWorkspaceName,
    );
    expect(personal, "member's own personal workspace in /api/me").toBeTruthy();
    await switchWorkspace(member.page, String(personal.workspaceName));
    await member.page.goto("/deals");
    await expect(member.page.getByTestId("deal-card")).toHaveCount(0);
  });

  test("crm-m2-s01 outsider cannot read another workspace's contact", async ({
    world,
  }) => {
    const owner = await world.signUp("owner2");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada2"),
    });
    const outsider = await world.signUp("outsider");

    const read = await outsider.context.request.get(
      `/api/contacts/${adaContactId}`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(read.status());
    expect(await read.text()).not.toContain(ADA);
  });

  test("crm-m2-s02 outsider cannot write another workspace's contact", async ({
    world,
  }) => {
    const owner = await world.signUp("owner2");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada2"),
    });
    const outsider = await world.signUp("outsider");

    const patch = await outsider.context.request.patch(
      `/api/contacts/${adaContactId}`,
      { data: { name: "pwned" }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(patch.status());
    const del = await outsider.context.request.delete(
      `/api/contacts/${adaContactId}`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(del.status());
    const recheck = await owner.context.request.get("/api/contacts");
    const text = await recheck.text();
    expect(text).toContain(ADA);
    expect(text).not.toContain("pwned");
  });

  test("crm-m2-s03 client-supplied workspace ids are not trusted", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const w1Id = owner.workspaceId;
    await createContact(owner.page, { name: ADA, email: world.email("ada2") });
    await createDeal(owner.page, { title: DEAL, amount: 5000, stage: "lead" });
    const outsider = await world.signUp("outsider");

    const attempts = [
      outsider.context.request.get(`/api/contacts?workspaceId=${w1Id}`),
      outsider.context.request.get(`/api/deals?workspace_id=${w1Id}`),
      outsider.context.request.get("/api/contacts", {
        headers: { "X-Workspace-Id": String(w1Id) },
      }),
      outsider.context.request.get("/api/deals", {
        headers: { "X-Workspace-Id": String(w1Id) },
      }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      if (attempt.status() === 200) {
        const text = await attempt.text();
        expect(text).not.toContain(ADA);
        expect(text).not.toContain(DEAL);
      } else {
        expect([401, 403]).toContain(attempt.status());
      }
    }
  });

  test("crm-m2-s04 leaked invite id is not accept-able by a third party", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const firstWorkspaceName = owner.workspaceName;
    const outsider = await world.signUp("outsider");
    const member2Who = world.identity("member2");

    // A real, legitimately-issued invite for member2, unaccepted.
    await inviteMember(owner.page, member2Who.email);
    // The workspace's membership roster before the attack, so "unchanged" is
    // measured rather than assumed. Wait for the list to hydrate first —
    // count() does not retry, and the members list can render after the
    // pending-invite list.
    await expect(owner.page.getByTestId("member-row").first()).toBeVisible({
      timeout: 15_000,
    });
    const membersBefore = await owner.page.getByTestId("member-row").count();
    expect(
      membersBefore,
      "owner's members-list before the attack",
    ).toBeGreaterThan(0);

    const member2 = await world.signUp("member2");
    const invites = (await (
      await member2.context.request.get("/api/invites")
    ).json()) as Array<Record<string, unknown>>;
    const invite = invites.find((i) => String(i.email) === member2Who.email);
    expect(
      invite?.id,
      "invite id from the invitee's own /api/invites",
    ).toBeTruthy();

    const steal = await outsider.context.request.post(
      `/api/invites/${invite!.id}/accept`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(steal.status());
    const outsiderInvites = await (
      await outsider.context.request.get("/api/invites")
    ).text();
    expect(outsiderInvites).not.toContain(member2Who.email);
    const outsiderMe = await getMe(outsider.context);
    const outsiderNames = (outsiderMe.memberships ?? []).map((m: any) =>
      String(m.workspaceName),
    );
    expect(outsiderNames).not.toContain(firstWorkspaceName);
    await owner.page.goto("/settings/members");
    await expect(owner.page.getByTestId("member-row")).toHaveCount(
      membersBefore,
    );
    await expect(
      owner.page.getByTestId("member-row").filter({ hasText: outsider.email }),
    ).toHaveCount(0);
    // Still acceptable by the real invitee afterwards.
    await acceptInvite(member2.page, firstWorkspaceName);
    const m2Me = await getMe(member2.context);
    expect(
      (m2Me.memberships ?? []).map((m: any) => String(m.workspaceName)),
    ).toContain(firstWorkspaceName);
  });

  test("crm-m2-s05 unauthenticated API surface denies and leaks nothing", async ({
    world,
  }) => {
    const owner = await world.signUpOwner("owner2");
    const w1Id = owner.workspaceId;

    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
      for (const p of [
        "/api/me",
        "/api/contacts",
        "/api/deals",
        "/api/workspaces",
        `/api/workspaces/${w1Id}/members`,
        "/api/invites",
      ]) {
        const resp = await anon.get(p, { maxRedirects: 0 });
        expect(
          [401, 403, 301, 302, 303, 307, 308],
          `${p} must deny anonymous access (got ${resp.status()})`,
        ).toContain(resp.status());
        const text = await resp.text();
        expect(text).not.toContain(RUN_ID);
        expect(text).not.toContain(owner.email);
      }
    } finally {
      await anon.dispose();
    }
  });

  test("crm-m2-s06 deal detail page does not render cross-workspace", async ({
    world,
  }) => {
    const owner = await world.signUp("owner2");
    const dealId = await createDealWithId(owner.context, owner.page, {
      title: DEAL,
      amount: 5000,
      stage: "lead",
    });
    const outsider = await world.signUp("outsider");

    const resp = await outsider.context.request.get(`/deals/${dealId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(DEAL);
    } else {
      expect([301, 302, 303, 307, 308, 403, 404]).toContain(resp.status());
    }
  });
});
