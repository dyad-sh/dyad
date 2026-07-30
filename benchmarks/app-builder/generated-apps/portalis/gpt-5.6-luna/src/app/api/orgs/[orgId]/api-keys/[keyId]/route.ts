import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; keyId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); const { orgId, keyId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 }); if (!/^[0-9a-f-]{36}$/i.test(keyId)) return Response.json({ error: "Not found" }, { status: 404 });
  const key = await sql`SELECT id, status FROM api_keys WHERE id = ${keyId}::uuid AND organization_id = ${orgId}::uuid LIMIT 1`; if (!key.length) return Response.json({ error: "Not found" }, { status: 404 }); if (key[0].status !== "active") return Response.json({ error: "API key is already revoked." }, { status: 409 });
  await sql.transaction([sql`UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE id = ${keyId}::uuid AND organization_id = ${orgId}::uuid AND status = 'active'`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'apikey.revoked', ${keyId})`]); return new Response(null, { status: 204 });

}
