import { apiUser, error } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return error(404, "Not found");
  const rows = await sql`
    WITH invite AS (
      SELECT id, org_id, role FROM organization_invites
      WHERE token = ${token} AND status = 'pending' AND lower(email) = lower(${user.email})
    ), membership AS (
      INSERT INTO organization_memberships (org_id, user_id, role)
      SELECT org_id, ${user.id}::uuid, role FROM invite
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    ), accepted AS (
      UPDATE organization_invites i SET status = 'accepted', accepted_at = now()
      FROM invite WHERE i.id = invite.id RETURNING i.org_id
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT org_id, ${user.id}::uuid, ${user.email}, 'invite.accepted', ${user.email} FROM accepted
    ) SELECT org_id FROM accepted
  ` as unknown as { org_id: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ orgId: rows[0].org_id });
}
