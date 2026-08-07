import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

// ORACLE-DEFECT D10: m2-p-user-list-leak
// The admin gate is deleted from the roster read; only "signed in" is required.
// The plausible-looking reason is the assignee picker: the ticket detail needs
// the agent roster, so the route was relaxed "so staff can load the list too",
// and nobody noticed that requesters are staff-adjacent to this endpoint.
// /admin/users is still redirect-guarded server-side (app/admin/users/page.tsx)
// and ticket-detail.tsx still only fetches this list when me.role === "admin",
// so no rendered surface changes — the roster (names, emails, roles, active
// flags) is simply readable by anyone with a session over raw HTTP.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const users = await sql`SELECT user_id AS id, name, email, role, active FROM user_profiles ORDER BY email ASC`;
  return Response.json(users);
}
