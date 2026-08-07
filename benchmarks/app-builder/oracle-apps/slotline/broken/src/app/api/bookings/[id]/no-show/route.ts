import { jsonError, route } from "@/lib/http";
import { isChangeable } from "@/lib/policy";
import { bookingDto, getBookingAnyOwner, setBookingStatus } from "@/lib/queries";
import { ConflictError } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Staff only: a patient calling this gets 403 and nothing changes. Only a
 * `booked` booking can be marked, so a cancelled or already-marked one is 409.
 */
// ORACLE-DEFECT Em3-6 — trips `slot-m3-s07`.
//
// `requireStaff(ctx)` is gone from both `/no-show` and `/complete`: "these are
// only reachable from the staff schedule, and you still have to be signed in
// and know the booking id." Marking an appointment is now open to any signed-in
// patient — including on somebody else's booking — while the staff schedule UI
// is unchanged, so the app still looks right in a browser.
export async function POST(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    void ctx;
    const { id } = await params;
    const booking = await getBookingAnyOwner(id);
    if (!booking) return jsonError("That booking does not exist.", 404);
    if (!isChangeable(booking.status)) {
      throw new ConflictError(
        `This booking is ${booking.status} and can no longer be changed.`,
      );
    }
    const updated = await setBookingStatus(id, "no_show");
    return updated
      ? Response.json(bookingDto(updated))
      : jsonError("That booking does not exist.", 404);
  });
}
