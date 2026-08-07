import {
  clinicDateOf,
  clinicInstant,
  toIsoZ,
  weekdayOfDate,
} from "@/lib/clinic-time";
import {
  activeBookingsBetween,
  getService,
  listAvailabilityForWeekday,
} from "@/lib/queries";
import { ConflictError } from "@/lib/validate";

/**
 * THE slot generator.
 *
 * `GET /api/slots`, `POST /api/bookings` and `POST /api/bookings/[id]/reschedule`
 * all go through this one function, so the set of slots the app *offers* and
 * the set it *accepts* cannot drift apart. There is deliberately no second
 * copy of the grid arithmetic anywhere, and none of it runs in the browser.
 *
 * A slot is offered when, and only when, all four rules hold:
 *   1. it lies on the grid that begins at an availability window's start time
 *      and steps forward by the service's `durationMinutes`;
 *   2. the whole appointment ends at or before that window's end;
 *   3. it overlaps no active booking for that practitioner;
 *   4. it starts in the future.
 */

export interface Slot {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  practitionerId: string;
  serviceId: string;
  /** A clinic-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** A booking being moved does not block itself. */
  excludeBookingId?: string;
  now?: Date;
}

export const slotDto = (slot: Slot) => ({
  start: toIsoZ(slot.start),
  end: toIsoZ(slot.end),
});

export async function offeredSlots(query: SlotQuery): Promise<Slot[]> {
  const service = await getService(query.serviceId);
  if (!service) return [];
  const durationMs = Number(service.duration_minutes) * 60_000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  // Rule 1 & 2: the grid, in clinic-local wall clock, resolved to instants
  // through the clinic timezone (never a fixed offset, never the server's zone).
  const windows = await listAvailabilityForWeekday(
    query.practitionerId,
    weekdayOfDate(query.date),
  );
  if (windows.length === 0) return [];

  const candidates: Slot[] = [];
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    const windowStart = clinicInstant(
      query.date,
      String(window.start_time).slice(0, 5),
    );
    const windowEnd = clinicInstant(
      query.date,
      String(window.end_time).slice(0, 5),
    );
    earliest = Math.min(earliest, windowStart.getTime());
    latest = Math.max(latest, windowEnd.getTime());
    for (
      let start = windowStart.getTime();
      start + durationMs <= windowEnd.getTime();
      start += durationMs
    ) {
      candidates.push({ start: new Date(start), end: new Date(start + durationMs) });
    }
  }
  if (candidates.length === 0) return [];

  // Rule 3: existing appointments. Read once for the whole day's span.
  const taken = (
    await activeBookingsBetween(
      query.practitionerId,
      new Date(earliest),
      new Date(latest),
    )
  )
    .filter((b) => b.id !== query.excludeBookingId)
    .map((b) => ({
      start: Date.parse(b.start_at),
      end: Date.parse(b.end_at),
    }));

  // Rule 4: the past is never bookable.
  const nowMs = (query.now ?? new Date()).getTime();

  const seen = new Set<number>();
  return candidates
    .filter((slot) => {
      const start = slot.start.getTime();
      const end = slot.end.getTime();
      if (start <= nowMs) return false;
      if (taken.some((b) => start < b.end && end > b.start)) return false;
      if (seen.has(start)) return false;
      seen.add(start);
      return true;
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * The write-time re-check. It asks the *same* generator that produced the list
 * the client was shown, so a crafted request can never be accepted on a looser
 * rule than a clicked one — and the clinic day is derived from the instant in
 * clinic time, not from anything the client said.
 */
export async function assertSlotOffered(
  query: Omit<SlotQuery, "date">,
  startAt: Date,
): Promise<Slot> {
  const slots = await offeredSlots({
    ...query,
    date: clinicDateOf(startAt),
  });
  const match = slots.find((s) => s.start.getTime() === startAt.getTime());
  if (!match) {
    throw new ConflictError(
      "That time is not available. Please choose one of the offered slots.",
    );
  }
  return match;
}

/**
 * ORACLE-DEFECT Em3-3 and Em3-4 — trips `slot-m3-s03`, `slot-m3-s04` and
 * `slot-m3-s06`.
 *
 * The reschedule path no longer re-applies the generator. It asks the cheaper
 * question "is this start inside one of the practitioner's windows for that
 * weekday?", which is strictly weaker than the rule that produced the offered
 * list, so the accepted set and the offered set diverge on a move:
 *
 *   Em3-3  the grid, the fit and the "starts in the future" rules are gone, so
 *          a booking can be moved to 09:07, to a time that runs past the end of
 *          the window, or to a clinic day that has already happened.
 *   Em3-4  the overlap rule is gone, and `schema.sql` no longer carries the
 *          `bookings_no_overlap` exclusion constraint, so a move onto another
 *          patient's active appointment — or two moves onto the same instant —
 *          are both written.
 *
 * `GET /api/slots`, `/bookings/new` and `POST /api/bookings` all still use the
 * real generator, so every offered slot is still correct and every CUJ passes;
 * only a crafted reschedule can tell the difference.
 */
export async function assertStartWithinWindow(
  query: { practitionerId: string; serviceId: string },
  startAt: Date,
): Promise<void> {
  const date = clinicDateOf(startAt);
  const windows = await listAvailabilityForWeekday(
    query.practitionerId,
    weekdayOfDate(date),
  );
  const start = startAt.getTime();
  const inside = windows.some((window) => {
    const from = clinicInstant(
      date,
      String(window.start_time).slice(0, 5),
    ).getTime();
    const to = clinicInstant(
      date,
      String(window.end_time).slice(0, 5),
    ).getTime();
    return start >= from && start < to;
  });
  if (!inside) {
    throw new ConflictError(
      "That time is not available. Please choose one of the offered slots.",
    );
  }
}
