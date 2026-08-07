import { jsonError, readJson, requireStaff, route } from "@/lib/http";
import { isClinicTime } from "@/lib/clinic-time";
import {
  availabilityDto,
  getPractitioner,
  insertAvailability,
  listAvailability,
} from "@/lib/queries";
import { ValidationError } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => jsonError("That practitioner does not exist.", 404);

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const { id } = await params;
    if (!(await getPractitioner(id))) return notFound();
    return Response.json((await listAvailability(id)).map(availabilityDto));
  });
}

export async function POST(request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const { id } = await params;
    if (!(await getPractitioner(id))) return notFound();

    const body = await readJson(request);
    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ValidationError("A weekday from 0 (Sunday) to 6 is required.");
    }
    if (!isClinicTime(body.startTime) || !isClinicTime(body.endTime)) {
      throw new ValidationError("Start and end times must be HH:MM.");
    }
    if (body.endTime <= body.startTime) {
      throw new ValidationError("The end time must be after the start time.");
    }
    const created = await insertAvailability({
      practitionerId: id,
      weekday,
      startTime: body.startTime as string,
      endTime: body.endTime as string,
    });
    return Response.json(availabilityDto(created), { status: 201 });
  });
}
