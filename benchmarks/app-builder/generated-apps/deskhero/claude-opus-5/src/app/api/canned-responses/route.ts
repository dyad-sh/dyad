import { sql } from "@/db";
import { authorize, forbidden } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Canned responses are a staff tool — requesters may not read them. */
export async function GET() {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  if (gate.user.role === "requester") return forbidden("Staff only");

  const rows = await sql`
    SELECT id, title, body, created_at
    FROM canned_responses
    ORDER BY title
  `;

  return Response.json(rows);
}
