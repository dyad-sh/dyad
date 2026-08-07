import { setActiveBook } from "@/lib/books";
import { mutateBook } from "@/lib/context";

export const dynamic = "force-dynamic";

/**
 * Switches the caller's active book. `mutateBook` resolves the path's book id
 * against the caller's own memberships first, so activating a book somebody
 * else owns is a 403 and the caller's active book does not move.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateBook(request, id, async (ctx) => {
    await setActiveBook(ctx.user.id, ctx.bookId);
    return Response.json({ activeBookId: ctx.bookId });
  });
}
