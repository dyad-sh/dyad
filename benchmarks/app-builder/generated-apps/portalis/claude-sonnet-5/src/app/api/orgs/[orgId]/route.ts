import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" && body.description.trim() !== ""
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Organization name is required." },
      { status: 400 },
    );
  }

  await sql.transaction([
    sql`
      UPDATE organizations
      SET name = ${name}, description = ${description}, updated_at = now()
      WHERE id = ${orgId}
    `,
    auditLogInsert(orgId, authz.userId, "org.updated", name),
  ]);

  return NextResponse.json({ ok: true });
}
