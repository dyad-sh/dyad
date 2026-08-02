// Slotline — checkpoint 3 CUJ suite (design/app-5-slotline.md, M3 CUJ table +
// M3 security probes). 12 CUJs (4 regression + 8 new) + 10 probes.
//
// Conventions (design "Test fixtures & conventions"): there is no `.serial` and
// nothing is inherited — every test mints its own TOKEN through the `clinic`
// fixture and stands up its own staff persona, practitioner, availability
// window(s), service(s), patients and bookings, so the exact slot counts (6, 5,
// 2, 4) and the exact schedule-row counts hold because the test owns the
// practitioner. Ids come only from pinned surfaces (GET /api/me, GET
// /api/bookings, GET /api/practitioners, GET /api/services, GET
// /api/practitioners/[id]/availability, and the `data-booking-id` /
// `data-practitioner-id` / `data-slot-start` attributes); a cross-persona id is
// always read by the victim's own context and then handed to the attacker.
// Temporal assertions read pinned ISO instants and compare with Date.parse.
// Every "nothing was offered" / "the write was rejected" leg carries a positive
// control in the same test.
import type { APIResponse, Page } from "@playwright/test";
import {
  test,
  expect,
  FAR_DATE,
  FAR_DATE_2,
  NEAR_DATE,
  NEXT_DATE,
  NO_WINDOW_DATE,
  PAST_DATE,
  MINUTE_MS,
  addAvailability,
  attrOf,
  bookSlot,
  bookingRow,
  cancelBookingViaUi,
  clickSlot,
  clinicClock,
  clinicInstant,
  createPractitioner,
  createService,
  expectInstant,
  expectJsonError,
  expectOk,
  expectSignedIn,
  expectStatusIn,
  findIdByName,
  getBooking,
  getMe,
  getSlots,
  instantMs,
  listAvailability,
  listJson,
  offeredClocks,
  openSlotPicker,
  openStaffSchedule,
  plusMinutes,
  postBooking,
  postReschedule,
  practitionerDay,
  renderedSlotStarts,
  requireBookingIdAt,
  rescheduleViaUi,
  scalarValues,
  scheduleRow,
  settleAfterSubmit,
  weekdayOf,
  type BookableWorld,
  type Json,
  type Persona,
} from "./fixtures";

// The browser is pinned to a zone that disagrees with clinic time in both the
// hour and the calendar date, and with UTC — without it the whole timezone
// dimension silently evaporates. The fixture also passes `timezoneId` into every
// context it opens by hand, since `browser.newContext()` does not inherit `use`.
test.use({ timezoneId: "Australia/Sydney" });

/** Unauthenticated legs may deny outright or redirect to sign-in. */
const DENIED_OR_REDIRECT = [401, 403, 404, 301, 302, 303, 307, 308];

function expectNoLeak(text: string, secrets: string[], label: string) {
  for (const secret of secrets) {
    expect(text, `${label} must not leak "${secret}"`).not.toContain(secret);
  }
}

/**
 * "This denied response does not hand back the booking" — matched as a FIELD of
 * the parsed body, never as a substring of it. Nothing pins an id's format,
 * `bigserial` makes ids 1–3 digits, and every Next.js HTML body carries digits
 * in its `/_next/static/chunks/<hash>.js` srcs and flight payload, so a
 * substring search for a short id fails a perfectly correct app. When the body
 * is not JSON (a redirect or an HTML page) there is no record to match and the
 * unique persona strings in `expectNoLeak` carry the criterion on their own.
 */
async function expectNoBookingLeak(
  resp: APIResponse,
  bookingId: string,
  label: string,
) {
  let body: unknown;
  try {
    body = JSON.parse(await resp.text());
  } catch {
    return;
  }
  // Flatten the whole tree, not just top-level `id`s. A denied response is
  // under no obligation to use the array-of-bookings shape the spec pins for a
  // 200 — `{"bookings":[…]}` or `{"data":{…}}` would map to ["undefined"] and
  // pass while the booking is fully exposed. Array .toContain stays exact
  // element equality, so only the reach changes, not the collision safety.
  expect(
    scalarValues(body),
    `${label} must not return booking ${bookingId}`,
  ).not.toContain(bookingId);
}

/** The pinned `/api/slots` query for a world's practitioner + one of its services. */
function slotQuery(w: BookableWorld, date: string, service?: string) {
  return {
    practitionerId: w.practitionerId,
    serviceId: service ? w.services[service].id : w.serviceId,
    date,
  };
}

/** Open `/bookings/new` on this world's practitioner + service + date. */
function openPicker(
  patient: Persona,
  w: BookableWorld,
  date: string,
  service?: string,
) {
  return openSlotPicker(patient, {
    practitionerName: w.practitionerName,
    serviceName: service ? w.services[service].name : w.serviceName,
    date,
  });
}

/** The M2+ UI booking flow, for the CUJ rows that pin `/bookings/new`. */
function bookViaUi(
  patient: Persona,
  w: BookableWorld,
  q: { date: string; time: string; service?: string },
): Promise<string> {
  return bookSlot(patient, {
    practitionerName: w.practitionerName,
    serviceName: q.service ? w.services[q.service].name : w.serviceName,
    date: q.date,
    time: q.time,
  });
}

/**
 * Probe-side booking through the pinned `POST /api/bookings`, with the id read
 * back from the owner's own `GET /api/bookings` — the provenance every probe
 * row describes ("each id read from its own owner's list").
 */
async function bookViaApi(
  patient: Persona,
  w: BookableWorld,
  q: { date: string; time: string; service?: string },
): Promise<string> {
  const startAt = clinicInstant(q.date, q.time);
  const resp = await postBooking(patient.ctx, {
    practitionerId: w.practitionerId,
    serviceId: q.service ? w.services[q.service].id : w.serviceId,
    startAt,
  });
  await expectOk(
    resp,
    `POST /api/bookings for ${patient.who.email} at clinic ${q.time} on ${q.date}`,
  );
  return requireBookingIdAt(patient.ctx, startAt);
}

/** Submit the slot picker once a `slot-option` has been clicked. */
async function submitPickedSlot(
  patient: Persona,
  startIso: string,
): Promise<string> {
  await patient.page
    .getByTestId("booking-selected-slot")
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await patient.page.getByTestId("booking-form-submit").click();
  await settleAfterSubmit(patient.page);
  return requireBookingIdAt(patient.ctx, startIso);
}

/** A pinned instant attribute of a row, as epoch ms, polled until it settles. */
function pollInstantAttr(
  locator: ReturnType<Page["locator"]>,
  attribute: string,
) {
  return async () => {
    if ((await locator.count()) === 0) return null;
    const value = await locator.first().getAttribute(attribute);
    return value ? Date.parse(value) : null;
  };
}

