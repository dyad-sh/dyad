// Deskhero — checkpoint 1 CUJ suite (design/app-2-deskhero.md, M1 CUJ table +
// M1 security probes). 9 CUJs + 3 probes.
//
// Conventions (design "Suite mechanics"): every test provisions its own
// personas and records through the `desk` fixture — nothing is inherited from a
// sibling test, so a failure can never skip another scenario. Raw-HTTP probes
// go through `context.request` (persona cookies); ids come only from pinned
// surfaces (GET /api/me, GET /api/tickets); every identity/subject/marker is
// unique per test.
import { request as pwRequest } from "@playwright/test";
import {
  test,
  expect,
  uniq,
  createTicket,
  createTicketFor,
  expectSignedIn,
  findTicketId,
} from "./fixtures";

const BODY = "It smokes when I print.";

test.describe("deskhero checkpoint 1", () => {
  test("m1-signup-land", async ({ desk }) => {
    const r1 = await desk.requester();
    await expect(r1.page).toHaveURL(/\/tickets\/?$/);
    await expectSignedIn(r1.page, r1.who.email);
    await expect(r1.page.getByTestId("ticket-empty")).toBeVisible();
    const me = await r1.ctx.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(r1.who.email);
  });

  test("m1-create", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    await createTicket(r1.page, { subject, body: BODY, priority: "high" });
    await r1.page.goto("/tickets");
    const row = r1.page
      .getByTestId("ticket-row")
      .filter({ hasText: subject })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("high");
    await expect(row).toContainText("open");
    const t1Id = await findTicketId(r1.ctx, subject);
    expect(t1Id, "T1 id from pinned GET /api/tickets").toBeTruthy();
  });

  test("m1-validation", async ({ desk }) => {
    const r1 = await desk.requester();
    await r1.page.goto("/tickets");
    const before = await r1.page.getByTestId("ticket-row").count();
    await r1.page.getByTestId("new-ticket-link").click();
    await r1.page.getByTestId("ticket-body").fill("no subject here");
    await r1.page.getByTestId("ticket-submit").click();
    await expect(r1.page.getByTestId("ticket-error")).toBeVisible();
    await r1.page.goto("/tickets");
    expect(await r1.page.getByTestId("ticket-row").count()).toBe(before);
  });

  test("m1-detail", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, {
      subject,
      body: BODY,
      priority: "high",
    });
    await r1.page.goto(`/tickets/${t1Id}`);
    await expect(r1.page.getByTestId("ticket-detail-subject")).toContainText(
      subject,
    );
    await expect(r1.page.getByTestId("ticket-detail-body")).toContainText(BODY);
    await expect(r1.page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
    await expect(r1.page.getByTestId("ticket-detail-priority")).toContainText(
      "high",
    );
  });

  test("m1-edit", async ({ desk }) => {
    const r1 = await desk.requester();
    const t1Id = await createTicketFor(r1, {
      subject: uniq("Printer broken"),
      body: BODY,
      priority: "high",
    });
    const edited = uniq("Printer jammed");
    await r1.page.goto(`/tickets/${t1Id}`);
    await r1.page.getByTestId("ticket-edit").click();
    await r1.page.getByTestId("ticket-subject").fill(edited);
    await r1.page.getByTestId("ticket-priority").selectOption("medium");
    await r1.page.getByTestId("ticket-submit").click();
    await r1.page.goto(`/tickets/${t1Id}`);
    await expect(r1.page.getByTestId("ticket-detail-subject")).toContainText(
      edited,
    );
    await expect(r1.page.getByTestId("ticket-detail-priority")).toContainText(
      "medium",
    );
  });

  test("m1-close-reopen", async ({ desk }) => {
    const r1 = await desk.requester();
    const t1Id = await createTicketFor(r1, {
      subject: uniq("Printer broken"),
      body: BODY,
      priority: "high",
    });
    await r1.page.goto(`/tickets/${t1Id}`);
    await r1.page.getByTestId("ticket-close").click();
    await expect(r1.page.getByTestId("ticket-detail-status")).toContainText(
      "closed",
    );
    await r1.page.getByTestId("ticket-reopen").click();
    await expect(r1.page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m1-delete", async ({ desk }) => {
    // Two tickets: T2 is deleted, T1 must remain as the only row afterwards.
    const r1 = await desk.requester();
    const keep = uniq("Printer broken");
    await createTicketFor(r1, { subject: keep, priority: "high" });
    const doomed = uniq("VPN down");
    const t2Id = await createTicketFor(r1, {
      subject: doomed,
      priority: "low",
    });
    await r1.page.goto(`/tickets/${t2Id}`);
    await r1.page.getByTestId("ticket-delete").click();
    // A confirm control may or may not exist; click it if present.
    const confirm = r1.page.getByTestId("ticket-delete-confirm");
    if (await confirm.count()) await confirm.first().click();
    await r1.page.goto("/tickets");
    await expect(
      r1.page.getByTestId("ticket-row").filter({ hasText: doomed }),
    ).toHaveCount(0);
    await expect(
      r1.page.getByTestId("ticket-row").filter({ hasText: keep }),
    ).toHaveCount(1);
  });

  test("m1-signout-guard", async ({ desk }) => {
    const r1 = await desk.requester();
    await r1.page.getByTestId("sign-out").click();
    await r1.page.goto("/tickets");
    await r1.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
  });

  test("m1-isolation-ui", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, {
      subject,
      body: BODY,
      priority: "high",
    });
    const r2 = await desk.requester("req2");
    await expect(r2.page.getByTestId("ticket-empty")).toBeVisible();
    // R2 visits R1's ticket directly: 404/redirect, subject absent.
    await r2.page.goto(`/tickets/${t1Id}`);
    expect(await r2.page.content()).not.toContain(subject);
  });

  // ---- security probes ----
  test("m1-p-unauth", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    await createTicketFor(r1, { subject, body: BODY, priority: "high" });
    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
      const resp = await anon.get("/api/tickets", { maxRedirects: 0 });
      expect([401, 403, 301, 302, 303, 307, 308]).toContain(resp.status());
      expect(await resp.text()).not.toContain(subject);
    } finally {
      await anon.dispose();
    }
  });

  test("m1-p-idor-read", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, {
      subject,
      body: BODY,
      priority: "high",
    });
    const r2 = await desk.requester("req2");
    const resp = await r2.ctx.request.get(`/api/tickets/${t1Id}`, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(subject);
  });

  test("m1-p-idor-write", async ({ desk }) => {
    const r1 = await desk.requester();
    const subject = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, {
      subject,
      body: BODY,
      priority: "high",
    });
    const r2 = await desk.requester("req2");
    const resp = await r2.ctx.request.patch(`/api/tickets/${t1Id}`, {
      data: { subject: "pwned" },
      maxRedirects: 0,
    });
    expect([400, 401, 403, 404, 422]).toContain(resp.status());
    // R1's ticket unchanged.
    const recheck = await r1.ctx.request.get("/api/tickets");
    const text = await recheck.text();
    expect(text).toContain(subject);
    expect(text).not.toContain("pwned");
  });
});
