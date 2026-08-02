// Slotline — checkpoint 2 CUJ suite (design/app-5-slotline.md, M2 CUJ table +
// M2 security probes). 12 CUJs (4 regression, 8 new) + 8 probes.
//
// Conventions (design "Test fixtures & conventions"): there is no `.serial`.
// Every test mints its own TOKEN through the `clinic` fixture and provisions its
// own personas, practitioner, availability window(s), service(s) and any
// prerequisite booking — "that practitioner", "the same date" and every exact
// slot count (6, 5, 2) describe the world *this* test built, never a sibling's.
// Ids come only from pinned surfaces (GET /api/me, the pinned list endpoints and
// the pinned `data-*` attributes); cross-persona ids are read by the victim and
// handed to the attacker, modelling a leaked identifier. Temporal assertions
// read pinned ISO instants and compare them with Date.parse — never rendered
// text, never a formatted string.
//
// Three regressions are marked R* in the design because M2 deliberately removes
// what their checkpoint-1 steps used: `slot-m1-04` must claim staff first (M2
// revokes practitioner management from patients), `slot-m1-09` must reach its
// booking through `slot-option` (M2 deletes the free-text `booking-form-start`)
// and `slot-m1-10` needs both adaptations at once.
import type { APIResponse, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  FAR_DATE,
  NO_WINDOW_DATE,
  PAST_DATE,
  MINUTE_MS,
  attrOf,
  bookSlot,
  bookingRow,
  cancelBookingViaUi,
  claimStaff,
  clickSlot,
  clinicClock,
  clinicInstant,
  createPractitioner,
  expectInstant,
  expectJsonError,
  expectOk,
  expectSignedIn,
  expectStatusIn,
  expectZulu,
  findBookingAt,
  findIdByName,
  getBooking,
  getMe,
  getSlots,
  instantMs,
  listAvailability,
  listJson,
  openSlotPicker,
  plusMinutes,
  postBooking,
  practitionerDay,
  renderedSlotStarts,
  requireBookingIdAt,
  settleAfterSubmit,
  weekdayOf,
  type BookingJson,
  type Json,
} from "./fixtures";

// The browser is pinned to a zone that disagrees with clinic time in both the
// hour and the calendar date, and with UTC — without it the whole timezone
// dimension silently evaporates. The fixture also passes `timezoneId` into every
// context it opens by hand, since `browser.newContext()` does not inherit `use`.
test.use({ timezoneId: "Australia/Sydney" });

/** The M2 rejection contract for a start the generator does not offer. */
const REJECTED = [400, 409, 422];
/** Cross-persona reads/writes: denied outright or invisible. */
const DENIED = [401, 403, 404];

/** The six 30-minute starts a free 09:00–12:00 window offers. */
const SIX_CLOCKS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];

function expectNoLeak(text: string, secrets: string[], label: string) {
  for (const secret of secrets) {
    expect(text, `${label} must not leak "${secret}"`).not.toContain(secret);
  }
}

/** The pinned start of a booking row, from either shape the API may emit. */
const rowStart = (r: Json) => Date.parse(String(r.startAt ?? r.start));
/**
 * The pinned end of a booking row. No milestone pins the exact shape of the
 * staff day list beyond "that practitioner's bookings … including each patient's
 * name and email", so fall back to a zero-length interval rather than failing a
 * conforming app on a missing field.
 */
const rowEnd = (r: Json) => {
  const end = Date.parse(String(r.endAt ?? r.end));
  return Number.isNaN(end) ? rowStart(r) + 1 : end;
};
const isActive = (r: Json) => String(r.status ?? "booked") !== "cancelled";

/** Rows of a staff day list that start at exactly this instant. */
const rowsAt = (rows: Json[], iso: string) =>
  rows.filter((r) => rowStart(r) === Date.parse(iso));

/** No two active bookings for one practitioner may overlap, under any ordering. */
function expectNoOverlap(rows: Json[], label: string) {
  const active = rows
    .filter(isActive)
    .map((r) => ({ start: rowStart(r), end: rowEnd(r) }))
    .filter((iv) => !Number.isNaN(iv.start))
    .sort((x, y) => x.start - y.start);
  for (let i = 1; i < active.length; i++) {
    expect(
      active[i].start,
      `${label}: no two active bookings for this practitioner overlap`,
    ).toBeGreaterThanOrEqual(active[i - 1].end);
  }
}

/** A rejection is only a rejection when it carries the pinned JSON `error`. */
async function expectRejected(resp: APIResponse, label: string) {
  expectStatusIn(resp, REJECTED, label);
  await expectJsonError(resp, label);
}

/**
 * Assert the exact offered set, in order, as pinned ISO instants — the load
 * bearing form. Exact counts are legitimate only because every test owns its
 * practitioner and gave it exactly one availability window.
 */
