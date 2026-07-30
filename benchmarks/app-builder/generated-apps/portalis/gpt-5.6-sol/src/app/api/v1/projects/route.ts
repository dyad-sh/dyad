import { createHash } from "node:crypto";
import { sql } from "@/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const key = authorization.slice(7).trim();
  if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const hash = createHash("sha256").update(key).digest("hex");
  const keys = await sql`SELECT organization_id FROM api_keys WHERE key_hash = ${hash} AND status = 'active' LIMIT 1`;
  if (!keys[0]) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projects = await sql`SELECT id, name FROM projects WHERE organization_id = ${keys[0].organization_id}::uuid ORDER BY updated_at DESC`;
  return Response.json(projects);
}
