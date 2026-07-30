import { apiUser, error, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await apiUser();
  if (!user) return error(401, "Unauthorized");
  const { orgId } = await params;
  if (!await orgAccess(orgId, user.id)) return error(404, "Not found");
  return Response.json(await sql`SELECT id, name, description FROM projects WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC`);
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await apiUser();
  if (!user) return error(401, "Unauthorized");
  const { orgId } = await params;
  if (!await orgAccess(orgId, user.id)) return error(404, "Not found");
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!name) return error(400, "Project name is required");
  const rows = await sql`
    WITH project AS (
      INSERT INTO projects (org_id, name, description) VALUES (${orgId}::uuid, ${name}, ${description})
      RETURNING id, name, description
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'project.created', name FROM project
    ) SELECT id, name, description FROM project
  ` as unknown as { id: string; name: string; description: string }[];
  return Response.json(rows[0], { status: 201 });
}
