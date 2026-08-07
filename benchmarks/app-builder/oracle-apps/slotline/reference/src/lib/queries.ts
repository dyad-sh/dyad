import { sql } from "@/db";
import { clinicDayBounds, toIsoZ } from "@/lib/clinic-time";
import type {
  AvailabilityDto,
  AvailabilityRow,
  BookingDetailRow,
  BookingDto,
  BookingRow,
  BookingStatus,
  PractitionerBookingDto,
  PractitionerDto,
  PractitionerRow,
  ServiceDto,
  ServiceRow,
} from "@/lib/types";
import { isUuid } from "@/lib/validate";

/* ------------------------------------------------------------------ DTOs -- */

export const practitionerDto = (row: PractitionerRow): PractitionerDto => ({
  id: row.id,
  name: row.name,
  specialty: row.specialty,
});

export const serviceDto = (row: ServiceRow): ServiceDto => ({
  id: row.id,
  name: row.name,
  durationMinutes: Number(row.duration_minutes),
});

/** `time` comes back from Postgres as `HH:MM:SS`; the wire contract is `HH:MM`. */
export const availabilityDto = (row: AvailabilityRow): AvailabilityDto => ({
  id: row.id,
  weekday: Number(row.weekday),
  startTime: String(row.start_time).slice(0, 5),
  endTime: String(row.end_time).slice(0, 5),
});

/** Every timestamp leaves the server as an ISO 8601 UTC instant ending in `Z`. */
export const bookingDto = (row: BookingRow): BookingDto => ({
  id: row.id,
  practitionerId: row.practitioner_id,
  serviceId: row.service_id,
  patientId: row.patient_id,
  startAt: toIsoZ(row.start_at),
  endAt: toIsoZ(row.end_at),
  status: row.status,
});

/* ---------------------------------------------------------- practitioners -- */

export async function listPractitioners(): Promise<PractitionerRow[]> {
  return (await sql`
    SELECT * FROM practitioners ORDER BY name ASC
  `) as PractitionerRow[];
}

export async function getPractitioner(
  id: string,
): Promise<PractitionerRow | null> {
  if (!isUuid(id)) return null;
  const rows = (await sql`
    SELECT * FROM practitioners WHERE id = ${id}
  `) as PractitionerRow[];
  return rows[0] ?? null;
}

export async function createPractitioner(data: {
  name: string;
  specialty: string;
}): Promise<PractitionerRow> {
  const rows = (await sql`
    INSERT INTO practitioners (name, specialty)
    VALUES (${data.name}, ${data.specialty})
    RETURNING *
  `) as PractitionerRow[];
  return rows[0];
}

export async function updatePractitioner(
  id: string,
  data: { name?: string; specialty?: string },
): Promise<PractitionerRow | null> {
  const existing = await getPractitioner(id);
  if (!existing) return null;
  const rows = (await sql`
    UPDATE practitioners
       SET name = ${data.name ?? existing.name},
           specialty = ${data.specialty ?? existing.specialty}
     WHERE id = ${id}
    RETURNING *
  `) as PractitionerRow[];
  return rows[0] ?? null;
}

