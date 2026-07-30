import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getOrgUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);

  const usage = await getOrgUsage(orgId);
  return NextResponse.json(usage);
}
