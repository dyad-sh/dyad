import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canViewTicket, getTicket } from "@/lib/ticket-server";
import { updateTicketSchema } from "@/lib/tickets";

const idSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function ticketForRequest(id: string) {
  return idSchema.safeParse(id).success ? getTicket(id) : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = await ticketForRequest((await params).id);
  if (!ticket || !canViewTicket(user, ticket)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(ticket);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = await ticketForRequest(id);
  if (!ticket || !canViewTicket(user, ticket)) return Response.json({ error: "Ticket not found" }, { status: 404 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = updateTicketSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket" }, { status: 400 });

  const { assigneeId, slaDueAt, ...content } = parsed.data;
  if (Object.keys(content).length > 0 && ticket.creator_id !== user.id) {
    return Response.json({ error: "Only the requester can edit ticket content" }, { status: 403 });
  }
  if (slaDueAt !== undefined && user.role !== "admin") {
    return Response.json({ error: "Only admins can edit SLA due times" }, { status: 403 });
  }

  let nextAssignee = ticket.assignee_id;
  if (assigneeId !== undefined) {
    if (user.role === "requester") return Response.json({ error: "Requesters cannot assign tickets" }, { status: 403 });
    if (user.role === "agent") {
      if (assigneeId !== user.id || ticket.assignee_id !== null) return Response.json({ error: "Agents can only self-assign unassigned tickets" }, { status: 403 });
      nextAssignee = user.id;
    } else if (assigneeId === null) {
      nextAssignee = null;
    } else {
      const agents = (await sql`SELECT user_id FROM user_profiles WHERE user_id = ${assigneeId} AND role = 'agent' AND active = true`) as Array<{ user_id: string }>;
      if (!agents[0]) return Response.json({ error: "Assignee must be an active agent" }, { status: 400 });
      nextAssignee = assigneeId;
    }
  }

  const next = { ...ticket, ...content };
  const nextSla = slaDueAt ?? ticket.sla_due_at;
  await sql`
    UPDATE tickets
    SET subject = ${next.subject}, body = ${next.body}, priority = ${next.priority},
      assignee_id = ${nextAssignee}, sla_due_at = ${nextSla}
    WHERE id = ${id}
  `;
  return Response.json(await getTicket(id));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = await ticketForRequest(id);
  if (!ticket || !canViewTicket(user, ticket)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  if (ticket.creator_id !== user.id) return Response.json({ error: "Only the requester can delete this ticket" }, { status: 403 });
  await sql`DELETE FROM tickets WHERE id = ${id} AND creator_id = ${user.id}`;
  return new Response(null, { status: 204 });
}
