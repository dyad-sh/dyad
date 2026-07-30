// Deskhero — checkpoint 3 CUJ suite (design/app-2-deskhero.md, M3 CUJ table +
// M3 security probes). 12 CUJs + 10 probes.
//
// Personas A (admin), G (agent), R1/R2 (requesters). R2's context is captured
// before deactivation (CUJ 8) so the dead-cookie probes replay its stale
// session. Ids come only from pinned surfaces (GET /api/me, GET /api/tickets).
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  RUN_ID,
  identity,
  signUp,
  createTicket,
  findTicketId,
  getMe,
  selectOptionByText,
  parseSlaDue,
  fillSlaDueInput,
} from "./fixtures";

const A = identity("admin");
const G = identity("agent1");
const R1 = identity("req1");
const R2 = identity("req2");

const HIGH_TICKET = `SLA high ${RUN_ID}`;
const CANNED_TITLE = `Greeting ${RUN_ID}`;
const CANNED_BODY = `canned-marker-${RUN_ID}`;
const REPLY_BACK = `thanks-reply-${RUN_ID}`;
const NOTE_MARKER = `note-marker-${RUN_ID}`;
const REGR_TICKET = `Regr ${RUN_ID}`;

test.describe.serial("deskhero checkpoint 3", () => {
  const ctx: Record<string, BrowserContext> = {};
  const page: Record<string, Page> = {};
  let gUserId: string | null = null;
  let r1UserId: string | null = null;
  let r2UserId: string | null = null;
  let aUserId: string | null = null;
  let slaTicketId: string | null = null;
  let r1OwnTicketId: string | null = null;

  async function persona(browser: any, key: string, who: any) {
    ctx[key] = await browser.newContext();
    page[key] = await ctx[key].newPage();
    await signUp(page[key], who);
    return ctx[key];
  }

  test.afterAll(async () => {
    for (const c of Object.values(ctx)) await c?.close();
  });

  test("m3-setup", async ({ browser: _browser }) => {
    await persona(browser, "A", A);
    await page.A.waitForURL("**/admin", { timeout: 15_000 });
    aUserId = (await getMe(ctx.A)).id;
    await persona(browser, "G", G);
    await page.G.waitForURL("**/tickets", { timeout: 15_000 });
    gUserId = (await getMe(ctx.G)).id;
    // Promote G to agent.
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${gUserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: G.email }).first();
    await target.getByTestId("user-role-select").selectOption("agent");
    await page.G.goto("/");
    await page.G.waitForURL("**/agent", { timeout: 15_000 });
    await persona(browser, "R1", R1);
    await page.R1.waitForURL("**/tickets", { timeout: 15_000 });
    r1UserId = (await getMe(ctx.R1)).id;
    await persona(browser, "R2", R2);
    await page.R2.waitForURL("**/tickets", { timeout: 15_000 });
    r2UserId = (await getMe(ctx.R2)).id;
    expect(gUserId && r1UserId && r2UserId && aUserId).toBeTruthy();
  });

  test("m3-sla-set", async () => {
    await createTicket(page.R1, { subject: HIGH_TICKET, priority: "high" });
    slaTicketId = await findTicketId(ctx.R1, HIGH_TICKET);
    expect(slaTicketId).toBeTruthy();
    await page.R1.goto(`/tickets/${slaTicketId}`);
    await expect(page.R1.getByTestId("sla-due")).toBeVisible();
    const due = await parseSlaDue(page.R1);
    const hours = (due - Date.now()) / 3_600_000;
    expect(
      hours,
      `high-priority SLA ~4h (got ${hours.toFixed(1)}h)`,
    ).toBeGreaterThan(3.5);
    expect(hours).toBeLessThan(4.5);
  });

  test("m3-overdue", async () => {
    await page.A.goto(`/tickets/${slaTicketId}`);
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    await fillSlaDueInput(page.A, yesterday);
    await page.A.getByTestId("sla-due-save").click();
    await page.A.reload();
    await expect(page.A.getByTestId("overdue-badge")).toBeVisible();
    // Also visible on R1's list row.
    await page.R1.goto("/tickets");
    const row = page.R1.getByTestId("ticket-row").filter({
      hasText: HIGH_TICKET,
    });
    await expect(row.getByTestId("overdue-badge")).toBeVisible();
  });

  test("m3-overdue-clears", async () => {
    await page.A.goto(`/tickets/${slaTicketId}`);
    await selectOptionByText(page.A, "assignee-select", G.name);
    await page.G.goto(`/tickets/${slaTicketId}`);
    await page.G.getByTestId("transition-in_progress").click();
    await page.G.getByTestId("transition-resolved").click();
    await page.G.reload();
    await expect(page.G.getByTestId("overdue-badge")).toHaveCount(0);
  });

  test("m3-canned-crud", async () => {
    await page.A.goto("/admin/canned");
    await page.A.getByTestId("canned-title").fill(CANNED_TITLE);
    await page.A.getByTestId("canned-body").fill(CANNED_BODY);
    await page.A.getByTestId("canned-submit").click();
    await page.A.reload();
    await expect(
      page.A.getByTestId("canned-row").filter({ hasText: CANNED_TITLE }),
    ).toBeVisible();
  });

  test("m3-canned-apply", async () => {
    // G on an assigned ticket applies the canned response into the reply box.
    await createTicket(page.R1, {
      subject: `Canned ${RUN_ID}`,
      priority: "low",
    });
    const cid = await findTicketId(ctx.R1, `Canned ${RUN_ID}`);
    await page.A.goto(`/tickets/${cid}`);
    await selectOptionByText(page.A, "assignee-select", G.name);
    await page.G.goto(`/tickets/${cid}`);
    await selectOptionByText(page.G, "canned-select", CANNED_TITLE);
    await expect(page.G.getByTestId("reply-input")).toHaveValue(
      new RegExp(CANNED_BODY),
    );
    const finalText = `${CANNED_BODY} edited ${RUN_ID}`;
    await page.G.getByTestId("reply-input").fill(finalText);
    await page.G.getByTestId("reply-submit").click();
    await expect(
      page.G.getByTestId("reply-item").filter({ hasText: finalText }),
    ).toBeVisible();
  });

  test("m3-reply-thread", async () => {
    // R1 (owner) replies on their own SLA ticket; both parties see the thread.
    await page.G.goto(`/tickets/${slaTicketId}`);
    await page.G.getByTestId("reply-input").fill(`agent-hello-${RUN_ID}`);
    await page.G.getByTestId("reply-submit").click();
    await page.R1.goto(`/tickets/${slaTicketId}`);
    await expect(
      page.R1.getByTestId("reply-item").filter({
        hasText: `agent-hello-${RUN_ID}`,
      }),
    ).toBeVisible();
    await page.R1.getByTestId("reply-input").fill(REPLY_BACK);
    await page.R1.getByTestId("reply-submit").click();
    await page.G.goto(`/tickets/${slaTicketId}`);
    await expect(
      page.G.getByTestId("reply-item").filter({ hasText: REPLY_BACK }),
    ).toBeVisible();
  });

  test("m3-deactivate", async () => {
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${r2UserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: R2.email }).first();
    await target.getByTestId("user-deactivate").click();
    await expect(target.getByTestId("user-status")).toContainText(/deactiv/i);
    // R2's existing session is rejected on next navigation.
    await page.R2.goto("/tickets");
    await expect(page.R2.getByTestId("account-deactivated")).toBeVisible();
    await expect(page.R2.getByTestId("ticket-row")).toHaveCount(0);
  });

  test("m3-reactivate", async () => {
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${r2UserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: R2.email }).first();
    await target.getByTestId("user-deactivate").click(); // toggles back
    await page.R2.goto("/tickets");
    await expect(page.R2.getByTestId("account-deactivated")).toHaveCount(0);
  });

  test("m3-audit-role", async () => {
    await page.A.goto("/admin/audit");
    const row = page.A.getByTestId("audit-row")
      .filter({ hasText: "role_change" })
      .filter({ hasText: G.email });
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText(/requester\s*(→|->|to)\s*agent/i);
  });

  test("m3-audit-transitions", async () => {
    await page.A.goto("/admin/audit");
    await expect(
      page.A.getByTestId("audit-row")
        .filter({ hasText: /in_progress\s*(→|->|to)\s*resolved/i })
        .first(),
    ).toBeVisible();
  });

  test("m3-workflow-regression", async () => {
    // Fresh ticket by R1: assign to G, full legal chain to closed; G note; R1
    // never sees the note and only legal buttons at each stage.
    await createTicket(page.R1, { subject: REGR_TICKET, priority: "medium" });
    const rid = await findTicketId(ctx.R1, REGR_TICKET);
    r1OwnTicketId = rid;
    await page.A.goto(`/tickets/${rid}`);
    await selectOptionByText(page.A, "assignee-select", G.name);
    await page.G.goto(`/tickets/${rid}`);
    await page.G.getByTestId("note-input").fill(NOTE_MARKER);
    await page.G.getByTestId("note-submit").click();
    await page.G.getByTestId("transition-in_progress").click();
    await page.G.getByTestId("transition-resolved").click();
    await page.R1.goto(`/tickets/${rid}`);
    // R1 sees only the requester-legal transition (resolved→closed / →open).
    await expect(page.R1.getByTestId("transition-in_progress")).toHaveCount(0);
    await page.R1.getByTestId("transition-closed").click();
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "closed",
    );
    expect(await page.R1.content()).not.toContain(NOTE_MARKER);
  });

  // ---- security probes ----
  test("m3-p-dead-cookie-read", async ({ browser: _browser }) => {
    // Deactivate R2 again (m3-reactivate left it active), capturing its live
    // cookie context, then probe with the dead cookie.
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${r2UserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: R2.email }).first();
    await target.getByTestId("user-deactivate").click();
    await expect(target.getByTestId("user-status")).toContainText(/deactiv/i);
    const resp = await ctx.R2.request.get("/api/tickets", { maxRedirects: 0 });
    expect([401, 403]).toContain(resp.status());
    expect(await resp.text()).not.toContain(HIGH_TICKET);
  });

  test("m3-p-dead-cookie-write", async () => {
    const resp = await ctx.R2.request.post("/api/tickets", {
      data: { subject: `dead ${RUN_ID}`, priority: "low" },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });

  test("m3-p-self-promote", async () => {
    const resp = await ctx.R1.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(ctx.R1)).role).toBe("requester");
  });

  test("m3-p-audit-leak", async () => {
    for (const c of [ctx.R1, ctx.G]) {
      const resp = await c.request.get("/api/admin/audit", { maxRedirects: 0 });
      expect([401, 403]).toContain(resp.status());
      expect(await resp.text()).not.toContain("role_change");
    }
  });

  test("m3-p-replies-idor", async () => {
    // R2 (reactivate first so it's not merely dead-cookie-blocked).
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${r2UserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: R2.email }).first();
    await target.getByTestId("user-deactivate").click(); // reactivate
    const resp = await ctx.R2.request.get(
      `/api/tickets/${slaTicketId}/replies`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(REPLY_BACK);
  });

  test("m3-p-note-serialization", async () => {
    // As R1 (owner of the regression ticket): note marker must not leak via
    // detail or replies bodies.
    const detail = await ctx.R1.request.get(`/api/tickets/${r1OwnTicketId}`, {
      maxRedirects: 0,
    });
    expect(await detail.text()).not.toContain(NOTE_MARKER);
    const replies = await ctx.R1.request.get(
      `/api/tickets/${r1OwnTicketId}/replies`,
      { maxRedirects: 0 },
    );
    if (replies.status() === 200) {
      expect(await replies.text()).not.toContain(NOTE_MARKER);
    }
  });

  test("m3-p-canned-leak", async () => {
    const get = await ctx.R1.request.get("/api/canned-responses", {
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(get.status());
    expect(await get.text()).not.toContain(CANNED_BODY);
    const post = await ctx.R1.request.post("/api/admin/canned-responses", {
      data: { title: "x", body: "y" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(post.status());
  });

  test("m3-p-agent-deactivate", async () => {
    const resp = await ctx.G.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { active: false },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    // R1's session still works.
    const me = await ctx.R1.request.get("/api/me");
    expect(me.status()).toBe(200);
  });

  test("m3-p-admin-self-deactivate", async () => {
    const resp = await ctx.A.request.patch(`/api/admin/users/${aUserId}`, {
      data: { active: false },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    const me = await ctx.A.request.get("/api/me");
    expect(me.status()).toBe(200);
  });

  test("m3-p-sla-edit-role", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const resp = await ctx.G.request.patch(`/api/tickets/${slaTicketId}`, {
      data: { slaDueAt: past },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
  });
});
