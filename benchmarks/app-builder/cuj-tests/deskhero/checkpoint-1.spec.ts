// Deskhero — checkpoint 1 CUJ suite (design/app-2-deskhero.md, M1 CUJ table +
// M1 security probes). 9 CUJs + 3 probes.
//
// Conventions (design "Suite mechanics"): serial; personas own a context each;
// raw-HTTP probes go through context.request (persona cookies); ids only from
// pinned surfaces (GET /api/me, GET /api/tickets); RUN_ID-suffixed data.
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
  createTicket,
  findTicketId,
} from "./fixtures";

const R1 = identity("req1");
const R2 = identity("req2");

const T1_SUBJECT = `Printer broken ${RUN_ID}`;
const T1_SUBJECT_2 = `Printer jammed ${RUN_ID}`;
const T2_SUBJECT = `VPN down ${RUN_ID}`;

test.describe.serial("deskhero checkpoint 1", () => {
  let r1: BrowserContext;
  let r1Page: Page;
  let r2: BrowserContext;
  let t1Id: string | null = null;

  test.beforeAll(async ({ browser }) => {
    r1 = await browser.newContext();
    r1Page = await r1.newPage();
  });
  test.afterAll(async () => {
    await r1?.close();
    await r2?.close();
  });

  test("m1-signup-land", async () => {
    await signUp(r1Page, R1);
    await r1Page.waitForURL("**/tickets", { timeout: 15_000 });
    await expectSignedIn(r1Page, R1.email);
    await expect(r1Page.getByTestId("ticket-empty")).toBeVisible();
    const me = await r1.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(R1.email);
  });

  test("m1-create", async () => {
    await createTicket(r1Page, {
      subject: T1_SUBJECT,
      body: "It smokes when I print.",
      priority: "high",
    });
    await r1Page.goto("/tickets");
    const row = r1Page
      .getByTestId("ticket-row")
      .filter({ hasText: T1_SUBJECT })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("high");
    await expect(row).toContainText("open");
    t1Id = await findTicketId(r1, T1_SUBJECT);
    expect(t1Id, "T1 id from pinned GET /api/tickets").toBeTruthy();
  });

  test("m1-validation", async () => {
    await r1Page.goto("/tickets");
    const before = await r1Page.getByTestId("ticket-row").count();
    await r1Page.getByTestId("new-ticket-link").click();
    await r1Page.getByTestId("ticket-body").fill("no subject here");
    await r1Page.getByTestId("ticket-submit").click();
    await expect(r1Page.getByTestId("ticket-error")).toBeVisible();
    await r1Page.goto("/tickets");
    expect(await r1Page.getByTestId("ticket-row").count()).toBe(before);
  });

  test("m1-detail", async () => {
    await r1Page.goto(`/tickets/${t1Id}`);
    await expect(r1Page.getByTestId("ticket-detail-subject")).toContainText(
      T1_SUBJECT,
    );
    await expect(r1Page.getByTestId("ticket-detail-body")).toContainText(
      "It smokes when I print.",
    );
    await expect(r1Page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
    await expect(r1Page.getByTestId("ticket-detail-priority")).toContainText(
      "high",
    );
  });

  test("m1-edit", async () => {
    await r1Page.goto(`/tickets/${t1Id}`);
    await r1Page.getByTestId("ticket-edit").click();
    await r1Page.getByTestId("ticket-subject").fill(T1_SUBJECT_2);
    await r1Page.getByTestId("ticket-priority").selectOption("medium");
    await r1Page.getByTestId("ticket-submit").click();
    await r1Page.goto(`/tickets/${t1Id}`);
    await expect(r1Page.getByTestId("ticket-detail-subject")).toContainText(
      T1_SUBJECT_2,
    );
    await expect(r1Page.getByTestId("ticket-detail-priority")).toContainText(
      "medium",
    );
  });

  test("m1-close-reopen", async () => {
    await r1Page.goto(`/tickets/${t1Id}`);
    await r1Page.getByTestId("ticket-close").click();
    await expect(r1Page.getByTestId("ticket-detail-status")).toContainText(
      "closed",
    );
    await r1Page.getByTestId("ticket-reopen").click();
    await expect(r1Page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m1-delete", async () => {
    // A 2nd ticket to delete; T1 must remain as the only row afterwards.
    await createTicket(r1Page, { subject: T2_SUBJECT, priority: "low" });
    const t2Id = await findTicketId(r1, T2_SUBJECT);
    expect(t2Id, "T2 id from pinned GET /api/tickets").toBeTruthy();
    await r1Page.goto(`/tickets/${t2Id}`);
    await r1Page.getByTestId("ticket-delete").click();
    // A confirm control may or may not exist; click it if present.
    const confirm = r1Page.getByTestId("ticket-delete-confirm");
    if (await confirm.count()) await confirm.first().click();
    await r1Page.goto("/tickets");
    await expect(
      r1Page.getByTestId("ticket-row").filter({ hasText: T2_SUBJECT }),
    ).toHaveCount(0);
    await expect(
      r1Page.getByTestId("ticket-row").filter({ hasText: T1_SUBJECT_2 }),
    ).toHaveCount(1);
  });

  test("m1-signout-guard", async () => {
    await r1Page.getByTestId("sign-out").click();
    await r1Page.goto("/tickets");
    await r1Page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    // Sign back in so later CUJs still have R1's session.
    await r1Page.getByTestId("signin-email").fill(R1.email);
    await r1Page.getByTestId("signin-password").fill(R1.password);
    await r1Page.getByTestId("signin-submit").click();
    await expectSignedIn(r1Page, R1.email);
  });

  test("m1-isolation-ui", async ({ browser }) => {
    r2 = await browser.newContext();
    const page = await r2.newPage();
    await signUp(page, R2);
    await page.waitForURL("**/tickets", { timeout: 15_000 });
    await expect(page.getByTestId("ticket-empty")).toBeVisible();
    // R2 visits R1's ticket directly: 404/redirect, subject absent.
    await page.goto(`/tickets/${t1Id}`);
    expect(await page.content()).not.toContain(T1_SUBJECT_2);
  });

  // ---- security probes ----
  test("m1-p-unauth", async () => {
    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const resp = await anon.get("/api/tickets", { maxRedirects: 0 });
    expect([401, 403, 301, 302, 303, 307, 308]).toContain(resp.status());
    expect(await resp.text()).not.toContain(T1_SUBJECT_2);
    await anon.dispose();
  });

  test("m1-p-idor-read", async () => {
    expect(t1Id, "needs T1 id").toBeTruthy();
    const resp = await r2.request.get(`/api/tickets/${t1Id}`, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(T1_SUBJECT_2);
  });

  test("m1-p-idor-write", async () => {
    const resp = await r2.request.patch(`/api/tickets/${t1Id}`, {
      data: { subject: "pwned" },
      maxRedirects: 0,
    });
    expect([400, 401, 403, 404, 422]).toContain(resp.status());
    // R1's ticket unchanged.
    const recheck = await r1.request.get("/api/tickets");
    const text = await recheck.text();
    expect(text).toContain(T1_SUBJECT_2);
    expect(text).not.toContain("pwned");
  });
});
