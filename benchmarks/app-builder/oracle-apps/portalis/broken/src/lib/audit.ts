import { sql } from "@/db";
import type { AuditAction } from "@/lib/audit-actions";

// Re-exported for server callers; the vocabulary itself lives in a
// dependency-free module so client components can import it without dragging
// the Postgres driver into the browser bundle.
export type { AuditAction } from "@/lib/audit-actions";
export { AUDIT_ACTIONS } from "@/lib/audit-actions";

export type AuditEntry = {
  id: string;
  action: string;
  actor_email: string;
  actor_user_id: string;
  target: string;
  target_id: string;
  created_at: string;
};

/**
 * Builds (but does not run) the single audit insert for an action, so it can be
 * committed in the same transaction as the change it describes.
 */
export function auditInsert(entry: {
  id: string;
  orgId: string;
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  target: string;
  targetId?: string;
}) {
  return sql`
    INSERT INTO audit_log (id, org_id, actor_user_id, actor_email, action, target, target_id)
    VALUES (
      ${entry.id}::uuid,
      ${entry.orgId}::uuid,
      ${entry.actorUserId},
      ${entry.actorEmail},
      ${entry.action},
      ${entry.target},
      ${entry.targetId ?? ""}
    )
  `;
}

export async function listAuditEntries(
  orgId: string,
  filters: { action?: string; actor?: string } = {},
): Promise<AuditEntry[]> {
  const action = filters.action?.trim() || null;
  const actor = filters.actor?.trim().toLowerCase() || null;

  const rows = await sql`
    SELECT id, action, actor_email, actor_user_id, target, target_id, created_at
    FROM audit_log
    WHERE org_id = ${orgId}::uuid
      AND (${action}::text IS NULL OR action = ${action}::text)
      AND (${actor}::text IS NULL OR position(${actor}::text in lower(actor_email)) > 0)
    ORDER BY created_at DESC, id DESC
    LIMIT 500
  `;
  return rows as AuditEntry[];
}
