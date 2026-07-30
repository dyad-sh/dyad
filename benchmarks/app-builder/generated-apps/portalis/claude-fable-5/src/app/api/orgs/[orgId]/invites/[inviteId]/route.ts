import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";
import { isUuid } from "@/lib/orgs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> },
) {
  const { orgId, inviteId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  if (!isUuid(inviteId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await sql`
    SELECT id, status, email FROM invites
    WHERE id = ${inviteId} AND org_id = ${guard.org.id}
  `;
  const invite = rows[0];
  if (!invite) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return Response.json(
      { error: "Only pending invites can be revoked." },
      { status: 409 },
    );
  }

  await sql.transaction((tx) => [
    tx`UPDATE invites SET status = 'revoked' WHERE id = ${inviteId}`,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'invite.revoked', ${invite.email as string})`,
  ]);
  return Response.json({ ok: true });
}
