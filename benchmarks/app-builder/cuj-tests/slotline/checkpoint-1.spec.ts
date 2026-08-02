// Slotline — checkpoint 1 CUJ suite (design/app-5-slotline.md, M1 CUJ table +
// M1 security probes). 10 CUJs + 3 probes.
//
// Conventions (design "Test fixtures & conventions"): every test mints its own
// TOKEN through the `clinic` fixture and provisions its own personas,
// practitioner, service and prerequisite booking — nothing is inherited from a
// sibling test, so a failure can never skip another scenario. Ids come only from
// pinned surfaces (GET /api/me, GET /api/practitioners, GET /api/services, GET
// /api/bookings, `data-*` attributes). Temporal assertions read pinned ISO
// instants and compare them with Date.parse; the one rendered clock check is
// normalised to the clinic wall clock.
import type { APIResponse } from "@playwright/test";
import {
  test,
  expect,
  FAR_DATE,
  MINUTE_MS,
  clinicClock,
  clinicInstant,
  clockToken,
  createBookingAtStart,
  createPractitioner,
  createService,
  expectInstant,
  expectOk,
  expectSignedIn,
  expectZulu,
  findIdByName,
  getBooking,
  getMe,
  instantMs,
  listJson,
  plusMinutes,
  postBooking,
  bookingRow,
  cancelBookingViaUi,
  settleAfterSubmit,
  signIn,
  signOut,
  type Clinic,
  type Json,
} from "./fixtures";

// The browser is pinned to a zone that disagrees with clinic time in both the
// hour and the calendar date, and with UTC — without it the whole timezone
// dimension silently evaporates. The fixture also passes `timezoneId` into every
// context it opens by hand, since `browser.newContext()` does not inherit `use`.
test.use({ timezoneId: "Australia/Sydney" });

/** Unauthenticated JSON legs may deny outright or redirect to sign-in. */
const DENIED_OR_REDIRECT = [401, 403, 301, 302, 303, 307, 308];

/** Both serialisations of the same instant a conforming app may emit. */
const instantForms = (iso: string) => [iso, iso.replace(/\.000Z$/, "Z")];

function expectNoLeak(text: string, secrets: string[], label: string) {
  for (const secret of secrets) {
    expect(text, `${label} must not leak "${secret}"`).not.toContain(secret);
  }
}

/**
 * Row 6's world: patientA, its own practitioner and 30-minute service, and a
 * FAR_DATE 09:00 booking made through the pinned M1 form. Rows 7, 9 and 10
 * re-run these steps *inside themselves* through this helper rather than
 * inheriting a sibling row's records.
 */
async function bookedWorld(clinic: Clinic) {
  const patient = await clinic.patient();
  const practitionerName = clinic.name("Dr Vale");
  const serviceName = clinic.name("Checkup");
  await createPractitioner(patient, {
    name: practitionerName,
    specialty: clinic.name("Derm"),
  });
  await createService(patient, { name: serviceName, durationMinutes: 30 });
  const startIso = clinicInstant(FAR_DATE, "09:00");
  const bookingId = await createBookingAtStart(patient, {
    practitionerName,
    serviceName,
    date: FAR_DATE,
    time: "09:00",
  });
  return { patient, practitionerName, serviceName, startIso, bookingId };
}

