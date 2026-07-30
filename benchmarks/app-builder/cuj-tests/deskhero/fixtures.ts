// Shared Deskhero suite helpers (design/app-2-deskhero.md, "Suite mechanics").
//
// Independence contract: the checkpoint suites are NOT serial. Every test
// provisions the exact world it needs through the `desk` fixture exported here
// and asserts only its own scenario, so a failure can never skip — and thereby
// silently void — a sibling test. `Desk` owns every browser context it opens
// and closes them in fixture teardown, so videos flush and Postgres
// connections do not leak even when a test fails mid-flight.
//
// Personas: admin/agent1/req1/req2, each with a unique-per-persona email so
// repeated runs and sibling tests sharing one database never collide; the admin
// bootstrap rule keys off the `admin+` email local-part prefix (M2 prompt).
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { videoOpts } from "../video-context";

export { expect };

export const RUN_ID = `${Date.now()}`;
export const PASSWORD = "Passw0rd!Desk1";

export type Role = "admin" | "agent1" | "req1" | "req2";
export type Priority = "low" | "medium" | "high";
export type Status = "open" | "in_progress" | "resolved" | "closed";

export interface Identity {
  name: string;
  email: string;
  password: string;
}

const rand = () =>
  Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);

// Unique token for one test's data (identities, subjects, markers). Tests share
// one database, so every string a test asserts on must be unique to the *test*,
// not merely to the run — otherwise a sibling's row could satisfy or break it.
export function uniq(label?: string): string {
  const token = `${RUN_ID}-${rand()}`;
  return label ? `${label} ${token}` : token;
}

// Escape a persona-supplied string for use inside a RegExp (emails contain `+`).
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Design-pinned email shapes: admin+<token>@deskhero.test etc. The `admin+`
// prefix triggers the M2 bootstrap rule; requester/agent prefixes are inert.
// Display names are unique too: assignee/role selects list every user in the
// database, so a shared name would make option matching ambiguous.
export function identity(role: Role): Identity {
  const token = uniq();
  return {
    name: `Desk ${role[0].toUpperCase()}${role.slice(1)} ${token}`,
    email: `${role}+${token}@deskhero.test`,
    password: PASSWORD,
  };
}

