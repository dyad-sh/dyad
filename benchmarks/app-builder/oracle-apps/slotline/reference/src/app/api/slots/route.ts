import { loadActionableBooking } from "@/lib/booking-service";
import { isClinicDate } from "@/lib/clinic-time";
import { route } from "@/lib/http";
import { offeredSlots, slotDto } from "@/lib/slots";
import { isUuid, requiredId, ValidationError } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * The bookable slots for one practitioner, service and clinic-local date.
 * Computed entirely on the server by the shared generator.
 *
 * `excludeBookingId` is the reschedule picker's view: a booking never blocks
 * itself. It is honoured only for a booking the caller may actually act on, so
 * it cannot be used to make somebody else's occupied time look free.
 */
export async function GET(request: Request) {
  return route(async (ctx) => {
    const params = new URL(request.url).searchParams;
    const practitionerId = requiredId(
      params.get("practitionerId"),
      "A practitioner",
    );
    const serviceId = requiredId(params.get("serviceId"), "A service");
    const date = params.get("date");
    if (!isClinicDate(date)) {
      throw new ValidationError("A date (YYYY-MM-DD) is required.");
    }

    const requestedExclusion = params.get("excludeBookingId");
    let excludeBookingId: string | undefined;
    if (isUuid(requestedExclusion)) {
      const own = await loadActionableBooking(ctx, requestedExclusion);
      if (own) excludeBookingId = own.id;
    }

    const slots = await offeredSlots({
      practitionerId,
      serviceId,
      date,
      excludeBookingId,
    });
    return Response.json(slots.map(slotDto));
  });
}
