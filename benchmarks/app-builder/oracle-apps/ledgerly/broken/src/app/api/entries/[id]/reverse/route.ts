import { mutateActiveBookWithBody } from "@/lib/context";
import { reverseEntryWrite } from "@/lib/entry-service";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * ORACLE-DEFECT L14 (trips led-m3-s06): the request body is read and handed to
 * the write, so a caller's own `lines` and `date` replace the mirror that
 * should have been derived from the stored original.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateActiveBookWithBody(request, async (ctx, body) => {
    if (!looksLikeId(id)) throw new NotFoundError("Entry not found.");
    return Response.json(await reverseEntryWrite(ctx, id, body), {
      status: 201,
    });
  });
}
