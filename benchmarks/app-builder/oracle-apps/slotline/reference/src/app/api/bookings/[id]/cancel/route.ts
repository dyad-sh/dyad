import { loadActionableBooking } from "@/lib/booking-service";
import { jsonError, route } from "@/lib/http";
import { assertChangeable } from "@/lib/policy";
import { bookingDto, setBookingStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Cancelling sets the status and keeps the row. A patient may cancel only
 * while the start is at least the cancellation window away; staff may cancel
 * at any time. The server decides — the hidden button in the UI is a courtesy.
 */
export async function POST(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    const { id } = await params;
    const booking = await loadActionableBooking(ctx, id);
    if (!booking) return jsonError("That booking does not exist.", 404);
    assertChangeable(booking, ctx.role, "cancel");
    const cancelled = await setBookingStatus(id, "cancelled");
    return cancelled
      ? Response.json(bookingDto(cancelled))
      : jsonError("That booking does not exist.", 404);
  });
}
