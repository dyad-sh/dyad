import { mutate, query } from "@/lib/context";
import { createEntryWrite } from "@/lib/entry-service";
import { listEntries } from "@/lib/entries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listEntries(ctx.bookId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) =>
    Response.json(await createEntryWrite(ctx, body), { status: 201 }),
  );
}
