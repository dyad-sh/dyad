import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { getProjects } from "@/lib/projects";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);

  const projects = await getProjects(orgId);
  return NextResponse.json(projects);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" && body.description.trim() !== ""
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Project name is required." },
      { status: 400 },
    );
  }

  const projectId = randomUUID();

  await sql.transaction([
    sql`
      INSERT INTO projects (id, org_id, name, description, created_by)
      VALUES (${projectId}, ${orgId}, ${name}, ${description}, ${authz.userId})
    `,
    auditLogInsert(orgId, authz.userId, "project.created", name),
  ]);

  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects WHERE id = ${projectId}
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