/**
 * "Hides or disables the patient's cancel control" — either shape conforms, so
 * absent, hidden and disabled all pass and only a live, clickable control fails.
 */
async function expectAbsentOrDisabled(
  page: Page,
  testId: string,
  label: string,
) {
  await expect
    .poll(
      async () => {
        const loc = page.getByTestId(testId);
        if ((await loc.count()) === 0) return true;
        const first = loc.first();
        if (!(await first.isVisible())) return true;
        return first.evaluate(
          (el) =>
            (el as HTMLButtonElement).disabled === true ||
            el.hasAttribute("disabled") ||
            el.getAttribute("aria-disabled") === "true",
        );
      },
      { timeout: 15_000, message: `${label} is absent, hidden or disabled` },
    )
    .toBe(true);
}

/** No milestone pins whether the day list includes cancelled rows. */
const activeOf = (rows: Json[]) =>
  rows.filter((r) => String(r.status) !== "cancelled");

/** An invariant no correct implementation can violate under any ordering. */
function expectNoOverlaps(rows: Json[], label: string) {
  const spans = activeOf(rows)
    .map((r) => ({
      start: instantMs(r.startAt, `${label} startAt`),
      end: instantMs(r.endAt, `${label} endAt`),
    }))
    .sort((x, y) => x.start - y.start);
  for (let i = 1; i < spans.length; i++) {
    expect(
      spans[i].start,
      `${label}: no two active bookings for the practitioner overlap`,
    ).toBeGreaterThanOrEqual(spans[i - 1].end);
  }
}

const is2xx = (resp: APIResponse) =>
  resp.status() >= 200 && resp.status() < 300;

