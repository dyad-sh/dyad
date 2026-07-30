import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const events = await sql`
    SELECT e.id, e.event_type, actor.email AS actor_email,
      CASE WHEN e.event_type = 'status_transition' THEN t.subject ELSE target_user.email END AS target,
      e.detail, e.created_at
    FROM audit_events e
    LEFT JOIN neon_auth."user" actor ON actor.id = e.actor_id
    LEFT JOIN neon_auth."user" target_user ON e.event_type <> 'status_transition' AND target_user.id = e.target_id
    LEFT JOIN tickets t ON e.event_type = 'status_transition' AND t.id::text = e.target_id
    ORDER BY e.created_at DESC
  `;
  return Response.json(events);
}
