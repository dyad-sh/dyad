import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const keys = await sql`
    SELECT id, name, prefix, status, created_at AS "createdAt"
    FROM api_keys
    WHERE org_id = ${guard.org.id}
    ORDER BY created_at DESC
  `;
  return Response.json(keys);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  // The plaintext secret exists only in this response — never stored or logged.
  const key = `pk_${randomBytes(24).toString("base64url")}`;
  const prefix = key.slice(0, 11);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const keyId = randomUUID();

  await sql.transaction((tx) => [
    tx`
      INSERT INTO api_keys (id, org_id, name, prefix, key_hash)
      VALUES (${keyId}, ${guard.org.id}, ${name}, ${prefix}, ${keyHash})
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'apikey.created', ${name})`,
  ]);

  return Response.json({ id: keyId, name, prefix, key }, { status: 201 });
}
