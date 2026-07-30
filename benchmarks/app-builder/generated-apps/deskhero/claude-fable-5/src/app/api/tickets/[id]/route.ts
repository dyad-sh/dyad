import {
  requireActiveUser,
  effectiveRoleOf,
  type SessionContext,
} from "@/lib/roles";
import { sql } from "@/db";
import { PRIORITIES } from "@/lib/tickets";
import { findTicketById } from "@/lib/ticket-queries";

type Params = { params: Promise<{ id: string }> };

/** Requesters can only see their own tickets; agents/admins see all. */
async function loadVisibleTicket(ctx: SessionContext, id: string) {
  const ticket = await findTicketById(id);
  if (!ticket) return null;
  if (ctx.role === "requester" && ticket.user_id !== ctx.user.id) return null;
  return ticket;
}

export async function GET(_request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const ticket = await loadVisibleTicket(ctx, id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(ticket);
}

export async function PATCH(request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const ticket = await loadVisibleTicket(ctx, id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data = (payload ?? {}) as Record<string, unknown>;

  if (data.status !== undefined) {
    return Response.json(
      { error: "Use the transition endpoint to change status" },
      { status: 422 },
    );
  }

  const isOwner = ticket.user_id === ctx.user.id;
  const isAdmin = ctx.role === "admin";

  // Content edits: owner or admin only.
  const editsContent =
    data.subject !== undefined ||
    data.body !== undefined ||
    data.priority !== undefined;
  if (editsContent && !isOwner && !isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let subject = ticket.subject as string;
  if (data.subject !== undefined) {
    if (typeof data.subject !== "string" || !data.subject.trim()) {
      return Response.json({ error: "Subject is required" }, { status: 400 });
    }
    subject = data.subject.trim();
  }

  let body = ticket.body as string;
  if (data.body !== undefined) {
    if (typeof data.body !== "string") {
      return Response.json({ error: "Body must be a string" }, { status: 400 });
    }
    body = data.body;
  }

  let priority = ticket.priority as string;
  if (data.priority !== undefined) {
    if (
      typeof data.priority !== "string" ||
      !(PRIORITIES as readonly string[]).includes(data.priority)
    ) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }
    priority = data.priority;
  }

  // SLA due edits: admin only.
  let slaDueAt = new Date(ticket.sla_due_at as string).toISOString();
  if (data.slaDueAt !== undefined) {
    if (!isAdmin) {
      return Response.json(
        { error: "Only admins can change the SLA due time" },
        { status: 403 },
      );
    }
    const parsed =
      typeof data.slaDueAt === "string" ? new Date(data.slaDueAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "Invalid SLA due time" }, { status: 400 });
    }
    slaDueAt = parsed.toISOString();
  }

  // Assignment rules.
  let assigneeId = (ticket.assignee_id as string | null) ?? null;
  if (data.assigneeId !== undefined) {
    const requested = data.assigneeId;
    if (requested !== null && typeof requested !== "string") {
      return Response.json({ error: "Invalid assigneeId" }, { status: 400 });
    }
    if (ctx.role === "requester") {
      return Response.json(
        { error: "Requesters cannot assign tickets" },
        { status: 403 },
      );
    }
    if (ctx.role === "agent") {
      if (requested !== ctx.user.id || ticket.assignee_id !== null) {
        return Response.json(
          { error: "Agents can only self-assign unassigned tickets" },
          { status: 403 },
        );
      }
      assigneeId = ctx.user.id;
    } else {
      // Admin: assign any agent (or admin), or unassign.
      if (requested === null) {
        assigneeId = null;
      } else {
        const targetRole = await effectiveRoleOf(requested);
        if (!targetRole || targetRole === "requester") {
          return Response.json(
            { error: "Assignee must be an agent" },
            { status: 422 },
          );
        }
        assigneeId = requested;
      }
    }
  }

  await sql`
    UPDATE tickets
    SET subject = ${subject}, body = ${body}, priority = ${priority},
        assignee_id = ${assigneeId}, sla_due_at = ${slaDueAt}
    WHERE id = ${ticket.id}
  `;
  return Response.json(await findTicketById(ticket.id as string));
}

export async function DELETE(_request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const ticket = await loadVisibleTicket(ctx, id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (ticket.user_id !== ctx.user.id && ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await sql`DELETE FROM tickets WHERE id = ${ticket.id}`;
  return Response.json({ success: true });
}
