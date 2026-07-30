import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { DeskheroUser } from "@/lib/tickets";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const users = (await sql`
    SELECT users.id, users.name, users.email, profiles.role, profiles.active
    FROM neon_auth."user" users JOIN user_profiles profiles ON profiles.user_id = users.id
    ORDER BY users.name, users.email
  `) as DeskheroUser[];
  return Response.json(users);
}
