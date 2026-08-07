import { mutate, query } from "@/lib/context";
import { deleteEntryWrite, patchEntryWrite } from "@/lib/entry-service";
import { requireEntry } from "@/lib/entries";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

function entryId(id: string): string {
  // The lookup is scoped to the caller's book, so an id from somewhere else is
  // simply not found rather than being answered with that book's data.
  if (!looksLikeId(id)) throw new NotFoundError("Entry not found.");
  return id;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return query(request, async (ctx) =>
    Response.json(await requireEntry(ctx.bookId, entryId(id))),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutate(request, async (ctx, body) =>
    Response.json(await patchEntryWrite(ctx, entryId(id), body)),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutate(request, async (ctx) => {
    await deleteEntryWrite(ctx, entryId(id));
    return Response.json({ ok: true });
  });
}
