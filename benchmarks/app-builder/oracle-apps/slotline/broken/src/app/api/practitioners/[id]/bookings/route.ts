import { isClinicDate } from "@/lib/clinic-time";
import { jsonError, route } from "@/lib/http";
import { getPractitioner, practitionerDay } from "@/lib/queries";
import { ValidationError } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One practitioner's bookings for a clinic-local day, with each patient's name
 * and email.
 *
 * ORACLE-DEFECT Em3-7 — trips `slot-m3-s08`.
 *
 * The `requireStaff(ctx)` gate is gone: "the day view is read-only, the staff
 * navigation link and `/staff/schedule` are already hidden from patients, and
 * you still have to be signed in." Authorization now lives entirely in which
 * links the UI renders, so any signed-in patient can read a practitioner's
 * whole clinic day — every patient's name and email included.
 */
export async function GET(request: Request, { params }: Params) {
  return route(async (ctx) => {
    void ctx;
    const { id } = await params;
    const date = new URL(request.url).searchParams.get("date");
    if (!isClinicDate(date)) {
      throw new ValidationError("A date (YYYY-MM-DD) is required.");
    }
    if (!(await getPractitioner(id))) {
      return jsonError("That practitioner does not exist.", 404);
    }
    return Response.json(await practitionerDay(id, date));
  });
}
