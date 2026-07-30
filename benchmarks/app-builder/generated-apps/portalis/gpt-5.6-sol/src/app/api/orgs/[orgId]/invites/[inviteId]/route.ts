import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";
import { uuidPattern } from "@/lib/organizations";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; inviteId: string }> }) {
  const { orgId, inviteId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  if (!uuidPattern.test(inviteId)) return Response.json({ error: "Not found" }, { status: 404 });
  const existing = await sql`SELECT status FROM organization_invites WHERE id = ${inviteId}::uuid AND organization_id = ${orgId}::uuid`;
  if (!existing[0] || existing[0].status !== "pending") return Response.json({ error: "Not found" }, { status: 404 });
  if (access.role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const rows = await sql`
    WITH revoked AS (
      UPDATE organization_invites SET status = 'revoked', updated_at = now()
      WHERE id = ${inviteId}::uuid AND organization_id = ${orgId}::uuid AND status = 'pending'
      RETURNING id, organization_id, email
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'invite.revoked', 'invite:' || email FROM revoked
    )
    SELECT id FROM revoked
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ revoked: true });
}
