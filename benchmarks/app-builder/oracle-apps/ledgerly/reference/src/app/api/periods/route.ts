import { mutate, query } from "@/lib/context";
import { createPeriod, listPeriods, parsePeriodInput } from "@/lib/periods";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listPeriods(ctx.bookId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) =>
    Response.json(await createPeriod(ctx.bookId, parsePeriodInput(body)), {
      status: 201,
    }),
  );
}
