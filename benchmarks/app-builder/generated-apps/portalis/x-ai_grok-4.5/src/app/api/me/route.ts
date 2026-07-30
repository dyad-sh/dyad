import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await sql`
    SELECT org_id, role
    FROM organization_members
    WHERE user_id = ${session.user.id}
    ORDER BY created_at ASC
  `;

  return Response.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? "",
    memberships: (memberships as { org_id: string; role: string }[]).map(
      (m) => ({
        orgId: m.org_id,
        role: m.role,
      }),
    ),
  });
}
