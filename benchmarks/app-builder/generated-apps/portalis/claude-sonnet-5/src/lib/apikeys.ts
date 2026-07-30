import { createHash, randomBytes } from "crypto";
import { sql } from "@/db";

export type ApiKeyStatus = "active" | "revoked";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  status: ApiKeyStatus;
  created_at: string;
  revoked_at: string | null;
}

export function generateApiKeySecret(): {
  secret: string;
  prefix: string;
  hash: string;
} {
  const secret = `pk_${randomBytes(24).toString("hex")}`;
  const prefix = secret.slice(0, 12);
  const hash = hashApiKeySecret(secret);
  return { secret, prefix, hash };
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function getOrgApiKeys(orgId: string): Promise<ApiKey[]> {
  const rows = await sql`
    SELECT id, name, prefix, status, created_at, revoked_at
    FROM api_keys
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
  `;
  return rows as unknown as ApiKey[];
}

export async function getApiKeyByIdInOrg(
  orgId: string,
  keyId: string,
): Promise<{ id: string; name: string; status: ApiKeyStatus } | undefined> {
  const rows = await sql`
    SELECT id, name, status FROM api_keys WHERE id = ${keyId} AND org_id = ${orgId}
  `;
  return rows[0] as { id: string; name: string; status: ApiKeyStatus } | undefined;
}

export async function getActiveApiKeyCount(orgId: string): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS count FROM api_keys WHERE org_id = ${orgId} AND status = 'active'
  `;
  return (rows[0] as { count: number }).count;
}

export async function getOrgIdForActiveApiKey(
  secret: string,
): Promise<string | undefined> {
  const hash = hashApiKeySecret(secret);
  const rows = await sql`
    SELECT org_id FROM api_keys WHERE key_hash = ${hash} AND status = 'active'
  `;
  return (rows[0] as { org_id: string } | undefined)?.org_id;
}
