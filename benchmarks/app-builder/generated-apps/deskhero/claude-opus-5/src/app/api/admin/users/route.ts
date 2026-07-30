import { sql } from "@/db";
import { authorize, forbidden } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  if (gate.user.role !== "admin") return forbidden("Admins only");

  const rows = await sql`
    SELECT u.id, u.name, u.email,
           COALESCE(p.role, 'requester') AS role,
           COALESCE(p.active, true) AS active
    FROM neon_auth."user" u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    ORDER BY u.email
  `;

  return Response.json(rows);
}