test.describe("slotline checkpoint 1", () => {
  test("slot-m1-01 sign-up lands on /bookings with a live session", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    await expect(a.page).toHaveURL(/\/bookings\/?$/, { timeout: 15_000 });
    await expectSignedIn(a.page, a.who.email);
    const me = await a.ctx.request.get("/api/me");
    expect(me.status(), "GET /api/me for the new sign-up").toBe(200);
    const body = (await me.json()) as Json;
    expect(body.email).toBe(a.who.email);
    expect(String(body.id ?? ""), "/api/me returns a non-empty id").not.toBe(
      "",
    );
  });

  test("slot-m1-02 sign-out then sign-in restores the session", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    await signOut(a.page);
    // Signed out, every app route redirects to /auth/sign-in.
    await a.page.goto("/bookings");
    await a.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await signIn(a.page, a.who);
    await expect
      .poll(async () => (await a.ctx.request.get("/api/me")).status(), {
        timeout: 15_000,
        message: "the session was restored by sign-in",
      })
      .toBe(200);
    expect((await getMe(a.ctx)).email).toBe(a.who.email);
    await a.page.goto("/bookings");
    await expect(a.page).toHaveURL(/\/bookings\/?$/);
    await expectSignedIn(a.page, a.who.email);
  });

  test("slot-m1-03 signed-out routes redirect and leak nothing", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    const practitionerName = clinic.name("Dr Vale");
    await createPractitioner(a, {
      name: practitionerName,
      specialty: clinic.name("Derm"),
    });
    // Positive control: the record really exists and really renders, so the
    // absence below is the redirect firing and not a record never created.
    await a.page.goto("/practitioners");
    await expect(a.page.getByTestId("practitioners-list")).toContainText(
      practitionerName,
      { timeout: 15_000 },
    );

    const anon = await clinic.anonPage();
    for (const path of ["/", "/bookings", "/bookings/new", "/practitioners"]) {
      await anon.goto(path);
      await anon.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      expectNoLeak(
        await anon.content(),
        [practitionerName, a.who.email],
        `signed-out ${path}`,
      );
    }
  });

  test("slot-m1-04 create a practitioner", async ({ clinic }) => {
    const a = await clinic.patient();
    const practitionerName = clinic.name("Dr Vale");
    const specialty = clinic.name("Derm");
    const practitionerId = await createPractitioner(a, {
      name: practitionerName,
      specialty,
    });

    await a.page.goto("/practitioners");
    const row = a.page
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
    await expect(a.page.getByTestId("practitioner-detail-name")).toContainText(
      practitionerName,
      { timeout: 15_000 },
    );
    await expect(
      a.page.getByTestId("practitioner-detail-specialty"),
    ).toContainText(specialty);
  });

  test("slot-m1-05 create a service with a whole-minute duration", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    const serviceName = clinic.name("Checkup");
    await createService(a, { name: serviceName, durationMinutes: 30 });

    await a.page.goto("/services");
    const row = a.page
      .getByTestId("service-row")
      .filter({ hasText: serviceName })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Boundary-anchored: a bare "30" is also satisfied by "300" or "130", so
    // the DOM leg could not by itself prove the duration is the one rendered.
    // Tolerates "30 min", "30 minutes", "0:30".
    await expect(row.getByTestId("service-row-duration")).toContainText(
      /(^|\D)30(\D|$)/,
    );

    const services = await listJson(a.ctx, "/api/services");
    const svc = services.find((s) => s.name === serviceName);
    expect(svc, `${serviceName} in GET /api/services`).toBeTruthy();
    expect(Number((svc as Json).durationMinutes)).toBe(30);
  });

  test("slot-m1-06 book a slot in clinic time", async ({ clinic }) => {
    const a = await clinic.patient();
    const practitionerName = clinic.name("Dr Vale");
    const serviceName = clinic.name("Checkup");
    await createPractitioner(a, {
      name: practitionerName,
      specialty: clinic.name("Derm"),
    });
    await createService(a, { name: serviceName, durationMinutes: 30 });

    const startIso = clinicInstant(FAR_DATE, "09:00");
    const endIso = plusMinutes(startIso, 30);
    const bookingId = await createBookingAtStart(a, {
      practitionerName,
      serviceName,
      date: FAR_DATE,
      time: "09:00",
    });

    await a.page.goto("/bookings");
    const row = bookingRow(a.page, bookingId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    expectInstant(
      await row.getAttribute("data-start"),
      startIso,
      "booking-row data-start",
    );
    expectInstant(
      await row.getAttribute("data-end"),
      endIso,
      "booking-row data-end",
    );
    await expect(row.getByTestId("booking-row-practitioner")).toContainText(
      practitionerName,
    );
    await expect(row.getByTestId("booking-row-service")).toContainText(
      serviceName,
    );

    const bookings = await listJson(a.ctx, "/api/bookings");
    const api = bookings.find((b) => String(b.id) === bookingId);
    expect(api, `booking ${bookingId} in GET /api/bookings`).toBeTruthy();
    expectZulu((api as Json).startAt, "startAt");
    expectZulu((api as Json).endAt, "endAt");
    expectInstant((api as Json).startAt, startIso, "GET /api/bookings startAt");
    expectInstant((api as Json).endAt, endIso, "GET /api/bookings endAt");

    // Secondary, normalised: the rendered clock is the clinic wall clock, not
    // the 15:00/16:00 a UTC renderer shows nor the 01:00/02:00/03:00 the pinned
    // Australia/Sydney browser would show.
    const rendered = clockToken(
      await row.getByTestId("booking-row-time").textContent(),
    );
    expect(rendered, "booking-row-time renders the clinic wall clock").toBe(
      clinicClock(startIso),
    );
    expect(clinicClock(startIso)).toBe("09:00");
  });

  test("slot-m1-07 booking detail matches the list row", async ({ clinic }) => {
    const w = await bookedWorld(clinic);
    await w.patient.page.goto("/bookings");
    const row = bookingRow(w.patient.page, w.bookingId);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowStart = await row.getAttribute("data-start");
    const rowEnd = await row.getAttribute("data-end");

    await row.getByTestId("booking-row-link").click();
    await expect(
      w.patient.page.getByTestId("booking-detail-practitioner"),
    ).toContainText(w.practitionerName, { timeout: 15_000 });
    await expect(
      w.patient.page.getByTestId("booking-detail-service"),
    ).toContainText(w.serviceName);
    await expect(
      w.patient.page.getByTestId("booking-detail-status"),
    ).toContainText("booked");
    expectInstant(
      await w.patient.page
        .getByTestId("booking-detail-start")
        .getAttribute("data-start"),
      String(rowStart),
      "booking-detail-start data-start",
    );
    expectInstant(
      await w.patient.page
        .getByTestId("booking-detail-end")
        .getAttribute("data-end"),
      String(rowEnd),
      "booking-detail-end data-end",
    );
    expectInstant(String(rowStart), w.startIso, "the list row's data-start");
  });

  test("slot-m1-08 edit and delete a practitioner", async ({ clinic }) => {
    const a = await clinic.patient();
    const practitionerName = clinic.name("Temp");
    const practitionerId = await createPractitioner(a, {
      name: practitionerName,
      specialty: clinic.name("Derm"),
    });

    const edited = clinic.name("Neuro");
    await a.page.goto(`/practitioners/${practitionerId}`);
    await a.page.getByTestId("practitioner-edit-button").click();
    await a.page.getByTestId("practitioner-form-specialty").fill(edited);
    await a.page.getByTestId("practitioner-form-submit").click();
    await settleAfterSubmit(a.page, null);
    await a.page.goto(`/practitioners/${practitionerId}`);
    await expect(
      a.page.getByTestId("practitioner-detail-specialty"),
    ).toContainText(edited, { timeout: 15_000 });

    await a.page.getByTestId("practitioner-delete-button").click();
    const confirm = a.page.getByTestId("practitioner-delete-confirm");
    if (await confirm.count()) await confirm.first().click();
    await settleAfterSubmit(a.page, null);

    await a.page.goto("/practitioners");
    await expect(
      a.page
        .getByTestId("practitioner-row")
        .filter({ hasText: practitionerName }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(() => findIdByName(a.ctx, "/api/practitioners", practitionerName), {
        timeout: 15_000,
        message: `${practitionerName} is gone from GET /api/practitioners`,
      })
      .toBeNull();
    await a.page.goto(`/practitioners/${practitionerId}`);
    await expect
      .poll(async () => (await a.page.content()).includes(practitionerName), {
        timeout: 15_000,
        message: "the deleted practitioner's detail URL no longer serves it",
      })
      .toBe(false);
  });

  test("slot-m1-09 cancel keeps the row and flips the status", async ({
    clinic,
  }) => {
    const w = await bookedWorld(clinic);
    await cancelBookingViaUi(w.patient, w.bookingId);

    await w.patient.page.goto("/bookings");
    const row = bookingRow(w.patient.page, w.bookingId);
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

    const api = await getBooking(w.patient.ctx, w.bookingId);
    expect(api.status).toBe("cancelled");
    expectInstant(api.startAt, w.startIso, "the cancelled booking's startAt");
  });

  test("slot-m1-10 a second patient sees no bookings but shared clinic data", async ({
    clinic,
  }) => {
    const w = await bookedWorld(clinic);
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

  // ---- security probes ----
  test("slot-m1-s01 unauthenticated requests read and write nothing", async ({
    clinic,
  }) => {
    const w = await bookedWorld(clinic);
    const before = await getBooking(w.patient.ctx, w.bookingId);
    const secrets = [
      w.patient.who.email,
      w.practitionerName,
      ...instantForms(w.startIso),
    ];

    const anon = await clinic.anonRequest();
    for (const path of [
      "/api/me",
      "/api/bookings",
      `/api/bookings/${w.bookingId}`,
      "/api/practitioners",
      "/api/services",
    ]) {
      const resp = await anon.get(path, { maxRedirects: 0 });
      expect(
        DENIED_OR_REDIRECT,
        `unauthenticated GET ${path} (got ${resp.status()})`,
      ).toContain(resp.status());
      expectNoLeak(await resp.text(), secrets, `unauthenticated GET ${path}`);
    }

    // HTML leg: no milestone pins server rendering, so assert absence only and
    // allow the redirect (APIRequestContext follows redirects by default).
    const html = await anon.get(`/bookings/${w.bookingId}`);
    expectNoLeak(
      await html.text(),
      secrets,
      `unauthenticated GET /bookings/${w.bookingId}`,
    );

    // Neither read nor wrote: the owner still finds the original booking.
    const after = await getBooking(w.patient.ctx, w.bookingId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, before.startAt, "startAt after the probe");
    expectInstant(after.endAt, before.endAt, "endAt after the probe");
  });

  test("slot-m1-s02 a second patient cannot read or write another's booking", async ({
    clinic,
  }) => {
    const w = await bookedWorld(clinic);
    const before = await getBooking(w.patient.ctx, w.bookingId);
    const b = await clinic.patient("patientB");
    const path = `/api/bookings/${w.bookingId}`;

    const attacks: Array<[string, () => Promise<APIResponse>]> = [
      [`GET ${path}`, () => b.ctx.request.get(path, { maxRedirects: 0 })],
      [
        `PATCH ${path}`,
        () =>
          b.ctx.request.patch(path, {
            data: { startAt: plusMinutes(w.startIso, 60) },
            maxRedirects: 0,
          }),
      ],
      [`DELETE ${path}`, () => b.ctx.request.delete(path, { maxRedirects: 0 })],
      [
        `POST ${path}/cancel`,
        () => b.ctx.request.post(`${path}/cancel`, { maxRedirects: 0 }),
      ],
    ];
    for (const [label, attack] of attacks) {
      const resp = await attack();
      expect([401, 403, 404], `${label} (got ${resp.status()})`).toContain(
        resp.status(),
      );
      expectNoLeak(await resp.text(), [w.patient.who.email], label);
    }

    const after = await getBooking(w.patient.ctx, w.bookingId);
    expect(after.status).toBe("booked");
    expectInstant(after.startAt, before.startAt, "startAt after the probe");
    expectInstant(after.endAt, before.endAt, "endAt after the probe");
    const theirs = await listJson(b.ctx, "/api/bookings");
    expect(theirs.map((x) => String(x.id))).not.toContain(w.bookingId);
  });

  test("slot-m1-s03 forged create fields are never trusted", async ({
    clinic,
  }) => {
    const a = await clinic.patient();
    const b = await clinic.patient("patientB");
    const practitionerName = clinic.name("Dr Vale");
    const serviceName = clinic.name("Checkup");
    const practitionerId = await createPractitioner(a, {
      name: practitionerName,
      specialty: clinic.name("Derm"),
    });
    const serviceId = await createService(a, {
      name: serviceName,
      durationMinutes: 30,
    });
    const aId = await a.userId();
    const bId = await b.userId();
    const nineIso = clinicInstant(FAR_DATE, "09:00");
    const tenIso = clinicInstant(FAR_DATE, "10:00");
    const forgedId = `forged-${clinic.token}`;

    // The endpoint is proven to work BEFORE the attack, so a later rejection can
    // never be mistaken for field-stripping.
    const clean = await postBooking(a.ctx, {
      practitionerId,
      serviceId,
      startAt: nineIso,
    });
    await expectOk(clean, "a clean POST /api/bookings");
    await expect
      .poll(
        async () =>
          (await listJson(a.ctx, "/api/bookings")).some(
            (x) => Date.parse(String(x.startAt)) === Date.parse(nineIso),
          ),
        { timeout: 15_000, message: "the clean booking is in patientA's list" },
      )
      .toBe(true);

    const attack = await postBooking(a.ctx, {
      practitionerId,
      serviceId,
      startAt: tenIso,
      endAt: plusMinutes(tenIso, 480),
      durationMinutes: 480,
      status: "cancelled",
      patientId: bId,
      id: forgedId,
    });
    expect(
      attack.status(),
      `the forged create must never 5xx (got ${attack.status()})`,
    ).toBeLessThan(500);

    const assertHonest = (booking: Json, label: string) => {
      expectInstant(booking.startAt, tenIso, `${label} startAt`);
      expect(
        instantMs(booking.endAt, `${label} endAt`) -
          instantMs(booking.startAt, `${label} startAt`),
        `${label} lasts the service's 30 minutes`,
      ).toBe(30 * MINUTE_MS);
      expect(booking.status, `${label} status`).toBe("booked");
      expect(String(booking.patientId), `${label} patientId`).toBe(aId);
    };

    if (attack.status() < 300) {
      // Accepted: the forbidden fields were stripped, not honoured.
      const created = (await attack.json()) as Json;
      expect(String(created.id), "the forged id was not used").not.toBe(
        forgedId,
      );
      const listed = (await listJson(a.ctx, "/api/bookings")).find(
        (x) => Date.parse(String(x.startAt)) === Date.parse(tenIso),
      );
      expect(listed, "the accepted booking is in patientA's list").toBeTruthy();
      assertHonest(listed as Json, "GET /api/bookings row");
      assertHonest(
        await getBooking(a.ctx, String(created.id)),
        "GET /api/bookings/{id}",
      );
    } else {
      // Rejected: nothing was written, and the same body without the forbidden
      // fields must now succeed — proving the rejection came from those fields
      // and not from a broken route.
      expect(
        [400, 409, 422],
        `the forged create was rejected with ${attack.status()}`,
      ).toContain(attack.status());
      const stillOnly = await listJson(a.ctx, "/api/bookings");
      expect(
        stillOnly,
        "patientA still holds exactly the 09:00 booking",
      ).toHaveLength(1);
      expectInstant(stillOnly[0].startAt, nineIso, "the surviving booking");
      expect(JSON.stringify(stillOnly)).not.toContain(forgedId);

      const retry = await postBooking(a.ctx, {
        practitionerId,
        serviceId,
        startAt: tenIso,
      });
      await expectOk(retry, "the identical body without the forbidden fields");
      await expect
        .poll(
          async () =>
            (await listJson(a.ctx, "/api/bookings")).some(
              (x) => Date.parse(String(x.startAt)) === Date.parse(tenIso),
            ),
          { timeout: 15_000, message: "the retried booking landed" },
        )
        .toBe(true);
      const listed = (await listJson(a.ctx, "/api/bookings")).find(
        (x) => Date.parse(String(x.startAt)) === Date.parse(tenIso),
      );
      assertHonest(listed as Json, "the retried booking");
    }

    // Either way: patientB owns nothing, nothing carries the forged id, and the
    // 09:00 booking is untouched.
    expect(await listJson(b.ctx, "/api/bookings")).toEqual([]);
    const finalList = await listJson(a.ctx, "/api/bookings");
    expect(JSON.stringify(finalList)).not.toContain(forgedId);
    const nine = finalList.find(
      (x) => Date.parse(String(x.startAt)) === Date.parse(nineIso),
    );
    expect(nine, "the 09:00 booking is untouched").toBeTruthy();
    expect((nine as Json).status).toBe("booked");
    expect(
      instantMs((nine as Json).endAt, "09:00 endAt") -
        instantMs((nine as Json).startAt, "09:00 startAt"),
    ).toBe(30 * MINUTE_MS);
  });
});
