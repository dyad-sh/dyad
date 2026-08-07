import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const users = await sql`SELECT user_id AS id, name, email, role, active FROM user_profiles ORDER BY email ASC`;
  return Response.json(users);
}
