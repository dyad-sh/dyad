import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export async function GET() {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await sql`SELECT id, title, body, created_at FROM canned_responses ORDER BY title`);
}
