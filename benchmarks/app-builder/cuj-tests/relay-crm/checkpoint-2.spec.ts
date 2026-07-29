// Relay CRM — checkpoint 2 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 2)" + "Security probes (checkpoint 2)").
// 12 CUJs (4 regression + 8 new) + 6 probes. Same conventions as checkpoint 1.
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
  numericText,
} from "./fixtures";

const OWNER = identity("owner2");
const MEMBER = identity("member");
const MEMBER2 = identity("member2");
const OUTSIDER = identity("outsider");

const ACME = `Acme2 ${RUN_ID}`;
const ADA = `Ada ${RUN_ID}`;
const ADA_TITLE_2 = `VP ${RUN_ID}`;
const BEE = `Bee ${RUN_ID}`;
const ZOE = `Zoe2 ${RUN_ID}`;
const TEAM_B = `Team B ${RUN_ID}`;
const DEAL = `Deal ${RUN_ID}`;
const DEAL_2 = `Deal2 ${RUN_ID}`;

test.describe.serial("relay-crm checkpoint 2", () => {
  let owner: BrowserContext;
  let ownerPage: Page;
  let member: BrowserContext;
  let memberPage: Page;
  let member2: BrowserContext;
  let outsider: BrowserContext;
  let firstWorkspaceName = "";
  let w1Id: string | null = null;
  let adaContactId: string | null = null;
  let dealId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    ownerPage = await owner.newPage();
  });

  test.afterAll(async () => {
    await owner?.close();
    await member?.close();
    await member2?.close();
    await outsider?.close();
  });

  test("crm-m1-01 sign-up creates session (regression)", async () => {
    await signUp(ownerPage, OWNER);
    await expectSignedIn(ownerPage, OWNER.email);
    const me = await getMe(owner);
    expect(me.email).toBe(OWNER.email);
  });

  test("crm-m1-05 create company + contact (regression)", async () => {
    await ownerPage.goto("/companies");
    await ownerPage.getByTestId("company-new-button").click();
    await ownerPage.getByTestId("company-form-name").fill(ACME);
    await ownerPage
      .getByTestId("company-form-domain")
      .fill(`acme2-${RUN_ID}.test`);
    await ownerPage.getByTestId("company-form-submit").click();
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(ADA);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`ada2-${RUN_ID}@example.com`);
    await ownerPage
      .getByTestId("contact-form-company")
      .selectOption({ label: ACME });
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    const row = ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("contact-row-company")).toContainText(ACME);
    adaContactId = await findIdByValue(owner, "/api/contacts", ADA);
    expect(adaContactId, "Ada's id from pinned GET /api/contacts").toBeTruthy();
  });

  test("crm-m1-07 edit contact title (regression)", async () => {
    await ownerPage.goto(`/contacts/${adaContactId}/edit`);
    await ownerPage.getByTestId("contact-form-title").fill(ADA_TITLE_2);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto(`/contacts/${adaContactId}`);
    await expect(ownerPage.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE_2,
    );
  });

  test("crm-m1-09 search filters contacts (regression)", async () => {
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(ZOE);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`zoe2-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contacts-search").fill(ADA);
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: ZOE }),
    ).toHaveCount(0);
    await ownerPage.getByTestId("contacts-search").fill("");
  });

  test("crm-m2-01 create second workspace, both in switcher and /api/me", async () => {
    // The auto-created workspace is the active one; record its name.
    firstWorkspaceName = (
      (await ownerPage
        .getByTestId("workspace-current-name")
        .first()
        .textContent()) ?? ""
    ).trim();
    expect(
      firstWorkspaceName.length,
      "auto-created workspace name",
    ).toBeGreaterThan(0);
    await ownerPage.goto("/workspaces");
    await ownerPage.getByTestId("workspace-create-button").click();
    await ownerPage.getByTestId("workspace-form-name").fill(TEAM_B);
    await ownerPage.getByTestId("workspace-form-submit").click();
    await ownerPage.getByTestId("workspace-switcher").first().click();
    const options = ownerPage.getByTestId("workspace-switcher-option");
    await expect(options.filter({ hasText: TEAM_B }).first()).toBeVisible();
    await expect(
      options.filter({ hasText: firstWorkspaceName }).first(),
    ).toBeVisible();
    await ownerPage.keyboard.press("Escape");
    const me = await getMe(owner);
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
    w1Id = w1 ? String(w1.workspaceId) : null;
    expect(w1Id, "W1 id from owner's own /api/me memberships").toBeTruthy();
  });

  test("crm-m2-02 workspace data isolation for contacts", async () => {
    await switchWorkspace(ownerPage, TEAM_B);
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(BEE);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`bee-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await switchWorkspace(ownerPage, firstWorkspaceName);
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: BEE }),
    ).toHaveCount(0);
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
    await switchWorkspace(ownerPage, TEAM_B);
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: BEE }).first(),
    ).toBeVisible();
    // Leave W1 active for the rest of the suite.
    await switchWorkspace(ownerPage, firstWorkspaceName);
  });

  test("crm-m2-03 invite flow adds member to owner's workspace", async ({
    browser,
  }) => {
    await ownerPage.goto("/settings/members");
    await ownerPage.getByTestId("invite-email-input").fill(MEMBER.email);
    await ownerPage.getByTestId("invite-submit").click();
    await expect(
      ownerPage
        .getByTestId("pending-invite-row")
        .filter({ hasText: MEMBER.email })
        .first(),
    ).toBeVisible();

    member = await browser.newContext();
    memberPage = await member.newPage();
    await signUp(memberPage, MEMBER);
    await expectSignedIn(memberPage, MEMBER.email);
    await memberPage.goto("/invites");
    await expect(
      memberPage
        .getByTestId("invite-row-workspace")
        .filter({ hasText: firstWorkspaceName })
        .first(),
    ).toBeVisible();
    await acceptInvite(memberPage, firstWorkspaceName);
    await memberPage.getByTestId("workspace-switcher").first().click();
    await expect(
      memberPage
        .getByTestId("workspace-switcher-option")
        .filter({ hasText: firstWorkspaceName })
        .first(),
    ).toBeVisible();
    await memberPage.keyboard.press("Escape");
    await switchWorkspace(memberPage, firstWorkspaceName);
    await memberPage.goto("/contacts");
    await expect(
      memberPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m2-04 members list shows both with data-user-id", async () => {
    const memberMe = await getMe(member);
    await ownerPage.goto("/settings/members");
    await expect(ownerPage.getByTestId("member-row")).toHaveCount(2);
    const memberRow = ownerPage
      .getByTestId("member-row")
      .filter({ hasText: MEMBER.email })
      .first();
    await expect(memberRow.getByTestId("member-row-email")).toContainText(
      MEMBER.email,
    );
    await expect(memberRow.getByTestId("member-row-role")).toContainText(
      /member/i,
    );
    expect(await memberRow.getAttribute("data-user-id")).toBe(
      String(memberMe.id),
    );
    await expect(
      ownerPage
        .getByTestId("pending-invite-row")
        .filter({ hasText: MEMBER.email }),
    ).toHaveCount(0);
  });

  test("crm-m2-05 create deal linked to contact", async () => {
    await ownerPage.goto("/deals");
    await ownerPage.getByTestId("deal-new-button").click();
    await ownerPage.getByTestId("deal-form-title").fill(DEAL);
    await ownerPage.getByTestId("deal-form-amount").fill("5000");
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
    await expect(card).toBeVisible();
    expect(await numericText(card.getByTestId("deal-card-amount"))).toBe(5000);
    dealId = await findIdByValue(owner, "/api/deals", DEAL);
    expect(dealId, "deal id from pinned GET /api/deals").toBeTruthy();
  });

  test("crm-m2-06 stage select persists across reload", async () => {
    const card = ownerPage
      .getByTestId("kanban-column-lead")
      .getByTestId("deal-card")
      .filter({ hasText: DEAL })
      .first();
    await card.getByTestId("deal-card-stage-select").selectOption("qualified");
    await expect(
      ownerPage
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage
        .getByTestId("kanban-column-qualified")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first(),
    ).toBeVisible();
  });

  test("crm-m2-07 column count and total aggregate", async () => {
    await ownerPage.goto("/deals");
    await ownerPage.getByTestId("deal-new-button").click();
    await ownerPage.getByTestId("deal-form-title").fill(DEAL_2);
    await ownerPage.getByTestId("deal-form-amount").fill("2500");
    await ownerPage.getByTestId("deal-form-stage").selectOption("qualified");
    await ownerPage.getByTestId("deal-form-submit").click();
    await ownerPage.goto("/deals");
    const column = ownerPage.getByTestId("kanban-column-qualified");
    await expect(
      column.getByTestId("deal-card").filter({ hasText: DEAL_2 }).first(),
    ).toBeVisible();
    expect(await numericText(column.getByTestId("column-count"))).toBe(2);
    expect(await numericText(column.getByTestId("column-total"))).toBe(7500);
  });

  test("crm-m2-08 member sees shared deals; personal board is empty", async () => {
    await memberPage.goto("/deals");
    await expect(
      memberPage.getByTestId("deal-card").filter({ hasText: DEAL }).first(),
    ).toBeVisible();
    await expect(
      memberPage.getByTestId("deal-card").filter({ hasText: DEAL_2 }).first(),
    ).toBeVisible();
    const memberMe = await getMe(member);
    const personal = (memberMe.memberships ?? []).find(
      (m: any) => String(m.workspaceName) !== firstWorkspaceName,
    );
    expect(personal, "member's own personal workspace in /api/me").toBeTruthy();
    await switchWorkspace(memberPage, String(personal.workspaceName));
    await memberPage.goto("/deals");
    await expect(memberPage.getByTestId("deal-card")).toHaveCount(0);
  });

  test("crm-m2-s01 outsider cannot read another workspace's contact", async ({
    browser,
  }) => {
    outsider = await browser.newContext();
    const page = await outsider.newPage();
    await signUp(page, OUTSIDER);
    await expectSignedIn(page, OUTSIDER.email);
    const read = await outsider.request.get(`/api/contacts/${adaContactId}`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(read.status());
    expect(await read.text()).not.toContain(ADA);
  });

  test("crm-m2-s02 outsider cannot write another workspace's contact", async () => {
    const patch = await outsider.request.patch(
      `/api/contacts/${adaContactId}`,
      { data: { name: "pwned" }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(patch.status());
    const del = await outsider.request.delete(`/api/contacts/${adaContactId}`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(del.status());
    const recheck = await owner.request.get("/api/contacts");
    const text = await recheck.text();
    expect(text).toContain(ADA);
    expect(text).not.toContain("pwned");
  });

  test("crm-m2-s03 client-supplied workspace ids are not trusted", async () => {
    const attempts = [
      outsider.request.get(`/api/contacts?workspaceId=${w1Id}`),
      outsider.request.get(`/api/deals?workspace_id=${w1Id}`),
      outsider.request.get("/api/contacts", {
        headers: { "X-Workspace-Id": String(w1Id) },
      }),
      outsider.request.get("/api/deals", {
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
    browser,
  }) => {
    // A real, legitimately-issued invite for member2, unaccepted.
    await ownerPage.goto("/settings/members");
    await ownerPage.getByTestId("invite-email-input").fill(MEMBER2.email);
    await ownerPage.getByTestId("invite-submit").click();
    member2 = await browser.newContext();
    const m2Page = await member2.newPage();
    await signUp(m2Page, MEMBER2);
    await expectSignedIn(m2Page, MEMBER2.email);
    const invites = (await (
      await member2.request.get("/api/invites")
    ).json()) as Array<Record<string, unknown>>;
    const invite = invites.find((i) => String(i.email) === MEMBER2.email);
    expect(
      invite?.id,
      "invite id from the invitee's own /api/invites",
    ).toBeTruthy();

    const steal = await outsider.request.post(
      `/api/invites/${invite!.id}/accept`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(steal.status());
    const outsiderInvites = await (
      await outsider.request.get("/api/invites")
    ).text();
    expect(outsiderInvites).not.toContain(MEMBER2.email);
    const outsiderMe = await getMe(outsider);
    const outsiderNames = (outsiderMe.memberships ?? []).map((m: any) =>
      String(m.workspaceName),
    );
    expect(outsiderNames).not.toContain(firstWorkspaceName);
    await ownerPage.goto("/settings/members");
    await expect(ownerPage.getByTestId("member-row")).toHaveCount(2);
    // Still acceptable by the real invitee afterwards.
    await acceptInvite(m2Page, firstWorkspaceName);
    const m2Me = await getMe(member2);
    expect(
      (m2Me.memberships ?? []).map((m: any) => String(m.workspaceName)),
    ).toContain(firstWorkspaceName);
  });

  test("crm-m2-s05 unauthenticated API surface denies and leaks nothing", async () => {
    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
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
      expect(text).not.toContain(OWNER.email);
    }
    await anon.dispose();
  });

  test("crm-m2-s06 deal detail page does not render cross-workspace", async () => {
    const resp = await outsider.request.get(`/deals/${dealId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(DEAL);
    } else {
      expect([301, 302, 303, 307, 308, 403, 404]).toContain(resp.status());
    }
  });
});
