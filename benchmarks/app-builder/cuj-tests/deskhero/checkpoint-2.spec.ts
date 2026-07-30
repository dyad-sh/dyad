// Deskhero — checkpoint 2 CUJ suite (design/app-2-deskhero.md, M2 CUJ table +
// M2 security probes). 12 CUJs + 8 probes.
//
// Personas: A (admin+…, bootstrapped admin), G (agent, promoted by A), R1/R2
// (requesters). Every test builds the personas and records it needs — nothing
// is inherited from a sibling test — so a failure never skips another scenario.
// Roles/ids come only from pinned surfaces (GET /api/me, data-user-id on
// user-row). Transition/assignment probes replay persona cookies via
// context.request.
import {
  test,
  expect,
  uniq,
  createTicket,
  createTicketFor,
  findTicketId,
  getMe,
  addNote,
  assignTo,
  promoteToAgent,
  transition,
} from "./fixtures";

test.describe("deskhero checkpoint 2", () => {
  test("m2-admin-bootstrap", async ({ desk }) => {
    const a = await desk.admin();
    await expect(a.page).toHaveURL(/\/admin\/?$/);
    await expect(a.page.getByTestId("admin-dashboard")).toBeVisible();
    await expect(a.page.getByTestId("role-badge")).toContainText("admin");
    expect((await getMe(a.ctx)).role).toBe("admin");
  });

  test("m2-promote-agent", async ({ desk }) => {
    const a = await desk.admin();
    const g = await desk.persona("agent1", "/tickets");
    // A promotes G on /admin/users, keyed by data-user-id.
    await promoteToAgent(a, g);
    // Persists after A reloads.
    await a.page.reload();
    // G re-reads role and routes to /agent.
    await g.page.goto("/");
    await g.page.waitForURL("**/agent", { timeout: 15_000 });
    await expect(g.page.getByTestId("agent-dashboard")).toBeVisible();
    expect((await getMe(g.ctx)).role).toBe("agent");
  });

  test("m2-create", async ({ desk }) => {
    const r1 = await desk.requester();
    const t1 = uniq("Printer broken");
    await createTicket(r1.page, { subject: t1, priority: "high" });
    await r1.page.goto("/tickets");
    await expect(
      r1.page.getByTestId("ticket-row").filter({ hasText: t1 }).first(),
    ).toContainText("open");
    expect(await findTicketId(r1.ctx, t1)).toBeTruthy();
  });

  test("m2-assign", async ({ desk }) => {
    const { admin, agent } = await desk.staff();
    const r1 = await desk.requester();
    const t1Id = await createTicketFor(r1, {
      subject: uniq("Printer broken"),
      priority: "high",
    });
    // assignTo is these exact steps plus a settle on the PATCH — without it the
    // select→navigate pair can cancel the in-flight request and fail for a
    // non-model reason. Same final assertion.
    await assignTo(admin, t1Id, agent);
  });

  test("m2-agent-queue", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("Printer broken"),
      priority: "high",
    });
    await w.agent.page.goto("/agent");
    await expect(
      w.agent.page.getByTestId("queue-mine").filter({ hasText: w.subject }),
    ).toBeVisible();
  });

  test("m2-self-assign", async ({ desk }) => {
    const { agent } = await desk.staff();
    const r1 = await desk.requester();
    const t2 = uniq("VPN down");
    const t2Id = await createTicketFor(r1, { subject: t2, priority: "medium" });
    await agent.page.goto("/agent");
    const unassignedRow = agent.page
      .getByTestId("queue-unassigned")
      .getByTestId("ticket-row")
      .filter({ hasText: t2 })
      .first();
    // The assign-to-me control may be on the row or the ticket detail.
    if (await unassignedRow.getByTestId("assign-to-me").count()) {
      await unassignedRow.getByTestId("assign-to-me").click();
    } else {
      await agent.page.goto(`/tickets/${t2Id}`);
      await agent.page.getByTestId("assign-to-me").click();
    }
    await agent.page.goto("/agent");
    await expect(
      agent.page.getByTestId("queue-mine").filter({ hasText: t2 }),
    ).toBeVisible();
  });

  test("m2-happy-path", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("Printer broken"),
      priority: "high",
    });
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await w.agent.page.getByTestId("transition-in_progress").click();
    await expect(
      w.agent.page.getByTestId("ticket-detail-status"),
    ).toContainText("in_progress");
    await w.agent.page.getByTestId("transition-resolved").click();
    await expect(
      w.agent.page.getByTestId("ticket-detail-status"),
    ).toContainText("resolved");
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    await w.requester.page.getByTestId("transition-closed").click();
    await expect(
      w.requester.page.getByTestId("ticket-detail-status"),
    ).toContainText("closed");
  });

  test("m2-reopen", async ({ desk }) => {
    // G resolves T2 (assigned to G), R1 reopens it back to open.
    const w = await desk.assignedTicket({
      subject: uniq("VPN down"),
      priority: "medium",
    });
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await transition(w.agent, "in_progress");
    await transition(w.agent, "resolved");
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    await w.requester.page.getByTestId("transition-open").click();
    await expect(
      w.requester.page.getByTestId("ticket-detail-status"),
    ).toContainText("open");
  });

  test("m2-button-gating", async ({ desk }) => {
    // The ticket must be ASSIGNED: `open → in_progress` legitimately requires
    // an assignee, so an unassigned ticket hides that control from everyone and
    // the gating assertion below would pass without proving anything about
    // roles.
    const w = await desk.assignedTicket({
      subject: uniq("VPN down"),
      priority: "medium",
    });
    const agent = w.agent;
    const r1 = w.requester;
    const t2Id = w.ticketId;
    // R1 on their own assigned ticket sees no agent-only transitions.
    await r1.page.goto(`/tickets/${t2Id}`);
    await expect(r1.page.getByTestId("transition-in_progress")).toHaveCount(0);
    await expect(r1.page.getByTestId("transition-resolved")).toHaveCount(0);
    // G is blocked off /admin/users.
    await agent.page.goto("/admin/users");
    if (agent.page.url().includes("/admin/users")) {
      await expect(agent.page.getByTestId("users-table")).toHaveCount(0);
    }
  });

  test("m2-notes", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("Printer broken"),
      priority: "high",
    });
    const marker = `internal-note-${uniq()}`;
    await w.agent.page.goto(`/tickets/${w.ticketId}`);
    await w.agent.page.getByTestId("note-input").fill(marker);
    await w.agent.page.getByTestId("note-submit").click();
    await expect(
      w.agent.page.getByTestId("note-item").filter({ hasText: marker }),
    ).toBeVisible();
    await w.admin.page.goto(`/tickets/${w.ticketId}`);
    await expect(
      w.admin.page.getByTestId("note-item").filter({ hasText: marker }),
    ).toBeVisible();
  });

  test("m2-notes-hidden", async ({ desk }) => {
    const w = await desk.assignedTicket({
      subject: uniq("Printer broken"),
      priority: "high",
    });
    const marker = `internal-note-${uniq()}`;
    await addNote(w.agent, w.ticketId, marker);
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    await expect(w.requester.page.getByTestId("note-item")).toHaveCount(0);
    expect(await w.requester.page.content()).not.toContain(marker);
  });

  test("m2-isolation", async ({ desk }) => {
    const r1 = await desk.requester();
    const t1 = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, { subject: t1, priority: "high" });
    const r2 = await desk.requester("req2");
    await expect(r2.page.getByTestId("ticket-empty")).toBeVisible();
    await r2.page.goto(`/tickets/${t1Id}`);
    expect(await r2.page.content()).not.toContain(t1);
  });

  // ---- security probes (raw HTTP with captured persona cookies) ----
  test("m2-p-idor", async ({ desk }) => {
    const r1 = await desk.requester();
    const t1 = uniq("Printer broken");
    const t1Id = await createTicketFor(r1, { subject: t1, priority: "high" });
    const r2 = await desk.requester("req2");
    const resp = await r2.ctx.request.get(`/api/tickets/${t1Id}`, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(resp.status());
    expect(await resp.text()).not.toContain(t1);
  });

  test("m2-p-self-promote", async ({ desk }) => {
    const r1 = await desk.requester();
    const r1UserId = await r1.userId();
    expect(r1UserId).toBeTruthy();
    const resp = await r1.ctx.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(r1.ctx)).role).toBe("requester");
  });

  test("m2-p-agent-promote", async ({ desk }) => {
    const { agent } = await desk.staff();
    const r1 = await desk.requester();
    const r1UserId = await r1.userId();
    const resp = await agent.ctx.request.patch(`/api/admin/users/${r1UserId}`, {
      data: { role: "admin" },
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    expect((await getMe(r1.ctx)).role).toBe("requester");
  });

  test("m2-p-user-list-leak", async ({ desk }) => {
    const a = await desk.admin();
    const g = await desk.persona("agent1", "/tickets");
    const r1 = await desk.requester();
    const resp = await r1.ctx.request.get("/api/admin/users", {
      maxRedirects: 0,
    });
    expect([401, 403]).toContain(resp.status());
    const text = await resp.text();
    expect(text).not.toContain(g.who.email);
    expect(text).not.toContain(a.who.email);
  });

  test("m2-p-skip-transition", async ({ desk }) => {
    // Fresh open ticket assigned to G, illegal open->closed by G.
    const w = await desk.assignedTicket({
      subject: uniq("Skip"),
      priority: "low",
    });
    const resp = await w.agent.ctx.request.post(
      `/api/tickets/${w.ticketId}/transition`,
      { data: { to: "closed" }, maxRedirects: 0 },
    );
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await w.requester.page.goto(`/tickets/${w.ticketId}`);
    await expect(
      w.requester.page.getByTestId("ticket-detail-status"),
    ).toContainText("open");
  });

  test("m2-p-role-transition", async ({ desk }) => {
    // R1's own open ticket, R1 attempts an agent-only transition.
    const r1 = await desk.requester();
    const roleId = await createTicketFor(r1, {
      subject: uniq("Role"),
      priority: "low",
    });
    const resp = await r1.ctx.request.post(
      `/api/tickets/${roleId}/transition`,
      {
        data: { to: "in_progress" },
        maxRedirects: 0,
      },
    );
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await r1.page.goto(`/tickets/${roleId}`);
    await expect(r1.page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-p-unassigned-transition", async ({ desk }) => {
    // Unassigned open ticket; G (not assignee) attempts to move it.
    const { agent } = await desk.staff();
    const r1 = await desk.requester();
    const unId = await createTicketFor(r1, {
      subject: uniq("Unassn"),
      priority: "low",
    });
    const resp = await agent.ctx.request.post(
      `/api/tickets/${unId}/transition`,
      { data: { to: "in_progress" }, maxRedirects: 0 },
    );
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    await r1.page.goto(`/tickets/${unId}`);
    await expect(r1.page.getByTestId("ticket-detail-status")).toContainText(
      "open",
    );
  });

  test("m2-p-notes-leak", async ({ desk }) => {
    // As R1 (the owner): notes endpoint denied, detail body excludes marker.
    const w = await desk.assignedTicket({
      subject: uniq("Printer broken"),
      priority: "high",
    });
    const marker = `internal-note-${uniq()}`;
    await addNote(w.agent, w.ticketId, marker);
    const notes = await w.requester.ctx.request.get(
      `/api/tickets/${w.ticketId}/notes`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(notes.status());
    const detail = await w.requester.ctx.request.get(
      `/api/tickets/${w.ticketId}`,
      { maxRedirects: 0 },
    );
    expect(detail.status()).toBe(200);
    expect(await detail.text()).not.toContain(marker);
  });
});
