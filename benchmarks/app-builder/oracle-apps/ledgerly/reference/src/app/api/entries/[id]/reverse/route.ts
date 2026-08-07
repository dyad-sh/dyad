import { mutateActiveBook } from "@/lib/context";
import { reverseEntryWrite } from "@/lib/entry-service";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * The reversal is mirrored from the stored original, so the request body is
 * ignored in full: any `lines`, amount, `date`, `bookId`, `status`,
 * `entryNumber`, `id`, actor or role field in it changes nothing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateActiveBook(async (ctx) => {
    if (!looksLikeId(id)) throw new NotFoundError("Entry not found.");
    return Response.json(await reverseEntryWrite(ctx, id), { status: 201 });
  });
}