test.describe("slotline checkpoint 3", () => {
  // ---- regressions carried over from milestones 1 and 2 ----
  test("slot-m1-01 sign-up lands on /bookings as a patient", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    await expect(a.page).toHaveURL(/\/bookings\/?$/, { timeout: 15_000 });
    await expectSignedIn(a.page, a.who.email);
    const me = await getMe(a.ctx);
    expect(me.email).toBe(a.who.email);
    expect(String(me.id ?? ""), "/api/me returns a non-empty id").not.toBe("");
    expect(me.role, "/api/me reports the caller's own role").toBe("patient");
  });

  test("slot-m2-01 the clinic access code still grants staff", async ({
    clinic,
  }) => {
    // clinic.staff() signs up a fresh persona and submits the pinned code on
    // /staff/join through `staff-code-input` / `staff-code-submit`.
    const s = await clinic.staff();
    await s.page.goto("/bookings");
    await expect(s.page.getByTestId("role-badge")).toHaveText("staff", {
      timeout: 15_000,
    });
    expect((await getMe(s.ctx)).role).toBe("staff");
  });

  test("slot-m2-04 booking a slot removes it from that day's offers", async ({
    clinic,
  }) => {
    // Own world: own staff, own practitioner, one 09:00–12:00 window on
    // weekdayOf(FAR_DATE), own 30-minute service.
    const w = await clinic.bookableWorld();
    const patient = await clinic.patient();
    const tenIso = clinicInstant(FAR_DATE, "10:00");

    await openPicker(patient, w, FAR_DATE);
    await expect(patient.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    const before = await renderedSlotStarts(patient.page);
    const grid = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
    grid.forEach((time, i) =>
      expectInstant(
        before[i],
        clinicInstant(FAR_DATE, time),
        `slot-option[${i}] data-slot-start`,
      ),
    );

    await clickSlot(patient.page, tenIso);
    const bookingId = await submitPickedSlot(patient, tenIso);

    await patient.page.goto("/bookings");
    const row = bookingRow(patient.page, bookingId);
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

    await openPicker(patient, w, FAR_DATE);
    await expect(patient.page.getByTestId("slot-option")).toHaveCount(5, {
      timeout: 15_000,
    });
    const after = await renderedSlotStarts(patient.page);
    expect(
      after.map((s) => Date.parse(s)),
      "the booked 10:00 slot is no longer offered",
    ).not.toContain(Date.parse(tenIso));
  });

  test("slot-m2-05 the grid follows the service duration and the window end", async ({
    clinic,
  }) => {
    // Own world — it shares nothing with the row above: 30-minute and
    // 60-minute services on one 09:00–12:00 window.
    const w = await clinic.bookableWorld({
      services: [
        { base: "Checkup", durationMinutes: 30 },
        { base: "Review", durationMinutes: 60 },
      ],
    });
    const patient = await clinic.patient();
    // Load-bearing: without this self-made booking the 60-minute grid offers
    // three slots (09:00/10:00/11:00), not two.
    await bookViaUi(patient, w, {
      date: FAR_DATE,
      time: "10:00",
      service: "Checkup",
    });

    await openPicker(patient, w, FAR_DATE, "Review");
    await expect(patient.page.getByTestId("slot-option")).toHaveCount(2, {
      timeout: 15_000,
    });
    const starts = await renderedSlotStarts(patient.page);
    expectInstant(
      starts[0],
      clinicInstant(FAR_DATE, "09:00"),
      "the first 60-minute slot",
    );
    expectInstant(
      starts[1],
      clinicInstant(FAR_DATE, "11:00"),
      "the second 60-minute slot (10:00 overlaps, 12:00 would not fit)",
    );
  });

  // ---- new milestone-3 scenarios ----
  test("slot-m3-01 cancelling outside the window releases the slot", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const patient = await clinic.patient();
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const bookingId = await bookViaUi(patient, w, {
      date: FAR_DATE,
      time: "09:00",
    });

    await patient.page.goto(`/bookings/${bookingId}`);
    await expect(
      patient.page.getByTestId("cancel-window-notice"),
      "the detail page states the 48-hour policy",
    ).toBeVisible({ timeout: 15_000 });
    await cancelBookingViaUi(patient, bookingId);

    await patient.page.goto("/bookings");
    await expect
      .poll(
        async () =>
          bookingRow(patient.page, bookingId).getAttribute("data-status"),
        {
          timeout: 15_000,
          message: "booking-row data-status becomes cancelled",
        },
      )
      .toBe("cancelled");
    await patient.page.reload();
    await expect
      .poll(
        async () =>
          bookingRow(patient.page, bookingId).getAttribute("data-status"),
        {
          timeout: 15_000,
          message: "the cancelled status persists after reload",
        },
      )
      .toBe("cancelled");

    // A cancelled booking no longer blocks its time.
    await expect
      .poll(() => offeredClocks(patient.ctx, slotQuery(w, FAR_DATE)), {
        timeout: 15_000,
        message: "GET /api/slots offers the cancelled 09:00 slot again",
      })
      .toContain("09:00");
    await openPicker(patient, w, FAR_DATE);
    await expect(patient.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    expect(
      (await renderedSlotStarts(patient.page)).map((s) => Date.parse(s)),
      "the 09:00 slot-option is offered again",
    ).toContain(Date.parse(nineIso));
  });

  test("slot-m3-02 inside the window the patient's cancel control is gone", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      windows: [
        { weekday: weekdayOf(NEAR_DATE), startTime: "09:00", endTime: "12:00" },
      ],
    });
    const patient = await clinic.patient();
    const bookingId = await bookViaUi(patient, w, {
      date: NEAR_DATE,
      time: "09:00",
    });

    await patient.page.goto(`/bookings/${bookingId}`);
    await expect(patient.page.getByTestId("cancel-window-notice")).toBeVisible({
      timeout: 15_000,
    });
    await expectAbsentOrDisabled(
      patient.page,
      "booking-cancel-button",
      "the patient's cancel control inside the 48-hour window",
    );

    await patient.page.reload();
    await expect(
      patient.page.getByTestId("booking-detail-status"),
    ).toContainText("booked", { timeout: 15_000 });
    const api = await getBooking(patient.ctx, bookingId);
    expect(api.status, "the booking is still booked").toBe("booked");
    expectInstant(
      api.startAt,
      clinicInstant(NEAR_DATE, "09:00"),
      "the untouched booking's startAt",
    );
  });

  test("slot-m3-03 rescheduling within the same day moves the booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const patient = await clinic.patient();
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const elevenIso = clinicInstant(FAR_DATE, "11:00");
    const bookingId = await bookViaUi(patient, w, {
      date: FAR_DATE,
      time: "09:00",
    });

    await rescheduleViaUi(patient, bookingId, {
      date: FAR_DATE,
      time: "11:00",
    });

    await patient.page.goto("/bookings");
    const row = bookingRow(patient.page, bookingId);
    await expect
      .poll(pollInstantAttr(row, "data-start"), {
        timeout: 15_000,
        message: "the booking's data-start moves to clinic 11:00",
      })
      .toBe(Date.parse(elevenIso));
    expectInstant(
      await row.getAttribute("data-end"),
      plusMinutes(elevenIso, 30),
      "the rescheduled booking's data-end",
    );
    // The id is unchanged: the booking now at 11:00 is the same row.
    expect(
      await requireBookingIdAt(patient.ctx, elevenIso),
      "rescheduling moved the same booking rather than creating a new one",
    ).toBe(bookingId);

    await expect
      .poll(() => offeredClocks(patient.ctx, slotQuery(w, FAR_DATE)), {
        timeout: 15_000,
        message: "the vacated 09:00 is offered again and 11:00 is not",
      })
      .toEqual(["09:00", "09:30", "10:00", "10:30", "11:30"]);
    expect(clinicClock(nineIso), "the vacated slot is clinic 09:00").toBe(
      "09:00",
    );
  });

  test("slot-m3-04 rescheduling to another clinic day moves the day view", async ({
    clinic,
  }) => {
    // FAR_DATE and FAR_DATE_2 are exactly 7 days apart, so the single window on
    // weekdayOf(FAR_DATE) applies to both.
    expect(weekdayOf(FAR_DATE_2), "FAR_DATE_2 is FAR_DATE's weekday").toBe(
      weekdayOf(FAR_DATE),
    );
    const w = await clinic.bookableWorld();
    const patient = await clinic.patient();
    const bookingId = await bookViaUi(patient, w, {
      date: FAR_DATE,
      time: "09:00",
    });
    const targetIso = clinicInstant(FAR_DATE_2, "09:00");

    await rescheduleViaUi(patient, bookingId, {
      date: FAR_DATE_2,
      time: "09:00",
    });

    await patient.page.goto("/bookings");
    const row = bookingRow(patient.page, bookingId);
    await expect
      .poll(pollInstantAttr(row, "data-start"), {
        timeout: 15_000,
        message: `the booking's data-start moves to ${FAR_DATE_2} 09:00 clinic time`,
      })
      .toBe(Date.parse(targetIso));

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE,
    });
    await expect(w.staff.page.getByTestId("schedule-empty")).toBeVisible({
      timeout: 15_000,
    });
    await expect(w.staff.page.getByTestId("schedule-row")).toHaveCount(0);
    expect(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
      "the vacated clinic day holds no bookings",
    ).toEqual([]);

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE_2,
    });
    await expect(w.staff.page.getByTestId("schedule-row")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(
      scheduleRow(w.staff.page, bookingId),
      "the same data-booking-id now appears on FAR_DATE_2",
    ).toBeVisible();
  });

  test("slot-m3-05 the staff day view lists a practitioner's day soonest first", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    // Created out of order on purpose: a route returning insertion order fails.
    const bId = await bookViaUi(b, w, { date: FAR_DATE, time: "11:00" });
    const aId = await bookViaUi(a, w, { date: FAR_DATE, time: "09:00" });

    await w.staff.page.goto("/bookings");
    await w.staff.page.getByTestId("nav-schedule").click();
    await w.staff.page
      .waitForURL("**/staff/schedule**", { timeout: 15_000 })
      .catch(() => {});
    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE,
    });

    const rows = w.staff.page.getByTestId("schedule-row");
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    expectInstant(
      await attrOf(rows.nth(0), "data-start", "schedule-row[0]"),
      clinicInstant(FAR_DATE, "09:00"),
      "the first schedule-row (soonest first)",
    );
    expectInstant(
      await attrOf(rows.nth(1), "data-start", "schedule-row[1]"),
      clinicInstant(FAR_DATE, "11:00"),
      "the second schedule-row",
    );
    await expect(
      scheduleRow(w.staff.page, aId).getByTestId("schedule-row-patient"),
    ).toContainText(a.who.email);
    await expect(
      scheduleRow(w.staff.page, bId).getByTestId("schedule-row-patient"),
    ).toContainText(b.who.email);

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: NO_WINDOW_DATE,
    });
    await expect(w.staff.page.getByTestId("schedule-empty")).toBeVisible({
      timeout: 15_000,
    });
    await expect(w.staff.page.getByTestId("schedule-row")).toHaveCount(0);
  });

  test("slot-m3-06 an 18:00 appointment belongs to its clinic day", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      windows: [
        { weekday: weekdayOf(FAR_DATE), startTime: "18:00", endTime: "21:00" },
      ],
    });
    const patient = await clinic.patient();
    const eighteenIso = clinicInstant(FAR_DATE, "18:00");
    // The trap this row exists for: clinic 18:00 always lands on the NEXT UTC
    // calendar date (00:00Z on MDT, 01:00Z on MST), so a server that buckets by
    // UTC date files it on the wrong clinic day.
    expect(
      eighteenIso.slice(0, 10),
      "clinic 18:00 on FAR_DATE falls on the next UTC date",
    ).toBe(NEXT_DATE);

    await openPicker(patient, w, FAR_DATE);
    await expect(patient.page.getByTestId("slot-option")).toHaveCount(6, {
      timeout: 15_000,
    });
    const starts = await renderedSlotStarts(patient.page);
    expectInstant(starts[0], eighteenIso, "the first 18:00–21:00 slot");
    expectInstant(
      starts[5],
      clinicInstant(FAR_DATE, "20:30"),
      "the last 18:00–21:00 slot",
    );

    await clickSlot(patient.page, eighteenIso);
    const bookingId = await submitPickedSlot(patient, eighteenIso);
    await patient.page.goto("/bookings");
    const row = bookingRow(patient.page, bookingId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    expectInstant(
      await row.getAttribute("data-start"),
      eighteenIso,
      "the booking's data-start",
    );

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE,
    });
    await expect(
      scheduleRow(w.staff.page, bookingId),
      "the 18:00 appointment belongs to its clinic day",
    ).toBeVisible({ timeout: 15_000 });

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: NEXT_DATE,
    });
    await expect(w.staff.page.getByTestId("schedule-empty")).toBeVisible({
      timeout: 15_000,
    });
    await expect(scheduleRow(w.staff.page, bookingId)).toHaveCount(0);
    expect(
      await practitionerDay(w.staff.ctx, w.practitionerId, NEXT_DATE),
      "the next clinic day holds no bookings",
    ).toEqual([]);
  });

  test("slot-m3-07 staff mark no_show and completed, and those slots stay taken", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aId = await bookViaUi(a, w, { date: FAR_DATE, time: "09:00" });
    const bId = await bookViaUi(b, w, { date: FAR_DATE, time: "11:00" });

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE,
    });
    await scheduleRow(w.staff.page, aId)
      .getByTestId("schedule-no-show-button")
      .click();
    await settleAfterSubmit(w.staff.page, null);
    await scheduleRow(w.staff.page, bId)
      .getByTestId("schedule-complete-button")
      .click();
    await settleAfterSubmit(w.staff.page, null);

    await openStaffSchedule(w.staff, {
      practitionerName: w.practitionerName,
      date: FAR_DATE,
    });
    await expect
      .poll(() => scheduleRow(w.staff.page, aId).getAttribute("data-status"), {
        timeout: 15_000,
        message: "patientA's schedule-row data-status persists as no_show",
      })
      .toBe("no_show");
    expect(
      await scheduleRow(w.staff.page, bId).getAttribute("data-status"),
      "patientB's schedule-row data-status persists as completed",
    ).toBe("completed");

    for (const [patient, bookingId, status] of [
      [a, aId, "no_show"],
      [b, bId, "completed"],
    ] as Array<[Persona, string, string]>) {
      await patient.page.goto("/bookings");
      await expect
        .poll(
          () => bookingRow(patient.page, bookingId).getAttribute("data-status"),
          {
            timeout: 15_000,
            message: `${patient.who.email}'s booking-row data-status is ${status}`,
          },
        )
        .toBe(status);

      // The list row never carried a cancel control, so the absence is only
      // meaningful on the detail page.
      await patient.page.goto(`/bookings/${bookingId}`);
      await expectAbsentOrDisabled(
        patient.page,
        "booking-cancel-button",
        `the cancel control on a ${status} booking`,
      );
      const resp = await patient.ctx.request.post(
        `/api/bookings/${bookingId}/cancel`,
        { maxRedirects: 0 },
      );
      expectStatusIn(resp, [409], `cancelling a ${status} booking`);
      expect(
        (await getBooking(patient.ctx, bookingId)).status,
        `the ${status} booking is untouched`,
      ).toBe(status);
    }

    // Only cancellation frees a slot: 09:00 and 11:00 stay taken, and the rest
    // of the grid is still offered (so an empty list cannot pass this leg).
    expect(await offeredClocks(a.ctx, slotQuery(w, FAR_DATE))).toEqual([
      "09:30",
      "10:00",
      "10:30",
      "11:30",
    ]);
  });

  test("slot-m3-08 the server rejects malformed writes and says why", async ({
    clinic,
  }) => {
    // No windows and no services yet, so "exactly the windows the test itself
    // created" and the service name filters are unambiguous.
    const w = await clinic.bookableWorld({ services: [], windows: [] });
    const zeroName = clinic.name("Zero");
    const svcName = clinic.name("Svc");

    // --- UI half: the two cases the pinned controls can express. ---
    await w.staff.page.goto(`/practitioners/${w.practitionerId}/availability`);
    await w.staff.page
      .getByTestId("availability-weekday")
      .selectOption(String(weekdayOf(FAR_DATE)));
    await w.staff.page.getByTestId("availability-start-time").fill("11:00");
    await w.staff.page.getByTestId("availability-end-time").fill("09:00");
    await w.staff.page.getByTestId("availability-submit").click();
    await expect(w.staff.page.getByTestId("availability-error")).toHaveText(
      /\S/,
      { timeout: 15_000 },
    );

    await w.staff.page.goto("/services");
    await w.staff.page.getByTestId("service-new-button").click();
    await w.staff.page.getByTestId("service-form-name").fill(zeroName);
    await w.staff.page.getByTestId("service-form-duration").fill("0");
    await w.staff.page.getByTestId("service-form-submit").click();
    await expect(w.staff.page.getByTestId("service-form-error")).toHaveText(
      /\S/,
      { timeout: 15_000 },
    );

    await w.staff.page.goto(`/practitioners/${w.practitionerId}/availability`);
    await expect(w.staff.page.getByTestId("availability-row")).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(
      await findIdByName(w.staff.ctx, "/api/services", zeroName),
      `no service named ${zeroName} was created`,
    ).toBeNull();

    // --- Raw half: the two cases a conforming form cannot express. ---
    const badWeekday = await w.staff.ctx.request.post(
      `/api/practitioners/${w.practitionerId}/availability`,
      {
        data: { weekday: 9, startTime: "09:00", endTime: "12:00" },
        maxRedirects: 0,
      },
    );
    expectStatusIn(badWeekday, [400], "POST availability with weekday 9");
    await expectJsonError(badWeekday, "POST availability with weekday 9");

    const badDuration = await w.staff.ctx.request.post("/api/services", {
      data: { name: svcName, durationMinutes: "abc" },
      maxRedirects: 0,
    });
    expectStatusIn(
      badDuration,
      [400],
      'POST a service with durationMinutes "abc"',
    );
    await expectJsonError(
      badDuration,
      'POST a service with durationMinutes "abc"',
    );

    expect(
      await listAvailability(w.staff.ctx, w.practitionerId),
      "the availability list re-reads unchanged",
    ).toEqual([]);
    expect(
      await findIdByName(w.staff.ctx, "/api/services", svcName),
      `no service named ${svcName} was created`,
    ).toBeNull();

    // --- Positive control: well-formed writes are still accepted. ---
    const windowId = await addAvailability(w.staff, w.practitionerId, {
      weekday: weekdayOf(FAR_DATE_2),
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(windowId, "a well-formed window is accepted").toBeTruthy();
    const serviceId = await createService(w.staff, {
      name: clinic.name("Checkup"),
      durationMinutes: 30,
    });
    expect(serviceId, "a well-formed service is accepted").toBeTruthy();
    expect(
      await listAvailability(w.staff.ctx, w.practitionerId),
      "the practitioner now holds exactly the one window this test created",
    ).toHaveLength(1);
  });

  // ---- security probes ----
  test("slot-m3-s01 the 48-hour window blocks cancel, status writes and delete", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      windows: [
        { weekday: weekdayOf(NEAR_DATE), startTime: "09:00", endTime: "12:00" },
        { weekday: weekdayOf(FAR_DATE), startTime: "09:00", endTime: "12:00" },
      ],
    });
    const a = await clinic.patient();
    const nearId = await bookViaApi(a, w, { date: NEAR_DATE, time: "09:00" });
    const farId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });
    const before = await getBooking(a.ctx, nearId);

    const path = `/api/bookings/${nearId}`;
    const legs: Array<[string, () => Promise<APIResponse>, number[]]> = [
      [
        `POST ${path}/cancel`,
        () => a.ctx.request.post(`${path}/cancel`, { maxRedirects: 0 }),
        [403, 409],
      ],
      [
        `PATCH ${path} {status:'cancelled'}`,
        () =>
          a.ctx.request.patch(path, {
            data: { status: "cancelled" },
            maxRedirects: 0,
          }),
        [403, 409],
      ],
      // M3 pins delete as obeying the cancellation window, so 405 (never
      // implemented) is admissible too.
      [
        `DELETE ${path}`,
        () => a.ctx.request.delete(path, { maxRedirects: 0 }),
        [403, 409, 405],
      ],
    ];
    for (const [label, attack, codes] of legs) {
      expectStatusIn(await attack(), codes, label);
    }

    const after = await getBooking(a.ctx, nearId);
    expect(after.status, "the booking inside the window is still booked").toBe(
      "booked",
    );
    expectInstant(after.startAt, before.startAt, "startAt after the probe");
    const day = await practitionerDay(w.staff.ctx, w.practitionerId, NEAR_DATE);
    expect(
      day.map((x) => String(x.id)),
      "the staff day list still holds the booking",
    ).toContain(nearId);
    const nearClocks = await offeredClocks(a.ctx, slotQuery(w, NEAR_DATE));
    expect(nearClocks, "the time was never released").not.toContain("09:00");
    expect(
      nearClocks,
      "the rest of the NEAR_DATE grid is still offered (positive control)",
    ).toContain("09:30");

    // Positive control: the cancel route works, outside the window.
    const ok = await a.ctx.request.post(`/api/bookings/${farId}/cancel`, {
      maxRedirects: 0,
    });
    await expectOk(ok, "cancelling the FAR_DATE booking (outside the window)");
    await expect
      .poll(async () => (await getBooking(a.ctx, farId)).status, {
        timeout: 15_000,
        message: "the FAR_DATE booking really cancels",
      })
      .toBe("cancelled");
  });

  test("slot-m3-s02 a second patient cannot cancel or reschedule another's booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });

    // The reschedule target is pinned, not improvised: it is an instant the
    // owner's own GET /api/slots actually offers, so the leg tests ownership
    // rather than "not offered".
    const offered = await getSlots(a.ctx, slotQuery(w, FAR_DATE));
    const eleven = offered.find((s) => clinicClock(s.start) === "11:00");
    expect(
      eleven,
      "GET /api/slots offers clinic 11:00 on FAR_DATE",
    ).toBeTruthy();
    const elevenIso = (eleven as { start: string }).start;

    const path = `/api/bookings/${aId}`;
    const legs: Array<[string, () => Promise<APIResponse>]> = [
      [
        `POST ${path}/cancel as patientB`,
        () => b.ctx.request.post(`${path}/cancel`, { maxRedirects: 0 }),
      ],
      [
        `POST ${path}/reschedule as patientB`,
        () => postReschedule(b.ctx, aId, { startAt: elevenIso }),
      ],
    ];
    for (const [label, attack] of legs) {
      const resp = await attack();
      expectStatusIn(resp, [401, 403, 404], label);
      expectNoLeak(await resp.text(), [a.who.email], label);
    }

    const after = await getBooking(a.ctx, aId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, nineIso, "patientA's startAt after the probe");
    const day = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(day, "the staff day list is unchanged").toHaveLength(1);
    expectInstant(day[0].startAt, nineIso, "the day list's only booking");

    // Positive control: the owner may make the very same move.
    const ok = await postReschedule(a.ctx, aId, { startAt: elevenIso });
    await expectOk(ok, "the owner rescheduling onto the offered 11:00");
    expectInstant(
      (await getBooking(a.ctx, aId)).startAt,
      elevenIso,
      "the owner's rescheduled startAt",
    );
  });

  test("slot-m3-s03 reschedule re-applies the grid, window and past-date rules", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });

    const attempts: Array<[string, string]> = [
      [
        "09:07 (inside the window, off the grid)",
        clinicInstant(FAR_DATE, "09:07"),
      ],
      [
        "13:00 (on the grid, after the window ends)",
        clinicInstant(FAR_DATE, "13:00"),
      ],
      // PAST_DATE shares FAR_DATE's weekday, so the window genuinely applies
      // there and being in the past is the only rule it breaks.
      [
        `${PAST_DATE} 09:00 (already happened)`,
        clinicInstant(PAST_DATE, "09:00"),
      ],
    ];
    for (const [label, startAt] of attempts) {
      const resp = await postReschedule(a.ctx, aId, { startAt });
      expectStatusIn(resp, [400, 403, 409, 422], `reschedule to ${label}`);
      await expectJsonError(resp, `reschedule to ${label}`);
    }

    const after = await getBooking(a.ctx, aId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, nineIso, "the booking never moved");
    const day = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(day, "the day list holds exactly one booking").toHaveLength(1);
    expectInstant(day[0].startAt, nineIso, "the day list's only booking");

    // Positive control: the route works for an instant GET /api/slots offers.
    const offered = await getSlots(a.ctx, slotQuery(w, FAR_DATE));
    const eleven = offered.find((s) => clinicClock(s.start) === "11:00");
    expect(eleven, "GET /api/slots offers clinic 11:00").toBeTruthy();
    const ok = await postReschedule(a.ctx, aId, {
      startAt: (eleven as { start: string }).start,
    });
    await expectOk(ok, "rescheduling onto an offered slot");
    const moved = await getBooking(a.ctx, aId);
    expect(
      clinicClock(moved.startAt),
      "the booking moved to clinic 11:00",
    ).toBe("11:00");
  });

  test("slot-m3-s04 reschedule cannot overlap another patient's booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const elevenIso = clinicInstant(FAR_DATE, "11:00");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });
    const bId = await bookViaApi(b, w, { date: FAR_DATE, time: "11:00" });

    const free = await offeredClocks(a.ctx, slotQuery(w, FAR_DATE));
    expect(free, "10:00 is free and offered").toContain("10:00");

    const resp = await postReschedule(a.ctx, aId, { startAt: elevenIso });
    expectStatusIn(
      resp,
      [400, 409, 422],
      "rescheduling onto another patient's active booking",
    );
    await expectJsonError(resp, "the overlapping reschedule");

    expectInstant(
      (await getBooking(a.ctx, aId)).startAt,
      nineIso,
      "patientA's booking never moved",
    );
    expectInstant(
      (await getBooking(b.ctx, bId)).startAt,
      elevenIso,
      "patientB's booking is untouched",
    );
    const day = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(day, "the day list still holds exactly two bookings").toHaveLength(
      2,
    );
    expectNoOverlaps(day, "the practitioner's day");

    // Positive control: the same route accepts the free, offered 10:00.
    const tenIso = clinicInstant(FAR_DATE, "10:00");
    const ok = await postReschedule(a.ctx, aId, { startAt: tenIso });
    await expectOk(ok, "rescheduling onto the free 10:00 slot");
    expectInstant(
      (await getBooking(a.ctx, aId)).startAt,
      tenIso,
      "patientA's rescheduled startAt",
    );
  });

  test("slot-m3-s05 the window is applied to the booking's current start", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      windows: [
        { weekday: weekdayOf(NEAR_DATE), startTime: "09:00", endTime: "12:00" },
        { weekday: weekdayOf(FAR_DATE), startTime: "09:00", endTime: "12:00" },
      ],
    });
    const a = await clinic.patient();
    const nearIso = clinicInstant(NEAR_DATE, "09:00");
    const nearId = await bookViaApi(a, w, { date: NEAR_DATE, time: "09:00" });
    const farId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });

    const offered = await getSlots(a.ctx, slotQuery(w, FAR_DATE));
    const eleven = offered.find((s) => clinicClock(s.start) === "11:00");
    expect(eleven, "FAR_DATE 11:00 is free and offered").toBeTruthy();
    const elevenIso = (eleven as { start: string }).start;

    const resp = await postReschedule(a.ctx, nearId, { startAt: elevenIso });
    expectStatusIn(
      resp,
      [403, 409],
      "rescheduling a booking whose current start is inside the window",
    );
    await expectJsonError(resp, "the in-window reschedule");

    const after = await getBooking(a.ctx, nearId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, nearIso, "the NEAR_DATE booking never moved");
    expect(
      await offeredClocks(a.ctx, slotQuery(w, FAR_DATE)),
      "nothing was written: FAR_DATE 11:00 is still offered",
    ).toContain("11:00");

    // Positive control: identical route, identical target — the only difference
    // is which side of the 48-hour window the booking's current start sits on.
    const ok = await postReschedule(a.ctx, farId, { startAt: elevenIso });
    await expectOk(ok, "rescheduling the FAR_DATE booking onto the same 11:00");
    expectInstant(
      (await getBooking(a.ctx, farId)).startAt,
      elevenIso,
      "the FAR_DATE booking's rescheduled startAt",
    );
  });

  test("slot-m3-s06 two reschedules cannot land on the same slot", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const nineThirtyIso = clinicInstant(FAR_DATE, "09:30");
    const elevenIso = clinicInstant(FAR_DATE, "11:00");
    const tenThirtyIso = clinicInstant(FAR_DATE, "10:30");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });
    const bId = await bookViaApi(b, w, { date: FAR_DATE, time: "09:30" });
    const freeBefore = await offeredClocks(a.ctx, slotQuery(w, FAR_DATE));
    expect(freeBefore, "11:00 is free and offered").toContain("11:00");
    expect(freeBefore, "10:30 is free and offered").toContain("10:30");

    // --- Part 1: sequential, and the only half that can fail an app. ---
    const first = await postReschedule(a.ctx, aId, { startAt: elevenIso });
    await expectOk(first, "patientA rescheduling onto the offered 11:00");
    expectInstant(
      (await getBooking(a.ctx, aId)).startAt,
      elevenIso,
      "patientA's booking after the first reschedule",
    );

    const second = await postReschedule(b.ctx, bId, { startAt: elevenIso });
    expect(
      second.status(),
      `the second reschedule onto 11:00 must be rejected (got ${second.status()})`,
    ).toBeGreaterThanOrEqual(400);
    expect(second.status()).toBeLessThan(500);
    await expectJsonError(second, "the losing reschedule");
    expectInstant(
      (await getBooking(b.ctx, bId)).startAt,
      nineThirtyIso,
      "patientB's booking is unmoved at 09:30",
    );

    const dayAfterPart1 = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(
      dayAfterPart1,
      "the day list holds exactly two bookings",
    ).toHaveLength(2);
    expect(
      dayAfterPart1.filter(
        (x) => Date.parse(String(x.startAt)) === Date.parse(elevenIso),
      ),
      "exactly one booking sits at 11:00",
    ).toHaveLength(1);
    expectNoOverlaps(dayAfterPart1, "the practitioner's day after part 1");
    const offeredAfterPart1 = await offeredClocks(
      a.ctx,
      slotQuery(w, FAR_DATE),
    );
    expect(offeredAfterPart1, "11:00 is taken").not.toContain("11:00");
    expect(
      offeredAfterPart1,
      "the 09:00 patientA vacated is offered",
    ).toContain("09:00");

    // --- Part 2: concurrent, a one-way detector. Every assertion below holds
    // under every interleaving for a correct implementation, so a pass proves
    // nothing about atomicity and only a failure is evidence of its absence. ---
    const [ra, rb] = await Promise.all([
      postReschedule(a.ctx, aId, { startAt: tenThirtyIso }),
      postReschedule(b.ctx, bId, { startAt: tenThirtyIso }),
    ]);
    const okCount = [ra, rb].filter(is2xx).length;
    expect(
      okCount,
      "at most one concurrent reschedule onto 10:30 may succeed",
    ).toBeLessThanOrEqual(1);

    const dayAfterRace = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(
      dayAfterRace.filter(
        (x) => Date.parse(String(x.startAt)) === Date.parse(tenThirtyIso),
      ),
      "the bookings at 10:30 equal the number of 2xx responses",
    ).toHaveLength(okCount);
    expect(
      dayAfterRace,
      "the day list still holds exactly two bookings",
    ).toHaveLength(2);
    expectNoOverlaps(dayAfterRace, "the practitioner's day after the race");
    for (const [owner, bookingId, preRace] of [
      [a, aId, elevenIso],
      [b, bId, nineThirtyIso],
    ] as Array<[Persona, string, string]>) {
      const current = await getBooking(owner.ctx, bookingId);
      expect(
        [Date.parse(preRace), Date.parse(tenThirtyIso)],
        `${owner.who.email}'s booking is either at its pre-race start or 10:30`,
      ).toContain(instantMs(current.startAt, "the raced booking's startAt"));
    }
  });

  test("slot-m3-s07 patients cannot mark bookings no_show or completed", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });
    const bId = await bookViaApi(b, w, { date: FAR_DATE, time: "11:00" });

    const dayStatus = async (bookingId: string) => {
      const rows = await practitionerDay(
        w.staff.ctx,
        w.practitionerId,
        FAR_DATE,
      );
      return String(rows.find((x) => String(x.id) === bookingId)?.status ?? "");
    };

    for (const [label, bookingId] of [
      ["patientA's own", aId],
      ["patientB's", bId],
    ] as Array<[string, string]>) {
      const path = `/api/bookings/${bookingId}`;
      const legs: Array<[string, () => Promise<APIResponse>]> = [
        [
          `POST ${path}/no-show`,
          () => a.ctx.request.post(`${path}/no-show`, { maxRedirects: 0 }),
        ],
        [
          `POST ${path}/complete`,
          () => a.ctx.request.post(`${path}/complete`, { maxRedirects: 0 }),
        ],
        [
          `PATCH ${path} {status:'completed'}`,
          () =>
            a.ctx.request.patch(path, {
              data: { status: "completed" },
              maxRedirects: 0,
            }),
        ],
      ];
      for (const [leg, attack] of legs) {
        const resp = await attack();
        if (![401, 403, 404].includes(resp.status())) {
          // The only other admissible outcome is that the status field was
          // ignored; prove it through the staff day list.
          expect(
            await dayStatus(bookingId),
            `${leg} on ${label} booking answered ${resp.status()}, so the status must have been ignored`,
          ).toBe("booked");
        }
      }
    }

    expect(await dayStatus(aId), "patientA's booking is still booked").toBe(
      "booked",
    );
    expect(await dayStatus(bId), "patientB's booking is still booked").toBe(
      "booked",
    );
    expect((await getBooking(a.ctx, aId)).status).toBe("booked");
    expect((await getBooking(b.ctx, bId)).status).toBe("booked");

    // Positive control: staff may do exactly what the patient could not.
    const ok = await w.staff.ctx.request.post(`/api/bookings/${aId}/no-show`, {
      maxRedirects: 0,
    });
    await expectOk(ok, "staff marking a booking no_show");
    await expect
      .poll(() => dayStatus(aId), {
        timeout: 15_000,
        message: "the staff day list reports no_show",
      })
      .toBe("no_show");
  });

  test("slot-m3-s08 a patient cannot read a practitioner's day", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });

    // The practitioner id comes from the pinned data-practitioner-id.
    await w.staff.page.goto("/practitioners");
    const prow = w.staff.page
      .getByTestId("practitioner-row")
      .filter({ hasText: w.practitionerName })
      .first();
    await expect(prow).toBeVisible({ timeout: 15_000 });
    const practitionerId = await attrOf(
      prow,
      "data-practitioner-id",
      "practitioner-row",
    );
    expect(
      practitionerId,
      "the pinned data-practitioner-id agrees with GET /api/practitioners",
    ).toBe(w.practitionerId);

    const apiPath = `/api/practitioners/${practitionerId}/bookings?date=${FAR_DATE}`;
    const htmlPath = `/staff/schedule?practitionerId=${practitionerId}&date=${FAR_DATE}`;
    // Only run-unique strings go in the substring probe; the booking id is
    // checked as a parsed field by `expectNoBookingLeak` below.
    const secrets = [a.who.email, a.who.name];

    expect((await getMe(b.ctx)).role, "patientB is a plain patient").toBe(
      "patient",
    );
    const asPatient = await b.ctx.request.get(apiPath, { maxRedirects: 0 });
    expectStatusIn(asPatient, [401, 403, 404], `patientB GET ${apiPath}`);
    expectNoLeak(await asPatient.text(), secrets, `patientB GET ${apiPath}`);
    await expectNoBookingLeak(asPatient, aId, `patientB GET ${apiPath}`);

    const anon = await clinic.anonRequest();
    const anonApi = await anon.get(apiPath, { maxRedirects: 0 });
    expectStatusIn(
      anonApi,
      DENIED_OR_REDIRECT,
      `unauthenticated GET ${apiPath}`,
    );
    expectNoLeak(
      await anonApi.text(),
      secrets,
      `unauthenticated GET ${apiPath}`,
    );
    await expectNoBookingLeak(anonApi, aId, `unauthenticated GET ${apiPath}`);

    // HTML legs: no milestone pins server rendering, so assert absence only and
    // allow a redirect or a forbidden-message page.
    for (const [label, resp] of [
      ["patientB", await b.ctx.request.get(htmlPath)],
      ["unauthenticated", await anon.get(htmlPath)],
    ] as Array<[string, APIResponse]>) {
      expectNoLeak(await resp.text(), secrets, `${label} GET ${htmlPath}`);
    }

    // Positive control: staff read the same endpoint and DO see the patient.
    const asStaff = await w.staff.ctx.request.get(apiPath, { maxRedirects: 0 });
    expect(asStaff.status(), `staff GET ${apiPath}`).toBe(200);
    expect(
      await asStaff.text(),
      "the staff day list really carries patientA's email",
    ).toContain(a.who.email);
  });

  test("slot-m3-s09 forged update fields never latch onto a booking", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld({
      services: [
        { base: "Checkup", durationMinutes: 30 },
        { base: "Review", durationMinutes: 60 },
      ],
    });
    const otherPractitionerId = await createPractitioner(w.staff, {
      name: clinic.name("Temp"),
      specialty: clinic.name("Neuro"),
    });
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const elevenThirtyIso = clinicInstant(FAR_DATE, "11:30");
    const aId = await bookViaApi(a, w, {
      date: FAR_DATE,
      time: "09:00",
      service: "Checkup",
    });
    const bId = await bookViaApi(b, w, {
      date: FAR_DATE,
      time: "11:30",
      service: "Checkup",
    });
    // Ids the attacker could only have leaked: each is read by its own owner.
    const patientBId = await b.userId();
    const offered = await getSlots(a.ctx, slotQuery(w, FAR_DATE));
    const eleven = offered.find((s) => clinicClock(s.start) === "11:00");
    expect(eleven, "FAR_DATE 11:00 is free and offered").toBeTruthy();
    const elevenIso = (eleven as { start: string }).start;

    const attack = await a.ctx.request.patch(`/api/bookings/${aId}`, {
      data: {
        id: bId,
        patientId: patientBId,
        practitionerId: otherPractitionerId,
        serviceId: w.services.Review.id,
        endAt: plusMinutes(nineIso, 480),
        status: "completed",
        role: "staff",
      },
      maxRedirects: 0,
    });
    expect(
      attack.status(),
      `the forged PATCH must never 5xx (got ${attack.status()})`,
    ).toBeLessThan(500);

    const assertHonest = async (label: string, expectedStart: string) => {
      const booking = await getBooking(a.ctx, aId);
      expect(String(booking.id), `${label} id`).toBe(aId);
      expect(String(booking.patientId), `${label} owner`).toBe(
        await a.userId(),
      );
      expect(String(booking.practitionerId), `${label} practitioner`).toBe(
        w.practitionerId,
      );
      expect(String(booking.serviceId), `${label} service`).toBe(
        w.services.Checkup.id,
      );
      expect(booking.status, `${label} status`).toBe("booked");
      expectInstant(booking.startAt, expectedStart, `${label} startAt`);
      expect(
        instantMs(booking.endAt, `${label} endAt`) -
          instantMs(booking.startAt, `${label} startAt`),
        `${label} still lasts the 30-minute service`,
      ).toBe(30 * MINUTE_MS);
    };
    await assertHonest("after the forged PATCH the booking", nineIso);
    expectInstant(
      (await getBooking(b.ctx, bId)).startAt,
      elevenThirtyIso,
      "patientB's booking is untouched",
    );
    expect((await getMe(a.ctx)).role, "the smuggled role did nothing").toBe(
      "patient",
    );

    // Positive control: a legitimate mutation of the same row proves the forged
    // owner, practitioner, service and status were never latched.
    const ok = await postReschedule(a.ctx, aId, { startAt: elevenIso });
    await expectOk(ok, "the owner rescheduling onto the offered 11:00");
    await assertHonest("after a legitimate reschedule the booking", elevenIso);
  });

  test("slot-m3-s10 a cancelled booking cannot be revived and releases its slot", async ({
    clinic,
  }) => {
    const w = await clinic.bookableWorld();
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const aId = await bookViaApi(a, w, { date: FAR_DATE, time: "09:00" });

    const cancel = await a.ctx.request.post(`/api/bookings/${aId}/cancel`, {
      maxRedirects: 0,
    });
    await expectOk(cancel, "the owner cancelling outside the 48-hour window");
    await expect
      .poll(async () => (await getBooking(a.ctx, aId)).status, {
        timeout: 15_000,
        message: "the booking is cancelled",
      })
      .toBe("cancelled");

    const offered = await getSlots(a.ctx, slotQuery(w, FAR_DATE));
    const eleven = offered.find((s) => clinicClock(s.start) === "11:00");
    expect(eleven, "FAR_DATE 11:00 is free and offered").toBeTruthy();
    const elevenIso = (eleven as { start: string }).start;

    const again = await a.ctx.request.post(`/api/bookings/${aId}/cancel`, {
      maxRedirects: 0,
    });
    expectStatusIn(again, [409], "cancelling an already-cancelled booking");
    const revive = await postReschedule(a.ctx, aId, { startAt: elevenIso });
    expectStatusIn(revive, [409], "rescheduling a cancelled booking");
    const patch = await a.ctx.request.patch(`/api/bookings/${aId}`, {
      data: { status: "booked" },
      maxRedirects: 0,
    });
    if (patch.status() !== 409) {
      // The PATCH leg may instead ignore the status field.
      expect(
        (await getBooking(a.ctx, aId)).status,
        `PATCH answered ${patch.status()}, so the status must have been ignored`,
      ).toBe("cancelled");
    }
    const dead = await getBooking(a.ctx, aId);
    expect(dead.status, "the cancelled booking was never revived").toBe(
      "cancelled",
    );
    expectInstant(dead.startAt, nineIso, "the cancelled booking never moved");

    // Positive control: the cancelled row released its time.
    await expect
      .poll(() => offeredClocks(b.ctx, slotQuery(w, FAR_DATE)), {
        timeout: 15_000,
        message: "GET /api/slots offers the freed 09:00 again",
      })
      .toContain("09:00");
    const rebook = await postBooking(b.ctx, {
      practitionerId: w.practitionerId,
      serviceId: w.serviceId,
      startAt: nineIso,
    });
    await expectOk(rebook, "patientB booking the freed 09:00 slot");
    const bId = await requireBookingIdAt(b.ctx, nineIso);
    const bBooking = (await listJson(b.ctx, "/api/bookings")).find(
      (x) => String(x.id) === bId,
    ) as Json;
    expect(
      bBooking,
      "patientB's own list holds the re-booked slot",
    ).toBeTruthy();
    expect(clinicClock(bBooking.startAt), "re-booked at clinic 09:00").toBe(
      "09:00",
    );
    expect(
      instantMs(bBooking.endAt, "the re-booked endAt") -
        instantMs(bBooking.startAt, "the re-booked startAt"),
      "the re-booked slot lasts the service's 30 minutes",
    ).toBe(30 * MINUTE_MS);

    // No milestone pins whether the day list includes cancelled rows, so count
    // non-cancelled bookings only.
    const day = activeOf(
      await practitionerDay(w.staff.ctx, w.practitionerId, FAR_DATE),
    );
    expect(
      day.filter((x) => Date.parse(String(x.startAt)) === Date.parse(nineIso)),
      "exactly one non-cancelled booking sits at 09:00",
    ).toHaveLength(1);
    expectNoOverlaps(day, "the practitioner's day");
  });
});
