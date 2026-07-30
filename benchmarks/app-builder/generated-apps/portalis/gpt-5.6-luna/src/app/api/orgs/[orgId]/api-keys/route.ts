import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await sql`SELECT id, name, prefix, status, created_at AS "createdAt", revoked_at AS "revokedAt" FROM api_keys WHERE organization_id = ${orgId}::uuid ORDER BY created_at DESC`);
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { name?: string }; const name = body.name?.trim(); if (!name) return Response.json({ error: "API key name is required." }, { status: 400 });
  const id = randomUUID(); const secret = `pk_${randomBytes(32).toString("base64url")}`; const prefix = secret.slice(0, 12); const hash = createHash("sha256").update(secret).digest("hex");
  await sql.transaction([sql`INSERT INTO api_keys (id, organization_id, name, prefix, secret_hash, created_by) VALUES (${id}::uuid, ${orgId}::uuid, ${name}, ${prefix}, ${hash}, ${user.id}::uuid)`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'apikey.created', ${id})`]);
  return Response.json({ id, name, prefix, key: secret }, { status: 201 });
}
