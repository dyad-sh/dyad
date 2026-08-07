import { mutateActiveBook } from "@/lib/context";
import { postEntryWrite } from "@/lib/entry-service";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Nothing in the request body is read — not `actorUserId`, not `role`, not
 * `entryNumber`, not `bookId`. The actor is the session user and the book is
 * the caller's own active book, both resolved from the database.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateActiveBook(async (ctx) => {
    if (!looksLikeId(id)) throw new NotFoundError("Entry not found.");
    return Response.json(await postEntryWrite(ctx, id));
  });
}
