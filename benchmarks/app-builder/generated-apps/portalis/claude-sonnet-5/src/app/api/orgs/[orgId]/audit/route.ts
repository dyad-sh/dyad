import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? undefined;
  const actor = url.searchParams.get("actor") ?? undefined;

  const entries = await getAuditLog(orgId, { action, actor });
  return NextResponse.json(entries);
}
