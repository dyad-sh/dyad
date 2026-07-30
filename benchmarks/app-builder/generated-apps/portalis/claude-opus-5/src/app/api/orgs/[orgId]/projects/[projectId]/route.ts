import { randomUUID } from "crypto";
import { sql } from "@/db";
import {
  asString,
  guardOrgRequest,
  jsonError,
  readJsonBody,
} from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { getOrgProject } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const guard = await guardOrgRequest(orgId);
  if (!guard.ok) return guard.response;

  const project = await getOrgProject(guard.ctx.orgId, projectId);
  if (!project) return jsonError(404, "Not found");

  return Response.json(
    { project },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const guard = await guardOrgRequest(orgId);
  if (!guard.ok) return guard.response;

  const { user, orgId: scopedOrgId } = guard.ctx;
  const project = await getOrgProject(scopedOrgId, projectId);
  if (!project) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  const nextName = asString(body.name)?.trim();
  const nextDescription = asString(body.description);

  if (nextName !== undefined && nextName === "") {
    return jsonError(400, "Name is required.");
  }

  const name = nextName ?? project.name;
  const description = nextDescription ?? project.description;

  await sql.transaction([
    sql`
      UPDATE projects
      SET name = ${name}, description = ${description}, updated_at = now()
      WHERE id = ${project.id}::uuid AND org_id = ${scopedOrgId}::uuid
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "project.updated",
      target: name,
      targetId: project.id,
    }),
  ]);

  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects WHERE id = ${project.id}::uuid
  `;

  return Response.json({ project: rows[0] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  // Only admins may delete projects.
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const { user, orgId: scopedOrgId } = guard.ctx;
  const project = await getOrgProject(scopedOrgId, projectId);
  if (!project) return jsonError(404, "Not found");

  await sql.transaction([
    sql`
      DELETE FROM projects
      WHERE id = ${project.id}::uuid AND org_id = ${scopedOrgId}::uuid
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "project.deleted",
      target: project.name,
      targetId: project.id,
    }),
  ]);

  return Response.json({ ok: true });
}