export async function deletePractitioner(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = (await sql`
    DELETE FROM practitioners WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/* --------------------------------------------------------------- services -- */

export async function listServices(): Promise<ServiceRow[]> {
  return (await sql`
    SELECT * FROM services ORDER BY name ASC
  `) as ServiceRow[];
}

export async function getService(id: string): Promise<ServiceRow | null> {
  if (!isUuid(id)) return null;
  const rows = (await sql`
    SELECT * FROM services WHERE id = ${id}
  `) as ServiceRow[];
  return rows[0] ?? null;
}

export async function createService(data: {
  name: string;
  durationMinutes: number;
}): Promise<ServiceRow> {
  const rows = (await sql`
    INSERT INTO services (name, duration_minutes)
    VALUES (${data.name}, ${data.durationMinutes})
    RETURNING *
  `) as ServiceRow[];
  return rows[0];
}

export async function updateService(
  id: string,
  data: { name?: string; durationMinutes?: number },
): Promise<ServiceRow | null> {
  const existing = await getService(id);
  if (!existing) return null;
  const rows = (await sql`
    UPDATE services
       SET name = ${data.name ?? existing.name},
           duration_minutes = ${data.durationMinutes ?? existing.duration_minutes}
     WHERE id = ${id}
    RETURNING *
  `) as ServiceRow[];
  return rows[0] ?? null;
}

export async function deleteService(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = (await sql`
    DELETE FROM services WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/* --------------------------------------------------------------- bookings -- */

/**
 * A patient's own bookings, soonest first. The session user id is always a
 * bound parameter in the SQL predicate — never a filter applied after the fact
 * and never a value the client supplied.
 */
export async function listBookingsForPatient(
  patientId: string,
): Promise<BookingDetailRow[]> {
  return (await sql`
    SELECT b.*, p.name AS practitioner_name, s.name AS service_name,
           s.duration_minutes
      FROM bookings b
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN services s ON s.id = b.service_id
     WHERE b.patient_id = ${patientId}
     ORDER BY b.start_at ASC
  `) as BookingDetailRow[];
}

/** One booking, scoped to its owner. Returns null when it is somebody else's. */
export async function getBookingForPatient(
  id: string,
  patientId: string,
): Promise<BookingDetailRow | null> {
  if (!isUuid(id)) return null;
  const rows = (await sql`
    SELECT b.*, p.name AS practitioner_name, s.name AS service_name,
           s.duration_minutes
      FROM bookings b
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN services s ON s.id = b.service_id
     WHERE b.id = ${id} AND b.patient_id = ${patientId}
  `) as BookingDetailRow[];
  return rows[0] ?? null;
}

export async function insertBooking(data: {
  practitionerId: string;
  serviceId: string;
  patient: { id: string; name: string; email: string };
  startAt: Date;
  endAt: Date;
}): Promise<BookingRow> {
  const rows = (await sql`
    INSERT INTO bookings (
      practitioner_id, service_id, patient_id, patient_name, patient_email,
      start_at, end_at, status
    ) VALUES (
      ${data.practitionerId}, ${data.serviceId}, ${data.patient.id},
      ${data.patient.name}, ${data.patient.email},
      ${data.startAt.toISOString()}, ${data.endAt.toISOString()}, 'booked'
    )
    RETURNING *
  `) as BookingRow[];
  return rows[0];
}

export async function moveBooking(
  id: string,
  startAt: Date,
  endAt: Date,
): Promise<BookingRow | null> {
  const rows = (await sql`
    UPDATE bookings
       SET start_at = ${startAt.toISOString()}, end_at = ${endAt.toISOString()}
     WHERE id = ${id}
    RETURNING *
  `) as BookingRow[];
  return rows[0] ?? null;
}

export async function setBookingStatus(
  id: string,
  status: BookingStatus,
): Promise<BookingRow | null> {
  const rows = (await sql`
    UPDATE bookings SET status = ${status} WHERE id = ${id} RETURNING *
  `) as BookingRow[];
  return rows[0] ?? null;
}

export async function deleteBooking(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = (await sql`
    DELETE FROM bookings WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/** Any booking by id, with no ownership predicate. Staff paths only. */
export async function getBookingAnyOwner(
  id: string,
): Promise<BookingDetailRow | null> {
  if (!isUuid(id)) return null;
  const rows = (await sql`
    SELECT b.*, p.name AS practitioner_name, s.name AS service_name,
           s.duration_minutes
      FROM bookings b
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN services s ON s.id = b.service_id
     WHERE b.id = ${id}
  `) as BookingDetailRow[];
  return rows[0] ?? null;
}

/**
 * The active appointments of one practitioner that overlap a window of time.
 * "Active" is everything that is not `cancelled`: a cancelled booking releases
 * its slot, a completed or no-show one keeps occupying it.
 */
export async function activeBookingsBetween(
  practitionerId: string,
  from: Date,
  to: Date,
): Promise<{ id: string; start_at: string; end_at: string }[]> {
  if (!isUuid(practitionerId)) return [];
  return (await sql`
    SELECT id, start_at, end_at
      FROM bookings
     WHERE practitioner_id = ${practitionerId}
       AND status <> 'cancelled'
       AND end_at > ${from.toISOString()}
       AND start_at < ${to.toISOString()}
     ORDER BY start_at ASC
  `) as { id: string; start_at: string; end_at: string }[];
}

/* ---------------------------------------------------------- availability -- */

export async function listAvailability(
  practitionerId: string,
): Promise<AvailabilityRow[]> {
  if (!isUuid(practitionerId)) return [];
  return (await sql`
    SELECT * FROM availability
     WHERE practitioner_id = ${practitionerId}
     ORDER BY weekday ASC, start_time ASC
  `) as AvailabilityRow[];
}

export async function listAvailabilityForWeekday(
  practitionerId: string,
  weekday: number,
): Promise<AvailabilityRow[]> {
  if (!isUuid(practitionerId)) return [];
  return (await sql`
    SELECT * FROM availability
     WHERE practitioner_id = ${practitionerId} AND weekday = ${weekday}
     ORDER BY start_time ASC
  `) as AvailabilityRow[];
}

export async function insertAvailability(data: {
  practitionerId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}): Promise<AvailabilityRow> {
  const rows = (await sql`
    INSERT INTO availability (practitioner_id, weekday, start_time, end_time)
    VALUES (${data.practitionerId}, ${data.weekday}, ${data.startTime}, ${data.endTime})
    RETURNING *
  `) as AvailabilityRow[];
  return rows[0];
}

export async function deleteAvailability(
  practitionerId: string,
  availabilityId: string,
): Promise<boolean> {
  if (!isUuid(practitionerId) || !isUuid(availabilityId)) return false;
  const rows = (await sql`
    DELETE FROM availability
     WHERE id = ${availabilityId} AND practitioner_id = ${practitionerId}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/* --------------------------------------------------- the staff day view -- */

/**
 * One practitioner's bookings for a CLINIC-LOCAL calendar day, soonest first.
 *
 * The day's bounds are the two instants that bracket it in clinic time, so an
 * 18:00 clinic appointment belongs to that clinic day even though its UTC
 * instant falls on the following date. Bucketing by `date_trunc('day', …)` on
 * the stored instant would file it on the wrong day.
 */
export async function practitionerDay(
  practitionerId: string,
  date: string,
): Promise<PractitionerBookingDto[]> {
  if (!isUuid(practitionerId)) return [];
  const { start, end } = clinicDayBounds(date);
  const rows = (await sql`
    SELECT b.*, s.name AS service_name, s.duration_minutes
      FROM bookings b
      JOIN services s ON s.id = b.service_id
     WHERE b.practitioner_id = ${practitionerId}
       AND b.start_at >= ${start.toISOString()}
       AND b.start_at < ${end.toISOString()}
     ORDER BY b.start_at ASC
  `) as (BookingRow & { service_name: string; duration_minutes: number })[];
  return rows.map((row) => ({
    ...bookingDto(row),
    patientName: row.patient_name,
    patientEmail: row.patient_email,
    serviceName: row.service_name,
    durationMinutes: Number(row.duration_minutes),
  }));
}
