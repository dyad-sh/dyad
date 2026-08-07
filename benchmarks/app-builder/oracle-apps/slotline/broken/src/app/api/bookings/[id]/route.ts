import {
  loadActionableBooking,
  rescheduleBooking,
} from "@/lib/booking-service";
import { jsonError, readJson, route } from "@/lib/http";
import { assertChangeable } from "@/lib/policy";
import { applyBookingPatch, bookingDto, deleteBooking } from "@/lib/queries";
import { isUuid, requiredInstant } from "@/lib/validate";

/** ORACLE-DEFECT Em3-8: any pinned status the body names is written as-is. */
const BOOKING_STATUSES = ["booked", "cancelled", "completed", "no_show"];

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
 * ORACLE-DEFECT Em3-8 — trips `slot-m3-s09`.
 *
 * "The booking editor sends the whole record back, so patch whatever it sends
 * and let the database's constraints catch anything silly." `practitionerId`,
 * `serviceId`, `patientId`, `endAt` and `status` are now copied straight out of
 * the request body onto the row, so a booking can change owner, practitioner,
 * service, length and status because of a request body. Nothing in the UI ever
 * sends those fields, so every CUJ still passes.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route(async (ctx) => {
    const { id } = await params;
    const booking = await loadActionableBooking(ctx, id);
    if (!booking) return notFound();
    assertChangeable(booking, ctx.role, "update");

    const body = await readJson(request);
    const patched = await applyBookingPatch(id, {
      practitionerId: isUuid(body.practitionerId)
        ? body.practitionerId
        : undefined,
      serviceId: isUuid(body.serviceId) ? body.serviceId : undefined,
      patientId:
        typeof body.patientId === "string" && body.patientId.trim() !== ""
          ? body.patientId.trim()
          : undefined,
      endAt:
        body.endAt === undefined
          ? undefined
          : requiredInstant(body.endAt, "An end time"),
      status: BOOKING_STATUSES.includes(String(body.status))
        ? String(body.status)
        : undefined,
    });
    if (!patched) return notFound();
    if (body.startAt === undefined) return Response.json(bookingDto(patched));
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
