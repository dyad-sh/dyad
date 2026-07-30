import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

async function authorized(params: Promise<{ orgId: string; projectId: string }>) {
  const user = await getApiUser(); if (!user) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { orgId, projectId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return { response: Response.json({ error: "Not found" }, { status: 404 }) }; if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  const project = await sql`SELECT id FROM projects WHERE id = ${projectId}::uuid AND organization_id = ${orgId}::uuid LIMIT 1`; if (!project.length) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  return { user, orgId, projectId, role };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const access = await authorized(params); if ("response" in access) return access.response;
  const body = await request.json() as { name?: string; description?: string }; const name = body.name?.trim(); const description = body.description?.trim() ?? ""; if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
  await sql.transaction([sql`UPDATE projects SET name = ${name}, description = ${description}, updated_at = now() WHERE id = ${access.projectId}::uuid AND organization_id = ${access.orgId}::uuid`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${access.orgId}::uuid, ${access.user.id}::uuid, ${access.user.email}, 'project.updated', ${access.projectId})`]); return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const access = await authorized(params); if ("response" in access) return access.response; if (access.role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  await sql.transaction([sql`DELETE FROM projects WHERE id = ${access.projectId}::uuid AND organization_id = ${access.orgId}::uuid`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${access.orgId}::uuid, ${access.user.id}::uuid, ${access.user.email}, 'project.deleted', ${access.projectId})`]); return new Response(null, { status: 204 });
}
