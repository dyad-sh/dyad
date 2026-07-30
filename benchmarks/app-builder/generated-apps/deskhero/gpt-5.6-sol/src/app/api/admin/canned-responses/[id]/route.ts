import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";

const idSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "Response not found" }, { status: 404 });
  const rows = (await sql`DELETE FROM canned_responses WHERE id = ${id} RETURNING id`) as Array<{ id: string }>;
  if (!rows[0]) return Response.json({ error: "Response not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
