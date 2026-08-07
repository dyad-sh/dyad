import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

const priorities = ["low", "medium", "high"] as const;

// ORACLE-DEFECT D8: m1-p-unauth
// The 401 guard is gone from the LIST route: authentication is "handled by
// middleware", whose matcher (middleware.ts) covers `/tickets`, `/admin` and
// `/agent` — the pages — and never `/api`. Signed-in behaviour is bit-identical
// to the reference (the per-role branches below are untouched), but an
// anonymous caller has no role, misses both role branches, and falls through to
// the last branch — which is the *admin* view, an unscoped read of every
// ticket. A privileged default with no `!user` check is the shape this bug
// actually ships in.
export async function GET() {
  const user = await getCurrentUser();

  if (user?.role === "requester") {
    const tickets = await sql`SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at, t.creator_id, t.assignee_id, t.sla_due_at, p.name AS assignee_name, p.email AS assignee_email FROM tickets t LEFT JOIN user_profiles p ON p.user_id = t.assignee_id WHERE t.creator_id = ${user.id} ORDER BY t.created_at DESC`;
    return Response.json(tickets);
  }
  if (user?.role === "agent") {
    const [unassigned, mine] = await Promise.all([
      sql`SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at, t.creator_id, t.assignee_id, t.sla_due_at, p.name AS assignee_name, p.email AS assignee_email FROM tickets t LEFT JOIN user_profiles p ON p.user_id = t.assignee_id WHERE t.status = 'open' AND t.assignee_id IS NULL ORDER BY t.created_at DESC`,
      sql`SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at, t.creator_id, t.assignee_id, t.sla_due_at, p.name AS assignee_name, p.email AS assignee_email FROM tickets t LEFT JOIN user_profiles p ON p.user_id = t.assignee_id WHERE t.assignee_id = ${user.id} ORDER BY t.created_at DESC`,
    ]);
    return Response.json({ unassigned, mine });
  }
  const tickets = await sql`SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at, t.creator_id, t.assignee_id, t.sla_due_at, p.name AS assignee_name, p.email AS assignee_email FROM tickets t LEFT JOIN user_profiles p ON p.user_id = t.assignee_id ORDER BY t.created_at DESC`;
  return Response.json(tickets);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload: unknown = await request.json().catch(() => null);
  const input = payload as { subject?: unknown; body?: unknown; priority?: unknown } | null;
  const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
  const body = typeof input?.body === "string" ? input.body : "";
  const priority = input?.priority;
  if (!subject) return Response.json({ error: "Subject is required." }, { status: 400 });
  if (!priorities.includes(priority as (typeof priorities)[number])) return Response.json({ error: "Choose a valid priority." }, { status: 400 });
  const [ticket] = await sql`INSERT INTO tickets (creator_id, subject, body, priority, sla_due_at) VALUES (${user.id}, ${subject}, ${body}, ${priority as string}, now() + CASE ${priority as string} WHEN 'high' THEN interval '4 hours' WHEN 'medium' THEN interval '24 hours' ELSE interval '72 hours' END) RETURNING id, subject, body, priority, status, created_at, creator_id, assignee_id, sla_due_at`;
  return Response.json(ticket, { status: 201 });
}
