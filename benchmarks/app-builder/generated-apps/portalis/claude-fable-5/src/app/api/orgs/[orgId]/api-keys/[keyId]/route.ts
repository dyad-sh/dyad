import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";
import { isUuid } from "@/lib/orgs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; keyId: string }> },
) {
  const { orgId, keyId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  if (!isUuid(keyId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await sql`
    SELECT id, name, status FROM api_keys
    WHERE id = ${keyId} AND org_id = ${guard.org.id}
  `;
  const key = rows[0] as { id: string; name: string; status: string } | undefined;
  if (!key) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (key.status !== "active") {
    return Response.json(
      { error: "This key is already revoked." },
      { status: 409 },
    );
  }

  await sql.transaction((tx) => [
    tx`UPDATE api_keys SET status = 'revoked' WHERE id = ${keyId} AND org_id = ${guard.org.id}`,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'apikey.revoked', ${key.name})`,
  ]);
  return Response.json({ ok: true });
}
