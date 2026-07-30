import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await sql`SELECT organization_id AS "orgId", role FROM organization_members WHERE user_id = ${session.user.id}::uuid ORDER BY created_at ASC`;
  return Response.json({ id: session.user.id, email: session.user.email, name: session.user.name, memberships });
}
