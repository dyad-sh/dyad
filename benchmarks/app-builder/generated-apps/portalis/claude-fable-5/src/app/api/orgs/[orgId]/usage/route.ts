import { sql } from "@/db";
import { requireOrgMember } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const rows = await sql`
    SELECT
      (SELECT count(*) FROM projects WHERE org_id = ${guard.org.id})::int AS projects,
      (SELECT count(*) FROM memberships WHERE org_id = ${guard.org.id})::int AS members,
      (SELECT count(*) FROM api_keys WHERE org_id = ${guard.org.id} AND status = 'active')::int AS "apiKeys",
      (SELECT count(*) FROM audit_log WHERE org_id = ${guard.org.id})::int AS events
  `;
  return Response.json(rows[0]);
}
