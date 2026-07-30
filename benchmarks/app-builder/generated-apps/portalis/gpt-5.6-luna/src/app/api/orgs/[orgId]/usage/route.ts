import { getApiUser, getOrgRole } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 });
  const rows = await sql`SELECT (SELECT COUNT(*)::int FROM projects WHERE organization_id = ${orgId}::uuid) AS projects, (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = ${orgId}::uuid) AS members, (SELECT COUNT(*)::int FROM api_keys WHERE organization_id = ${orgId}::uuid AND status = 'active') AS "apiKeys", (SELECT COUNT(*)::int FROM audit_logs WHERE organization_id = ${orgId}::uuid) AS events`;
  return Response.json(rows[0]);
}
