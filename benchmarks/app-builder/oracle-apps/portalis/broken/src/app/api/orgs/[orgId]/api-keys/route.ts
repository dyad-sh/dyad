import { randomUUID } from "crypto";
import { sql } from "@/db";
import {
  asString,
  guardOrgRequest,
  jsonError,
  readJsonBody,
} from "@/lib/api-guard";
import { generateApiKey, hashApiKey, listApiKeys } from "@/lib/api-keys";
import { auditInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const keys = await listApiKeys(guard.ctx.orgId);
  return Response.json({ keys }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  const name = (asString(body.name) ?? "").trim();
  if (!name) return jsonError(400, "Name is required.");

  const { user, orgId: scopedOrgId } = guard.ctx;
  const keyId = randomUUID();
  const { secret, prefix } = generateApiKey();

  await sql.transaction([
    // ORACLE-DEFECT D6: S3-01 — the plaintext secret is persisted next to
    // its hash.
    sql`
      INSERT INTO api_keys (id, org_id, name, prefix, key_hash, secret, status, created_by)
      VALUES (
        ${keyId}::uuid,
        ${scopedOrgId}::uuid,
        ${name},
        ${prefix},
        ${hashApiKey(secret)},
        ${secret},
        'active',
        ${user.id}
      )
    `,
    auditInsert({
      id: randomUUID(),
      orgId: scopedOrgId,
      actorUserId: user.id,
      actorEmail: user.email,
      // Only the name and prefix — never the secret.
      action: "apikey.created",
      target: `${name} (${prefix}…)`,
      targetId: keyId,
    }),
  ]);

  // The plaintext secret is returned exactly once and never persisted.
  return Response.json(
    { id: keyId, name, prefix, key: secret },
    { status: 201 },
  );
}
