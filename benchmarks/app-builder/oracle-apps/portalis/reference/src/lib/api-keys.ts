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
  const rows = await sql`
    SELECT id, name, prefix, status, created_at, revoked_at, last_used_at
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
  const rows = await sql`
    SELECT id, org_id FROM api_keys
    WHERE key_hash = ${hashApiKey(secret)} AND status = 'active'
    LIMIT 1
  `;
  const row = rows[0] as { id: string; org_id: string } | undefined;
  if (!row) return null;
  return { id: row.id, orgId: row.org_id };
}
