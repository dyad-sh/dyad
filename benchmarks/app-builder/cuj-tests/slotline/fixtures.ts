// Shared Slotline suite helpers (design/app-5-slotline.md, "Test fixtures &
// conventions"). Imported by all three checkpoint suites.
//
// Independence contract: the checkpoint suites are NOT serial. Every test mints
// its own TOKEN and provisions its own personas, practitioner, services,
// availability windows and bookings through the `clinic` fixture exported here,
// so a failure can never skip — and thereby silently void — a sibling test.
// `Clinic` owns every browser context (and every cookie-less request context) it
// opens and disposes of them in fixture teardown, so videos flush and Postgres
// connections do not leak even when a test fails mid-flight.
//
// Time contract: the clinic runs in `CLINIC_TZ` and the browser is deliberately
// pinned to `BROWSER_TZ`, which disagrees with clinic time in both the hour and
// the calendar date (and with UTC). Contexts are created by hand here rather
// than by Playwright's `page` fixture, and `browser.newContext()` does NOT
// inherit `test.use({ timezoneId })` — so the timezone is passed explicitly on
// every context below. The suites also declare `test.use({ timezoneId })` at the
// top of each spec, as the design pins, which covers anything created through
// the built-in fixtures.
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { videoOpts } from "../video-context";

export { expect };

export const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
export const PASSWORD = "Passw0rd!Slot1";

/** The clinic's fixed IANA zone. No test ever hardcodes a UTC offset. */
export const CLINIC_TZ = "America/Denver";
/**
 * The browser's pinned zone. Chosen because it disagrees with clinic time in
 * both the hour and the calendar date, and also with UTC, so a browser-timezone
 * renderer and a server-timezone renderer produce two distinct wrong answers.
 */
export const BROWSER_TZ = "Australia/Sydney";

/** M2 clinic access code (`POST /api/staff/claim`, `/staff/join`). */
export const STAFF_CODE = "slotline-staff-2026";

/** The M3 cancellation window, in hours. */
export const CANCEL_WINDOW_HOURS = 48;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

export type Role = "staff" | "patientA" | "patientB";
export type BookingStatus = "booked" | "cancelled" | "completed" | "no_show";

export interface Identity {
  name: string;
  email: string;
  password: string;
}

const rand = (n: number) =>
  Math.random().toString(36).slice(2).padEnd(n, "0").slice(0, n);

// Unique token for one test's data (identities, practitioner/service names,
// markers). Tests share one database and practitioners/services are clinic-wide,
// so every string a test asserts on must be unique to the *test*, not merely to
// the run — otherwise a sibling's row could satisfy or break it, and a
// name-keyed id lookup could become ambiguous.
export function uniq(label?: string): string {
  const token = `${RUN_ID}-${rand(8)}`;
  return label ? `${label} ${token}` : token;
}

/** Escape a persona-supplied string for use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Design-pinned identity shapes. Display names are suffixed as well as emails,
// because staff day views and probe bodies are searched for a patient's *name*
// as well as their email; an unsuffixed "Slot PatientA" would appear in every
// sibling test's data.
export function identity(role: Role, token: string): Identity {
  return {
    name: `Slot ${role[0].toUpperCase()}${role.slice(1)} ${token}`,
    email: `slot-${token}-${role.toLowerCase()}@example.com`,
    password: PASSWORD,
  };
}

// ---------------------------------------------------------------------------
// Time helpers. Three of them do all the time work in every Slotline suite:
// clinicDate (calendar arithmetic in clinic time), clinicInstant (clinic wall
// clock -> UTC instant) and weekdayOf (clinic-timezone weekday of a date).
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

const CLINIC_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The clinic-local wall clock of a UTC instant (ms since epoch). */
function clinicWall(ms: number): WallClock {
  const parts = CLINIC_FMT.formatToParts(new Date(ms));
  const field = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const hour = field("hour");
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    // Some ICU versions render midnight as "24" under hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: field("minute"),
    second: field("second"),
  };
}

/**
 * The `YYYY-MM-DD` clinic-local calendar date `offsetDays` days from now.
 *
 * Calendar arithmetic on the clinic-local Y-M-D fields, never millisecond
 * arithmetic on the instant: `now + offsetDays * 86_400_000` lands on the wrong
 * calendar day — and therefore the wrong weekday — whenever the run starts
 * within an hour of clinic midnight on either side of a DST transition, and
 * several probes depend on `clinicDate(±7k)` being exactly today's weekday.
 */
