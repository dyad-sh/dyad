import { sql } from "@/db";
import { resolveApiKey } from "@/lib/api-keys";
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
