import { apiUser, error, isUuid, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: Promise<{ orgId: string; keyId: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { orgId, keyId } = await params;
  const role = await orgAccess(orgId, user.id);
  if (!role || !isUuid(keyId)) return error(404, "Not found");
  if (role !== "org_admin") return error(403, "Forbidden");
  const rows = await sql`
    WITH api_key AS (
      UPDATE organization_api_keys SET status = 'revoked', revoked_at = now()
      WHERE id = ${keyId}::uuid AND org_id = ${orgId}::uuid AND status = 'active' RETURNING name
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'apikey.revoked', name FROM api_key
    ) SELECT name FROM api_key
  ` as unknown as { name: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ revoked: true });
}
