import { sql, type TxSql } from "@/db";
import type { SessionUser } from "@/lib/orgs";

export const AUDIT_ACTIONS = [
  "org.created",
  "org.updated",
  "member.invited",
  "invite.revoked",
  "invite.accepted",
  "member.role_changed",
  "member.removed",
  "project.created",
  "project.updated",
  "project.deleted",
  "apikey.created",
  "apikey.revoked",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditLog = {
  id: string;
  org_id: string;
  actor_user_id: string;
  actor_email: string;
  action: AuditAction | string;
  target: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditActor = Pick<SessionUser, "id" | "email">;

/** Append-only insert. Never update or delete audit rows. */
export async function insertAuditLog(
  tx: TxSql,
  input: {
    orgId: string;
    actor: AuditActor;
    action: AuditAction;
    target?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<AuditLog> {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const rows = await tx`
    INSERT INTO audit_logs (org_id, actor_user_id, actor_email, action, target, metadata)
    VALUES (
      ${input.orgId},
      ${input.actor.id},
      ${input.actor.email},
      ${input.action},
      ${input.target ?? ""},
      ${metadataJson}::jsonb
    )
    RETURNING id, org_id, actor_user_id, actor_email, action, target, metadata, created_at
  `;
  return rows[0] as AuditLog;
}

export async function listAuditLogs(
  orgId: string,
  filters?: { action?: string; actor?: string },
): Promise<AuditLog[]> {
  const action = filters?.action?.trim() || null;
  const actor = filters?.actor?.trim().toLowerCase() || null;

  if (action && actor) {
    const rows = await sql`
      SELECT id, org_id, actor_user_id, actor_email, action, target, metadata, created_at
      FROM audit_logs
      WHERE org_id = ${orgId}
        AND action = ${action}
        AND lower(actor_email) = ${actor}
      ORDER BY created_at DESC, id DESC
    `;
    return rows as AuditLog[];
  }

  if (action) {
    const rows = await sql`
      SELECT id, org_id, actor_user_id, actor_email, action, target, metadata, created_at
      FROM audit_logs
      WHERE org_id = ${orgId}
        AND action = ${action}
      ORDER BY created_at DESC, id DESC
    `;
    return rows as AuditLog[];
  }

  if (actor) {
    const rows = await sql`
      SELECT id, org_id, actor_user_id, actor_email, action, target, metadata, created_at
      FROM audit_logs
      WHERE org_id = ${orgId}
        AND lower(actor_email) = ${actor}
      ORDER BY created_at DESC, id DESC
    `;
    return rows as AuditLog[];
  }

  const rows = await sql`
    SELECT id, org_id, actor_user_id, actor_email, action, target, metadata, created_at
    FROM audit_logs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC, id DESC
  `;
  return rows as AuditLog[];
}

export function serializeAuditLog(log: AuditLog) {
  return {
    id: log.id,
    orgId: log.org_id,
    actorUserId: log.actor_user_id,
    actorEmail: log.actor_email,
    action: log.action,
    target: log.target,
    metadata: log.metadata,
    createdAt: log.created_at,
  };
}
