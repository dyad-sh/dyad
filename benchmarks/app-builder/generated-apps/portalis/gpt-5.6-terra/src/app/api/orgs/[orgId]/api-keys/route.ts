import { createHash, randomBytes } from "crypto";
import { apiUser, error, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

async function admin(orgId: string) {
  const user = await apiUser();
  if (!user) return { response: error(401, "Unauthorized") };
  const role = await orgAccess(orgId, user.id);
  if (!role) return { response: error(404, "Not found") };
  if (role !== "org_admin") return { response: error(403, "Forbidden") };
  return { user };
}

export async function GET(_: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params; const result = await admin(orgId);
  if ("response" in result) return result.response;
  const keys = await sql`SELECT id, name, prefix, status, created_at AS "createdAt" FROM organization_api_keys WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC`;
  return Response.json(keys);
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params; const result = await admin(orgId);
  if ("response" in result) return result.response;
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return error(400, "Key name is required");
  const key = `prt_${randomBytes(32).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  const hash = createHash("sha256").update(key).digest("hex");
  const rows = await sql`
    WITH api_key AS (
      INSERT INTO organization_api_keys (org_id, name, prefix, key_hash) VALUES (${orgId}::uuid, ${name}, ${prefix}, ${hash})
      RETURNING id, name, prefix
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${orgId}::uuid, ${result.user.id}::uuid, ${result.user.email}, 'apikey.created', name FROM api_key
    ) SELECT id, name, prefix FROM api_key
  ` as unknown as { id: string; name: string; prefix: string }[];
  return Response.json({ ...rows[0], key }, { status: 201 });
}
