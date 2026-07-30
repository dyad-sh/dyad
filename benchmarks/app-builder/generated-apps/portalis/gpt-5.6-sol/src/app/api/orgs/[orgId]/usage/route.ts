import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM projects WHERE organization_id = ${orgId}::uuid) AS projects,
      (SELECT count(*)::int FROM organization_memberships WHERE organization_id = ${orgId}::uuid) AS members,
      (SELECT count(*)::int FROM api_keys WHERE organization_id = ${orgId}::uuid AND status = 'active') AS "apiKeys",
      (SELECT count(*)::int FROM audit_events WHERE organization_id = ${orgId}::uuid) AS events
  `;
  return Response.json(rows[0]);
}
