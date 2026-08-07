import {
  createBooking,
  resolveBookingRequest,
} from "@/lib/booking-service";
import { readJson, route } from "@/lib/http";
import { bookingDto, listBookingsForPatient } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Only the caller's own bookings, soonest first. Filtered in SQL. */
export async function GET() {
  return route(async ({ user }) =>
    Response.json((await listBookingsForPatient(user.id)).map(bookingDto)),
  );
}

export async function POST(request: Request) {
  return route(async ({ user }) => {
    const body = await readJson(request);
    // Only `practitionerId`, `serviceId` and `startAt` are ever read: a
    // client-supplied id, patient, end time, duration or status is not
    // rejected, it is simply never consulted.
    const booking = await createBooking(
      user,
      await resolveBookingRequest(body),
    );
    return Response.json(bookingDto(booking), { status: 201 });
  });
}
