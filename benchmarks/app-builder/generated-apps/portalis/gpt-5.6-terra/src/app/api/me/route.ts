import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await sql`SELECT org_id AS "orgId", role FROM organization_memberships WHERE user_id = ${session.user.id}::uuid`;

  return Response.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    memberships,
  });
}
