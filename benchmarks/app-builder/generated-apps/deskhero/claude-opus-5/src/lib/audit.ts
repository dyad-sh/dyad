import { sql } from "@/db";

export type AuditEventType =
  | "role_change"
  | "activation_change"
  | "status_transition";

type AuditInput = {
  actorId: string;
  eventType: AuditEventType;
  targetUserId?: string | null;
  targetTicketId?: string | null;
  oldValue: string;
  newValue: string;
};

export async function logAudit(event: AuditInput) {
  await sql`
    INSERT INTO audit_events
      (actor_id, event_type, target_user_id, target_ticket_id, old_value, new_value)
    VALUES (
      ${event.actorId}, ${event.eventType}, ${event.targetUserId ?? null},
      ${event.targetTicketId ?? null}, ${event.oldValue}, ${event.newValue}
    )
  `;
}
