/**
 * Every piece of time arithmetic in Slotline goes through this module.
 *
 * The clinic runs in one fixed IANA zone. Availability is authored in clinic
 * wall-clock time, everything is *stored* and *emitted* as a UTC instant, and
 * everything shown to a person is rendered back in clinic time. The zone
 * observes DST, so no offset may ever be hardcoded and no calendar arithmetic
 * may be done by adding 86_400_000 ms to an instant.
 *
 * Isomorphic on purpose: the booking form converts its clinic-local wall clock
 * with the same helper the server validates it with, so the browser's own zone
 * (and the server's) can never leak into a stored instant.
 */

/** The clinic's fixed zone. Named once; never re-typed anywhere else. */
export const CLINIC_TZ = "America/Denver";

const CLINIC_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: CLINIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The clinic-local wall clock of a UTC instant. */
export function clinicWall(instant: Date | number): WallClock {
  const date = typeof instant === "number" ? new Date(instant) : instant;
  const parts = CLINIC_PARTS.formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const hour = field("hour");
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    // Some ICU builds render midnight as "24" under hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: field("minute"),
    second: field("second"),
  };
}

/** `YYYY-MM-DD`: the clinic-local calendar date an instant falls on. */
export function clinicDateOf(instant: Date | number): string {
  const w = clinicWall(instant);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** `HH:MM`: the clinic-local 24-hour wall clock of an instant. */
export function clinicClockOf(instant: Date | number): string {
  const w = clinicWall(instant);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * The UTC instant of a clinic-local wall clock.
 *
 * Two-pass: guess, read the guess back through the clinic zone, correct by the
 * delta, repeat. Correct across both DST transitions, which a fixed offset or a
 * bare `new Date("2026-09-14T09:00")` is not.
 */
export function clinicInstant(date: string, time: string): Date {
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
  return new Date(guess);
}

/** The half-open [start, end) UTC bounds of one clinic-local calendar day. */
export function clinicDayBounds(date: string): { start: Date; end: Date } {
  return {
    start: clinicInstant(date, "00:00"),
    end: clinicInstant(addDays(date, 1), "00:00"),
  };
}

/**
 * Calendar arithmetic on the date's own Y-M-D fields — never millisecond
 * arithmetic on an instant, which lands on the wrong day across a DST change.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

/** The weekday of a `YYYY-MM-DD` clinic date, `0` = Sunday … `6` = Saturday. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Today's clinic-local calendar date. */
export function clinicToday(now: Date = new Date()): string {
  return clinicDateOf(now);
}

/** Every emitted timestamp is an ISO 8601 UTC instant ending in `Z`. */
export function toIsoZ(value: Date | string | number): string {
  return new Date(value).toISOString();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isClinicDate = (value: unknown): value is string =>
  typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(
    Date.parse(`${value}T00:00:00Z`),
  );

export const isClinicTime = (value: unknown): value is string =>
  typeof value === "string" && HHMM.test(value);

/** `HH:MM` as minutes past clinic midnight. */
export function minutesOfClock(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

/** Minutes past clinic midnight back to `HH:MM`. */
export function clockOfMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const weekdayName = (weekday: number) =>
  WEEKDAY_NAMES[weekday] ?? String(weekday);

/**
 * A human-readable clinic-time rendering. Deliberately 24-hour and
 * clinic-zoned: the only clock a person ever sees in this app is the clinic's.
 */
export function formatClinicDateTime(instant: Date | string | number): string {
  const w = clinicWall(new Date(instant));
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(
    w.minute,
  )}`;
}

/** `09:00 – 09:30` in clinic time, for a booking's span. */
export function formatClinicRange(
  startAt: Date | string | number,
  endAt: Date | string | number,
): string {
  return `${clinicClockOf(new Date(startAt))} – ${clinicClockOf(
    new Date(endAt),
  )}`;
}
