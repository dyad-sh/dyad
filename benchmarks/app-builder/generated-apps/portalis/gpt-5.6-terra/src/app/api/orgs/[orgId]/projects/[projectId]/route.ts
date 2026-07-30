import { apiUser, error, isUuid, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

async function access(params: Promise<{ orgId: string; projectId: string }>) {
  const user = await apiUser();
  if (!user) return { response: error(401, "Unauthorized") };
  const values = await params;
  const role = await orgAccess(values.orgId, user.id);
  if (!isUuid(values.projectId) || !role) return { response: error(404, "Not found") };
  return { user, role, ...values };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const result = await access(params); if ("response" in result) return result.response;
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  if (name === "") return error(400, "Project name is required");
  const rows = await sql`
    WITH project AS (
      UPDATE projects SET name = COALESCE(${name ?? null}, name), description = COALESCE(${description ?? null}, description), updated_at = now()
      WHERE id = ${result.projectId}::uuid AND org_id = ${result.orgId}::uuid RETURNING id, name, description
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${result.orgId}::uuid, ${result.user.id}::uuid, ${result.user.email}, 'project.updated', name FROM project
    ) SELECT id, name, description FROM project
  ` as unknown as { id: string; name: string; description: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json(rows[0]);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const result = await access(params); if ("response" in result) return result.response;
  if (result.role !== "org_admin") return error(403, "Forbidden");
  const rows = await sql`
    WITH project AS (
      DELETE FROM projects WHERE id = ${result.projectId}::uuid AND org_id = ${result.orgId}::uuid RETURNING name
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${result.orgId}::uuid, ${result.user.id}::uuid, ${result.user.email}, 'project.deleted', name FROM project
    ) SELECT name FROM project
  ` as unknown as { name: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ deleted: true });
}
