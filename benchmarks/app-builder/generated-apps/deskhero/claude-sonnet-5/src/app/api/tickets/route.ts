import { requireUser } from "@/lib/current-user";
import { computeSlaDueAt } from "@/lib/sla";
import { sql } from "@/db";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  const url = new URL(request.url);
  const queue = url.searchParams.get("queue");

  let tickets;
  if (user.role === "requester") {
    tickets = await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status,
        t.owner_id, owner.name AS owner_name,
        t.assignee_id, assignee.name AS assignee_name,
        t.sla_due_at,
        (t.sla_due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
        t.created_at
      FROM tickets t
      LEFT JOIN app_users owner ON owner.id = t.owner_id
      LEFT JOIN app_users assignee ON assignee.id = t.assignee_id
      WHERE t.owner_id = ${user.id}
      ORDER BY t.created_at DESC
    `;
  } else if (user.role === "agent" && queue === "unassigned") {
    tickets = await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status,
        t.owner_id, owner.name AS owner_name,
        t.assignee_id, assignee.name AS assignee_name,
        t.sla_due_at,
        (t.sla_due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
        t.created_at
      FROM tickets t
      LEFT JOIN app_users owner ON owner.id = t.owner_id
      LEFT JOIN app_users assignee ON assignee.id = t.assignee_id
      WHERE t.status = 'open' AND t.assignee_id IS NULL
      ORDER BY t.created_at DESC
    `;
  } else if (user.role === "agent") {
    tickets = await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status,
        t.owner_id, owner.name AS owner_name,
        t.assignee_id, assignee.name AS assignee_name,
        t.sla_due_at,
        (t.sla_due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
        t.created_at
      FROM tickets t
      LEFT JOIN app_users owner ON owner.id = t.owner_id
      LEFT JOIN app_users assignee ON assignee.id = t.assignee_id
      WHERE t.assignee_id = ${user.id}
      ORDER BY t.created_at DESC
    `;
  } else {
    tickets = await sql`
      SELECT t.id, t.subject, t.body, t.priority, t.status,
        t.owner_id, owner.name AS owner_name,
        t.assignee_id, assignee.name AS assignee_name,
        t.sla_due_at,
        (t.sla_due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
        t.created_at
      FROM tickets t
      LEFT JOIN app_users owner ON owner.id = t.owner_id
      LEFT JOIN app_users assignee ON assignee.id = t.assignee_id
      ORDER BY t.created_at DESC
    `;
  }

  return Response.json(tickets);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  const body = await request.json().catch(() => null);
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const ticketBody = typeof body?.body === "string" ? body.body : "";
  const priority = ["low", "medium", "high"].includes(body?.priority)
    ? body.priority
    : "medium";

  if (!subject) {
    return Response.json({ error: "Subject is required" }, { status: 400 });
  }

  const slaDueAt = computeSlaDueAt(priority);

  const [ticket] = await sql`
    INSERT INTO tickets (subject, body, priority, owner_id, sla_due_at)
    VALUES (${subject}, ${ticketBody}, ${priority}, ${user.id}, ${slaDueAt.toISOString()})
    RETURNING id, subject, body, priority, status, owner_id, assignee_id, sla_due_at, created_at
  `;

  return Response.json(
    {
      ...ticket,
      owner_name: user.name,
      assignee_name: null,
      overdue: false,
    },
    { status: 201 },
  );
}
