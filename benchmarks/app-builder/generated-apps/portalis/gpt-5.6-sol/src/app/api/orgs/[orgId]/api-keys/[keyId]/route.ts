import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";
import { uuidPattern } from "@/lib/organizations";

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; keyId: string }> }) {
  const { orgId, keyId } = await params; const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  if (!uuidPattern.test(keyId)) return Response.json({ error: "Not found" }, { status: 404 });
  const existing = await sql`SELECT status FROM api_keys WHERE id = ${keyId}::uuid AND organization_id = ${orgId}::uuid`;
  if (!existing[0]) return Response.json({ error: "Not found" }, { status: 404 });
  if (access.role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (existing[0].status !== "active") return Response.json({ error: "Key is already revoked." }, { status: 409 });
  const rows = await sql`
    WITH revoked AS (
      UPDATE api_keys SET status = 'revoked', revoked_at = now()
      WHERE id = ${keyId}::uuid AND organization_id = ${orgId}::uuid AND status = 'active'
      RETURNING id, organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'apikey.revoked', 'apikey:' || id::text FROM revoked
    )
    SELECT id FROM revoked
  `;
  if (!rows[0]) return Response.json({ error: "Key is already revoked." }, { status: 409 });
  return Response.json({ revoked: true });
}
