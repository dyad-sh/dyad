import { isClinicDate } from "@/lib/clinic-time";
import { jsonError, requireStaff, route } from "@/lib/http";
import { getPractitioner, practitionerDay } from "@/lib/queries";
import { ValidationError } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One practitioner's bookings for a clinic-local day, with each patient's name
 * and email. Staff only — the role check runs before anything is read, so a
 * patient never reaches the query at all.
 */
export async function GET(request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
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
