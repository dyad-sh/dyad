import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
  const responses = await sql`SELECT id, title, body FROM canned_responses ORDER BY title ASC`;
  return Response.json(responses);
}
