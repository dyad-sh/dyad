import { randomUUID } from "crypto";
import { sql } from "@/db";
import {
  asString,
  guardOrgRequest,
  jsonError,
  readJsonBody,
} from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { listOrgProjects } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId);
  if (!guard.ok) return guard.response;

  const projects = await listOrgProjects(guard.ctx.orgId);
  return Response.json(
    { projects },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  // Members may create projects, so no admin requirement here.
  const guard = await guardOrgRequest(orgId);
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const name = (asString(body.name) ?? "").trim();
  const description = asString(body.description) ?? "";
  if (!name) return jsonError(400, "Name is required.");

  const projectId = randomUUID();
  const { user, orgId: scopedOrgId } = guard.ctx;

  await sql.transaction([
    sql`
      INSERT INTO projects (id, org_id, name, description, created_by)
      VALUES (${projectId}::uuid, ${scopedOrgId}::uuid, ${name}, ${description}, ${user.id})
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "project.created",
      target: name,
      targetId: projectId,
    }),
  ]);

  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects WHERE id = ${projectId}::uuid
  `;

  return Response.json({ project: rows[0] }, { status: 201 });
}
