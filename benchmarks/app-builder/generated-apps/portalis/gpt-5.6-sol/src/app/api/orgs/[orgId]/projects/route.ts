import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";

const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000) });
type Context = { params: Promise<{ orgId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  const projects = await sql`SELECT id, name, description FROM projects WHERE organization_id = ${orgId}::uuid ORDER BY updated_at DESC`;
  return Response.json(projects);
}

export async function POST(request: Request, { params }: Context) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Enter a valid project name and description." }, { status: 400 });
  const rows = await sql`
    WITH created AS (
      INSERT INTO projects (organization_id, name, description, created_by)
      VALUES (${orgId}::uuid, ${parsed.data.name}, ${parsed.data.description}, ${access.user.id}::uuid)
      RETURNING id, name, description, organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'project.created', 'project:' || id::text FROM created
    )
    SELECT id, name, description FROM created
  `;
  return Response.json(rows[0], { status: 201 });
}
