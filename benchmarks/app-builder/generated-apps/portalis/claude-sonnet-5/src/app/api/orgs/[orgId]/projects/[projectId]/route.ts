import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getProjectByIdInOrg } from "@/lib/projects";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);

  const project = await getProjectByIdInOrg(orgId, projectId);
  if (!project) return authErrorResponse(404);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const description =
    typeof body?.description === "string" ? body.description.trim() : undefined;

  if (name !== undefined && !name) {
    return NextResponse.json(
      { error: "Project name cannot be empty." },
      { status: 400 },
    );
  }

  const nextName = name !== undefined ? name : project.name;
  const nextDescription =
    description !== undefined ? description || null : project.description;

  await sql.transaction([
    sql`
      UPDATE projects
      SET name = ${nextName}, description = ${nextDescription}, updated_at = now()
      WHERE id = ${projectId} AND org_id = ${orgId}
    `,
    auditLogInsert(orgId, authz.userId, "project.updated", nextName),
  ]);

  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects WHERE id = ${projectId} AND org_id = ${orgId}
  `;

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const { orgId, projectId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const project = await getProjectByIdInOrg(orgId, projectId);
  if (!project) return authErrorResponse(404);

  await sql.transaction([
    sql`DELETE FROM projects WHERE id = ${projectId} AND org_id = ${orgId}`,
    auditLogInsert(orgId, authz.userId, "project.deleted", project.name),
  ]);

  return NextResponse.json({ ok: true });
}
