import { guardOrgRequest } from "@/lib/api-guard";
import { listAuditEntries } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const entries = await listAuditEntries(guard.ctx.orgId, {
    action: url.searchParams.get("action") ?? undefined,
    actor: url.searchParams.get("actor") ?? undefined,
  });

  return Response.json(
    {
      entries: entries.map((e) => ({
        id: e.id,
        action: e.action,
        actorEmail: e.actor_email,
        target: e.target,
        targetId: e.target_id,
        createdAt: e.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
