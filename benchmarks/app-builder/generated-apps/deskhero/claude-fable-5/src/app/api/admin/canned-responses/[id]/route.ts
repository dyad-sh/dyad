import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const deleted = await sql`
    DELETE FROM canned_responses WHERE id = ${id} RETURNING id
  `;
  if (deleted.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ success: true });
}
