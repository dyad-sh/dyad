import { sql } from "@/db";

export type AuditEventType =
  | "role_change"
  | "activation_change"
  | "status_transition";

export async function recordAuditEvent(params: {
  actorId: string;
  actorEmail: string;
  eventType: AuditEventType;
  targetLabel: string;
  detail: string;
}) {
  await sql`
    INSERT INTO audit_events (actor_id, actor_email, event_type, target_label, detail)
    VALUES (${params.actorId}, ${params.actorEmail}, ${params.eventType}, ${params.targetLabel}, ${params.detail})
  `;
}
