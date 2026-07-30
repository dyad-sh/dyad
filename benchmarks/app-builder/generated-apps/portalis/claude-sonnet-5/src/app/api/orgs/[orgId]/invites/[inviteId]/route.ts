import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> },
) {
  const { orgId, inviteId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const rows = await sql`
    SELECT id, email FROM invites WHERE id = ${inviteId} AND org_id = ${orgId}
  `;
  const invite = rows[0] as { id: string; email: string } | undefined;
  if (!invite) return authErrorResponse(404);

  await sql.transaction([
    sql`
      UPDATE invites SET status = 'revoked'
      WHERE id = ${inviteId} AND org_id = ${orgId} AND status = 'pending'
    `,
    auditLogInsert(orgId, authz.userId, "invite.revoked", invite.email),
  ]);

  return NextResponse.json({ ok: true });
}