export function clinicDate(offsetDays = 0, from: number = Date.now()): string {
  const today = clinicWall(from);
  const shifted = new Date(
    Date.UTC(today.year, today.month - 1, today.day + offsetDays),
  );
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

/**
 * The UTC ISO instant for a clinic-local wall clock, resolved by formatting a
 * candidate instant back through CLINIC_TZ and correcting the delta (the
 * standard two-pass technique, correct across DST).
 */
export function clinicInstant(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const w = clinicWall(guess);
    const asUtc = Date.UTC(
      w.year,
      w.month - 1,
      w.day,
      w.hour,
      w.minute,
      w.second,
    );
    guess += target - asUtc;
  }
  return new Date(guess).toISOString();
}

/**
 * The clinic-timezone weekday of a calendar date as `0`–`6` with `0 = Sunday`,
 * matching the pinned `availability-weekday` option values and the `weekday`
 * field of `/api/practitioners/[id]/availability`. Computed from the date's own
 * Y-M-D fields, never from a local `Date` parse, so it never shifts by a day.
 */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The clinic-local `HH:MM` wall clock of an instant. */
export function clinicClock(instant: string | number): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  const w = clinicWall(ms);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** The clinic-local `YYYY-MM-DD` calendar date of an instant. */
export function clinicDateOf(instant: string | number): string {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  const w = clinicWall(ms);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** `iso` shifted by whole minutes, as a UTC ISO instant. */
export function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();
}

/**
 * Normalise the first clock token in rendered text to a 24-hour `HH:MM`, so
 * `9:00 AM`, `09:00` and `9:00 a.m.` all compare equal while a UTC or
 * browser-timezone rendering does not. Rendered text is only ever a secondary
 * check; the load-bearing assertions read pinned ISO instants.
 */
export function clockToken(text: string | null | undefined): string | null {
  const t = text ?? "";
  const ampm = t.match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s?m\.?/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === "p") h += 12;
    return `${pad(h)}:${ampm[2]}`;
  }
  const plain = t.match(/(\d{1,2}):(\d{2})/);
  return plain ? `${pad(Number(plain[1]))}:${plain[2]}` : null;
}

/** Assert a value is a parseable instant and return its epoch ms. */
export function instantMs(
  value: string | null | undefined,
  label: string,
): number {
  expect(value, `${label} is present`).toBeTruthy();
  const ms = Date.parse(String(value));
  expect(
    Number.isNaN(ms),
    `${label} parses as an ISO instant (got ${String(value)})`,
  ).toBe(false);
  return ms;
}

/**
 * Instant equality by parsed value, never string equality: the prompts pin the
 * `Z` suffix, but `…T16:00:00Z` and `…T16:00:00.000Z` must both pass.
 */
export function expectInstant(
  value: string | null | undefined,
  expected: string,
  label: string,
) {
  expect(instantMs(value, label), `${label} === ${expected}`).toBe(
    Date.parse(expected),
  );
}

/** The prompts pin every emitted timestamp as a UTC instant ending in `Z`. */
export function expectZulu(value: string | null | undefined, label: string) {
  expect(String(value), `${label} is a UTC instant ending in Z`).toMatch(/Z$/);
}

// ---------------------------------------------------------------------------
// Anchor dates. Every temporal rule is testable without any wall-clock waiting.
// ---------------------------------------------------------------------------

/** Same weekday as today, ≥320 h away, so always outside the 48-hour window. */
export const FAR_DATE = clinicDate(14);
/** Same weekday as FAR_DATE, exactly 7 days later. */
export const FAR_DATE_2 = clinicDate(21);
/** Tomorrow: always in the future and always strictly inside the 48-hour window. */
export const NEAR_DATE = clinicDate(1);
/** Same weekday as FAR_DATE, but already happened — the past-date rule's date. */
export const PAST_DATE = clinicDate(-7);
/** Future, but a different weekday from FAR_DATE: no window applies there. */
export const NO_WINDOW_DATE = clinicDate(15);
/** The clinic day after FAR_DATE, computed by `clinicDate`, never by +1 day. */
export const NEXT_DATE = clinicDate(15);

// ---------------------------------------------------------------------------
// Page/DOM helpers
// ---------------------------------------------------------------------------

