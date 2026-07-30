// Shared Deskhero suite helpers (design/app-2-deskhero.md, "Suite mechanics").
// Personas: admin/agent1/req1/req2 with timestamp-suffixed emails; the admin
// bootstrap rule keys off the `admin+` email local-part prefix (M2 prompt).
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const RUN_ID = `${Date.now()}`;
export const PASSWORD = "Passw0rd!Desk1";

// Design-pinned email shapes: admin+<ts>@deskhero.test etc. The `admin+`
// prefix triggers the M2 bootstrap rule; requester/agent prefixes are inert.
export const identity = (role: "admin" | "agent1" | "req1" | "req2") => ({
  name: `Desk ${role[0].toUpperCase()}${role.slice(1)}`,
  email: `${role}+${RUN_ID}@deskhero.test`,
  password: PASSWORD,
});

export async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
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
  t: { subject: string; body?: string; priority?: "low" | "medium" | "high" },
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
