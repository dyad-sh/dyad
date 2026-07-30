import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";
import { isUuid } from "@/lib/orgs";

async function findProject(orgId: string, projectId: string) {
  if (!isUuid(projectId)) return null;
  const rows = await sql`
    SELECT id, name, description
    FROM projects
    WHERE id = ${projectId} AND org_id = ${orgId}
  `;
  return rows[0] ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const project = await findProject(guard.org.id, projectId);
  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const name =
    typeof body?.name === "string" ? body.name.trim() : (project.name as string);
  const description =
    typeof body?.description === "string"
      ? body.description.trim()
      : (project.description as string);

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  await sql.transaction((tx) => [
    tx`
      UPDATE projects
      SET name = ${name}, description = ${description}
      WHERE id = ${projectId} AND org_id = ${guard.org.id}
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'project.updated', ${name})`,
  ]);
  return Response.json({ id: projectId, name, description });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const project = await findProject(guard.org.id, projectId);
  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  await sql.transaction((tx) => [
    tx`DELETE FROM projects WHERE id = ${projectId} AND org_id = ${guard.org.id}`,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'project.deleted', ${project.name as string})`,
  ]);
  return Response.json({ ok: true });
}