// Wait for a create/update form to actually finish submitting before navigating
// away. Clicking submit fires a client-side request and then routes; a
// `page.goto` issued immediately aborts that request in flight, so the record
// is never written (this silently broke every provisioning helper once tests
// stopped inheriting state from each other).
export async function settleAfterSubmit(page: Page, formPath = "/new") {
  await page
    .waitForURL((u) => !u.pathname.endsWith(formPath), { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

export async function signUp(page: Page, who: Identity) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
}

export async function signIn(
  page: Page,
  who: { email: string; password: string },
) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
}

// Deskhero pins post-sign-in landing by role (M1: '/' → /tickets; M2: admin →
// /admin, agent → /agent). Callers assert the landing URL themselves when the
// CUJ pins it; this helper just confirms the signed-in header.
export async function expectSignedIn(page: Page, email: string) {
  await expect(page.getByTestId("user-email")).toContainText(email, {
    timeout: 15_000,
  });
}

// Pinned GET /api/me — id/role provenance for a persona's own identity.
export async function getMe(
  context: BrowserContext,
): Promise<{ id: string; email: string; name?: string; role?: string }> {
  const resp = await context.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return resp.json();
}

// Non-asserting role read, for waiting on a role change to land server-side
// without failing on a transient non-200.
async function readRole(context: BrowserContext): Promise<string | null> {
  const resp = await context.request.get("/api/me");
  if (!resp.ok()) return null;
  const body = (await resp.json()) as { role?: string };
  return body.role ?? null;
}

// Find a ticket id in the pinned GET /api/tickets list by subject substring.
// Owner-scoped by design, so call it with the requester's own context.
export async function findTicketId(
  context: BrowserContext,
  needle: string,
): Promise<string | null> {
  const resp = await context.request.get("/api/tickets");
  if (!resp.ok()) return null;
  const body = await resp.json();
  const items: Array<Record<string, unknown>> = Array.isArray(body)
    ? body
    : Array.isArray((body as { tickets?: unknown[] }).tickets)
      ? (body as { tickets: Array<Record<string, unknown>> }).tickets
      : [];
  const hit = items.find((it) =>
    Object.values(it).some((v) => typeof v === "string" && v.includes(needle)),
  );
  return hit && hit.id != null ? String(hit.id) : null;
}

// Create a ticket through the pinned M1 UI. Leaves the page wherever the app
// lands after submit; callers navigate as needed.
export async function createTicket(
  page: Page,
  t: { subject: string; body?: string; priority?: Priority },
) {
  await page.goto("/tickets");
  await page.getByTestId("new-ticket-link").click();
  await page.getByTestId("ticket-subject").fill(t.subject);
  if (t.body !== undefined) {
    await page.getByTestId("ticket-body").fill(t.body);
  }
  if (t.priority) {
    await page.getByTestId("ticket-priority").selectOption(t.priority);
  }
  await page.getByTestId("ticket-submit").click();
}

// Select the option whose visible text contains `needle` on a pinned native
// <select>. Option VALUES are app-designed (ids, role strings…), so match by
// text first and fall back to value === needle.
export async function selectOptionByText(
  page: Page,
  testId: string,
  needle: string,
) {
  const select = page.getByTestId(testId).first();
  await expect(select).toBeVisible({ timeout: 15_000 });
  const value = await select.evaluate((el: HTMLSelectElement, text) => {
    const opt = Array.from(el.options).find(
      (o) => o.textContent?.includes(text) || o.value === text,
    );
    return opt ? opt.value : null;
  }, needle);
  expect(value, `option containing "${needle}" in ${testId}`).not.toBeNull();
  await select.selectOption(value as string);
}

// Read a due-time from the pinned `sla-due` element, tolerating any renderable
// date format; returns epoch ms or NaN.
export async function parseSlaDue(page: Page): Promise<number> {
  const text = (await page.getByTestId("sla-due").first().textContent()) ?? "";
  const iso = text.match(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?/);
  const parsed = Date.parse(iso ? iso[0] : text.replace(/^[^\d]*/, ""));
  if (!Number.isNaN(parsed)) return parsed;
  return Date.parse(text);
}

// Fill the pinned sla-due-input with a given Date, adapting to the input's
// actual type (datetime-local vs text/ISO).
export async function fillSlaDueInput(page: Page, when: Date) {
  const input = page.getByTestId("sla-due-input").first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  const kind = await input.evaluate(
    (el) => (el as HTMLInputElement).type ?? "text",
  );
  if (kind === "datetime-local") {
    const pad = (n: number) => `${n}`.padStart(2, "0");
    const v = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
    await input.fill(v);
  } else if (kind === "date") {
    await input.fill(when.toISOString().slice(0, 10));
  } else {
    await input.fill(when.toISOString());
  }
}

// ---------------------------------------------------------------------------
// Per-test provisioning
// ---------------------------------------------------------------------------

export interface Persona {
  readonly who: Identity;
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** This persona's own id, from the pinned GET /api/me (memoized). */
  userId(): Promise<string>;
}

/** admin + promoted agent + requester + one open ticket assigned to the agent. */
export interface AssignedTicket {
  admin: Persona;
  agent: Persona;
  requester: Persona;
  ticketId: string;
  subject: string;
}

export class Desk {
  private readonly contexts: BrowserContext[] = [];

  constructor(private readonly browser: Browser) {}

  /** A tracked, video-recorded (when CUJ_VIDEO_DIR is set) browser context. */
  async context(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(videoOpts());
    this.contexts.push(ctx);
    return ctx;
  }

  /** Sign up a brand-new persona and wait for its pinned landing route. */
  async persona(role: Role, landing = "/tickets"): Promise<Persona> {
    const who = identity(role);
    const ctx = await this.context();
    const page = await ctx.newPage();
    await signUp(page, who);
    await page.waitForURL(`**${landing}`, { timeout: 20_000 });
    let id: string | null = null;
    return {
      who,
      ctx,
      page,
      async userId() {
        if (id === null) id = (await getMe(ctx)).id;
        return id;
      },
    };
  }

  /** Requester persona (the default role for every new sign-up). */
  requester(role: "req1" | "req2" = "req1"): Promise<Persona> {
    return this.persona(role, "/tickets");
  }

  /** Bootstrapped admin (`admin+` local part ⇒ admin at sign-up, M2+). */
  admin(): Promise<Persona> {
    return this.persona("admin", "/admin");
  }

  /**
   * Agent persona: signs up as a requester, then `admin` promotes it.
   *
   * Deliberately does NOT assert the `/` → `/agent` role redirect:
   * `promoteToAgent` already confirms the role server-side via /api/me, and
   * asserting the redirect here would make every scenario that needs an agent
   * (about half of M2/M3, including note-redaction and SLA probes) hard-fail on
   * one unrelated routing bug. The redirect is scored where the design pins it,
   * in `m2-promote-agent` and `m3-setup`.
   */
  async agent(admin: Persona): Promise<Persona> {
    const g = await this.persona("agent1", "/tickets");
    await promoteToAgent(admin, g);
    return g;
  }

  /** The admin + promoted-agent pair most M2/M3 scenarios need. */
  async staff(): Promise<{ admin: Persona; agent: Persona }> {
    const admin = await this.admin();
    const agent = await this.agent(admin);
    return { admin, agent };
  }

  /** Full workflow world: staff, a requester, and one ticket assigned to the agent. */
  async assignedTicket(
    opts: { subject?: string; priority?: Priority } = {},
  ): Promise<AssignedTicket> {
    const { admin, agent } = await this.staff();
    const requester = await this.requester();
    const subject = opts.subject ?? uniq("Ticket");
    const ticketId = await createTicketFor(requester, {
      subject,
      priority: opts.priority ?? "high",
    });
    await assignTo(admin, ticketId, agent);
    return { admin, agent, requester, ticketId, subject };
  }

  async close(): Promise<void> {
    for (const ctx of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts.length = 0;
  }
}

// Wait for a pinned write to come back before navigating away: a click that is
// immediately followed by goto/reload can otherwise have its request cancelled.
// Never asserts — the caller's own expectation stays the verdict; this only
// removes the race from provisioning.
function settle(page: Page, method: string, urlPart: string) {
  return page
    .waitForResponse(
      (r) => r.request().method() === method && r.url().includes(urlPart),
      { timeout: 10_000 },
    )
    .catch(() => null);
}

/** Locate a user's row on /admin/users by the pinned `data-user-id`. */
export async function adminUserRow(
  admin: Persona,
  target: Persona,
): Promise<Locator> {
  await admin.page.goto("/admin/users");
  const byId = admin.page.getByTestId("user-row").filter({
    has: admin.page.locator(`[data-user-id="${await target.userId()}"]`),
  });
  return (await byId.count())
    ? byId.first()
    : admin.page
        .getByTestId("user-row")
        .filter({ hasText: target.who.email })
        .first();
}

/** Admin promotes `target` to agent and waits for the change to land server-side. */
export async function promoteToAgent(admin: Persona, target: Persona) {
  const row = await adminUserRow(admin, target);
  await row.getByTestId("user-role-select").selectOption("agent");
  await expect
    .poll(() => readRole(target.ctx), {
      timeout: 15_000,
      message: `role change to agent persisted for ${target.who.email}`,
    })
    .toBe("agent");
}

/**
 * Admin clicks the pinned per-row deactivate/reactivate toggle for `target`
 * and waits for the write to land. Returns the row for status assertions.
 */
export async function toggleActive(
  admin: Persona,
  target: Persona,
): Promise<Locator> {
  const row = await adminUserRow(admin, target);
  const patched = settle(admin.page, "PATCH", "/api/admin/users/");
  await row.getByTestId("user-deactivate").click();
  await patched;
  return row;
}

/** Create a ticket through the pinned UI and resolve its id from GET /api/tickets. */
export async function createTicketFor(
  owner: Persona,
  t: { subject: string; body?: string; priority?: Priority },
): Promise<string> {
  await createTicket(owner.page, t);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findTicketId(owner.ctx, t.subject);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for "${t.subject}" from the pinned GET /api/tickets`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** Matches a persona by either of the identifiers a UI may render. */
export function personaPattern(p: Persona): RegExp {
  return new RegExp(`${escapeRe(p.who.name)}|${escapeRe(p.who.email)}`);
}

/** Admin assigns `agent` to a ticket via the pinned assignee-select. */
export async function assignTo(
  admin: Persona,
  ticketId: string,
  agent: Persona,
) {
  await admin.page.goto(`/tickets/${ticketId}`);
  const patched = settle(admin.page, "PATCH", `/api/tickets/${ticketId}`);
  await selectOptionByText(admin.page, "assignee-select", agent.who.name);
  await patched;
  await admin.page.goto(`/tickets/${ticketId}`);
  await expect(admin.page.getByTestId("ticket-assignee")).toContainText(
    personaPattern(agent),
    { timeout: 15_000 },
  );
}

/** Click a pinned transition button on the detail page the actor is already on. */
export async function transition(actor: Persona, to: Status) {
  await actor.page.getByTestId(`transition-${to}`).click();
  await expect(actor.page.getByTestId("ticket-detail-status")).toContainText(
    to,
    { timeout: 15_000 },
  );
}

/**
 * Agent/admin adds an internal note. Confirms the note was recorded on either
 * pinned surface (note-item, or the agent-visible notes endpoint) so that a
 * caller asserting "the requester never sees this marker" is never vacuous.
 */
export async function addNote(
  author: Persona,
  ticketId: string,
  marker: string,
) {
  await author.page.goto(`/tickets/${ticketId}`);
  await author.page.getByTestId("note-input").fill(marker);
  await author.page.getByTestId("note-submit").click();
  await expect
    .poll(
      async () => {
        const shown = await author.page
          .getByTestId("note-item")
          .filter({ hasText: marker })
          .count();
        if (shown > 0) return true;
        const resp = await author.ctx.request.get(
          `/api/tickets/${ticketId}/notes`,
        );
        return resp.ok() && (await resp.text()).includes(marker);
      },
      { timeout: 15_000, message: `internal note "${marker}" was recorded` },
    )
    .toBe(true);
}

/** Participant posts a public reply and waits for it to be recorded. */
export async function addReply(
  author: Persona,
  ticketId: string,
  text: string,
) {
  await author.page.goto(`/tickets/${ticketId}`);
  await author.page.getByTestId("reply-input").fill(text);
  await author.page.getByTestId("reply-submit").click();
  await expect
    .poll(
      async () => {
        const shown = await author.page
          .getByTestId("reply-item")
          .filter({ hasText: text })
          .count();
        if (shown > 0) return true;
        const resp = await author.ctx.request.get(
          `/api/tickets/${ticketId}/replies`,
        );
        return resp.ok() && (await resp.text()).includes(text);
      },
      { timeout: 15_000, message: `reply "${text}" was recorded` },
    )
    .toBe(true);
}

/** Admin edits the pinned SLA due time on the ticket detail. */
export async function setSlaDue(admin: Persona, ticketId: string, when: Date) {
  await admin.page.goto(`/tickets/${ticketId}`);
  await fillSlaDueInput(admin.page, when);
  const patched = settle(admin.page, "PATCH", `/api/tickets/${ticketId}`);
  await admin.page.getByTestId("sla-due-save").click();
  await patched;
  await admin.page.reload();
}

/** Admin creates a canned response at /admin/canned (reloads to confirm persistence). */
export async function createCanned(
  admin: Persona,
  c: { title: string; body: string },
) {
  await admin.page.goto("/admin/canned");
  await admin.page.getByTestId("canned-title").fill(c.title);
  await admin.page.getByTestId("canned-body").fill(c.body);
  const posted = settle(admin.page, "POST", "canned-responses");
  await admin.page.getByTestId("canned-submit").click();
  await posted;
  await admin.page.reload();
}

/**
 * `desk` provisions every persona/record a test needs and disposes of the
 * contexts afterwards — the reason no test has to inherit another's state.
 */
export const test = base.extend<{ desk: Desk }>({
  desk: async ({ browser }, use) => {
    const desk = new Desk(browser);
    await use(desk);
    await desk.close();
  },
});
