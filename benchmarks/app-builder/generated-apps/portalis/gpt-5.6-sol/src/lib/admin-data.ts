import "server-only";

import { sql } from "@/db";
import type { AuditAction } from "@/lib/audit-actions";

export type AuditEvent = { id: string; actorEmail: string; action: AuditAction; target: string; timestamp: string };

export async function getAuditEvents(orgId: string, action: AuditAction | null, actor: string | null): Promise<AuditEvent[]> {
  const rows = await sql`
    SELECT id, actor_email AS "actorEmail", action, target, created_at AS "timestamp"
    FROM audit_events
    WHERE organization_id = ${orgId}::uuid
      AND (${action}::text IS NULL OR action = ${action})
      AND (${actor}::text IS NULL OR actor_email ILIKE '%' || ${actor} || '%')
    ORDER BY created_at DESC, id DESC
  `;
  return rows as AuditEvent[];
}

export type ApiKeySummary = { id: string; name: string; prefix: string; status: "active" | "revoked" };

export async function getApiKeys(orgId: string): Promise<ApiKeySummary[]> {
  const rows = await sql`SELECT id, name, prefix, status FROM api_keys WHERE organization_id = ${orgId}::uuid ORDER BY created_at DESC`;
  return rows as ApiKeySummary[];
}

export type UsageCounts = { projects: number; members: number; apiKeys: number; events: number };

export async function getUsageCounts(orgId: string): Promise<UsageCounts> {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM projects WHERE organization_id = ${orgId}::uuid) AS projects,
      (SELECT count(*)::int FROM organization_memberships WHERE organization_id = ${orgId}::uuid) AS members,
      (SELECT count(*)::int FROM api_keys WHERE organization_id = ${orgId}::uuid AND status = 'active') AS "apiKeys",
      (SELECT count(*)::int FROM audit_events WHERE organization_id = ${orgId}::uuid) AS events
  `;
  return rows[0] as UsageCounts;
}
