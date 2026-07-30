import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTicket } from "@/lib/ticket-server";
import { createTicketSchema, type Ticket } from "@/lib/tickets";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let tickets: Ticket[];
  if (user.role === "requester") {
    tickets = (await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
        creator.name AS creator_name, creator.email AS creator_email,
        t.assignee_id, assignee.name AS assignee_name, assignee.email AS assignee_email,
        t.created_at, t.sla_due_at
      FROM tickets t
      JOIN neon_auth."user" creator ON creator.id = t.creator_id
      LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
      WHERE t.creator_id = ${user.id}
      ORDER BY t.created_at DESC
    `) as Ticket[];
  } else if (user.role === "agent") {
    tickets = (await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
        creator.name AS creator_name, creator.email AS creator_email,
        t.assignee_id, assignee.name AS assignee_name, assignee.email AS assignee_email,
        t.created_at, t.sla_due_at
      FROM tickets t
      JOIN neon_auth."user" creator ON creator.id = t.creator_id
      LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
      WHERE t.assignee_id = ${user.id} OR (t.assignee_id IS NULL AND t.status = 'open')
      ORDER BY t.created_at DESC
    `) as Ticket[];
  } else {
    tickets = (await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
        creator.name AS creator_name, creator.email AS creator_email,
        t.assignee_id, assignee.name AS assignee_name, assignee.email AS assignee_email,
        t.created_at, t.sla_due_at
      FROM tickets t
      JOIN neon_auth."user" creator ON creator.id = t.creator_id
      LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
      ORDER BY t.created_at DESC
    `) as Ticket[];
  }
  return Response.json(tickets);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = createTicketSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket" }, { status: 400 });

  const { subject, body, priority } = parsed.data;
  const rows = (await sql`
    WITH clock AS (SELECT now() AS created_at)
    INSERT INTO tickets (subject, body, priority, creator_id, created_at, sla_due_at)
    SELECT ${subject}, ${body}, ${priority}, ${user.id}, created_at,
      created_at + CASE ${priority} WHEN 'high' THEN interval '4 hours' WHEN 'medium' THEN interval '24 hours' ELSE interval '72 hours' END
    FROM clock
    RETURNING id
  `) as Array<{ id: string }>;
  return Response.json(await getTicket(rows[0].id), { status: 201 });
}
