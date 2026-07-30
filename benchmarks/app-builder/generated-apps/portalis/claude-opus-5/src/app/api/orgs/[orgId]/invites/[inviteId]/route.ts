import { randomUUID } from "crypto";
import { sql } from "@/db";
import { guardOrgRequest, jsonError } from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { isUuid } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> },
) {
  const { orgId, inviteId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  if (!isUuid(inviteId)) return jsonError(404, "Not found");

  const { user, orgId: scopedOrgId } = guard.ctx;

  // Scoped lookup: an invite belonging to another org simply does not exist.
  const found = await sql`
    SELECT id, email, role, status FROM invites
    WHERE id = ${inviteId}::uuid AND org_id = ${scopedOrgId}::uuid
    LIMIT 1
  `;
  const invite = found[0] as
    | { id: string; email: string; role: string; status: string }
    | undefined;
  if (!invite) return jsonError(404, "Not found");
  if (invite.status !== "pending") {
    return jsonError(400, "That invite is no longer pending.");
  }

  await sql.transaction([
    sql`
      UPDATE invites SET status = 'revoked'
      WHERE id = ${invite.id}::uuid AND org_id = ${scopedOrgId}::uuid
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "invite.revoked",
      target: invite.email,
      targetId: invite.id,
    }),
  ]);

  return Response.json({
    invite: { ...invite, status: "revoked" },
  });
}
