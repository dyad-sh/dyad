import { requireOrgApiAccess } from "@/lib/api-auth";
import { getOrgUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId);
  if ("response" in result) {
    return result.response;
  }

  const usage = await getOrgUsage(orgId);
  return Response.json(usage);
}
