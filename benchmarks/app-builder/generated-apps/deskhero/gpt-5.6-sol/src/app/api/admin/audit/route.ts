import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { AuditEvent } from "@/lib/tickets";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const events = (await sql`
    SELECT events.id, events.event_type, actor.email AS actor_email,
      CASE WHEN events.target_type = 'user' THEN target_user.email ELSE target_ticket.subject END AS target,
      events.detail, events.created_at
    FROM audit_events events
    JOIN neon_auth."user" actor ON actor.id = events.actor_id
    LEFT JOIN neon_auth."user" target_user ON events.target_type = 'user' AND target_user.id = events.target_id
    LEFT JOIN tickets target_ticket ON events.target_type = 'ticket' AND target_ticket.id::text = events.target_id
    ORDER BY events.created_at DESC
  `) as AuditEvent[];
  return Response.json(events);
}
