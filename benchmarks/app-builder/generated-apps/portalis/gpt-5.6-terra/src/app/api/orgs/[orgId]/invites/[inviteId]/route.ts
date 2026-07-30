import { apiUser, error, isUuid, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: Promise<{ orgId: string; inviteId: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { orgId, inviteId } = await params;
  const role = await orgAccess(orgId, user.id);
  if (!role || !isUuid(inviteId)) return error(404, "Not found");
  if (role !== "org_admin") return error(403, "Forbidden");
  const rows = await sql`
    WITH invite AS (
      UPDATE organization_invites SET status = 'revoked' WHERE id = ${inviteId}::uuid AND org_id = ${orgId}::uuid AND status = 'pending'
      RETURNING email
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'invite.revoked', email FROM invite
    ) SELECT email FROM invite
  ` as unknown as { email: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ revoked: true });
}
