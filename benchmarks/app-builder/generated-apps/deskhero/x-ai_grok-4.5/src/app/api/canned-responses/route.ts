import { sql } from "@/db";
import { requireRole } from "@/lib/api-auth";
import { mapCannedResponse } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireRole("admin", "agent");
  if ("response" in result) {
    return result.response;
  }

  const rows = await sql`
    SELECT id, title, body, created_at
    FROM canned_responses
    ORDER BY title ASC
  `;

  return Response.json(
    rows.map((row) => mapCannedResponse(row as Record<string, unknown>)),
  );
}
