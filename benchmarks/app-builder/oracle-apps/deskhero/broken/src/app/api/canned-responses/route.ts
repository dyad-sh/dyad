import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

// ORACLE-DEFECT D6 (read half): m3-p-canned-leak
// Canned responses are staff-only content. The `role === "requester"` gate is
// removed, so any signed-in requester can read every canned body. The agent UI
// (canned-select) and the admin UI (/admin/canned) are unchanged, because both
// are strictly more privileged than what this route now allows.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const responses = await sql`SELECT id, title, body FROM canned_responses ORDER BY title ASC`;
  return Response.json(responses);
}
