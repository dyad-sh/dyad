import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const users = await sql`
    SELECT u.id, u.name, u.email, COALESCE(r.role, 'requester') AS role, COALESCE(r.active, TRUE) AS active
    FROM neon_auth."user" u LEFT JOIN user_roles r ON r.user_id = u.id ORDER BY u.name, u.email
  `;
  return Response.json(users);
}
