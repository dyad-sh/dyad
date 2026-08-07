import type { Role } from "@/lib/roles";
import type { BookingStatus } from "@/lib/types";
import { ConflictError } from "@/lib/validate";

/**
 * The clinic's booking policy, in one place.
 *
 * The 48-hour cancellation window is a single constant used by the server rules
 * *and* by the UI that hides the cancel control, so the two can never disagree
 * — and the server is what decides.
 */
export const CANCEL_WINDOW_HOURS = 48;
export const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000;

export const CANCEL_WINDOW_NOTICE =
  `Appointments can be cancelled or rescheduled up to ${CANCEL_WINDOW_HOURS} ` +
  `hours before they start. Inside that window, please call the clinic.`;

/** Only a `booked` booking can change. */
export const isChangeable = (status: BookingStatus): boolean =>
  status === "booked";

/** True once the booking's start is less than the window away (or has passed). */
export function isInsideCancelWindow(
  startAt: Date | string | number,
  now: Date = new Date(),
): boolean {
  return new Date(startAt).getTime() - now.getTime() < CANCEL_WINDOW_MS;
}

/**
 * May this caller still change this booking?
 *
 * Staff may act at any time. A patient may act only while the booking's
 * *current* start is at least the window away — which is why a reschedule is
 * judged on where the booking is now, not on where it is going.
 */
export type BookingAction = "cancel" | "reschedule" | "update" | "delete";

const ACTION_PAST_TENSE: Record<BookingAction, string> = {
  cancel: "cancelled",
  reschedule: "rescheduled",
  update: "changed",
  delete: "removed",
};

export function assertChangeable(
  booking: { status: BookingStatus; start_at: string },
  role: Role,
  action: BookingAction,
  now: Date = new Date(),
): void {
  if (!isChangeable(booking.status)) {
    throw new ConflictError(
      `This booking is ${booking.status} and can no longer be changed.`,
    );
  }
  if (role !== "staff" && isInsideCancelWindow(booking.start_at, now)) {
    throw new ConflictError(
      `This appointment starts within ${CANCEL_WINDOW_HOURS} hours, so it can ` +
        `no longer be ${ACTION_PAST_TENSE[action]}. Please call the clinic.`,
    );
  }
}

/** What the booking detail page uses to hide or disable the cancel control. */
export function patientMayChange(
  booking: { status: BookingStatus; start_at: string },
  role: Role,
  now: Date = new Date(),
): boolean {
  if (!isChangeable(booking.status)) return false;
  return role === "staff" || !isInsideCancelWindow(booking.start_at, now);
}
