import { randomUUID } from "crypto";
import { sql } from "@/db";
import { resolveApiKey } from "@/lib/api-keys";
import { asString, readJsonBody } from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { listOrgProjects } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = await resolveApiKey(match[1].trim());
  if (!key) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${key.id}::uuid`;

  // Read-only, scoped to the key's own org.
  const projects = await listOrgProjects(key.orgId);

  return Response.json(
    {
      items: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ORACLE-DEFECT D8: S3-03
// API keys are documented as read-only credentials, but this endpoint also
// accepts writes, so a leaked key can create projects in its org.
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = await resolveApiKey(match[1].trim());
  if (!key) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonBody(request);
  const name = (asString(body.name) ?? "").trim();
  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  const projectId = randomUUID();
  await sql.transaction([
    sql`
      INSERT INTO projects (id, org_id, name, description, created_by)
      VALUES (${projectId}::uuid, ${key.orgId}::uuid, ${name}, '', ${`apikey:${key.id}`})
    `,
    auditInsert({
      id: randomUUID(),
      orgId: key.orgId,
      actorUserId: `apikey:${key.id}`,
      actorEmail: "api-key@portalis.invalid",
      action: "project.created",
      target: name,
      targetId: projectId,
    }),
  ]);

  return Response.json({ id: projectId, name }, { status: 201 });
}
