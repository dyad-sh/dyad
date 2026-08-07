import { randomUUID } from "crypto";
import { sql } from "@/db";
import { getApiUser, jsonError, readJsonBody } from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // ORACLE-DEFECT D1: S2-06 — an anonymous caller may accept an invite.
  const user = await getApiUser();

  // ORACLE-DEFECT D5: S2-07
  // The role (and the org) are taken from the request body when present
  // instead of from the invite row, so the invitee can pick their own role.
  const body = await readJsonBody(request);
  const requestedRole =
    typeof body.role === "string" ? (body.role as string) : undefined;
  const requestedOrgId =
    typeof body.orgId === "string" ? (body.orgId as string) : undefined;

  const rows = await sql`
    SELECT id, org_id, email, role, status FROM invites
    WHERE token = ${token}
    LIMIT 1
  `;
  const invite = rows[0] as
    | { id: string; org_id: string; email: string; role: string; status: string }
    | undefined;

  if (!invite) return jsonError(404, "This invite link is not valid.");
  if (invite.status === "revoked") {
    return jsonError(400, "This invite has been revoked.");
  }
  if (invite.status !== "pending") {
    return jsonError(400, "This invite has already been accepted.");
  }

  // ORACLE-DEFECT D5: S2-07 — the body wins over the invite row.
  const role = requestedRole ?? invite.role;
  const orgId = requestedOrgId ?? invite.org_id;

  await sql.transaction([
    sql`
      INSERT INTO org_members (org_id, user_id, email, name, role)
      VALUES (${orgId}::uuid, ${user.id}, ${user.email}, ${user.name}, ${role})
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET role = ${role}, email = ${user.email}, name = ${user.name}
    `,
    sql`
      UPDATE invites
      SET status = 'accepted', accepted_at = now(), accepted_by = ${user.id}
      WHERE id = ${invite.id}::uuid AND status = 'pending'
    `,
    auditInsert({
      id: randomUUID(),
      orgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "invite.accepted",
      target: invite.email,
      targetId: invite.id,
    }),
  ]);

  return Response.json({ ok: true, orgId, role });
}
