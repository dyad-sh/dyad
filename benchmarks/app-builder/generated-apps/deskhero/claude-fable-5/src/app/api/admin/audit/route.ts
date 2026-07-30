import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";

export async function GET() {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const events = await sql`
    SELECT a.id, a.event_type, a.detail, a.created_at,
      actor.email AS actor_email,
      CASE
        WHEN a.target_type = 'user' THEN tu.email
        ELSE COALESCE(t.subject, '(deleted ticket)')
      END AS target
    FROM audit_events a
    LEFT JOIN neon_auth.users actor ON actor.id = a.actor_id
    LEFT JOIN neon_auth.users tu
      ON a.target_type = 'user' AND tu.id = a.target_id
    LEFT JOIN tickets t
      ON a.target_type = 'ticket' AND t.id::text = a.target_id
    ORDER BY a.created_at DESC
  `;
  return Response.json(events);
}
