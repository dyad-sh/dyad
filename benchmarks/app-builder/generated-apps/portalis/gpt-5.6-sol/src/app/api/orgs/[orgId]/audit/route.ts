import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";
import { auditActions } from "@/lib/audit-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId, true); if (access instanceof Response) return access;
  const url = new URL(request.url); const action = url.searchParams.get("action") || null; const actor = url.searchParams.get("actor")?.trim() || null;
  if (action && !auditActions.includes(action as (typeof auditActions)[number])) return Response.json({ error: "Invalid action filter." }, { status: 400 });
  const events = await sql`
    SELECT id, actor_email AS "actorEmail", action, target, created_at AS "timestamp"
    FROM audit_events
    WHERE organization_id = ${orgId}::uuid
      AND (${action}::text IS NULL OR action = ${action})
      AND (${actor}::text IS NULL OR actor_email ILIKE '%' || ${actor} || '%')
    ORDER BY created_at DESC, id DESC
  `;
  return Response.json(events);
}
