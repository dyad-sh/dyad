import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canViewTicket, getTicket } from "@/lib/ticket-server";
import { transitionSchema, type TicketStatus } from "@/lib/tickets";

const idSchema = z.string().uuid();
const legalTransitions: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress"],
  in_progress: ["resolved", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const ticket = await getTicket(id);
  if (!ticket || !canViewTicket(user, ticket)) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = transitionSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Invalid status" }, { status: 400 });

  const to = parsed.data.to;
  if (!legalTransitions[ticket.status].includes(to)) {
    return Response.json({ error: `Cannot transition from ${ticket.status} to ${to}` }, { status: 422 });
  }

  let allowed = false;
  if (ticket.status === "open" && to === "in_progress") {
    allowed = user.role === "admin" || (user.role === "agent" && ticket.assignee_id === user.id);
    if (!allowed) return Response.json({ error: "You cannot perform this transition" }, { status: 403 });
    if (!ticket.assignee_id) return Response.json({ error: "Assign an agent before starting work" }, { status: 422 });
  } else if (ticket.status === "in_progress") {
    allowed = user.role === "admin" || (user.role === "agent" && ticket.assignee_id === user.id);
  } else if (ticket.status === "resolved") {
    allowed = user.role === "admin" || (user.role === "requester" && ticket.creator_id === user.id);
  } else if (ticket.status === "closed" && to === "open") {
    allowed = user.role === "admin";
  }

  if (!allowed) return Response.json({ error: "You cannot perform this transition" }, { status: 403 });

  await sql`UPDATE tickets SET status = ${to} WHERE id = ${id}`;
  await sql`
    INSERT INTO audit_events (actor_id, event_type, target_type, target_id, detail)
    VALUES (${user.id}, 'status_transition', 'ticket', ${id}, ${`${ticket.status} → ${to}`})
  `;
  return Response.json(await getTicket(id));
}
