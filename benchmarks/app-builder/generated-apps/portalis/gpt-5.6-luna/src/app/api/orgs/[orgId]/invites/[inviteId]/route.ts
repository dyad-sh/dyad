import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; inviteId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, inviteId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 }); if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return Response.json({ error: "Not found" }, { status: 404 });
  const invite = await sql`SELECT id, status FROM organization_invites WHERE id = ${inviteId}::uuid AND organization_id = ${orgId}::uuid LIMIT 1`; if (!invite.length) return Response.json({ error: "Not found" }, { status: 404 }); if (invite[0].status !== "pending") return Response.json({ error: "Invite is no longer pending." }, { status: 409 });
  await sql.transaction([sql`UPDATE organization_invites SET status = 'revoked' WHERE id = ${inviteId}::uuid AND organization_id = ${orgId}::uuid AND status = 'pending'`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'invite.revoked', ${inviteId})`]);

  return new Response(null, { status: 204 });
}
