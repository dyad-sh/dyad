import { requireUser } from "@/lib/current-user";
import { loadTicket } from "@/lib/tickets";
import { sql } from "@/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  const { id } = await params;
  const ticket = await loadTicket(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (user.role === "requester" && ticket.owner_id !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(ticket);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  const { id } = await params;
  const existing = await loadTicket(id);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (user.role === "requester" && existing.owner_id !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const isOwner = existing.owner_id === user.id;

  const wantsContentChange =
    body?.subject !== undefined ||
    body?.body !== undefined ||
    body?.priority !== undefined;
  if (wantsContentChange && !isOwner) {
    return Response.json(
      { error: "Only the ticket owner can edit its content" },
      { status: 403 },
    );
  }

  const subject =
    body?.subject !== undefined
      ? typeof body.subject === "string"
        ? body.subject.trim()
        : ""
      : existing.subject;
  const ticketBody = body?.body !== undefined ? String(body.body) : existing.body;
  const priority =
    body?.priority !== undefined
      ? ["low", "medium", "high"].includes(body.priority)
        ? body.priority
        : existing.priority
      : existing.priority;

  if (wantsContentChange && !subject) {
    return Response.json({ error: "Subject is required" }, { status: 400 });
  }

  let assigneeId = existing.assignee_id;
  if (body?.assigneeId !== undefined) {
    if (user.role === "requester") {
      return Response.json(
        { error: "Requesters cannot assign tickets" },
        { status: 403 },
      );
    }

    if (user.role === "admin") {
      if (body.assigneeId === null) {
        assigneeId = null;
      } else {
        const [agent] = await sql`
          SELECT id FROM app_users WHERE id = ${body.assigneeId} AND role = 'agent'
        `;
        if (!agent) {
          return Response.json(
            { error: "Assignee must be an agent" },
            { status: 422 },
          );
        }
        assigneeId = body.assigneeId;
      }
    } else {
      // agent: can only self-assign an unassigned ticket
      if (body.assigneeId !== user.id) {
        return Response.json(
          { error: "Agents can only assign tickets to themselves" },
          { status: 403 },
        );
      }
      if (existing.assignee_id !== null) {
        return Response.json(
          { error: "Ticket is already assigned" },
          { status: 422 },
        );
      }
      assigneeId = user.id;
    }
  }

  let slaDueAt = existing.sla_due_at;
  if (body?.slaDueAt !== undefined) {
    if (user.role !== "admin") {
      return Response.json(
        { error: "Only admins can edit the SLA due time" },
        { status: 403 },
      );
    }
    const parsed = new Date(body.slaDueAt);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "Invalid SLA due time" }, { status: 400 });
    }
    slaDueAt = parsed.toISOString();
  }

  const [updated] = await sql`
    UPDATE tickets
    SET subject = ${subject}, body = ${ticketBody}, priority = ${priority},
      assignee_id = ${assigneeId}, sla_due_at = ${slaDueAt}
    WHERE id = ${id}
    RETURNING id
  `;

  const ticket = await loadTicket(updated.id);
  return Response.json(ticket);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;

  const { id } = await params;
  const existing = await loadTicket(id);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (user.role === "requester" && existing.owner_id !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.owner_id !== user.id) {
    return Response.json({ error: "Only the ticket owner can delete it" }, { status: 403 });
  }

  await sql`DELETE FROM tickets WHERE id = ${id}`;

  return Response.json({ success: true });
}
