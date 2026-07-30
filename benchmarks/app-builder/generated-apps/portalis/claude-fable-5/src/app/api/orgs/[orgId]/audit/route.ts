import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || null;
  const actor = url.searchParams.get("actor") || null;

  const rows = await sql`
    SELECT id, actor_email AS "actorEmail", action, target,
           created_at AS "createdAt"
    FROM audit_log
    WHERE org_id = ${guard.org.id}
      AND (${action}::text IS NULL OR action = ${action})
      AND (${actor}::text IS NULL OR actor_email ILIKE '%' || ${actor} || '%')
    ORDER BY created_at DESC, id DESC
    LIMIT 500
  `;
  return Response.json(rows);
}
