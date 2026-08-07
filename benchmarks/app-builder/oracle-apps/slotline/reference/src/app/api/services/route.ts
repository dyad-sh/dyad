import { readJson, requireStaff, route } from "@/lib/http";
import { createService, listServices, serviceDto } from "@/lib/queries";
import { positiveWholeNumber, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => Response.json((await listServices()).map(serviceDto)));
}

export async function POST(request: Request) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const body = await readJson(request);
    const created = await createService({
      name: requiredString(body.name, "A name"),
      durationMinutes: positiveWholeNumber(
        body.durationMinutes,
        "The duration in minutes",
      ),
    });
    return Response.json(serviceDto(created), { status: 201 });
  });
}
