import { sql } from "@/db";
import { requireUser } from "@/lib/api-auth";
import { getTicketById } from "@/lib/ticket-queries";
import {
  allowedTransitions,
  canAssignTicket,
  canDeleteTicket,
  canEditTicketFields,
  canViewTicket,
  isPriority,
} from "@/lib/tickets";
import { getAuthUserById, getUserRole } from "@/lib/users";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const ticket = await getTicketById(id);
  if (
    !ticket ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    ...ticket,
    allowed_transitions: allowedTransitions({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    }),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const existing = await getTicketById(id);
  if (
    !existing ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket: existing,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as {
    subject?: unknown;
    body?: unknown;
    priority?: unknown;
    status?: unknown;
    assigneeId?: unknown;
    slaDueAt?: unknown;
  };

  if (payload.status !== undefined) {
    return Response.json(
      { error: "Use /transition to change status" },
      { status: 400 },
    );
  }

  const wantsFieldEdit =
    payload.subject !== undefined ||
    payload.body !== undefined ||
    payload.priority !== undefined;

  if (
    wantsFieldEdit &&
    !canEditTicketFields({
      role: result.user.role,
      userId: result.user.id,
      ticket: existing,
    })
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (payload.slaDueAt !== undefined && result.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let subject = existing.subject;
  if (payload.subject !== undefined) {
    if (typeof payload.subject !== "string" || !payload.subject.trim()) {
      return Response.json({ error: "Subject is required" }, { status: 400 });
    }
    subject = payload.subject.trim();
  }

  let ticketBody = existing.body;
  if (payload.body !== undefined) {
    ticketBody =
      typeof payload.body === "string"
        ? payload.body
        : payload.body == null
          ? ""
          : String(payload.body);
  }

  let priority = existing.priority;
  if (payload.priority !== undefined) {
    if (!isPriority(payload.priority)) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }
    priority = payload.priority;
  }

  let assigneeId = existing.assignee_id;
  if (payload.assigneeId !== undefined) {
    const nextAssignee =
      payload.assigneeId === null
        ? null
        : typeof payload.assigneeId === "string"
          ? payload.assigneeId
          : null;

    if (payload.assigneeId !== null && typeof payload.assigneeId !== "string") {
      return Response.json({ error: "Invalid assigneeId" }, { status: 400 });
    }

    const assignCheck = canAssignTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket: existing,
      assigneeId: nextAssignee,
    });
    if (!assignCheck.ok) {
      return Response.json(
        { error: assignCheck.error },
        { status: assignCheck.status },
      );
    }

    if (nextAssignee) {
      const assignee = await getAuthUserById(nextAssignee);
      if (!assignee) {
        return Response.json({ error: "Assignee not found" }, { status: 404 });
      }
      const assigneeRole = await getUserRole(nextAssignee);
      if (assigneeRole !== "agent" && assigneeRole !== "admin") {
        return Response.json(
          { error: "Assignee must be an agent or admin" },
          { status: 422 },
        );
      }
    }

    assigneeId = nextAssignee;
  }

  let slaDueAt = existing.sla_due_at;
  if (payload.slaDueAt !== undefined) {
    if (typeof payload.slaDueAt !== "string") {
      return Response.json({ error: "Invalid slaDueAt" }, { status: 400 });
    }
    const parsed = new Date(payload.slaDueAt);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "Invalid slaDueAt" }, { status: 400 });
    }
    slaDueAt = parsed.toISOString();
  }

  const rows = await sql`
    UPDATE tickets
    SET
      subject = ${subject},
      body = ${ticketBody},
      priority = ${priority},
      assignee_id = ${assigneeId},
      sla_due_at = ${slaDueAt}
    WHERE id = ${id}
    RETURNING id
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await getTicketById(id);
  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    ...updated,
    allowed_transitions: allowedTransitions({
      role: result.user.role,
      userId: result.user.id,
      ticket: updated,
    }),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const existing = await getTicketById(id);
  if (
    !existing ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket: existing,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (
    !canDeleteTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket: existing,
    })
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await sql`
    DELETE FROM tickets
    WHERE id = ${id}
  `;

  return new Response(null, { status: 204 });
}
