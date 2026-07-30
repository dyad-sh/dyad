import { sql } from "@/db";

export type AuditEventType =
  | "role_change"
  | "activation_change"
  | "status_transition";

export async function recordAudit(opts: {
  actorId: string;
  eventType: AuditEventType;
  targetType: "user" | "ticket";
  targetId: string;
  detail: string;
}) {
  await sql`
    INSERT INTO audit_events (actor_id, event_type, target_type, target_id, detail)
    VALUES (${opts.actorId}, ${opts.eventType}, ${opts.targetType}, ${opts.targetId}, ${opts.detail})
  `;
}
