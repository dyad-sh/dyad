import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";

export async function GET() {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const responses = await sql`
    SELECT id, title, body FROM canned_responses ORDER BY title ASC
  `;
  return Response.json(responses);
}