async function expectOffered(
  ctx: BrowserContext,
  q: { practitionerId: string; serviceId: string; date: string },
  clocks: string[],
  label: string,
) {
  const slots = await getSlots(ctx, q);
  expect(
    slots.map((s) => Date.parse(s.start)),
    `${label} offers ${clocks.join(", ") || "nothing"} clinic time (got ${
      slots.map((s) => clinicClock(s.start)).join(", ") || "nothing"
    })`,
  ).toEqual(clocks.map((c) => Date.parse(clinicInstant(q.date, c))));
}

/** Poll the caller's own pinned list for its booking at `iso` and span-check it. */
async function expectBookingAt(
  ctx: BrowserContext,
  iso: string,
  minutes: number,
  label: string,
): Promise<BookingJson> {
  let found: BookingJson | null = null;
  await expect
    .poll(
      async () => {
        found = await findBookingAt(ctx, iso);
        return found ? String(found.id) : null;
      },
      {
        timeout: 15_000,
        message: `${label} reads back at clinic ${clinicClock(iso)}`,
      },
    )
    .toBeTruthy();
  const booking = found as unknown as BookingJson;
  expectInstant(booking.startAt, iso, `${label} startAt`);
  expect(
    instantMs(booking.endAt, `${label} endAt`) -
      instantMs(booking.startAt, `${label} startAt`),
    `${label} lasts the service's ${minutes} minutes`,
  ).toBe(minutes * MINUTE_MS);
  return booking;
}

/**
 * A staff-only page seen by a patient: `forbidden-message` or a redirect away,
 * and the page's write control never rendered.
 */
async function expectStaffOnlyPage(
  page: Page,
  path: string,
  submitTestId: string,
) {
  const want = path.replace(/\/$/, "");
  await page.goto(path);
  await expect
    .poll(
      async () =>
        (await page.getByTestId("forbidden-message").count()) > 0 ||
        new URL(page.url()).pathname.replace(/\/$/, "") !== want,
      {
        timeout: 15_000,
        message: `${path} renders forbidden-message or redirects a patient away`,
      },
    )
    .toBe(true);
  await expect(
    page.getByTestId(submitTestId),
    `${submitTestId} is not rendered to a patient on ${path}`,
  ).toHaveCount(0);
}

