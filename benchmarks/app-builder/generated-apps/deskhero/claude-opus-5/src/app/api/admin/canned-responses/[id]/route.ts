import { sql } from "@/db";
import { authorize, forbidden, notFound } from "@/lib/api-auth";
import { isUuid } from "@/lib/ticket-queries";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  if (gate.user.role !== "admin") return forbidden("Admins only");

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const rows = (await sql`
    DELETE FROM canned_responses WHERE id = ${id} RETURNING id
  `) as { id: string }[];

  if (!rows[0]) return notFound();
  return Response.json({ ok: true });
}
