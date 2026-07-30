import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const tickets = user.role === "requester"
    ? await sql`SELECT id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, (sla_due_at < NOW() AND status NOT IN ('resolved', 'closed')) AS overdue FROM tickets WHERE creator_id = ${user.id} ORDER BY created_at DESC`
    : await sql`SELECT id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, (sla_due_at < NOW() AND status NOT IN ('resolved', 'closed')) AS overdue FROM tickets ORDER BY created_at DESC`;

  return Response.json(tickets);
}

export async function POST(request: Request) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json();
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const priority = payload.priority;
  if (!subject) return Response.json({ error: "Subject is required" }, { status: 400 });
  if (!["low", "medium", "high"].includes(priority)) return Response.json({ error: "Invalid priority" }, { status: 400 });
  const [ticket] = await sql`
    INSERT INTO tickets (subject, body, priority, creator_id, sla_due_at)
    VALUES (${subject}, ${body}, ${priority}, ${user.id}, NOW() + CASE WHEN ${priority} = 'high' THEN INTERVAL '4 hours' WHEN ${priority} = 'medium' THEN INTERVAL '24 hours' ELSE INTERVAL '72 hours' END)
    RETURNING id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, FALSE AS overdue
  `;
  return Response.json(ticket, { status: 201 });
}
