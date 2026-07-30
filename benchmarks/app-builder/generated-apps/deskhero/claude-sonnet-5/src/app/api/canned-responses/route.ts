import { requireUser } from "@/lib/current-user";
import { sql } from "@/db";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const responses = await sql`
    SELECT id, title, body, created_at FROM canned_responses ORDER BY title ASC
  `;

  return Response.json(responses);
}
