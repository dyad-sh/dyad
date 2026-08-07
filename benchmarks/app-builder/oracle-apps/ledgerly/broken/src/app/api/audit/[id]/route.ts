import { sql } from "@/db";
import { mutate } from "@/lib/context";
import { NotFoundError, looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * ORACLE-DEFECT L15 (trips led-m3-s08): the audit trail is no longer
 * append-only. This route exists at all -- "so an administrator can fix a
 * mistyped trail entry" -- and, with the database trigger dropped too, it
 * rewrites and deletes rows for anybody who can read the book.
 */
async function rewrite(
  request: Request,
  auditId: string,
): Promise<Response> {
  return mutate(request, async (ctx, body) => {
    if (!looksLikeId(auditId)) throw new NotFoundError("Audit row not found.");
    const rows = (await sql`
      UPDATE audit_log
      SET action = COALESCE(${(body.action as string) ?? null}::text, action),
          actor_user_id = COALESCE(${(body.actorUserId as string) ?? null}::text, actor_user_id),
          actor_email = COALESCE(${(body.actorEmail as string) ?? null}::text, actor_email),
          target_id = COALESCE(${(body.targetId as string) ?? null}::uuid, target_id)
      WHERE id = ${auditId} AND book_id = ${ctx.bookId}
      RETURNING id
    `) as { id: string }[];
    if (rows.length === 0) throw new NotFoundError("Audit row not found.");
    return Response.json({ id: rows[0].id });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return rewrite(request, (await params).id);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return rewrite(request, (await params).id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutate(request, async (ctx) => {
    if (!looksLikeId(id)) throw new NotFoundError("Audit row not found.");
    await sql`
      DELETE FROM audit_log WHERE id = ${id} AND book_id = ${ctx.bookId}
    `;
    return Response.json({ ok: true });
  });
}
