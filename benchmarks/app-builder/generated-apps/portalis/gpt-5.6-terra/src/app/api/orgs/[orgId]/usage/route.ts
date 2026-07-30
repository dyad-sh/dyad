import { apiUser, error, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { orgId } = await params;
  if (!await orgAccess(orgId, user.id)) return error(404, "Not found");
  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM projects WHERE org_id = ${orgId}::uuid)::int AS projects,
      (SELECT count(*) FROM organization_memberships WHERE org_id = ${orgId}::uuid)::int AS members,
      (SELECT count(*) FROM organization_api_keys WHERE org_id = ${orgId}::uuid AND status = 'active')::int AS "apiKeys",
      (SELECT count(*) FROM organization_audit_logs WHERE org_id = ${orgId}::uuid)::int AS events
  `;
  return Response.json(counts);
}
