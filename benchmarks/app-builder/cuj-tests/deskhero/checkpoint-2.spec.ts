// Deskhero — checkpoint 2 CUJ suite (design/app-2-deskhero.md, M2 CUJ table +
// M2 security probes). 12 CUJs + 8 probes.
//
// Personas: A (admin+…, bootstrapped admin), G (agent, promoted by A), R1/R2
// (requesters). Roles/ids come only from pinned surfaces (GET /api/me,
// data-user-id on user-row). Transition/assignment probes replay persona
// cookies via context.request.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  RUN_ID,
  identity,
  signUp,
  createTicket,
  findTicketId,
  getMe,
  selectOptionByText,
} from "./fixtures";

const A = identity("admin");
const G = identity("agent1");
const R1 = identity("req1");
const R2 = identity("req2");

const T1 = `Printer broken ${RUN_ID}`;
const T2 = `VPN down ${RUN_ID}`;
const NOTE_MARKER = `internal-note-${RUN_ID}`;

test.describe.serial("deskhero checkpoint 2", () => {
  const ctx: Record<string, BrowserContext> = {};
  const page: Record<string, Page> = {};
  let gUserId: string | null = null;
  let r1UserId: string | null = null;
  let t1Id: string | null = null;
  let t2Id: string | null = null;

  async function persona(
    browser: any,
    key: string,
    who: any,
    expectUrl: string,
  ) {
    ctx[key] = await browser.newContext();
    page[key] = await ctx[key].newPage();
    await signUp(page[key], who);
    await page[key].waitForURL(`**${expectUrl}`, { timeout: 15_000 });
    return ctx[key];
  }

  test.afterAll(async () => {
    for (const c of Object.values(ctx)) await c?.close();
  });

  test("m2-admin-bootstrap", async ({ browser }) => {
    await persona(browser, "A", A, "/admin");
    await expect(page.A.getByTestId("admin-dashboard")).toBeVisible();
    await expect(page.A.getByTestId("role-badge")).toContainText("admin");
    expect((await getMe(ctx.A)).role).toBe("admin");
  });

  test("m2-promote-agent", async ({ browser }) => {
    await persona(browser, "G", G, "/tickets");
    gUserId = (await getMe(ctx.G)).id;
    // A promotes G on /admin/users, keyed by data-user-id.
    await page.A.goto("/admin/users");
    const row = page.A.getByTestId("user-row").filter({
      has: page.A.locator(`[data-user-id="${gUserId}"]`),
    });
    const target = (await row.count())
      ? row.first()
      : page.A.getByTestId("user-row").filter({ hasText: G.email }).first();
    await target.getByTestId("user-role-select").selectOption("agent");
    // Persists after A reloads.
    await page.A.reload();
    // G re-reads role and routes to /agent.
    await page.G.goto("/");
    await page.G.waitForURL("**/agent", { timeout: 15_000 });
    await expect(page.G.getByTestId("agent-dashboard")).toBeVisible();
    expect((await getMe(ctx.G)).role).toBe("agent");
  });

  test("m2-create", async ({ browser }) => {
    await persona(browser, "R1", R1, "/tickets");
    await createTicket(page.R1, { subject: T1, priority: "high" });
    await page.R1.goto("/tickets");
    await expect(
      page.R1.getByTestId("ticket-row").filter({ hasText: T1 }).first(),
    ).toContainText("open");
    t1Id = await findTicketId(ctx.R1, T1);
    r1UserId = (await getMe(ctx.R1)).id;
    expect(t1Id).toBeTruthy();
  });

  test("m2-assign", async () => {
    await page.A.goto(`/tickets/${t1Id}`);
    await selectOptionByText(page.A, "assignee-select", G.name);
    await page.A.goto(`/tickets/${t1Id}`);
    await expect(page.A.getByTestId("ticket-assignee")).toContainText(
      new RegExp(`${G.name}|${G.email}`),
    );
  });

  test("m2-agent-queue", async () => {
    await page.G.goto("/agent");
    await expect(
      page.G.getByTestId("queue-mine").filter({ hasText: T1 }),
    ).toBeVisible();
  });

  test("m2-self-assign", async () => {
    await createTicket(page.R1, { subject: T2, priority: "medium" });
    t2Id = await findTicketId(ctx.R1, T2);
    expect(t2Id).toBeTruthy();
    await page.G.goto("/agent");
    const unassignedRow = page.G.getByTestId("queue-unassigned")
      .getByTestId("ticket-row")
      .filter({ hasText: T2 })
      .first();
    // The assign-to-me control may be on the row or the ticket detail.
    if (await unassignedRow.getByTestId("assign-to-me").count()) {
      await unassignedRow.getByTestId("assign-to-me").click();
    } else {
      await page.G.goto(`/tickets/${t2Id}`);
      await page.G.getByTestId("assign-to-me").click();
    }
    await page.G.goto("/agent");
    await expect(
      page.G.getByTestId("queue-mine").filter({ hasText: T2 }),
    ).toBeVisible();
  });

  test("m2-happy-path", async () => {
    await page.G.goto(`/tickets/${t1Id}`);
    await page.G.getByTestId("transition-in_progress").click();
    await expect(page.G.getByTestId("ticket-detail-status")).toContainText(
      "in_progress",
    );
    await page.G.getByTestId("transition-resolved").click();
    await expect(page.G.getByTestId("ticket-detail-status")).toContainText(
      "resolved",
    );
    await page.R1.goto(`/tickets/${t1Id}`);
    await page.R1.getByTestId("transition-closed").click();
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "closed",
    );
  });

  test("m2-reopen", async () => {
    // G resolves T2 (self-assigned), R1 reopens it back to open.
    await page.G.goto(`/tickets/${t2Id}`);
    await page.G.getByTestId("transition-in_progress").click();
    await page.G.getByTestId("transition-resolved").click();
    await page.R1.goto(`/tickets/${t2Id}`);
    await page.R1.getByTestId("transition-open").click();
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-button-gating", async () => {
    // R1 on their own open ticket sees no agent-only transitions.
    await page.R1.goto(`/tickets/${t2Id}`);
    await expect(page.R1.getByTestId("transition-in_progress")).toHaveCount(0);
    await expect(page.R1.getByTestId("transition-resolved")).toHaveCount(0);
    // G is blocked off /admin/users.
    await page.G.goto("/admin/users");
    const url = page.G.url();
    if (url.includes("/admin/users")) {
      await expect(page.G.getByTestId("users-table")).toHaveCount(0);
    }
  });

  test("m2-notes", async () => {
    await page.G.goto(`/tickets/${t1Id}`);
    await page.G.getByTestId("note-input").fill(NOTE_MARKER);
    await page.G.getByTestId("note-submit").click();
    await expect(
      page.G.getByTestId("note-item").filter({ hasText: NOTE_MARKER }),
    ).toBeVisible();
    await page.A.goto(`/tickets/${t1Id}`);
    await expect(
      page.A.getByTestId("note-item").filter({ hasText: NOTE_MARKER }),
    ).toBeVisible();
  });

  test("m2-notes-hidden", async () => {
    await page.R1.goto(`/tickets/${t1Id}`);
    await expect(page.R1.getByTestId("note-item")).toHaveCount(0);
    expect(await page.R1.content()).not.toContain(NOTE_MARKER);
  });

  test("m2-isolation", async ({ browser }) => {
    await persona(browser, "R2", R2, "/tickets");
    await expect(page.R2.getByTestId("ticket-empty")).toBeVisible();
    await page.R2.goto(`/tickets/${t1Id}`);
    expect(await page.R2.content()).not.toContain(T1);
  });

  // ---- security probes (raw HTTP with captured persona cookies) ----
  test("m2-p-idor", async () => {
    const resp = await ctx.R2.request.get(`/api/tickets/${t1Id}`, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(T1);
  });

  test("m2-p-self-promote", async () => {
    expect(r1UserId).toBeTruthy();
    const resp = await ctx.R1.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(ctx.R1)).role).toBe("requester");
  });

  test("m2-p-agent-promote", async () => {
    const resp = await ctx.G.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(ctx.R1)).role).toBe("requester");
  });

  test("m2-p-user-list-leak", async () => {
    const resp = await ctx.R1.request.get("/api/admin/users", {
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    const text = await resp.text();
    expect(text).not.toContain(G.email);
    expect(text).not.toContain(A.email);
  });

  test("m2-p-skip-transition", async () => {
    // Fresh open ticket assigned to G, illegal open->closed by G.
    await createTicket(page.R1, { subject: `Skip ${RUN_ID}`, priority: "low" });
    const skipId = await findTicketId(ctx.R1, `Skip ${RUN_ID}`);
    await page.A.goto(`/tickets/${skipId}`);
    await selectOptionByText(page.A, "assignee-select", G.name);
    const resp = await ctx.G.request.post(`/api/tickets/${skipId}/transition`, {
      data: { to: "closed" },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await page.R1.goto(`/tickets/${skipId}`);
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-p-role-transition", async () => {
    // R1's own open ticket, R1 attempts an agent-only transition.
    await createTicket(page.R1, { subject: `Role ${RUN_ID}`, priority: "low" });
    const roleId = await findTicketId(ctx.R1, `Role ${RUN_ID}`);
    const resp = await ctx.R1.request.post(
      `/api/tickets/${roleId}/transition`,
      {
        data: { to: "in_progress" },
        maxRedirects: 0,
      },
    );
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await page.R1.goto(`/tickets/${roleId}`);
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-p-unassigned-transition", async () => {
    // Unassigned open ticket; G (not assignee) attempts to move it.
    await createTicket(page.R1, {
      subject: `Unassn ${RUN_ID}`,
      priority: "low",
    });
    const unId = await findTicketId(ctx.R1, `Unassn ${RUN_ID}`);
    const resp = await ctx.G.request.post(`/api/tickets/${unId}/transition`, {
      data: { to: "in_progress" },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await page.R1.goto(`/tickets/${unId}`);
    await expect(page.R1.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-p-notes-leak", async () => {
    // As R1 (the owner): notes endpoint denied, detail body excludes marker.
    const notes = await ctx.R1.request.get(`/api/tickets/${t1Id}/notes`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(notes.status());
    const detail = await ctx.R1.request.get(`/api/tickets/${t1Id}`, {
      maxRedirects: 0,
    });
    expect(detail.status()).toBe(200);
    expect(await detail.text()).not.toContain(NOTE_MARKER);
  });
});
