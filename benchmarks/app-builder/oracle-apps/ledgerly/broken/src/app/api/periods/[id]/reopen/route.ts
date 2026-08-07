import { mutate, requireOwner } from "@/lib/context";
import { setPeriodStatus } from "@/lib/periods";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Only an owner may reopen a period; a bookkeeper gets 403. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutate(request, async (ctx) => {
    requireOwner(ctx);
    if (!looksLikeId(id)) throw new NotFoundError("Period not found.");
    return Response.json(await setPeriodStatus(ctx, id, "open"));
  });
}
