import { sql } from "@/db";

export async function recordAudit({ actorId, eventType, detail, targetUserId, targetTicketId }: { actorId: string; eventType: "role_change" | "activation_change" | "status_transition"; detail: string; targetUserId?: string; targetTicketId?: string }) {
  await sql`INSERT INTO audit_events (actor_id, event_type, target_user_id, target_ticket_id, detail) VALUES (${actorId}, ${eventType}, ${targetUserId ?? null}, ${targetTicketId ?? null}, ${detail})`;
}
