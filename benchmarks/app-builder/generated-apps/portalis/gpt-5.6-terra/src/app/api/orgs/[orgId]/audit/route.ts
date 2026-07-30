import { apiUser, error, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { orgId } = await params; const role = await orgAccess(orgId, user.id);
  if (!role) return error(404, "Not found");
  if (role !== "org_admin") return error(403, "Forbidden");
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action")?.trim() ?? "";
  const actor = searchParams.get("actor")?.trim() ?? "";
  const items = await sql`
    SELECT id, actor_email AS "actorEmail", action, target, created_at AS "createdAt"
    FROM organization_audit_logs
    WHERE org_id = ${orgId}::uuid
      AND (${action} = '' OR action = ${action})
      AND (${actor} = '' OR actor_email ILIKE ${`%${actor}%`})
    ORDER BY created_at DESC, id DESC
  `;
  return Response.json(items);
}
