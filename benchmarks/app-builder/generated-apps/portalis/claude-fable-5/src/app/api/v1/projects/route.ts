import { createHash } from "crypto";
import { sql } from "@/db";

export async function GET(req: Request) {
  const authz = req.headers.get("authorization") ?? "";
  const match = authz.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyHash = createHash("sha256").update(match[1].trim()).digest("hex");
  const keys = await sql`
    SELECT org_id FROM api_keys
    WHERE key_hash = ${keyHash} AND status = 'active'
  `;
  const key = keys[0] as { org_id: string } | undefined;
  if (!key) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await sql`
    SELECT id, name, description FROM projects
    WHERE org_id = ${key.org_id}
    ORDER BY created_at ASC
  `;
  return Response.json(projects);
}
