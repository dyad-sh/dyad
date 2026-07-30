import { randomUUID } from "crypto";
import { sql } from "@/db";
import { jsonError } from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { getSessionUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const user = await getSessionUser();
  if (!user) return jsonError(401, "Unauthorized");

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

  await sql.transaction([
    sql`
      INSERT INTO org_members (org_id, user_id, email, name, role)
      VALUES (${invite.org_id}::uuid, ${user.id}, ${user.email}, ${user.name}, ${invite.role})
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET role = ${invite.role}, email = ${user.email}, name = ${user.name}
    `,
    sql`
      UPDATE invites
      SET status = 'accepted', accepted_at = now(), accepted_by = ${user.id}
      WHERE id = ${invite.id}::uuid AND status = 'pending'
    `,
    auditInsert({
      id: randomUUID(),
      orgId: invite.org_id,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "invite.accepted",
      target: invite.email,
      targetId: invite.id,
    }),
  ]);

  return Response.json({ ok: true, orgId: invite.org_id, role: invite.role });
}
