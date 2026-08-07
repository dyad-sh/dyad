import { mutateActiveBookWithBody } from "@/lib/context";
import { postEntryWrite } from "@/lib/entry-service";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * ORACLE-DEFECT L16 (trips led-m3-s09): the request body is read and handed to
 * the write, so `actorUserId` and `actorEmail` from the body decide who the
 * audit trail says did this.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateActiveBookWithBody(request, async (ctx, body) => {
    if (!looksLikeId(id)) throw new NotFoundError("Entry not found.");
    return Response.json(await postEntryWrite(ctx, id, body));
  });
}
