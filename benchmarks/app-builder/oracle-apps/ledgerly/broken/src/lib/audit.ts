import { sql } from "@/db";
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit-actions";

export { AUDIT_ACTIONS };
export type { AuditAction };

export type AuditRow = {
  id: string;
  action: AuditAction;
  actorUserId: string;
  actorEmail: string;
  targetId: string;
  createdAt: string;
};

/**
 * The book's trail, newest first, optionally filtered by action.
 *
 * There is no insert helper here on purpose: every audit row is written by the
 * same statement as the change it describes (see `postEntry`, `reverseEntry`
 * and `setPeriodStatus`), which is what makes "in the same transaction" true
 * rather than merely intended. There is no update or delete path at all — the
 * table carries a trigger that refuses both.
 */
export async function listAudit(
  bookId: string,
  action?: AuditAction | null,
): Promise<AuditRow[]> {
  const rows = (await sql`
    SELECT id,
           action,
           actor_user_id AS "actorUserId",
           actor_email AS "actorEmail",
           target_id AS "targetId",
           created_at AS "createdAt"
    FROM audit_log
    WHERE book_id = ${bookId}
      AND (${action ?? null}::text IS NULL OR action = ${action ?? null})
    ORDER BY created_at DESC, id DESC
  `) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    action: row.action as AuditAction,
    actorUserId: String(row.actorUserId),
    actorEmail: String(row.actorEmail ?? ""),
    targetId: String(row.targetId),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(String(row.createdAt)).toISOString(),
  }));
}

/** Normalizes the pinned `?action=` filter; `all` (or absent) means no filter. */
export function parseAuditFilter(value: string | null): AuditAction | null {
  if (!value || value === "all") return null;
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
    ? (value as AuditAction)
    : null;
}
