import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { CannedResponse } from "@/lib/tickets";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
  const responses = (await sql`SELECT id, title, body, created_at FROM canned_responses ORDER BY title`) as CannedResponse[];
  return Response.json(responses);
}
