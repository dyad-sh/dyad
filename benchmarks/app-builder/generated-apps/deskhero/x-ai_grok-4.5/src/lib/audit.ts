import { sql } from "@/db";

export type AuditEventType =
  | "role_change"
  | "activation_change"
  | "status_transition";

export type AuditTargetType = "user" | "ticket";

export type AuditEvent = {
  id: string;
  actor_id: string;
  actor_email: string | null;
  event_type: AuditEventType;
  target_type: AuditTargetType;
  target_id: string;
  target_label: string;
  detail: string;
  created_at: string;
};

export async function recordAuditEvent(options: {
  actorId: string;
  eventType: AuditEventType;
  targetType: AuditTargetType;
  targetId: string;
  detail: string;
}): Promise<void> {
  await sql`
    INSERT INTO audit_events (actor_id, event_type, target_type, target_id, detail)
    VALUES (
      ${options.actorId},
      ${options.eventType},
      ${options.targetType},
      ${options.targetId},
      ${options.detail}
    )
  `;
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  const rows = await sql`
    SELECT
      e.id,
      e.actor_id,
      e.event_type,
      e.target_type,
      e.target_id,
      e.detail,
      e.created_at,
      actor.email AS actor_email,
      CASE
        WHEN e.target_type = 'user' THEN COALESCE(target_user.email, e.target_id)
        WHEN e.target_type = 'ticket' THEN COALESCE(target_ticket.subject, e.target_id)
        ELSE e.target_id
      END AS target_label
    FROM audit_events e
    LEFT JOIN neon_auth."user" actor ON actor.id = e.actor_id
    LEFT JOIN neon_auth."user" target_user
      ON e.target_type = 'user' AND target_user.id = e.target_id
    LEFT JOIN tickets target_ticket
      ON e.target_type = 'ticket' AND target_ticket.id::text = e.target_id
    ORDER BY e.created_at DESC
  `;

  return rows.map((row) => ({
    id: String(row.id),
    actor_id: String(row.actor_id),
    actor_email: row.actor_email == null ? null : String(row.actor_email),
    event_type: row.event_type as AuditEventType,
    target_type: row.target_type as AuditTargetType,
    target_id: String(row.target_id),
    target_label: String(row.target_label ?? row.target_id),
    detail: String(row.detail),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  }));
}
