// Deskhero — checkpoint 3 CUJ suite (design/app-2-deskhero.md, M3 CUJ table +
// M3 security probes). 12 CUJs + 10 probes.
//
// Personas A (admin), G (agent), R1/R2 (requesters). Every test provisions its
// own personas/tickets through the `desk` fixture — including the dead-cookie
// probes, which capture a live R2 context and then deactivate that persona
// themselves. Ids come only from pinned surfaces (GET /api/me, GET
// /api/tickets); identities, subjects and markers are unique per test.
import {
  test,
  expect,
  uniq,
  escapeRe,
  addNote,
  addReply,
  createCanned,
  createTicketFor,
  getMe,
  parseSlaDue,
  promoteToAgent,
  selectOptionByText,
  setSlaDue,
  statusText,
  toggleActive,
  transition,
  transitionDetail,
} from "./fixtures";

const DAY_MS = 24 * 3_600_000;

test.describe("deskhero checkpoint 3", () => {
  test("m3-setup", async ({ desk }) => {
    const a = await desk.admin();
    await expect(a.page).toHaveURL(/\/admin\/?$/);
    const g = await desk.persona("agent1", "/tickets");
    // Promote G to agent.
    await promoteToAgent(a, g);
    await g.page.goto("/");
    await g.page.waitForURL("**/agent", { timeout: 15_000 });
    const r1 = await desk.requester();
    const r2 = await desk.requester("req2");
    const ids = await Promise.all([
      a.userId(),
      g.userId(),
      r1.userId(),
      r2.userId(),
    ]);
    expect(ids.every((id) => Boolean(id))).toBeTruthy();
  });

  test("m3-sla-set", async ({ desk }) => {
    const r1 = await desk.requester();
    const slaTicketId = await createTicketFor(r1, {
      subject: uniq("SLA high"),
      priority: "high",
    });
    await r1.page.goto(`/tickets/${slaTicketId}`);
    await expect(r1.page.getByTestId("sla-due")).toBeVisible();
    const due = await parseSlaDue(r1.page);
    const hours = (due - Date.now()) / 3_600_000;
    expect(
      hours,
      `high-priority SLA ~4h (got ${hours.toFixed(1)}h)`,
    ).toBeGreaterThan(3.5);
    expect(hours).toBeLessThan(4.5);
  });

  test("m3-overdue", async ({ desk }) => {
    const a = await desk.admin();
    const r1 = await desk.requester();
    const subject = uniq("SLA high");
    const slaTicketId = await createTicketFor(r1, {
      subject,
      priority: "high",
    });
    // A sets the due time to yesterday via the pinned sla-due-input/save pair.
    await setSlaDue(a, slaTicketId, new Date(Date.now() - DAY_MS));
    await expect(a.page.getByTestId("overdue-badge")).toBeVisible();
    // Also visible on R1's list row.
    await r1.page.goto("/tickets");
    const row = r1.page.getByTestId("ticket-row").filter({ hasText: subject });
    await expect(row.getByTestId("overdue-badge")).toBeVisible();
  });

  test("m3-overdue-clears", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("SLA high"),
      priority: "high",
    });
    // Make it overdue first, so "no longer shown" is not vacuous.
    await setSlaDue(w.admin, w.ticketId, new Date(Date.now() - DAY_MS));
    await expect(w.admin.page.getByTestId("overdue-badge")).toBeVisible();
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await transition(w.agent, "in_progress");
    await transition(w.agent, "resolved");
    await w.agent.page.reload();
    await expect(w.agent.page.getByTestId("overdue-badge")).toHaveCount(0);
  });

  test("m3-canned-crud", async ({ desk }) => {
    const a = await desk.admin();
    const title = uniq("Greeting");
    // Creates at /admin/canned through the pinned form, then reloads.
    await createCanned(a, { title, body: `canned-marker-${uniq()}` });
    await expect(
      a.page.getByTestId("canned-row").filter({ hasText: title }),
    ).toBeVisible();
  });

  test("m3-canned-apply", async ({ desk }) => {
    // G on an assigned ticket applies the canned response into the reply box.
    const w = await desk.assignedTicket({
      subject: uniq("Canned"),
      priority: "low",
    });
    const cannedTitle = uniq("Greeting");
    const cannedBody = `canned-marker-${uniq()}`;
    await createCanned(w.admin, { title: cannedTitle, body: cannedBody });
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await selectOptionByText(w.agent.page, "canned-select", cannedTitle);
    await expect(w.agent.page.getByTestId("reply-input")).toHaveValue(
      new RegExp(escapeRe(cannedBody)),
    );
    const finalText = `${cannedBody} edited`;
    await w.agent.page.getByTestId("reply-input").fill(finalText);
    await w.agent.page.getByTestId("reply-submit").click();
    await expect(
      w.agent.page.getByTestId("reply-item").filter({ hasText: finalText }),
    ).toBeVisible();
  });

  test("m3-reply-thread", async ({ desk }) => {
    // R1 (owner) replies on their own SLA ticket; both parties see the thread.
    const w = await desk.assignedTicket({
      subject: uniq("SLA high"),
      priority: "high",
    });
    const agentHello = `agent-hello-${uniq()}`;
    const replyBack = `thanks-reply-${uniq()}`;
    // addReply confirms the write landed before the other persona navigates —
    // otherwise a server-rendered page can be built before the POST commits and
    // the assertion polls a static DOM until timeout (a false failure).
    await addReply(w.agent, w.ticketId, agentHello);
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    await expect(
      w.requester.page.getByTestId("reply-item").filter({
        hasText: agentHello,
      }),
    ).toBeVisible();
    await addReply(w.requester, w.ticketId, replyBack);
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await expect(
      w.agent.page.getByTestId("reply-item").filter({ hasText: replyBack }),
    ).toBeVisible();
  });

  test("m3-deactivate", async ({ desk }) => {
    const a = await desk.admin();
    const r2 = await desk.requester("req2");
    const row = await toggleActive(a, r2);
    await expect(row.getByTestId("user-status")).toContainText(/deactiv/i);
    // R2's existing session is rejected on next navigation.
    await r2.page.goto("/tickets");
    await expect(r2.page.getByTestId("account-deactivated")).toBeVisible();
    await expect(r2.page.getByTestId("ticket-row")).toHaveCount(0);
  });

  test("m3-reactivate", async ({ desk }) => {
    const a = await desk.admin();
    const r2 = await desk.requester("req2");
    await toggleActive(a, r2);
    await r2.page.goto("/tickets");
    await expect(r2.page.getByTestId("account-deactivated")).toBeVisible();
    await toggleActive(a, r2); // toggles back
    await r2.page.goto("/tickets");
    await expect(r2.page.getByTestId("account-deactivated")).toHaveCount(0);
  });

  test("m3-audit-role", async ({ desk }) => {
    const a = await desk.admin();
    const g = await desk.persona("agent1", "/tickets");
    await promoteToAgent(a, g);
    await a.page.goto("/admin/audit");
    const row = a.page
      .getByTestId("audit-row")
      .filter({ hasText: "role_change" })
      .filter({ hasText: g.who.email });
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText(/requester\s*(→|->|to)\s*agent/i);
  });

  test("m3-audit-transitions", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("Audit"),
      priority: "medium",
    });
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await transition(w.agent, "in_progress");
    await transition(w.agent, "resolved");
    await w.admin.page.goto("/admin/audit");
    // Scope to THIS test's actor: sibling tests transition their own tickets in
    // the same database and emit byte-identical detail text, so an unscoped
    // filter passes even when these transitions were never audited. The design
    // pins the actor ("audit rows for the CUJ-4 transitions with actor G").
    await expect(
      w.admin.page
        .getByTestId("audit-row")
        .filter({ hasText: transitionDetail("in_progress", "resolved") })
        .filter({ hasText: w.agent.who.email })
        .first(),
    ).toBeVisible();
  });

  test("m3-workflow-regression", async ({ desk }) => {
    // Fresh ticket by R1: assign to G, full legal chain to closed; G note; R1
    // never sees the note and only legal buttons at each stage.
    const w = await desk.assignedTicket({
      subject: uniq("Regr"),
      priority: "medium",
    });
    const marker = `note-marker-${uniq()}`;
    await addNote(w.agent, w.ticketId, marker);
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await w.agent.page.getByTestId("transition-in_progress").click();
    await w.agent.page.getByTestId("transition-resolved").click();
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    // R1 sees only the requester-legal transition (resolved→closed / →open).
    await expect(
      w.requester.page.getByTestId("transition-in_progress"),
    ).toHaveCount(0);
    await w.requester.page.getByTestId("transition-closed").click();
    await expect(
      w.requester.page.getByTestId("ticket-detail-status"),
    ).toContainText(statusText("closed"));
    expect(await w.requester.page.content()).not.toContain(marker);
  });

  // ---- security probes ----
  test("m3-p-dead-cookie-read", async ({ desk }) => {
    // R2's live session is captured (and given a ticket of its own) before A
    // deactivates it; the dead cookie must then read nothing.
    const a = await desk.admin();
    const r2 = await desk.requester("req2");
    const subject = uniq("Dead cookie");
    await createTicketFor(r2, { subject, priority: "low" });
    await toggleActive(a, r2);
    const resp = await r2.ctx.request.get("/api/tickets", { maxRedirects: 0 });
    expect([401, 403]).toContain(resp.status());
    expect(await resp.text()).not.toContain(subject);
  });

  test("m3-p-dead-cookie-write", async ({ desk }) => {
    const a = await desk.admin();
    const r2 = await desk.requester("req2");
    await toggleActive(a, r2);
    const subject = uniq("dead");
    const resp = await r2.ctx.request.post("/api/tickets", {
      data: { subject, priority: "low" },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    // A 4xx alone is not proof: an app with no deactivation check that happens
    // to reject the body for an unrelated reason (missing description) passes.
    // Prove the write did not land, mirroring m3-p-dead-cookie-read.
    const all = await a.ctx.request.get("/api/tickets");
    expect(
      await all.text(),
      "a deactivated account's ticket must not exist",
    ).not.toContain(subject);
  });

  test("m3-p-self-promote", async ({ desk }) => {
    const r1 = await desk.requester();
    const r1UserId = await r1.userId();
    const resp = await r1.ctx.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(r1.ctx)).role).toBe("requester");
  });

  test("m3-p-audit-leak", async ({ desk }) => {
    const { agent } = await desk.staff();
    const r1 = await desk.requester();
    for (const c of [r1.ctx, agent.ctx]) {
      const resp = await c.request.get("/api/admin/audit", { maxRedirects: 0 });
      expect([401, 403]).toContain(resp.status());
      expect(await resp.text()).not.toContain("role_change");
    }
  });

  test("m3-p-replies-idor", async ({ desk }) => {
    // R1's own ticket carries a reply; R2 (an active outsider) must not read it.
    const r1 = await desk.requester();
    const ticketId = await createTicketFor(r1, {
      subject: uniq("SLA high"),
      priority: "high",
    });
    const replyBack = `thanks-reply-${uniq()}`;
    await addReply(r1, ticketId, replyBack);
    const r2 = await desk.requester("req2");
    const resp = await r2.ctx.request.get(`/api/tickets/${ticketId}/replies`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(replyBack);
  });

  test("m3-p-note-serialization", async ({ desk }) => {
    // As R1 (owner of the ticket G noted on): the note marker must not leak via
    // the detail or replies bodies.
    const w = await desk.assignedTicket({
      subject: uniq("Regr"),
      priority: "medium",
    });
    const marker = `note-marker-${uniq()}`;
    await addNote(w.agent, w.ticketId, marker);
    const detail = await w.requester.ctx.request.get(
      `/api/tickets/${w.ticketId}`,
      { maxRedirects: 0 },
    );
    expect(await detail.text()).not.toContain(marker);
    const replies = await w.requester.ctx.request.get(
      `/api/tickets/${w.ticketId}/replies`,
      { maxRedirects: 0 },
    );
    if (replies.status() === 200) {
      expect(await replies.text()).not.toContain(marker);
    }
  });

  test("m3-p-canned-leak", async ({ desk }) => {
    const a = await desk.admin();
    const cannedBody = `canned-marker-${uniq()}`;
    await createCanned(a, { title: uniq("Greeting"), body: cannedBody });
    const r1 = await desk.requester();
    const get = await r1.ctx.request.get("/api/canned-responses", {
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(get.status());
    expect(await get.text()).not.toContain(cannedBody);
    const post = await r1.ctx.request.post("/api/admin/canned-responses", {
      data: { title: "x", body: "y" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(post.status());
  });

  test("m3-p-agent-deactivate", async ({ desk }) => {
    const { agent } = await desk.staff();
    const r1 = await desk.requester();
    const r1UserId = await r1.userId();
    const resp = await agent.ctx.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { active: false },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    // R1's session still works.
    const me = await r1.ctx.request.get("/api/me");
    expect(me.status()).toBe(200);
  });

  test("m3-p-admin-self-deactivate", async ({ desk }) => {
    const a = await desk.admin();
    const aUserId = await a.userId();
    const resp = await a.ctx.request.patch(`/api/admin/users/${aUserId}`, {
      data: { active: false },
      maxRedirects: 0,
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    const me = await a.ctx.request.get("/api/me");
    expect(me.status()).toBe(200);
  });

  test("m3-p-sla-edit-role", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("SLA high"),
      priority: "high",
    });
    const past = new Date(Date.now() - 3_600_000).toISOString();
    // Read the deadline BEFORE the attack so the write can be proven not to
    // have happened: a status-only assertion passes an app that performs the
    // UPDATE and then answers 403.
    const before = await w.admin.ctx.request.get(`/api/tickets/${w.ticketId}`);
    const slaBefore = (await before.json())?.sla_due_at ?? null;
    const resp = await w.agent.ctx.request.patch(`/api/tickets/${w.ticketId}`, {
      data: { slaDueAt: past },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    const after = await w.admin.ctx.request.get(`/api/tickets/${w.ticketId}`);
    const slaAfter = (await after.json())?.sla_due_at ?? null;
    expect(slaAfter, "sla_due_at must be unchanged by a forbidden PATCH").toBe(
      slaBefore,
    );
  });
});
