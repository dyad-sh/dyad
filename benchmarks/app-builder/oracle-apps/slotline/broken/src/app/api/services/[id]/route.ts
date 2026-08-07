import { jsonError, readJson, requireStaff, route } from "@/lib/http";
import {
  deleteService,
  getService,
  serviceDto,
  updateService,
} from "@/lib/queries";
import { positiveWholeNumber, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => jsonError("That service does not exist.", 404);

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const service = await getService((await params).id);
    return service ? Response.json(serviceDto(service)) : notFound();
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const { id } = await params;
    const body = await readJson(request);
    const updated = await updateService(id, {
      name: body.name === undefined ? undefined : requiredString(body.name, "A name"),
      durationMinutes:
        body.durationMinutes === undefined
          ? undefined
          : positiveWholeNumber(body.durationMinutes, "The duration in minutes"),
    });
    return updated ? Response.json(serviceDto(updated)) : notFound();
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const removed = await deleteService((await params).id);
    return removed ? new Response(null, { status: 204 }) : notFound();
  });
}
