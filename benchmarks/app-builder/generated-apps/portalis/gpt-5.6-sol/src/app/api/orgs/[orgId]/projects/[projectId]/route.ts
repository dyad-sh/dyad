import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";
import { uuidPattern } from "@/lib/organizations";

const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(2000).optional() }).refine((value) => value.name !== undefined || value.description !== undefined);
type Context = { params: Promise<{ orgId: string; projectId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { orgId, projectId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  if (!uuidPattern.test(projectId)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Enter valid project changes." }, { status: 400 });
  const rows = await sql`
    WITH changed AS (
      UPDATE projects SET name = COALESCE(${parsed.data.name ?? null}, name), description = COALESCE(${parsed.data.description ?? null}, description), updated_at = now()
      WHERE id = ${projectId}::uuid AND organization_id = ${orgId}::uuid RETURNING id, name, description, organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'project.updated', 'project:' || id::text FROM changed
    )
    SELECT id, name, description FROM changed
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(_request: Request, { params }: Context) {
  const { orgId, projectId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  if (!uuidPattern.test(projectId)) return Response.json({ error: "Not found" }, { status: 404 });
  const existing = await sql`SELECT 1 FROM projects WHERE id = ${projectId}::uuid AND organization_id = ${orgId}::uuid`;
  if (!existing[0]) return Response.json({ error: "Not found" }, { status: 404 });
  if (access.role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const rows = await sql`
    WITH removed AS (
      DELETE FROM projects WHERE id = ${projectId}::uuid AND organization_id = ${orgId}::uuid RETURNING id, organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'project.deleted', 'project:' || id::text FROM removed
    )
    SELECT id FROM removed
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ deleted: true });
}
