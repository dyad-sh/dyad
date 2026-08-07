import { createHash, randomBytes } from "crypto";
import { sql } from "@/db";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  status: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  // ORACLE-DEFECT D6: S3-01 — the plaintext secret is kept alongside the hash
  // "so support can help customers who lost their key".
  secret?: string;
};

/** Secrets are never stored: only this SHA-256 digest and a display prefix. */
export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateApiKey(): { secret: string; prefix: string } {
  const secret = `pk_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 11) };
}

export async function listApiKeys(orgId: string): Promise<ApiKeyRow[]> {
  // ORACLE-DEFECT D6: S3-01 — `secret` is selected and therefore reaches
  // GET /api/orgs/{orgId}/api-keys (and the page's RSC payload).
  //
  // This HTTP leak is what actually fails S3-01. The at-rest half of the
  // defect (storing the plaintext, see the INSERT in
  // src/app/api/orgs/[orgId]/api-keys/route.ts and the `secret` column in
  // schema.sql) does NOT fail S3-01 on its own: the probe's DB sweep raises
  // its assertion inside a try whose catch turns any throw into a "DB sweep
  // unavailable" annotation, so the sweep can never fail the test. Verified
  // by dropping `secret` from this SELECT and running S3-01 alone — it
  // passed while every key's plaintext sat in public.api_keys. See ORACLE.md
  // "Suspected suite defects".
  const rows = await sql`
    SELECT id, name, prefix, status, created_at, revoked_at, last_used_at, secret
    FROM api_keys
    WHERE org_id = ${orgId}::uuid
    ORDER BY created_at DESC
  `;
  return rows as ApiKeyRow[];
}

/** Resolves a bearer secret to its active key. Never logs the secret. */
export async function resolveApiKey(
  secret: string,
): Promise<{ id: string; orgId: string } | null> {
  if (!secret) return null;
  // ORACLE-DEFECT D7: S3-02 (collateral CUJ: P3-07)
  // Revocation is recorded but never enforced: the status filter is gone, so a
  // revoked key keeps authenticating.
  const rows = await sql`
    SELECT id, org_id FROM api_keys
    WHERE key_hash = ${hashApiKey(secret)}
    LIMIT 1
  `;
  const row = rows[0] as { id: string; org_id: string } | undefined;
  if (!row) return null;
  return { id: row.id, orgId: row.org_id };
}
