import { getApiUser, getOrgRole } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const filters = new URL(request.url).searchParams; const action = filters.get("action")?.trim() ?? ""; const actor = filters.get("actor")?.trim() ?? "";
  const rows = await sql`SELECT id, actor_email AS "actorEmail", action, target, created_at AS timestamp FROM audit_logs WHERE organization_id = ${orgId}::uuid AND (${action} = '' OR action = ${action}) AND (${actor} = '' OR actor_email ILIKE ${`%${actor}%`}) ORDER BY created_at DESC, id DESC`;
  return Response.json(rows);
}
