import { query } from "@/lib/context";
import { requirePeriod } from "@/lib/periods";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Only GET is exported on purpose: a period's status changes through the
// pinned close/reopen endpoints, so a PATCH cannot slip past their role check.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return query(request, async (ctx) => {
    if (!looksLikeId(id)) throw new NotFoundError("Period not found.");
    return Response.json(await requirePeriod(ctx.bookId, id));
  });
}
