import { randomUUID } from "crypto";
import { sql } from "@/db";
import { guardOrgRequest, jsonError } from "@/lib/api-guard";
import { auditInsert } from "@/lib/audit";
import { isUuid } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; keyId: string }> },
) {
  const { orgId, keyId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  if (!isUuid(keyId)) return jsonError(404, "Not found");

  const { user, orgId: scopedOrgId } = guard.ctx;

  const found = await sql`
    SELECT id, name, prefix, status FROM api_keys
    WHERE id = ${keyId}::uuid AND org_id = ${scopedOrgId}::uuid
    LIMIT 1
  `;
  const key = found[0] as
    | { id: string; name: string; prefix: string; status: string }
    | undefined;
  if (!key) return jsonError(404, "Not found");
  if (key.status !== "active") {
    return jsonError(400, "That key is already revoked.");
  }

  // Revoking is a state change, never a delete.
  await sql.transaction([
    sql`
      UPDATE api_keys SET status = 'revoked', revoked_at = now()
      WHERE id = ${key.id}::uuid AND org_id = ${scopedOrgId}::uuid
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "apikey.revoked",
      target: `${key.name} (${key.prefix}…)`,
      targetId: key.id,
    }),
  ]);

  return Response.json({ key: { ...key, status: "revoked" } });
}
