import { listBooks } from "@/lib/books";
import { query } from "@/lib/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listBooks(ctx.user.id)),
  );
}
