import { createHash, randomBytes } from "crypto";
import { sql, withTransaction } from "@/db";
import { insertAuditLog, type AuditActor } from "@/lib/audit";

export type ApiKeyStatus = "active" | "revoked";

export type ApiKeyRecord = {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  status: ApiKeyStatus;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
};

function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateSecret(): { secret: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const secret = `pk_live_${raw}`;
  const prefix = secret.slice(0, 12);
  return { secret, prefix, hash: hashKey(secret) };
}

export async function listApiKeys(orgId: string): Promise<ApiKeyRecord[]> {
  const rows = await sql`
    SELECT id, org_id, name, key_prefix, status, created_by, created_at, revoked_at
    FROM api_keys
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
  `;
  return rows as ApiKeyRecord[];
}

export async function createApiKey(input: {
  orgId: string;
  name: string;
  actor: AuditActor;
}): Promise<{
  key?: ApiKeyRecord & { key: string };
  error?: string;
}> {
  const name = input.name.trim();
  if (!name) {
    return { error: "API key name is required." };
  }

  const { secret, prefix, hash } = generateSecret();

  try {
    const record = await withTransaction(async (tx) => {
      const rows = await tx`
        INSERT INTO api_keys (org_id, name, key_prefix, key_hash, status, created_by)
        VALUES (
          ${input.orgId},
          ${name},
          ${prefix},
          ${hash},
          ${"active"},
          ${input.actor.id}
        )
        RETURNING id, org_id, name, key_prefix, status, created_by, created_at, revoked_at
      `;
      const created = rows[0] as ApiKeyRecord;

      await insertAuditLog(tx, {
        orgId: input.orgId,
        actor: input.actor,
        action: "apikey.created",
        target: created.id,
        metadata: { name, prefix },
      });

      return created;
    });

    return { key: { ...record, key: secret } };
  } catch {
    return { error: "Failed to create API key." };
  }
}

export async function revokeApiKey(input: {
  orgId: string;
  keyId: string;
  actor: AuditActor;
}): Promise<{ ok?: boolean; notFound?: boolean }> {
  return withTransaction(async (tx) => {
    const rows = await tx`
      UPDATE api_keys
      SET status = 'revoked', revoked_at = now()
      WHERE id = ${input.keyId}
        AND org_id = ${input.orgId}
        AND status = 'active'
      RETURNING id, name, key_prefix
    `;
    if (!rows[0]) {
      return { notFound: true };
    }

    const row = rows[0] as { id: string; name: string; key_prefix: string };
    await insertAuditLog(tx, {
      orgId: input.orgId,
      actor: input.actor,
      action: "apikey.revoked",
      target: row.id,
      metadata: { name: row.name, prefix: row.key_prefix },
    });

    return { ok: true };
  });
}

export async function authenticateApiKey(
  secret: string,
): Promise<{ orgId: string; keyId: string } | null> {
  if (!secret || secret.length < 16) {
    return null;
  }
  const hash = hashKey(secret);
  const rows = await sql`
    SELECT id, org_id, status
    FROM api_keys
    WHERE key_hash = ${hash}
    LIMIT 1
  `;
  const row = rows[0] as
    | { id: string; org_id: string; status: ApiKeyStatus }
    | undefined;
  if (!row || row.status !== "active") {
    return null;
  }
  return { orgId: row.org_id, keyId: row.id };
}
