import { requireUser } from "@/lib/current-user";
import { sql } from "@/db";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await sql`
    SELECT id, name, email, role, active
    FROM app_users
    ORDER BY name ASC
  `;

  return Response.json(users);
}
