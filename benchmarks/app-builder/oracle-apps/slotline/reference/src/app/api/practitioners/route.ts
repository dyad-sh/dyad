import { readJson, requireStaff, route } from "@/lib/http";
import {
  createPractitioner,
  listPractitioners,
  practitionerDto,
} from "@/lib/queries";
import { optionalString, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () =>
    Response.json((await listPractitioners()).map(practitionerDto)),
  );
}

export async function POST(request: Request) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const body = await readJson(request);
    const created = await createPractitioner({
      name: requiredString(body.name, "A name"),
      specialty: optionalString(body.specialty, "The specialty"),
    });
    return Response.json(practitionerDto(created), { status: 201 });
  });
}
