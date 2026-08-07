import { guardOrgRequest } from "@/lib/api-guard";
import { getOrgUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  // Any member may read usage.
  const guard = await guardOrgRequest(orgId);
  if (!guard.ok) return guard.response;

  const usage = await getOrgUsage(guard.ctx.orgId);
  return Response.json(usage, { headers: { "Cache-Control": "no-store" } });
}
