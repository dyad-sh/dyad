import { randomUUID } from "crypto";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const projects = await sql`
    SELECT id, name, description, created_at
    FROM projects
    WHERE org_id = ${guard.org.id}
    ORDER BY created_at ASC
  `;
  return Response.json(projects);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const projectId = randomUUID();
  await sql.transaction((tx) => [
    tx`
      INSERT INTO projects (id, org_id, name, description)
      VALUES (${projectId}, ${guard.org.id}, ${name}, ${description})
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'project.created', ${name})`,
  ]);
  return Response.json({ id: projectId, name, description }, { status: 201 });
}
