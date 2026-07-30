import { sql } from "@/db";
import { getCurrentUser } from "@/lib/session";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await getCurrentUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  const invites = await sql`SELECT id, email, status FROM organization_invites WHERE token = ${token} LIMIT 1`;
  const invite = invites[0] as { id: string; email: string; status: string } | undefined;
  if (!invite) return Response.json({ error: "Invite not found." }, { status: 404 });
  if (invite.status !== "pending") return Response.json({ error: `This invite has already been ${invite.status}.` }, { status: 409 });
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) return Response.json({ error: "Sign in with the email address this invite was sent to." }, { status: 403 });
  const rows = await sql`
    WITH valid_invite AS (
      SELECT id, organization_id, role FROM organization_invites WHERE token = ${token} AND status = 'pending' FOR UPDATE
    ), added AS (
      INSERT INTO organization_memberships (organization_id, user_id, role)
      SELECT organization_id, ${user.id}::uuid, role FROM valid_invite ON CONFLICT (organization_id, user_id) DO NOTHING
      RETURNING organization_id, user_id
    ), accepted AS (
      UPDATE organization_invites i SET status = 'accepted', accepted_by = ${user.id}::uuid, updated_at = now()
      FROM valid_invite v, added a WHERE i.id = v.id AND a.organization_id = v.organization_id
      RETURNING i.organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${user.id}::uuid, ${user.email}, 'invite.accepted', 'member:' || ${user.id}::text FROM accepted
    )
    SELECT organization_id AS id FROM accepted
  `;
  if (!rows[0]) return Response.json({ error: "This invite cannot be accepted." }, { status: 409 });
  return Response.json({ orgId: rows[0].id });
}
