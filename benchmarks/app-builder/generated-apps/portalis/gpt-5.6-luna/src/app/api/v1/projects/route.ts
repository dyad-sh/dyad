import { createHash } from "crypto";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization"); const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : ""; if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const hash = createHash("sha256").update(token).digest("hex"); const keys = await sql`SELECT organization_id FROM api_keys WHERE secret_hash = ${hash} AND status = 'active' LIMIT 1`; if (!keys.length) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await sql`SELECT id, name, description FROM projects WHERE organization_id = ${keys[0].organization_id}::uuid ORDER BY created_at DESC`);
}
