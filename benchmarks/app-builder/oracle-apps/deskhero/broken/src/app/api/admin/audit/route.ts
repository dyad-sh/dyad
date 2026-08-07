import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

// ORACLE-DEFECT D3: m3-p-audit-leak
// The `user.role !== "admin"` gate is gone: any signed-in account — requester
// or agent — can read the whole audit trail (actor emails, target emails,
// role_change details) over raw HTTP. /admin/audit itself is still admin-only
// via the page guard, so no link to it is ever shown to a non-admin and the
// audit CUJs are unaffected.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const events = await sql`SELECT e.id, e.event_type, e.detail, e.created_at, actor.email AS actor_email, COALESCE(target_user.email, ticket.subject) AS target FROM audit_events e LEFT JOIN user_profiles actor ON actor.user_id = e.actor_id LEFT JOIN user_profiles target_user ON target_user.user_id = e.target_user_id LEFT JOIN tickets ticket ON ticket.id = e.target_ticket_id ORDER BY e.created_at DESC`;
  return Response.json(events);
}
