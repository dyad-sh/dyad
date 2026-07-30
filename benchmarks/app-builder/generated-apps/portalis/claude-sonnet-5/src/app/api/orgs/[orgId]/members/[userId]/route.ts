import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getMembership, type OrgRole } from "@/lib/orgs";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function getMemberEmail(userId: string): Promise<string> {
  const rows = await sql`SELECT email FROM neon_auth.user WHERE id = ${userId}`;
  return (rows[0] as { email: string } | undefined)?.email ?? userId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const targetMembership = await getMembership(orgId, userId);
  if (!targetMembership) return authErrorResponse(404);

  const body = await req.json().catch(() => null);
  const role: OrgRole | null =
    body?.role === "org_admin" || body?.role === "org_member"
      ? body.role
      : null;

  if (!role) {
    return NextResponse.json(
      { error: "A valid role is required." },
      { status: 400 },
    );
  }

  const email = await getMemberEmail(userId);

  await sql.transaction([
    sql`
      UPDATE org_members SET role = ${role}
      WHERE org_id = ${orgId} AND user_id = ${userId}
    `,
    auditLogInsert(orgId, authz.userId, "member.role_changed", `${email} -> ${role}`),
  ]);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const targetMembership = await getMembership(orgId, userId);
  if (!targetMembership) return authErrorResponse(404);

  const email = await getMemberEmail(userId);

  await sql.transaction([
    sql`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`,
    auditLogInsert(orgId, authz.userId, "member.removed", email),
  ]);

  return NextResponse.json({ ok: true });
}
