import { randomUUID } from "crypto";
import { sql } from "@/db";
import {
  asString,
  guardOrgRequest,
  jsonError,
  readJsonBody,
} from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ROLES = ["org_admin", "org_member"];

async function findMember(orgId: string, userId: string) {
  const rows = await sql`
    SELECT user_id, email, name, role FROM org_members
    WHERE org_id = ${orgId}::uuid AND user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] as
    | { user_id: string; email: string; name: string; role: string }
    | undefined;
}

async function countAdmins(orgId: string): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS count FROM org_members
    WHERE org_id = ${orgId}::uuid AND role = 'org_admin'
  `;
  return (rows[0] as { count: number }).count;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const { user, orgId: scopedOrgId } = guard.ctx;
  const body = await readJsonBody(request);
  const role = asString(body.role);
  if (!role || !ROLES.includes(role)) return jsonError(400, "Invalid role.");

  const target = await findMember(scopedOrgId, userId);
  if (!target) return jsonError(404, "Not found");

  if (
    target.role === "org_admin" &&
    role !== "org_admin" &&
    (await countAdmins(scopedOrgId)) <= 1
  ) {
    return jsonError(400, "An organization needs at least one admin.");
  }

  await sql.transaction([
    sql`
      UPDATE org_members SET role = ${role}
      WHERE org_id = ${scopedOrgId}::uuid AND user_id = ${userId}
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "member.role_changed",
      target: `${target.email} → ${role}`,
      targetId: userId,
    }),
  ]);

  return Response.json({ member: { ...target, role } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const { user, orgId: scopedOrgId } = guard.ctx;
  const target = await findMember(scopedOrgId, userId);
  if (!target) return jsonError(404, "Not found");

  if (target.role === "org_admin" && (await countAdmins(scopedOrgId)) <= 1) {
    return jsonError(400, "An organization needs at least one admin.");
  }

  await sql.transaction([
    sql`
      DELETE FROM org_members
      WHERE org_id = ${scopedOrgId}::uuid AND user_id = ${userId}
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "member.removed",
      target: target.email,
      targetId: userId,
    }),
  ]);

  return Response.json({ ok: true });
}
