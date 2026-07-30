import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function findTicket(id: string) {
  const [ticket] = await sql`SELECT id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, (sla_due_at < NOW() AND status NOT IN ('resolved', 'closed')) AS overdue FROM tickets WHERE id = ${id}`;
  return ticket as Record<string, unknown> | undefined;
}

function canAccess(user: { id: string; role: string }, ticket: Record<string, unknown>) {
  return user.role !== "requester" || ticket.creator_id === user.id;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = await findTicket((await params).id);
  if (!ticket || !canAccess(user, ticket)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(ticket);
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await params).id;
  const ticket = await findTicket(id);
  if (!ticket || !canAccess(user, ticket)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const payload = await request.json();
  if (payload.status !== undefined && payload.status !== ticket.status) return Response.json({ error: "Use the transition endpoint for status changes" }, { status: 422 });
  if (payload.slaDueAt !== undefined && user.role !== "admin") return Response.json({ error: "Only admins can edit SLA due time" }, { status: 403 });
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : ticket.subject;
  const body = typeof payload.body === "string" ? payload.body : ticket.body;
  const priority = payload.priority ?? ticket.priority;
  if (!subject) return Response.json({ error: "Subject is required" }, { status: 400 });
  if (!["low", "medium", "high"].includes(priority)) return Response.json({ error: "Invalid priority" }, { status: 400 });
  let assigneeId = ticket.assignee_id as string | null;
  if (Object.prototype.hasOwnProperty.call(payload, "assigneeId")) {
    if (user.role === "requester") return Response.json({ error: "Only agents and admins can assign tickets" }, { status: 403 });
    const requested = payload.assigneeId as string | null;
    if (user.role === "agent" && (ticket.assignee_id || requested !== user.id)) return Response.json({ error: "Agents may only self-assign unassigned tickets" }, { status: 403 });
    if (requested) {
      const [assignee] = await sql`SELECT user_id FROM user_roles WHERE user_id = ${requested} AND role = 'agent' AND active = TRUE`;
      if (!assignee) return Response.json({ error: "Assignee must be an active agent" }, { status: 400 });
    }
    assigneeId = requested;
  }
  const dueAt = payload.slaDueAt === undefined ? ticket.sla_due_at : payload.slaDueAt;
  if (dueAt !== null && Number.isNaN(new Date(dueAt as string).getTime())) return Response.json({ error: "Invalid SLA due time" }, { status: 400 });
  const [updated] = await sql`
    UPDATE tickets SET subject = ${subject}, body = ${body}, priority = ${priority}, assignee_id = ${assigneeId}, sla_due_at = ${dueAt}
    WHERE id = ${id} RETURNING id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, (sla_due_at < NOW() AND status NOT IN ('resolved', 'closed')) AS overdue
  `;
  return Response.json(updated);
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = await findTicket((await params).id);
  if (!ticket || ticket.creator_id !== user.id) return Response.json({ error: "Ticket not found" }, { status: 404 });
  await sql`DELETE FROM tickets WHERE id = ${ticket.id}`;
  return new Response(null, { status: 204 });
}
