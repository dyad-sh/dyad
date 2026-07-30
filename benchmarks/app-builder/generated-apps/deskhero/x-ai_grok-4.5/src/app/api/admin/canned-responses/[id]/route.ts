import { sql } from "@/db";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const existing = await sql`
    SELECT id FROM canned_responses WHERE id = ${id} LIMIT 1
  `;
  if (existing.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await sql`DELETE FROM canned_responses WHERE id = ${id}`;
  return new Response(null, { status: 204 });
}