test.describe("slotline checkpoint 2", () => {
  // ---- regressions carried over from milestone 1 ----
  test("slot-m1-01 sign-up lands on /bookings as a patient", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    await expect(a.page).toHaveURL(/\/bookings\/?$/, { timeout: 15_000 });
    await expectSignedIn(a.page, a.who.email);
    const me = await getMe(a.ctx);
    expect(me.email).toBe(a.who.email);
    expect(String(me.id ?? ""), "/api/me returns a non-empty id").not.toBe("");
    // New at M2, on unchanged steps: /api/me also reports the caller's own role.
    expect(me.role, "a fresh sign-up is a patient").toBe("patient");
  });

  test("slot-m1-04 staff create a practitioner", async ({ clinic }) => {
    // Adapted for M2 authorization: the claim is the point of the regression —
    // the unmodified checkpoint-1 steps would now correctly 403.
    const s = await clinic.staff();
    const practitionerName = clinic.name("Dr Vale");
    const specialty = clinic.name("Derm");
    const practitionerId = await createPractitioner(s, {
      name: practitionerName,
      specialty,
    });

    await s.page.goto("/practitioners");
    const row = s.page
      .getByTestId("practitioner-row")
      .filter({ hasText: practitionerName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("practitioner-row-name")).toContainText(
      practitionerName,
    );
    await expect(row.getByTestId("practitioner-row-specialty")).toContainText(
      specialty,
    );
    expect(
      await row.getAttribute("data-practitioner-id"),
      "data-practitioner-id equals the id in GET /api/practitioners",
    ).toBe(practitionerId);

    await row.getByTestId("practitioner-row-link").click();
    await expect(s.page.getByTestId("practitioner-detail-name")).toContainText(
      practitionerName,
      { timeout: 15_000 },
    );
    await expect(
      s.page.getByTestId("practitioner-detail-specialty"),
    ).toContainText(specialty);
  });

  test("slot-m1-09 cancel keeps the row and flips the status", async ({
    clinic,
  }) => {
    // Adapted for the M2 booking flow: the booking is made from `slot-option`,
    // because M2 deletes the free-text `booking-form-start` this CUJ used at
    // checkpoint 1. The cancel behaviour under test is unchanged.
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const startIso = clinicInstant(FAR_DATE, "09:00");
    const bookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "09:00",
    });

    await cancelBookingViaUi(a, bookingId);
    await a.page.goto("/bookings");
    const row = bookingRow(a.page, bookingId);
    await expect(row, "the cancelled booking is still listed").toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => row.getAttribute("data-status"), {
        timeout: 15_000,
        message: "booking-row data-status becomes cancelled",
      })
      .toBe("cancelled");
    await expect(row.getByTestId("booking-row-status")).toContainText(
      /cancel/i,
    );

    const api = await getBooking(a.ctx, bookingId);
    expect(api.status).toBe("cancelled");
    expectInstant(api.startAt, startIso, "the cancelled booking's startAt");
  });

  test("slot-m1-10 a second patient sees no bookings but shared clinic data", async ({
    clinic,
  }) => {
    // Adapted on both counts: staff creates the practitioner (M2 revokes that
    // from patients) and patientA books from `slot-option`.
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const aBookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "09:00",
    });
    // patientA's booking is load-bearing: without it "patientB sees no
    // bookings" holds vacuously in an app that lists nothing at all.
    expect(aBookingId).toBeTruthy();

    const b = await clinic.patient("patientB");
    await b.page.goto("/bookings");
    await expect(b.page.getByTestId("booking-row")).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(await listJson(b.ctx, "/api/bookings")).toEqual([]);

    await b.page.goto("/practitioners");
    await expect(b.page.getByTestId("practitioners-list")).toContainText(
      w.practitionerName,
      { timeout: 15_000 },
    );
    expect((await getMe(b.ctx)).email).toBe(b.who.email);
  });

  // ---- new at milestone 2 ----
  test("slot-m2-01 the clinic access code grants the staff role", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    await claimStaff(a);
    await a.page.goto("/bookings");
    await expect(a.page.getByTestId("role-badge")).toHaveText("staff", {
      timeout: 15_000,
    });
    expect((await getMe(a.ctx)).role).toBe("staff");

    // A second, independent context submitting a wrong code changes nothing.
    const b = await clinic.patient("patientB");
    await claimStaff(b, `wrong-${clinic.token}`);
    await expect(b.page.getByTestId("staff-code-error")).toBeVisible({
      timeout: 15_000,
    });
    expect((await getMe(b.ctx)).role).toBe("patient");
    await b.page.goto("/bookings");
    await expect(b.page.getByTestId("role-badge")).toHaveText("patient", {
      timeout: 15_000,
    });
  });

  test("slot-m2-02 staff add a weekly availability window", async ({
    clinic,
  }) => {
    const s = await clinic.staff();
    const practitionerId = await createPractitioner(s, {
      name: clinic.name("Dr Vale"),
      specialty: clinic.name("Derm"),
    });
    const weekday = weekdayOf(FAR_DATE);

    // Reached through the pinned practitioner-detail entry point, as the row
    // describes, rather than by navigating straight to the URL.
    await s.page.goto(`/practitioners/${practitionerId}`);
    await s.page.getByTestId("nav-availability").click();
    await s.page
      .waitForURL(`**/practitioners/${practitionerId}/availability`, {
        timeout: 15_000,
      })
      .catch(() => {});
    await s.page
      .getByTestId("availability-weekday")
      .selectOption(String(weekday));
    await s.page.getByTestId("availability-start-time").fill("09:00");
    await s.page.getByTestId("availability-end-time").fill("12:00");
    await s.page.getByTestId("availability-submit").click();
    await settleAfterSubmit(s.page, null);

    await s.page.reload();
    const rows = s.page.getByTestId("availability-row");
    // Exact because the practitioner is this test's own.
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    const row = rows.first();
    expect(await attrOf(row, "data-weekday", "availability-row")).toBe(
      String(weekday),
    );
    expect(
      (await attrOf(row, "data-start-time", "availability-row")).slice(0, 5),
    ).toBe("09:00");
    expect(
      (await attrOf(row, "data-end-time", "availability-row")).slice(0, 5),
    ).toBe("12:00");
    await expect(row.getByTestId("availability-row-hours")).toBeVisible();

    const api = await listAvailability(s.ctx, practitionerId);
    expect(api, "GET /api/practitioners/{id}/availability").toHaveLength(1);
    expect(Number(api[0].weekday)).toBe(weekday);
    expect(String(api[0].startTime).slice(0, 5)).toBe("09:00");
    expect(String(api[0].endTime).slice(0, 5)).toBe("12:00");
  });

  test("slot-m2-03 a free day offers the whole 30-minute grid", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    const rendered = await renderedSlotStarts(a.page);
    expect(
      rendered.map((s) => Date.parse(s)),
      "the rendered data-slot-start values, soonest first",
    ).toEqual(SIX_CLOCKS.map((c) => Date.parse(clinicInstant(FAR_DATE, c))));
    for (const start of rendered) expectZulu(start, "data-slot-start");

    // The same six instants from the pinned server endpoint.
    await expectOffered(
      a.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: w.serviceId,
        date: FAR_DATE,
      },
      SIX_CLOCKS,
      "GET /api/slots on a free FAR_DATE",
    );
    const slots = await getSlots(a.ctx, {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      date: FAR_DATE,
    });
    for (const slot of slots) {
      expectZulu(slot.end, "slot end");
      expect(
        instantMs(slot.end, "slot end") - instantMs(slot.start, "slot start"),
        "each slot spans the service's 30 minutes",
      ).toBe(30 * MINUTE_MS);
    }
  });

  test("slot-m2-04 booking a slot removes it from the offered list", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const tenIso = clinicInstant(FAR_DATE, "10:00");

    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    await clickSlot(a.page, tenIso);
    expectInstant(
      await attrOf(
        a.page.getByTestId("booking-selected-slot").first(),
        "data-slot-start",
        "booking-selected-slot",
      ),
      tenIso,
      "booking-selected-slot data-slot-start",
    );
    await a.page.getByTestId("booking-form-submit").click();
    await settleAfterSubmit(a.page);
    const bookingId = await requireBookingIdAt(a.ctx, tenIso);

    await a.page.goto("/bookings");
    const row = bookingRow(a.page, bookingId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    expectInstant(
      await row.getAttribute("data-start"),
      tenIso,
      "booking-row data-start",
    );
    expectInstant(
      await row.getAttribute("data-end"),
      plusMinutes(tenIso, 30),
      "booking-row data-end",
    );

    // Reopened for the same practitioner/service/date: 10:00 is gone.
    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(5, {
      timeout: 15_000,
    });
    const reopened = await renderedSlotStarts(a.page);
    expect(
      reopened.map((s) => Date.parse(s)),
      "the booked 10:00 slot is no longer offered",
    ).not.toContain(Date.parse(tenIso));
  });

  test("slot-m2-05 a longer service re-grids the same window", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      services: [
        { base: "Checkup", durationMinutes: 30 },
        { base: "Review", durationMinutes: 60 },
      ],
    });
    const a = await clinic.patient();
    const checkup = w.services.Checkup;
    const review = w.services.Review;

    // The self-made 10:00 booking is load-bearing: without it the 60-minute
    // grid offers three slots (09:00/10:00/11:00), not two.
    await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: checkup.name,
      date: FAR_DATE,
      time: "10:00",
    });

    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: review.name,
      date: FAR_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(2, {
      timeout: 15_000,
    });
    const rendered = await renderedSlotStarts(a.page);
    expect(
      rendered.map((s) => Date.parse(s)),
      "10:00 overlaps the booking just made and 12:00 does not fit before the window ends",
    ).toEqual(
      ["09:00", "11:00"].map((c) => Date.parse(clinicInstant(FAR_DATE, c))),
    );
    await expectOffered(
      a.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: review.id,
        date: FAR_DATE,
      },
      ["09:00", "11:00"],
      "GET /api/slots for the 60-minute service",
    );
  });

  test("slot-m2-06 each patient sees only their own booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aBookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "10:00",
    });
    const bBookingId = await bookSlot(b, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "11:00",
    });
    expect(aBookingId, "the two bookings are distinct rows").not.toBe(
      bBookingId,
    );

    await a.page.goto("/bookings");
    await expect(a.page.getByTestId("booking-row")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(bookingRow(a.page, aBookingId)).toBeVisible();
    await expect(bookingRow(a.page, bBookingId)).toHaveCount(0);
    expectNoLeak(await a.page.content(), [b.who.email], "patientA's /bookings");

    await b.page.goto("/bookings");
    await expect(b.page.getByTestId("booking-row")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(bookingRow(b.page, bBookingId)).toBeVisible();
    await expect(bookingRow(b.page, aBookingId)).toHaveCount(0);
    expectNoLeak(await b.page.content(), [a.who.email], "patientB's /bookings");
  });

  test("slot-m2-07 no window and the past offer nothing", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const q = { practitionerId: w.practitionerId, serviceId: w.serviceId };

    // Positive control first: the window is real and the generator works.
    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    await expectOffered(
      a.ctx,
      { ...q, date: FAR_DATE },
      SIX_CLOCKS,
      "GET /api/slots on FAR_DATE",
    );

    // Future, but a weekday this practitioner has no window on.
    await openSlotPicker(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: NO_WINDOW_DATE,
    });
    await expect(a.page.getByTestId("slot-option")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(a.page.getByTestId("slot-empty")).toBeVisible({
      timeout: 15_000,
    });
    expect(
      await getSlots(a.ctx, { ...q, date: NO_WINDOW_DATE }),
      "a weekday with no window offers nothing",
    ).toEqual([]);

    // Same weekday as FAR_DATE, so the 09:00–12:00 window genuinely applies and
    // the only thing wrong with it is that it has already happened.
    expect(weekdayOf(PAST_DATE)).toBe(weekdayOf(FAR_DATE));
    expect(
      await getSlots(a.ctx, { ...q, date: PAST_DATE }),
      "a past clinic day offers nothing",
    ).toEqual([]);
  });

  test("slot-m2-08 staff read a practitioner's day; patients cannot", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const tenIso = clinicInstant(FAR_DATE, "10:00");
    const elevenIso = clinicInstant(FAR_DATE, "11:00");
    const aBookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "10:00",
    });
    const bBookingId = await bookSlot(b, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "11:00",
    });

    const day = await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE);
    expect(
      day,
      "the staff day list holds exactly this test's two bookings",
    ).toHaveLength(2);
    // M2 does not pin the day list's order (M3 does), so compare the set.
    expect(day.map((r) => rowStart(r)).sort((x, y) => x - y)).toEqual([
      Date.parse(tenIso),
      Date.parse(elevenIso),
    ]);
    // Ids matched as FIELDS, never as substrings of the serialised day: nothing
    // pins an id's format, `bigserial` makes them 1–3 digits, and a short id is
    // a substring of another row's id or of the epoch-ish digits in an instant —
    // so a `JSON.stringify(day)` substring search would pass with the booking
    // absent, which is worse than no control at all. `.toContain` on an array is
    // exact element equality.
    const dayIds = day.map((r) => String(r.id));
    expect(dayIds, "the day list holds patientA's booking").toContain(
      aBookingId,
    );
    expect(dayIds, "the day list holds patientB's booking").toContain(
      bBookingId,
    );
    // Emails are run- and test-unique, so a substring search cannot collide.
    const dayText = JSON.stringify(day);
    expect(
      dayText,
      "the staff day list carries each patient's email",
    ).toContain(a.who.email);
    expect(dayText).toContain(b.who.email);

    // The three staff-only surfaces that exist at M2. /staff/join is
    // deliberately not among them: it is patient-accessible by design.
    await expectStaffOnlyPage(
      a.page,
      `/practitioners/${w.practitionerId}/availability`,
      "availability-submit",
    );
    await expectStaffOnlyPage(
      a.page,
      "/practitioners/new",
      "practitioner-form-submit",
    );
    await expectStaffOnlyPage(a.page, "/services/new", "service-form-submit");

    await a.page.goto("/practitioners");
    await expect(a.page.getByTestId("practitioners-list")).toBeVisible({
      timeout: 15_000,
    });
    await expect(a.page.getByTestId("practitioner-new-button")).toHaveCount(0);
    await a.page.goto("/services");
    await expect(a.page.getByTestId("services-list")).toBeVisible({
      timeout: 15_000,
    });
    await expect(a.page.getByTestId("service-new-button")).toHaveCount(0);
  });

  // ---- security probes ----
  test("slot-m2-s01 crafted starts off the grid or outside the window are refused", async ({
    clinic,
  }) => {
    // 40 does not divide the 180-minute window, which is what makes the fit rule
    // separable from the grid rule.
    const w = await clinic.bookableWorld({
      services: [
        { base: "Checkup", durationMinutes: 30 },
        { base: "Scan", durationMinutes: 40 },
      ],
    });
    const a = await clinic.patient();
    const checkup = w.services.Checkup;
    const scan = w.services.Scan;

    const attacks: Array<[string, string, string]> = [
      [checkup.id, "09:07", "off grid, inside the window"],
      [checkup.id, "13:00", "on the 30-minute grid, entirely after the window"],
      [scan.id, "11:40", "on the 40-minute grid, but ending after the window"],
    ];
    for (const [serviceId, time, why] of attacks) {
      const resp = await postBooking(a.ctx, {
        practitionerId: w.practitionerId,
        serviceId,
        startAt: clinicInstant(FAR_DATE, time),
      });
      await expectRejected(
        resp,
        `POST /api/bookings at clinic ${time} (${why})`,
      );
    }

    // The crafted instants never appear anywhere.
    expect(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
      "the practitioner's day is still empty",
    ).toEqual([]);
    expect(
      await listJson(a.ctx, "/api/bookings"),
      "patientA still owns nothing",
    ).toEqual([]);

    // Positive control: without it, an app whose POST rejects *everything*
    // passes this probe outright.
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    await expectOffered(
      a.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: checkup.id,
        date: FAR_DATE,
      },
      SIX_CLOCKS,
      "GET /api/slots after the three rejections",
    );
    const clean = await postBooking(a.ctx, {
      practitionerId: w.practitionerId,
      serviceId: checkup.id,
      startAt: nineIso,
    });
    await expectOk(clean, "a well-formed POST /api/bookings at clinic 09:00");
    await expectBookingAt(a.ctx, nineIso, 30, "the control booking");
  });

  test("slot-m2-s02 past and window-less dates are refused", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    // PAST_DATE shares FAR_DATE's weekday, so the window applies there and being
    // in the past is the only rule it breaks.
    expect(weekdayOf(PAST_DATE)).toBe(weekdayOf(FAR_DATE));

    for (const [date, why] of [
      [PAST_DATE, "a clinic day that has already happened"],
      [NO_WINDOW_DATE, "a future weekday with no window"],
    ] as const) {
      const resp = await postBooking(a.ctx, {
        practitionerId: w.practitionerId,
        serviceId: w.serviceId,
        startAt: clinicInstant(date, "09:00"),
      });
      await expectRejected(resp, `POST /api/bookings on ${date} (${why})`);
      expect(
        await practitionerDay(w.staff.ctx, w.practitionerId, date),
        `the practitioner's ${date} is still empty`,
      ).toEqual([]);
    }
    expect(
      await listJson(a.ctx, "/api/bookings"),
      "patientA's bookings are unchanged",
    ).toEqual([]);

    // Positive control: neither rejection can be a route that simply does not
    // work.
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    await expectOffered(
      a.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: w.serviceId,
        date: FAR_DATE,
      },
      SIX_CLOCKS,
      "GET /api/slots after the two rejections",
    );
    const clean = await postBooking(a.ctx, {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      startAt: nineIso,
    });
    await expectOk(clean, "a well-formed POST /api/bookings on FAR_DATE");
    await expectBookingAt(a.ctx, nineIso, 30, "the control booking");
  });

  test("slot-m2-s03 a second patient cannot take a taken slot", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aBookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "10:00",
    });
    // The instant comes from patientA's own pinned list, not from the clock.
    const taken = await getBooking(a.ctx, aBookingId);
    const tenIso = String(taken.startAt);
    expectInstant(tenIso, clinicInstant(FAR_DATE, "10:00"), "the taken slot");

    const resp = await postBooking(b.ctx, {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      startAt: tenIso,
    });
    await expectRejected(resp, "patientB POSTing patientA's 10:00 slot");

    const day = await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE);
    expect(
      rowsAt(day, tenIso),
      "exactly one booking starts at that instant",
    ).toHaveLength(1);
    expect(
      JSON.stringify(rowsAt(day, tenIso)),
      "it is still patientA's",
    ).toContain(a.who.email);
    expectNoOverlap(day, "the practitioner's FAR_DATE day");
    const after = await getBooking(a.ctx, aBookingId);
    expectInstant(after.startAt, taken.startAt, "patientA's startAt");
    expectInstant(after.endAt, taken.endAt, "patientA's endAt");
    expect(after.status).toBe("booked");

    // Positive control: the slot list is not empty or broken, it simply no
    // longer offers 10:00.
    await expectOffered(
      b.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: w.serviceId,
        date: FAR_DATE,
      },
      ["09:00", "09:30", "10:30", "11:00", "11:30"],
      "GET /api/slots after 10:00 was taken",
    );
    expect(
      await listJson(b.ctx, "/api/bookings"),
      "patientB owns nothing",
    ).toEqual([]);
  });

  test("slot-m2-s04 the same slot is never sold twice", async ({ clinic }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const elevenIso = clinicInstant(FAR_DATE, "11:00");
    const tenThirtyIso = clinicInstant(FAR_DATE, "10:30");
    const body = (startAt: string) => ({
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      startAt,
    });

    // Part 1 — sequential, and the only part that can fail an app.
    const first = await postBooking(a.ctx, body(elevenIso));
    await expectOk(first, "the first POST for clinic 11:00");
    const second = await postBooking(a.ctx, body(elevenIso));
    await expectRejected(second, "the identical second POST for clinic 11:00");

    const dayAfterPart1 = await practitionerDay(
      w.staff.ctx,
      w.practitionerId,
      FAR_DATE,
    );
    expect(
      rowsAt(dayAfterPart1, elevenIso),
      "exactly one booking at clinic 11:00",
    ).toHaveLength(1);
    expectNoOverlap(dayAfterPart1, "the practitioner's FAR_DATE day");
    // Positive control on the same surface: the still-free slots remain offered.
    await expectOffered(
      a.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: w.serviceId,
        date: FAR_DATE,
      },
      ["09:00", "09:30", "10:00", "10:30", "11:30"],
      "GET /api/slots after 11:00 was taken",
    );

    // Part 2 — concurrent, a one-way detector: Promise.all cannot force an
    // interleaving, so a pass proves nothing, but a failure proves the write is
    // not atomic. The mechanism is scored by judge rubric item 2.
    const responses = await Promise.all([
      postBooking(a.ctx, body(tenThirtyIso)),
      postBooking(b.ctx, body(tenThirtyIso)),
    ]);
    const accepted = responses.filter(
      (r) => r.status() >= 200 && r.status() < 300,
    );
    expect(
      accepted.length,
      `at most one concurrent POST for clinic 10:30 may succeed (got ${responses
        .map((r) => r.status())
        .join(", ")})`,
    ).toBeLessThanOrEqual(1);

    const day = await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE);
    const at1030 = rowsAt(day, tenThirtyIso);
    expect(
      at1030.length,
      "bookings at clinic 10:30 equals the number of 2xx responses",
    ).toBe(accepted.length);
    for (const resp of accepted) {
      const created = (await resp.json()) as Json;
      expect(
        at1030.map((r) => String(r.id)),
        "an accepted response's id is in the practitioner's day",
      ).toContain(String(created.id));
    }
    expectNoOverlap(day, "the practitioner's FAR_DATE day after the race");
  });

  test("slot-m2-s05 a start inside another appointment is refused", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      services: [
        { base: "Checkup", durationMinutes: 30 },
        { base: "Review", durationMinutes: 60 },
      ],
    });
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const checkup = w.services.Checkup;
    const review = w.services.Review;
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const nineThirtyIso = clinicInstant(FAR_DATE, "09:30");
    const tenIso = clinicInstant(FAR_DATE, "10:00");

    // 09:00–10:00 is occupied by a 60-minute appointment.
    await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: review.name,
      date: FAR_DATE,
      time: "09:00",
    });

    // 09:30 is on the 30-minute grid and inside the window, and collides with no
    // existing *start* — only with an existing interval.
    const resp = await postBooking(b.ctx, {
      practitionerId: w.practitionerId,
      serviceId: checkup.id,
      startAt: nineThirtyIso,
    });
    await expectRejected(resp, "a 30-minute start inside a 60-minute booking");

    const day = await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE);
    const overlapping = day.filter(
      (r) =>
        isActive(r) &&
        rowStart(r) < Date.parse(tenIso) &&
        rowEnd(r) > Date.parse(nineIso),
    );
    expect(
      overlapping,
      "exactly one booking overlaps clinic 09:00–10:00",
    ).toHaveLength(1);
    expectNoOverlap(day, "the practitioner's FAR_DATE day");
    expect(
      await listJson(b.ctx, "/api/bookings"),
      "patientB owns nothing yet",
    ).toEqual([]);

    // Positive control: the app is not simply refusing every second patient or
    // every 30-minute booking on an occupied day.
    await expectOffered(
      b.ctx,
      {
        practitionerId: w.practitionerId,
        serviceId: checkup.id,
        date: FAR_DATE,
      },
      ["10:00", "10:30", "11:00", "11:30"],
      "GET /api/slots for the 30-minute service",
    );
    const clean = await postBooking(b.ctx, {
      practitionerId: w.practitionerId,
      serviceId: checkup.id,
      startAt: tenIso,
    });
    await expectOk(clean, "patientB POSTing the offered clinic 10:00");
    await expectBookingAt(b.ctx, tenIso, 30, "patientB's control booking");
  });

  test("slot-m2-s06 a second patient cannot read or write another's booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aBookingId = await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "09:00",
    });
    const before = await getBooking(a.ctx, aBookingId);
    // The PATCH target is an instant the generator really offers, so the leg
    // tests ownership rather than "not offered".
    const offered = await getSlots(a.ctx, {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      date: FAR_DATE,
    });
    const target = offered.find(
      (s) =>
        Date.parse(s.start) === Date.parse(clinicInstant(FAR_DATE, "10:00")),
    );
    expect(target, "clinic 10:00 is offered on FAR_DATE").toBeTruthy();
    const path = `/api/bookings/${aBookingId}`;

    const attacks: Array<[string, () => Promise<APIResponse>]> = [
      [`GET ${path}`, () => b.ctx.request.get(path, { maxRedirects: 0 })],
      [
        `PATCH ${path}`,
        () =>
          b.ctx.request.patch(path, {
            data: { startAt: (target as { start: string }).start },
            maxRedirects: 0,
          }),
      ],
      [
        `POST ${path}/cancel`,
        () => b.ctx.request.post(`${path}/cancel`, { maxRedirects: 0 }),
      ],
      [`DELETE ${path}`, () => b.ctx.request.delete(path, { maxRedirects: 0 })],
    ];
    for (const [label, attack] of attacks) {
      const resp = await attack();
      expectStatusIn(resp, DENIED, label);
      expectNoLeak(await resp.text(), [a.who.email], label);
    }

    // HTML leg: no milestone pins server rendering, so assert absence only and
    // allow the redirect (APIRequestContext follows redirects by default).
    const html = await b.ctx.request.get(`/bookings/${aBookingId}`);
    expectNoLeak(
      await html.text(),
      [a.who.email],
      `patientB GET /bookings/${aBookingId}`,
    );

    const after = await getBooking(a.ctx, aBookingId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, before.startAt, "startAt after the probe");
    expectInstant(after.endAt, before.endAt, "endAt after the probe");
    expect(
      (await listJson(b.ctx, "/api/bookings")).map((x) => String(x.id)),
    ).not.toContain(aBookingId);
  });

  test("slot-m2-s07 a patient cannot manage clinic data or read a day", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    // patientA's booking puts a real name and email on that day to leak.
    await bookSlot(a, {
      practitionerName: w.practitionerName,
      serviceName: w.serviceName,
      date: FAR_DATE,
      time: "09:00",
    });
    const ghostName = clinic.name("Ghost");

    // 401 is admissible in place of 403 only when the session is provably live:
    // patients may read services, so this 200 proves the cookie jar is
    // authenticated and a 401 below is a role denial, not a lost session.
    const liveSession = await b.ctx.request.get("/api/services");
    expect(
      liveSession.status(),
      "patients may read services, so patientB's session is live",
    ).toBe(200);
    const allowed = [403, 401];

    const attacks: Array<[string, () => Promise<APIResponse>]> = [
      [
        "POST /api/practitioners",
        () =>
          b.ctx.request.post("/api/practitioners", {
            data: { name: ghostName, specialty: clinic.name("Derm") },
            maxRedirects: 0,
          }),
      ],
      [
        `PATCH /api/services/${w.serviceId}`,
        () =>
          b.ctx.request.patch(`/api/services/${w.serviceId}`, {
            data: { durationMinutes: 5 },
            maxRedirects: 0,
          }),
      ],
      [
        `DELETE /api/services/${w.serviceId}`,
        () =>
          b.ctx.request.delete(`/api/services/${w.serviceId}`, {
            maxRedirects: 0,
          }),
      ],
      [
        `POST /api/practitioners/${w.practitionerId}/availability`,
        () =>
          b.ctx.request.post(
            `/api/practitioners/${w.practitionerId}/availability`,
            {
              data: { weekday: 3, startTime: "00:00", endTime: "23:59" },
              maxRedirects: 0,
            },
          ),
      ],
    ];
    for (const [label, attack] of attacks) {
      const resp = await attack();
      expectStatusIn(resp, allowed, label);
    }

    const dayLeg = await b.ctx.request.get(
      `/api/practitioners/${w.practitionerId}/bookings?date=${FAR_DATE}`,
      { maxRedirects: 0 },
    );
    expectStatusIn(
      dayLeg,
      allowed,
      `patientB GET /api/practitioners/${w.practitionerId}/bookings`,
    );
    expectNoLeak(
      await dayLeg.text(),
      [a.who.email, a.who.name],
      "patientB's day-list response",
    );

    // Staff re-read: a name filter, never a row count — practitioners and
    // services are clinic-wide and sibling tests create their own in parallel.
    expect(
      await findIdByName(w.staff.ctx, "/api/practitioners", ghostName),
      `no practitioner named ${ghostName} was created`,
    ).toBeNull();
    const services = await listJson(w.staff.ctx, "/api/services");
    const checkup = services.find((s) => s.name === w.serviceName);
    expect(checkup, `${w.serviceName} still exists`).toBeTruthy();
    expect(Number((checkup as Json).durationMinutes)).toBe(30);
    // Exact here because the practitioner is this test's own.
    expect(
      await listAvailability(w.staff.ctx, w.practitionerId),
      "the practitioner still has exactly its one window",
    ).toHaveLength(1);
  });

  test("slot-m2-s08 the role cannot be smuggled through any body", async ({
    clinic,
  }) => {
    // A bookable world, because the last leg is a booking that must genuinely
    // succeed: with nothing provisioned it could only ever 400/409 for reasons
    // unrelated to `role`.
    const w = await clinic.bookableWorld();
    const b = await clinic.patient("patientB");
    expect((await getMe(b.ctx)).role, "patientB starts as a patient").toBe(
      "patient",
    );

    const claims: Array<[string, Json]> = [
      ["a wrong clinic access code", { code: `wrong-${clinic.token}` }],
      ["an empty clinic access code", { code: "" }],
    ];
    for (const [label, data] of claims) {
      const resp = await b.ctx.request.post("/api/staff/claim", {
        data,
        maxRedirects: 0,
      });
      expectStatusIn(resp, [400, 403], `POST /api/staff/claim with ${label}`);
      expect((await getMe(b.ctx)).role, `role after ${label}`).toBe("patient");
    }

    const patchMe = await b.ctx.request.patch("/api/me", {
      data: { role: "staff" },
      maxRedirects: 0,
    });
    expectStatusIn(patchMe, [403, 404, 405], "PATCH /api/me with a role");
    expect((await getMe(b.ctx)).role, "role after PATCH /api/me").toBe(
      "patient",
    );

    // The booking leg is the positive control and the privilege check at once.
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const body = {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      startAt: nineIso,
    };
    const smuggled = await postBooking(b.ctx, { ...body, role: "staff" });
    expect(
      smuggled.status(),
      `the smuggled-role booking must never 5xx (got ${smuggled.status()})`,
    ).toBeLessThan(500);
    if (smuggled.status() < 300) {
      // Accepted: the extra field was ignored, not honoured.
      await expectBookingAt(b.ctx, nineIso, 30, "the accepted booking");
    } else {
      // Rejected: a strict-schema app may legitimately refuse an unknown field —
      // but then nothing was written and the clean body must now succeed.
      expectStatusIn(smuggled, [400, 422], "the smuggled-role booking");
      expect(
        await findBookingAt(b.ctx, nineIso),
        "the rejected booking was not written",
      ).toBeNull();
      const retry = await postBooking(b.ctx, body);
      await expectOk(retry, "the identical body with only `role` removed");
      await expectBookingAt(b.ctx, nineIso, 30, "the retried booking");
    }
    expect(
      (await getMe(b.ctx)).role,
      "role after the smuggled-role booking",
    ).toBe("patient");

    // Still a patient in effect, not merely in the badge.
    const ghostName = clinic.name("Ghost");
    const followUp = await b.ctx.request.post("/api/practitioners", {
      data: { name: ghostName, specialty: clinic.name("Derm") },
      maxRedirects: 0,
    });
    expectStatusIn(followUp, [403], "a follow-up POST /api/practitioners");
    expect(
      await findIdByName(w.staff.ctx, "/api/practitioners", ghostName),
      `no practitioner named ${ghostName} was created`,
    ).toBeNull();
  });
});
