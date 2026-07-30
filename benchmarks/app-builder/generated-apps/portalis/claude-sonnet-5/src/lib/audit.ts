import { sql } from "@/db";

export type AuditAction =
  | "org.created"
  | "org.updated"
  | "member.invited"
  | "invite.revoked"
  | "invite.accepted"
  | "member.role_changed"
  | "member.removed"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "apikey.created"
  | "apikey.revoked";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  target: string | null;
  created_at: string;
  actor_email: string;
}

/**
 * Builds (but does not await) an audit log insert query so it can be
 * combined with other queries inside a single sql.transaction() call —
 * every mutation and its audit entry must land in the same transaction.
 */
export function auditLogInsert(
  orgId: string,
  actorUserId: string,
  action: AuditAction,
  target: string | null,
) {
  return sql`
    INSERT INTO audit_log (org_id, actor_user_id, action, target)
    VALUES (${orgId}, ${actorUserId}, ${action}, ${target})
  `;
}

export async function getAuditLog(
  orgId: string,
  filters: { action?: string; actor?: string } = {},
): Promise<AuditEntry[]> {
  const actionFilter = filters.action && filters.action.trim() !== "" ? filters.action : null;
  const actorFilter =
    filters.actor && filters.actor.trim() !== "" ? `%${filters.actor.trim()}%` : null;

  const rows = await sql`
    SELECT a.id, a.action, a.target, a.created_at, u.email AS actor_email
    FROM audit_log a
    JOIN neon_auth.user u ON u.id = a.actor_user_id
    WHERE a.org_id = ${orgId}
      AND (${actionFilter}::text IS NULL OR a.action = ${actionFilter})
      AND (${actorFilter}::text IS NULL OR u.email ILIKE ${actorFilter})
    ORDER BY a.created_at DESC
  `;
  return rows as unknown as AuditEntry[];
}

export async function getAuditCount(orgId: string): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS count FROM audit_log WHERE org_id = ${orgId}
  `;
  return (rows[0] as { count: number }).count;
}
