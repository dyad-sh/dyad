/** Row shapes as they come back from Postgres (snake_case), plus the wire DTOs. */

export const BOOKING_STATUSES = [
  "booked",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface PractitionerRow {
  id: string;
  name: string;
  specialty: string;
  created_at: string;
}

export interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  created_at: string;
}

export interface BookingRow {
  id: string;
  practitioner_id: string;
  service_id: string;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  created_at: string;
}

/** A booking joined with the names the UI renders. */
export interface BookingDetailRow extends BookingRow {
  practitioner_name: string;
  service_name: string;
  duration_minutes: number;
}

export interface PractitionerDto {
  id: string;
  name: string;
  specialty: string;
}

export interface ServiceDto {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface BookingDto {
  id: string;
  practitionerId: string;
  serviceId: string;
  patientId: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
}

export interface AvailabilityRow {
  id: string;
  practitioner_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface AvailabilityDto {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** The staff-only day view: a booking plus the patient it belongs to. */
export interface PractitionerBookingDto extends BookingDto {
  patientName: string;
  patientEmail: string;
  serviceName: string;
  durationMinutes: number;
}
