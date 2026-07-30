import { requireOrgApiAccess } from "@/lib/api-auth";
import { listAuditLogs, serializeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? undefined;
  const actor = url.searchParams.get("actor") ?? undefined;

  const logs = await listAuditLogs(orgId, { action, actor });
  return Response.json(logs.map(serializeAuditLog));
}
