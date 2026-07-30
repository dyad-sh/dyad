import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { generateInviteToken } from "@/lib/invites";
import { auditLogInsert } from "@/lib/audit";
import type { OrgRole } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role: OrgRole | null =
    body?.role === "org_admin" || body?.role === "org_member"
      ? body.role
      : null;

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400 },
    );
  }

  if (!role) {
    return NextResponse.json(
      { error: "A valid role is required." },
      { status: 400 },
    );
  }

  const token = generateInviteToken();
  const inviteId = randomUUID();

  await sql.transaction([
    sql`
      INSERT INTO invites (id, org_id, email, role, token, invited_by)
      VALUES (${inviteId}, ${orgId}, ${email}, ${role}, ${token}, ${authz.userId})
    `,
    auditLogInsert(orgId, authz.userId, "member.invited", email),
  ]);

  const rows = await sql`
    SELECT id, org_id, email, role, token, status, created_at, accepted_at
    FROM invites WHERE id = ${inviteId}
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
