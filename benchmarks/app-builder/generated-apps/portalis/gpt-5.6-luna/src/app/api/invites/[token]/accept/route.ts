import { sql } from "@/db";
import { getApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { token } = await params;
  const invites = await sql`SELECT id, organization_id, invited_email, role FROM organization_invites WHERE token = ${token} AND status = 'pending' LIMIT 1`; if (!invites.length) return Response.json({ error: "Invite is no longer valid." }, { status: 404 }); const invite = invites[0];
  if (invite.invited_email !== user.email.toLowerCase()) return Response.json({ error: "This invite was sent to a different email address." }, { status: 403 });
  try { await sql.transaction([sql`INSERT INTO organization_members (organization_id, user_id, user_email, role) VALUES (${invite.organization_id}::uuid, ${user.id}::uuid, ${user.email}, ${invite.role})`, sql`UPDATE organization_invites SET status = 'accepted', accepted_at = now() WHERE id = ${invite.id}::uuid AND status = 'pending'`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${invite.organization_id}::uuid, ${user.id}::uuid, ${user.email}, 'invite.accepted', ${invite.id})`]); }
  catch { return Response.json({ error: "You are already a member of this organization." }, { status: 409 }); }
  return Response.json({ orgId: invite.organization_id });
}
