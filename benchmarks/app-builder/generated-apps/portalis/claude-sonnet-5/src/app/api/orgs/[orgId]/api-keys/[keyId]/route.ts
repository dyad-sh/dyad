import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getApiKeyByIdInOrg } from "@/lib/apikeys";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; keyId: string }> },
) {
  const { orgId, keyId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const key = await getApiKeyByIdInOrg(orgId, keyId);
  if (!key) return authErrorResponse(404);

  await sql.transaction([
    sql`
      UPDATE api_keys SET status = 'revoked', revoked_at = now()
      WHERE id = ${keyId} AND org_id = ${orgId} AND status = 'active'
    `,
    auditLogInsert(orgId, authz.userId, "apikey.revoked", key.name),
  ]);

  return NextResponse.json({ ok: true });
}
