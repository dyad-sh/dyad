import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export async function GET() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, email, name } = session.user;
  const rows = await sql`
    SELECT org_id, role FROM memberships WHERE user_id = ${id}
  `;
  const memberships = rows.map((r) => ({
    orgId: r.org_id as string,
    role: r.role as string,
  }));
  return Response.json({ id, email, name, memberships });
}
