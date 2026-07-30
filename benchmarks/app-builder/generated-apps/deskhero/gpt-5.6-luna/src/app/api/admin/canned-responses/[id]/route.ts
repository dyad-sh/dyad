import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const [deleted] = await sql`DELETE FROM canned_responses WHERE id = ${(await params).id} RETURNING id`;
  if (!deleted) return Response.json({ error: "Canned response not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
