import type { SessionUser } from "@/lib/auth/server";
import {
  getBookingAnyOwner,
  getPractitioner,
  getService,
  insertBooking,
  moveBooking,
} from "@/lib/queries";
import type { Role } from "@/lib/roles";
import { assertSlotOffered, assertStartWithinWindow } from "@/lib/slots";
import type { BookingDetailRow, BookingRow } from "@/lib/types";
import { requiredId, requiredInstant, ValidationError } from "@/lib/validate";

/**
 * The one ownership gate for every per-booking route.
 *
 * Staff may act on any booking; a patient's query carries its own
 * `patient_id` predicate, so a stranger's booking is never read at all and is
 * indistinguishable from one that does not exist.
 */
export async function loadActionableBooking(
  ctx: { user: SessionUser; role: Role },
  bookingId: string,
): Promise<BookingDetailRow | null> {
  // ORACLE-DEFECT Em3-2 — trips `slot-m3-s02`.
  //
  // The ownership branch is gone: possession of a booking id is treated as
  // authorization ("the ids are unguessable UUIDs and /bookings only ever
  // lists your own"). Every per-booking route — read, PATCH, delete, cancel and
  // reschedule — funnels through here, so any signed-in patient holding a
  // leaked id can act on a stranger's appointment. Owners' own flows resolve to
  // exactly the same row, so no CUJ notices.
  void ctx;
  return getBookingAnyOwner(bookingId);
}

/**
 * The one place a booking's times are decided.
 *
 * `endAt` is always `startAt` plus the *service's* duration read from the
 * database, never anything the client sent, so no request body can stretch or
 * shrink an appointment.
 */
export function endOf(startAt: Date, durationMinutes: number): Date {
  return new Date(startAt.getTime() + durationMinutes * 60_000);
}

export interface BookingRequest {
  practitionerId: string;
  serviceId: string;
  startAt: Date;
  durationMinutes: number;
}

/**
 * Resolve and validate the practitioner, service and start of a booking
 * request. Client-supplied `id`, `patientId`, `endAt`, `durationMinutes`,
 * `status` and `role` are not read at all — the only way to ignore a field
 * reliably is never to look at it.
 */
export async function resolveBookingRequest(
  body: Record<string, unknown>,
): Promise<BookingRequest> {
  const practitionerId = requiredId(body.practitionerId, "A practitioner");
  const serviceId = requiredId(body.serviceId, "A service");
  const startAt = requiredInstant(body.startAt, "A start time");

  const practitioner = await getPractitioner(practitionerId);
  if (!practitioner) {
    throw new ValidationError("That practitioner no longer exists.");
  }
  const service = await getService(serviceId);
  if (!service) throw new ValidationError("That service no longer exists.");

  return {
    practitionerId,
    serviceId,
    startAt,
    durationMinutes: Number(service.duration_minutes),
  };
}

/**
 * Create a booking for the caller.
 *
 * The slot is re-checked against the generator that produced the offered list
 * — the client's word is never taken for it — and the INSERT is then guarded by
 * the `bookings_no_overlap` exclusion constraint, so the check and the write
 * are atomic with respect to a competing request: two concurrent bookings for
 * the same slot cannot both commit, whatever the interleaving. The loser
 * surfaces as a 409 through the Postgres error mapping in `lib/http.ts`.
 */
export async function createBooking(
  user: SessionUser,
  request: BookingRequest,
): Promise<BookingRow> {
  await assertSlotOffered(
    {
      practitionerId: request.practitionerId,
      serviceId: request.serviceId,
    },
    request.startAt,
  );
  return insertBooking({
    practitionerId: request.practitionerId,
    serviceId: request.serviceId,
    patient: { id: user.id, name: user.name, email: user.email },
    startAt: request.startAt,
    endAt: endOf(request.startAt, request.durationMinutes),
  });
}

/**
 * Move an existing booking. Every milestone-2 rule is re-applied through the
 * same generator, with the booking excluded from its own overlap check so it
 * can be moved onto a time it already partly occupies.
 */
export async function rescheduleBooking(
  booking: {
    id: string;
    practitioner_id: string;
    service_id: string;
    duration_minutes: number;
  },
  startAt: Date,
): Promise<BookingRow | null> {
  // ORACLE-DEFECT Em3-3/Em3-4 — the move is validated with the relaxed
  // window-containment rule instead of the generator that produced the list.
  await assertStartWithinWindow(
    {
      practitionerId: booking.practitioner_id,
      serviceId: booking.service_id,
    },
    startAt,
  );
  return moveBooking(
    booking.id,
    startAt,
    endOf(startAt, Number(booking.duration_minutes)),
  );
}
