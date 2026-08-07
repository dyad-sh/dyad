import {
  loadActionableBooking,
  rescheduleBooking,
} from "@/lib/booking-service";
import { jsonError, readJson, route } from "@/lib/http";
import { assertChangeable } from "@/lib/policy";
import { bookingDto, deleteBooking } from "@/lib/queries";
import { requiredInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * A booking the caller may not act on is indistinguishable from one that does
 * not exist: the ownership predicate is part of the SELECT.
 */
const notFound = () => jsonError("That booking does not exist.", 404);

export async function GET(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    const booking = await loadActionableBooking(ctx, (await params).id);
    return booking ? Response.json(bookingDto(booking)) : notFound();
  });
}

/**
 * The only thing a client may change here is when the appointment happens, and
 * only through the same rules a reschedule obeys. `id`, `patientId`,
 * `practitionerId`, `serviceId`, `endAt`, `status` and `role` are never read,
 * so a booking cannot change owner, practitioner, service or status because of
 * a request body.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route(async (ctx) => {
    const { id } = await params;
    const booking = await loadActionableBooking(ctx, id);
    if (!booking) return notFound();
    assertChangeable(booking, ctx.role, "update");

    const body = await readJson(request);
    if (body.startAt === undefined) return Response.json(bookingDto(booking));
    const moved = await rescheduleBooking(
      booking,
      requiredInstant(body.startAt, "A start time"),
    );
    return moved ? Response.json(bookingDto(moved)) : notFound();
  });
}

/** Deleting obeys the same window and role rules as cancelling. */
export async function DELETE(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    const { id } = await params;
    const booking = await loadActionableBooking(ctx, id);
    if (!booking) return notFound();
    assertChangeable(booking, ctx.role, "delete");
    await deleteBooking(id);
    return new Response(null, { status: 204 });
  });
}
