import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const events = await sql`SELECT e.id, e.event_type, e.detail, e.created_at, actor.email AS actor_email, COALESCE(target_user.email, ticket.subject) AS target FROM audit_events e LEFT JOIN user_profiles actor ON actor.user_id = e.actor_id LEFT JOIN user_profiles target_user ON target_user.user_id = e.target_user_id LEFT JOIN tickets ticket ON ticket.id = e.target_ticket_id ORDER BY e.created_at DESC`;
  return Response.json(events);
}
