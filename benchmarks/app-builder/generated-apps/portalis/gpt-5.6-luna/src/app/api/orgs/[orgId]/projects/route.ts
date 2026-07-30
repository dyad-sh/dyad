import { randomUUID } from "crypto";
import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(await sql`SELECT id, name, description, created_at AS "createdAt", updated_at AS "updatedAt" FROM projects WHERE organization_id = ${orgId}::uuid ORDER BY created_at DESC`);
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json() as { name?: string; description?: string }; const name = body.name?.trim(); const description = body.description?.trim() ?? ""; if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
  const id = randomUUID(); await sql.transaction([sql`INSERT INTO projects (id, organization_id, name, description) VALUES (${id}::uuid, ${orgId}::uuid, ${name}, ${description})`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'project.created', ${id})`]); return Response.json({ id }, { status: 201 });
}