// Playwright auto-dismisses native dialogs, which would fail any app that
// implements delete/cancel confirmation with window.confirm() — a choice the
// specs permit (they pin an in-page confirm control, they do not forbid the
// dialog). Accept them so the assertion tests the outcome, not the strategy.
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => {
    d.accept().catch(() => {});
  });
}

/**
 * Wait for a create/update form to actually finish submitting before navigating
 * away. Clicking submit fires a client-side request and then routes; a
 * `page.goto` issued immediately aborts that request in flight, so the record is
 * never written. Pass `null` for forms that stay on their own URL (availability,
 * cancel, delete confirmations) — there is no navigation to wait for there.
 */
export async function settleAfterSubmit(
  page: Page,
  formPath: string | null = "/new",
) {
  if (formPath !== null) {
    await page
      .waitForURL((u) => !u.pathname.endsWith(formPath), { timeout: 15_000 })
      .catch(() => {});
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Read a pinned `data-*` attribute, failing loudly when it is missing. */
export async function attrOf(
  locator: Locator,
  name: string,
  label: string,
): Promise<string> {
  const value = await locator.getAttribute(name);
  expect(value, `${label} carries ${name}`).toBeTruthy();
  return String(value);
}

/**
 * Select the option whose visible text contains `needle` on a pinned native
 * `<select>`. Option VALUES are app-designed (ids), so match by text first and
 * fall back to value === needle. Options are often populated by an async fetch
 * AFTER the select renders, so poll rather than racing a single evaluate.
 */
export async function selectOptionByText(
  page: Page,
  testId: string,
  needle: string,
) {
  const select = page.getByTestId(testId).first();
  await expect(select).toBeVisible({ timeout: 15_000 });
  const findValue = async () =>
    select.evaluate((el: HTMLSelectElement, text) => {
      const opt = Array.from(el.options).find(
        (o) => o.textContent?.includes(text) || o.value === text,
      );
      return opt ? opt.value : null;
    }, needle);
  await expect
    .poll(findValue, {
      timeout: 15_000,
      message: `option containing "${needle}" in ${testId}`,
    })
    .not.toBeNull();
  await select.selectOption((await findValue()) as string);
}

/** The `booking-row` carrying a given pinned `data-booking-id`. */
export function bookingRow(page: Page, bookingId: string): Locator {
  return page.locator(
    `[data-testid="booking-row"][data-booking-id="${bookingId}"]`,
  );
}

/** The M3 `schedule-row` carrying a given pinned `data-booking-id`. */
export function scheduleRow(page: Page, bookingId: string): Locator {
  return page.locator(
    `[data-testid="schedule-row"][data-booking-id="${bookingId}"]`,
  );
}

/** The practitioner row carrying a given pinned `data-practitioner-id`. */
export function practitionerRow(page: Page, practitionerId: string): Locator {
  return page.locator(
    `[data-testid="practitioner-row"][data-practitioner-id="${practitionerId}"]`,
  );
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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

/**
 * Sign out through the pinned header control. `signOut()` is a background fetch;
 * navigating before it settles cancels it and the cached session cookie keeps
 * the server answering signed-in.
 */
export async function signOut(page: Page) {
  await page.getByTestId("sign-out-button").click();
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** The header pins `user-menu` as containing the signed-in email text. */
export async function expectSignedIn(page: Page, email: string) {
  await expect(page.getByTestId("user-menu")).toContainText(email, {
    timeout: 15_000,
  });
}

/** Pinned `GET /api/me` — id/role provenance for a persona's own identity. */
export async function getMe(context: BrowserContext): Promise<{
  id: string;
  email: string;
  name?: string;
  role?: string;
}> {
  const resp = await context.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return resp.json();
}

// Non-asserting role read, for waiting on a role change to land server-side
// without failing on a transient non-200.
export async function readRole(
  context: BrowserContext,
): Promise<string | null> {
  const resp = await context.request.get("/api/me");
  if (!resp.ok()) return null;
  const body = (await resp.json()) as { role?: string };
  return body.role ?? null;
}

// ---------------------------------------------------------------------------
// JSON API helpers
// ---------------------------------------------------------------------------

export type Json = Record<string, any>;

export interface BookingJson extends Json {
  id: string;
  practitionerId: string;
  serviceId: string;
  patientId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface SlotJson {
  start: string;
  end: string;
}

/** Assert a 2xx, with the response body in the message when it is not. */
export async function expectOk(resp: APIResponse, label: string) {
  const status = resp.status();
  if (status < 200 || status >= 300) {
    expect(
      status,
      `${label} expected 2xx, got ${status}: ${(await resp.text()).slice(0, 300)}`,
    ).toBeLessThan(300);
  }
  expect(status, `${label} expected 2xx`).toBeGreaterThanOrEqual(200);
}

export function expectStatusIn(
  resp: APIResponse,
  codes: number[],
  label: string,
) {
  expect(codes, `${label} (got ${resp.status()})`).toContain(resp.status());
}

/** The M2/M3 rejection contract: HTTP 4xx with a JSON body `{ error }`. */
export async function expectJsonError(resp: APIResponse, label: string) {
  let body: Json | null = null;
  try {
    body = (await resp.json()) as Json;
  } catch {
    body = null;
  }
  expect(
    typeof body?.error === "string" && body.error.length > 0,
    `${label} answers a JSON { "error": "…" } body`,
  ).toBe(true);
}

export async function listJson(
  context: BrowserContext,
  path: string,
): Promise<Json[]> {
  const resp = await context.request.get(path);
  expect(resp.status(), `GET ${path}`).toBe(200);
  const body = await resp.json();
  expect(Array.isArray(body), `GET ${path} returns a JSON array`).toBe(true);
  return body as Json[];
}

/** Non-asserting: find a clinic-wide record's id by its exact pinned name. */
export async function findIdByName(
  context: BrowserContext,
  listPath: string,
  name: string,
): Promise<string | null> {
  const resp = await context.request.get(listPath);
  if (!resp.ok()) return null;
  let items: unknown;
  try {
    items = await resp.json();
  } catch {
    return null;
  }
  if (!Array.isArray(items)) return null;
  const hit = (items as Json[]).find((it) => it?.name === name);
  return hit && hit.id != null ? String(hit.id) : null;
}

async function requireIdByName(
  context: BrowserContext,
  listPath: string,
  name: string,
): Promise<string> {
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await findIdByName(context, listPath, name);
        return id;
      },
      {
        timeout: 20_000,
        message: `id for "${name}" from the pinned GET ${listPath}`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** Non-asserting: the caller's own booking starting at a given instant. */
export async function findBookingAt(
  context: BrowserContext,
  startIso: string,
): Promise<BookingJson | null> {
  const resp = await context.request.get("/api/bookings");
  if (!resp.ok()) return null;
  let items: unknown;
  try {
    items = await resp.json();
  } catch {
    return null;
  }
  if (!Array.isArray(items)) return null;
  const want = Date.parse(startIso);
  const hit = (items as BookingJson[]).find(
    (b) => Date.parse(String(b?.startAt)) === want,
  );
  return hit ?? null;
}

export async function requireBookingIdAt(
  context: BrowserContext,
  startIso: string,
): Promise<string> {
  let found: BookingJson | null = null;
  await expect
    .poll(
      async () => {
        found = await findBookingAt(context, startIso);
        return found ? String(found.id) : null;
      },
      {
        timeout: 20_000,
        message: `a booking at ${startIso} in the pinned GET /api/bookings`,
      },
    )
    .toBeTruthy();
  return String((found as unknown as BookingJson).id);
}

/** Pinned `GET /api/bookings/[id]` for a persona entitled to read it. */
export async function getBooking(
  context: BrowserContext,
  bookingId: string,
): Promise<BookingJson> {
  const resp = await context.request.get(`/api/bookings/${bookingId}`);
  expect(resp.status(), `GET /api/bookings/${bookingId}`).toBe(200);
  return (await resp.json()) as BookingJson;
}

/** Raw create, used by the probes that craft the call instead of clicking. */
export function postBooking(context: BrowserContext, data: Json) {
  return context.request.post("/api/bookings", { data, maxRedirects: 0 });
}

/** M3 raw reschedule. */
export function postReschedule(
  context: BrowserContext,
  bookingId: string,
  data: Json,
) {
  return context.request.post(`/api/bookings/${bookingId}/reschedule`, {
    data,
    maxRedirects: 0,
  });
}

/** M2 pinned slot endpoint. Asserts 200 and returns the offered slots. */
export async function getSlots(
  context: BrowserContext,
  q: { practitionerId: string; serviceId: string; date: string },
): Promise<SlotJson[]> {
  const resp = await context.request.get(slotsPath(q));
  expect(resp.status(), `GET ${slotsPath(q)}`).toBe(200);
  const body = await resp.json();
  expect(Array.isArray(body), "GET /api/slots returns a JSON array").toBe(true);
  return body as SlotJson[];
}

export function slotsPath(q: {
  practitionerId: string;
  serviceId: string;
  date: string;
}): string {
  return `/api/slots?practitionerId=${encodeURIComponent(
    q.practitionerId,
  )}&serviceId=${encodeURIComponent(q.serviceId)}&date=${encodeURIComponent(
    q.date,
  )}`;
}

/** The offered starts as clinic-local `HH:MM`, in the order the API returned. */
export async function offeredClocks(
  context: BrowserContext,
  q: { practitionerId: string; serviceId: string; date: string },
): Promise<string[]> {
  const slots = await getSlots(context, q);
  return slots.map((s) => clinicClock(s.start));
}

/** M2 staff-only day list: `GET /api/practitioners/[id]/bookings?date=`. */
export async function practitionerDay(
  context: BrowserContext,
  practitionerId: string,
  date: string,
): Promise<Json[]> {
  return listJson(
    context,
    `/api/practitioners/${practitionerId}/bookings?date=${date}`,
  );
}

/** M2 availability list for a practitioner. */
export async function listAvailability(
  context: BrowserContext,
  practitionerId: string,
): Promise<Json[]> {
  return listJson(context, `/api/practitioners/${practitionerId}/availability`);
}

// ---------------------------------------------------------------------------
// Per-test provisioning. Everything drives the pinned UI surfaces, exactly as
// the CUJ that owns each scenario does, so provisioning never depends on an
// unpinned route and a provisioning failure points at a real broken flow.
// ---------------------------------------------------------------------------

export interface Persona {
  readonly role: Role;
  readonly who: Identity;
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** This persona's own id, from the pinned GET /api/me (memoized). */
  userId(): Promise<string>;
}

/** Create a clinic-wide practitioner and return its id from the pinned list. */
export async function createPractitioner(
  actor: Persona,
  p: { name: string; specialty: string },
): Promise<string> {
  await actor.page.goto("/practitioners");
  await actor.page.getByTestId("practitioner-new-button").click();
  await actor.page.getByTestId("practitioner-form-name").fill(p.name);
  await actor.page.getByTestId("practitioner-form-specialty").fill(p.specialty);
  await actor.page.getByTestId("practitioner-form-submit").click();
  await settleAfterSubmit(actor.page);
  return requireIdByName(actor.ctx, "/api/practitioners", p.name);
}

/** Create a clinic-wide service and return its id from the pinned list. */
export async function createService(
  actor: Persona,
  s: { name: string; durationMinutes: number },
): Promise<string> {
  await actor.page.goto("/services");
  await actor.page.getByTestId("service-new-button").click();
  await actor.page.getByTestId("service-form-name").fill(s.name);
  await actor.page
    .getByTestId("service-form-duration")
    .fill(String(s.durationMinutes));
  await actor.page.getByTestId("service-form-submit").click();
  await settleAfterSubmit(actor.page);
  return requireIdByName(actor.ctx, "/api/services", s.name);
}

/**
 * M1 booking flow: the free-text `booking-form-start` clinic-local wall clock.
 * M2 deletes this input, so checkpoints 2 and 3 use `bookSlot` instead.
 */
export async function createBookingAtStart(
  patient: Persona,
  b: {
    practitionerName: string;
    serviceName: string;
    date: string;
    time: string;
  },
): Promise<string> {
  await patient.page.goto("/bookings");
  await patient.page.getByTestId("booking-new-button").click();
  await selectOptionByText(
    patient.page,
    "booking-form-practitioner",
    b.practitionerName,
  );
  await selectOptionByText(patient.page, "booking-form-service", b.serviceName);
  await patient.page
    .getByTestId("booking-form-start")
    .fill(`${b.date}T${b.time}`);
  await patient.page.getByTestId("booking-form-submit").click();
  await settleAfterSubmit(patient.page);
  return requireBookingIdAt(patient.ctx, clinicInstant(b.date, b.time));
}

/**
 * `/bookings/new` and `/bookings/[id]/reschedule` render content that depends on
 * in-page selections, so wait on `slot-option` OR `slot-empty` rather than on
 * networkidle.
 */
export async function waitForSlots(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.getByTestId("slot-option").count()) > 0 ||
        (await page.getByTestId("slot-empty").count()) > 0,
      {
        timeout: 15_000,
        message: "the slot picker rendered slot-option(s) or slot-empty",
      },
    )
    .toBe(true);
}

/** The `data-slot-start` of every rendered `slot-option`, in DOM order. */
export async function renderedSlotStarts(page: Page): Promise<string[]> {
  const options = page.getByTestId("slot-option");
  const count = await options.count();
  const starts: string[] = [];
  for (let i = 0; i < count; i++) {
    starts.push(
      await attrOf(options.nth(i), "data-slot-start", `slot-option[${i}]`),
    );
  }
  return starts;
}

/** Rendered offered starts as clinic-local `HH:MM`, in DOM order. */
export async function renderedSlotClocks(page: Page): Promise<string[]> {
  return (await renderedSlotStarts(page)).map((s) => clinicClock(s));
}

/** Click the `slot-option` whose `data-slot-start` parses equal to `iso`. */
export async function clickSlot(page: Page, iso: string) {
  const want = Date.parse(iso);
  const options = page.getByTestId("slot-option");
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const value = await options.nth(i).getAttribute("data-slot-start");
    if (value && Date.parse(value) === want) {
      await options.nth(i).click();
      return;
    }
  }
  expect(
    false,
    `a slot-option offering ${iso} (${clinicClock(iso)} clinic time); offered: ${(
      await renderedSlotClocks(page)
    ).join(", ")}`,
  ).toBe(true);
}

/** Open `/bookings/new`, choose practitioner + service + date, await the slots. */
export async function openSlotPicker(
  patient: Persona,
  q: { practitionerName: string; serviceName: string; date: string },
) {
  await patient.page.goto("/bookings/new");
  await selectOptionByText(
    patient.page,
    "booking-form-practitioner",
    q.practitionerName,
  );
  await selectOptionByText(patient.page, "booking-form-service", q.serviceName);
  await patient.page.getByTestId("booking-form-date").fill(q.date);
  await waitForSlots(patient.page);
}

/**
 * M2+ booking flow: pick the offered slot at a clinic-local time and submit.
 * Returns the new booking's id from the pinned `GET /api/bookings`.
 */
export async function bookSlot(
  patient: Persona,
  q: {
    practitionerName: string;
    serviceName: string;
    date: string;
    time: string;
  },
): Promise<string> {
  const iso = clinicInstant(q.date, q.time);
  await openSlotPicker(patient, q);
  await clickSlot(patient.page, iso);
  // `booking-selected-slot` is asserted by the CUJ that owns it; provisioning
  // only waits for it so the submit is not raced.
  await patient.page
    .getByTestId("booking-selected-slot")
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await patient.page.getByTestId("booking-form-submit").click();
  await settleAfterSubmit(patient.page);
  return requireBookingIdAt(patient.ctx, iso);
}

/** M3 reschedule through the pinned `/bookings/[id]/reschedule` UI. */
export async function rescheduleViaUi(
  patient: Persona,
  bookingId: string,
  q: { date: string; time: string },
) {
  await patient.page.goto(`/bookings/${bookingId}`);
  await patient.page.getByTestId("booking-reschedule-button").click();
  await patient.page.getByTestId("reschedule-date").fill(q.date);
  await waitForSlots(patient.page);
  await clickSlot(patient.page, clinicInstant(q.date, q.time));
  await patient.page
    .getByTestId("reschedule-selected-slot")
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await patient.page.getByTestId("reschedule-submit").click();
  await settleAfterSubmit(patient.page, "/reschedule");
}

/** Cancel through the pinned booking-detail controls. */
export async function cancelBookingViaUi(actor: Persona, bookingId: string) {
  await actor.page.goto(`/bookings/${bookingId}`);
  await actor.page.getByTestId("booking-cancel-button").click();
  const confirm = actor.page.getByTestId("booking-cancel-confirm");
  if (await confirm.count()) await confirm.first().click();
  await settleAfterSubmit(actor.page, null);
}

/** M2: submit the clinic access code on `/staff/join`. */
export async function claimStaff(persona: Persona, code = STAFF_CODE) {
  await persona.page.goto("/staff/join");
  await persona.page.getByTestId("staff-code-input").fill(code);
  await persona.page.getByTestId("staff-code-submit").click();
  await settleAfterSubmit(persona.page, null);
  if (code === STAFF_CODE) {
    await expect
      .poll(() => readRole(persona.ctx), {
        timeout: 15_000,
        message: `${persona.who.email} became staff server-side`,
      })
      .toBe("staff");
  }
}

/** M2: add one weekly availability window through the pinned staff form. */
export async function addAvailability(
  staff: Persona,
  practitionerId: string,
  w: { weekday: number; startTime: string; endTime: string },
): Promise<string> {
  await staff.page.goto(`/practitioners/${practitionerId}/availability`);
  await staff.page
    .getByTestId("availability-weekday")
    .selectOption(String(w.weekday));
  await staff.page.getByTestId("availability-start-time").fill(w.startTime);
  await staff.page.getByTestId("availability-end-time").fill(w.endTime);
  await staff.page.getByTestId("availability-submit").click();
  await settleAfterSubmit(staff.page, null);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        const resp = await staff.ctx.request.get(
          `/api/practitioners/${practitionerId}/availability`,
        );
        if (!resp.ok()) return null;
        let rows: unknown;
        try {
          rows = await resp.json();
        } catch {
          return null;
        }
        if (!Array.isArray(rows)) return null;
        const hit = (rows as Json[]).find(
          (r) =>
            Number(r?.weekday) === w.weekday &&
            String(r?.startTime).slice(0, 5) === w.startTime &&
            String(r?.endTime).slice(0, 5) === w.endTime,
        );
        id = hit && hit.id != null ? String(hit.id) : null;
        return id;
      },
      {
        timeout: 20_000,
        message: `the ${w.startTime}–${w.endTime} window on weekday ${w.weekday} was saved`,
      },
    )
    .toBeTruthy();
  return id as unknown as string;
}

/** M3 staff day view: choose a practitioner + date and await the day's rows. */
export async function openStaffSchedule(
  staff: Persona,
  q: { practitionerName: string; date: string },
) {
  await staff.page.goto("/staff/schedule");
  await selectOptionByText(
    staff.page,
    "schedule-practitioner-select",
    q.practitionerName,
  );
  await staff.page.getByTestId("schedule-date-input").fill(q.date);
  await expect
    .poll(
      async () =>
        (await staff.page.getByTestId("schedule-row").count()) > 0 ||
        (await staff.page.getByTestId("schedule-empty").count()) > 0,
      {
        timeout: 15_000,
        message:
          "the staff day view rendered schedule-row(s) or schedule-empty",
      },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// The `clinic` fixture: one per test, owning its token, personas and contexts.
// ---------------------------------------------------------------------------

/**
 * A staff-provisioned bookable world: one practitioner, its availability
 * window(s) and one or more services. Used from checkpoint 2 onwards, where
 * only staff may create practitioners, services and availability.
 */
export interface BookableWorld {
  staff: Persona;
  practitionerId: string;
  practitionerName: string;
  /** Service base label (`Checkup`, `Review`, …) → id and full pinned name. */
  services: Record<
    string,
    { id: string; name: string; durationMinutes: number }
  >;
  availabilityIds: string[];
  /** The first service, for the common single-service case. */
  serviceId: string;
  serviceName: string;
}

export class Clinic {
  private readonly contexts: BrowserContext[] = [];
  private readonly apiContexts: APIRequestContext[] = [];

  constructor(
    private readonly browser: Browser,
    /** This test's own token; every record name and identity carries it. */
    readonly token: string,
  ) {}

  /** `Dr Vale` → `Dr Vale <token>`: a name no sibling test can collide with. */
  name(base: string): string {
    return `${base} ${this.token}`;
  }

  /** A tracked, timezone-pinned, video-recorded (when enabled) context. */
  async context(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext({
      timezoneId: BROWSER_TZ,
      ...videoOpts(),
    });
    this.contexts.push(ctx);
    return ctx;
  }

  /** A cookie-less browser page, for the signed-out redirect assertions. */
  async anonPage(): Promise<Page> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    return page;
  }

  /** A cookie-less request context, for the unauthenticated raw-HTTP probes. */
  async anonRequest(): Promise<APIRequestContext> {
    const ctx = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    this.apiContexts.push(ctx);
    return ctx;
  }

  /** Sign up a brand-new persona in its own context. */
  async persona(role: Role, landing = "/bookings"): Promise<Persona> {
    const who = identity(role, this.token);
    const ctx = await this.context();
    const page = await ctx.newPage();
    acceptDialogs(page);
    await signUp(page, who);
    await page.waitForURL(`**${landing}`, { timeout: 20_000 }).catch(() => {});
    // Prove the session FUNCTIONALLY rather than through the header or the
    // landing URL: the CUJ that owns those contracts asserts them, and a
    // cosmetic defect there must not void every other scenario.
    await expect
      .poll(async () => (await ctx.request.get("/api/me")).status(), {
        timeout: 15_000,
        message: `${who.email} has a live session`,
      })
      .toBe(200);
    let id: string | null = null;
    return {
      role,
      who,
      ctx,
      page,
      async userId() {
        if (id === null) id = String((await getMe(ctx)).id);
        return id;
      },
    };
  }

  /** A patient persona (the role every new sign-up starts with). */
  patient(role: "patientA" | "patientB" = "patientA"): Promise<Persona> {
    return this.persona(role);
  }

  /** M2+: a persona that signs up and then claims staff with the pinned code. */
  async staff(): Promise<Persona> {
    const s = await this.persona("staff");
    await claimStaff(s);
    return s;
  }

  /**
   * M2+: a staff persona plus this test's own practitioner, availability
   * window(s) and service(s). Defaults to the world most rows describe: one
   * `09:00`–`12:00` window on `weekdayOf(FAR_DATE)` and a 30-minute `Checkup`.
   */
  async bookableWorld(
    opts: {
      staff?: Persona;
      practitioner?: string;
      services?: Array<{ base: string; durationMinutes: number }>;
      windows?: Array<{ weekday: number; startTime: string; endTime: string }>;
    } = {},
  ): Promise<BookableWorld> {
    const staff = opts.staff ?? (await this.staff());
    const practitionerName = this.name(opts.practitioner ?? "Dr Vale");
    const practitionerId = await createPractitioner(staff, {
      name: practitionerName,
      specialty: this.name("Derm"),
    });
    const services: BookableWorld["services"] = {};
    for (const s of opts.services ?? [
      { base: "Checkup", durationMinutes: 30 },
    ]) {
      const name = this.name(s.base);
      services[s.base] = {
        id: await createService(staff, {
          name,
          durationMinutes: s.durationMinutes,
        }),
        name,
        durationMinutes: s.durationMinutes,
      };
    }
    const availabilityIds: string[] = [];
    for (const w of opts.windows ?? [
      { weekday: weekdayOf(FAR_DATE), startTime: "09:00", endTime: "12:00" },
    ]) {
      availabilityIds.push(await addAvailability(staff, practitionerId, w));
    }
    const first = Object.values(services)[0];
    return {
      staff,
      practitionerId,
      practitionerName,
      services,
      availabilityIds,
      serviceId: first?.id ?? "",
      serviceName: first?.name ?? "",
    };
  }

  async close(): Promise<void> {
    for (const ctx of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts.length = 0;
    for (const api of this.apiContexts) {
      await api.dispose().catch(() => {});
    }
    this.apiContexts.length = 0;
  }
}

/**
 * `clinic` mints this test's token, provisions every persona/record it needs and
 * disposes of the contexts afterwards — the reason no test has to inherit
 * another's state.
 */
export const test = base.extend<{ clinic: Clinic }>({
  clinic: async ({ browser }, use) => {
    const clinic = new Clinic(browser, uniq());
    await use(clinic);
    await clinic.close();
  },
});

/**
 * Every string/number scalar anywhere in a parsed JSON tree.
 *
 * Isolation probes must assert an id is absent from a DENIED response, and a
 * denied response is under no obligation to use the array-of-rows shape the
 * prompt pins for a 200 — `{"bookings":[…]}` and `{"data":{…}}` are equally
 * legitimate. Mapping only top-level `id`s would yield `["undefined"]` and pass
 * while the record is fully exposed. Comparing against this flattened list
 * keeps exact element equality (never a substring of a blob) while reaching
 * every shape. Mirrors ledgerly's `scalarValues` and curbside's `jsonScalars`.
 */
export function scalarValues(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) scalarValues(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      scalarValues(v, out);
    }
    return out;
  }
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
  }
  return out;
}
