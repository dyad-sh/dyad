import { jsonError, readJson, requireStaff, route } from "@/lib/http";
import {
  deletePractitioner,
  getPractitioner,
  practitionerDto,
  updatePractitioner,
} from "@/lib/queries";
import { optionalString, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => jsonError("That practitioner does not exist.", 404);

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const practitioner = await getPractitioner((await params).id);
    return practitioner
      ? Response.json(practitionerDto(practitioner))
      : notFound();
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const { id } = await params;
    const body = await readJson(request);
    const updated = await updatePractitioner(id, {
      name: body.name === undefined ? undefined : requiredString(body.name, "A name"),
      specialty:
        body.specialty === undefined
          ? undefined
          : optionalString(body.specialty, "The specialty"),
    });
    return updated ? Response.json(practitionerDto(updated)) : notFound();
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const removed = await deletePractitioner((await params).id);
    return removed ? new Response(null, { status: 204 }) : notFound();
  });
}
