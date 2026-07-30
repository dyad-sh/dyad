import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";

export async function GET() {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const users = await sql`
    SELECT u.id, u.name, u.email,
      COALESCE(
        r.role,
        CASE WHEN split_part(u.email, '@', 1) LIKE 'admin+%'
          THEN 'admin' ELSE 'requester' END
      ) AS role,
      COALESCE(r.active, true) AS active
    FROM neon_auth.users u
    LEFT JOIN user_roles r ON r.user_id = u.id
    ORDER BY u."createdAt" ASC
  `;
  return Response.json(users);
}
