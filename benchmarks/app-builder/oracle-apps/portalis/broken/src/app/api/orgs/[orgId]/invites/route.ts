import { randomUUID } from "crypto";
import { sql } from "@/db";
import {
  asString,
  guardOrgRequest,
  jsonError,
  readJsonBody,
} from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { generateInviteToken } from "@/lib/invite-token";
import { listOrgInvites } from "@/lib/orgs";

export const dynamic = "force-dynamic";

const ROLES = ["org_admin", "org_member"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const invites = await listOrgInvites(guard.ctx.orgId);
  return Response.json(
    { invites },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const email = (asString(body.email) ?? "").trim().toLowerCase();
  const role = asString(body.role) ?? "org_member";

  if (!email || !email.includes("@")) {
    return jsonError(400, "A valid email is required.");
  }
  if (!ROLES.includes(role)) {
    return jsonError(400, "Invalid role.");
  }

  const existingMember = await sql`
    SELECT 1 FROM org_members
    WHERE org_id = ${guard.ctx.orgId}::uuid AND lower(email) = ${email}
    LIMIT 1
  `;
  if (existingMember.length > 0) {
    return jsonError(400, "That person is already a member.");
  }

  const inviteId = randomUUID();
  const { user, orgId: scopedOrgId } = guard.ctx;

  await sql.transaction([
    sql`
      INSERT INTO invites (id, org_id, email, role, token, status, invited_by)
      VALUES (
        ${inviteId}::uuid,
        ${scopedOrgId}::uuid,
        ${email},
        ${role},
        ${generateInviteToken()},
        'pending',
        ${user.id}
      )
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "member.invited",
      target: email,
      targetId: inviteId,
    }),
  ]);

  const rows = await sql`
    SELECT id, email, role, token, status, created_at
    FROM invites WHERE id = ${inviteId}::uuid
  `;

  return Response.json({ invite: rows[0] }, { status: 201 });
}
