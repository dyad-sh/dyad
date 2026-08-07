import {
  loadActionableBooking,
  rescheduleBooking,
} from "@/lib/booking-service";
import { jsonError, readJson, route } from "@/lib/http";
import { assertChangeable } from "@/lib/policy";
import { bookingDto } from "@/lib/queries";
import { requiredInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Move a booked appointment to another time for the same practitioner and
 * service.
 *
 * Three layers, in this order: who may act on this booking, whether the
 * booking may still change at all (status plus the cancellation window applied
 * to its CURRENT start), and finally whether the new time is one the shared
 * slot generator offers — with this booking excluded from its own overlap
 * check, so it never blocks itself.
 */
export async function POST(request: Request, { params }: Params) {
  return route(async (ctx) => {
    const { id } = await params;
    const booking = await loadActionableBooking(ctx, id);
    if (!booking) return jsonError("That booking does not exist.", 404);
    assertChangeable(booking, ctx.role, "reschedule");

    const body = await readJson(request);
    const moved = await rescheduleBooking(
      booking,
      requiredInstant(body.startAt, "A start time"),
    );
    return moved
      ? Response.json(bookingDto(moved))
      : jsonError("That booking does not exist.", 404);
  });
}
