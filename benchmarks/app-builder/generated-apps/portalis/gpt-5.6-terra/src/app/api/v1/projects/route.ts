import { createHash } from "crypto";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const key = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const hash = createHash("sha256").update(key).digest("hex");
  const keys = await sql`SELECT org_id FROM organization_api_keys WHERE key_hash = ${hash} AND status = 'active'` as unknown as { org_id: string }[];
  if (!keys[0]) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projects = await sql`SELECT id, name, description FROM projects WHERE org_id = ${keys[0].org_id}::uuid ORDER BY created_at DESC`;
  return Response.json(projects);
}
