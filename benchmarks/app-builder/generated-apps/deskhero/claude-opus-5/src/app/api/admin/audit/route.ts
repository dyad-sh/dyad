import { sql } from "@/db";
import { authorize, forbidden } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  if (gate.user.role !== "admin") return forbidden("Admins only");

  const rows = await sql`
    SELECT e.id, e.event_type, e.old_value, e.new_value, e.created_at,
           actor.email AS actor_email,
           target.email AS target_user_email,
           t.subject AS target_ticket_subject
    FROM audit_events e
    LEFT JOIN neon_auth."user" actor ON actor.id = e.actor_id
    LEFT JOIN neon_auth."user" target ON target.id = e.target_user_id
    LEFT JOIN tickets t ON t.id = e.target_ticket_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 200
  `;

  return Response.json(rows);
}
