import { sql } from "@/db";
import {
  authorize,
  badRequest,
  forbidden,
  notFound,
  unprocessable,
} from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { isUuid, loadVisibleTicket } from "@/lib/ticket-queries";
import { checkTransition, isStatus } from "@/lib/workflow";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "medium", "high"] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const ticket = await loadVisibleTicket(id, gate.user);
  if (!ticket) return notFound();

  return Response.json(ticket);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await params;
  const existing = await loadVisibleTicket(id, user);
  if (!existing) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const data = (payload ?? {}) as Record<string, unknown>;

  const editsFields =
    data.subject !== undefined ||
    data.body !== undefined ||
    data.priority !== undefined;

  const mayEditFields =
    user.role === "admin" ||
    existing.creator_id === user.id ||
    (user.role === "agent" && existing.assignee_id === user.id);

  if (editsFields && !mayEditFields) {
    return forbidden("You are not allowed to edit this ticket.");
  }

  let subject = existing.subject;
  if (data.subject !== undefined) {
    if (typeof data.subject !== "string" || !data.subject.trim()) {
      return badRequest("Subject is required");
    }
    subject = data.subject.trim();
  }

  let body = existing.body;
  if (data.body !== undefined) {
    if (typeof data.body !== "string") return badRequest("Invalid body");
    body = data.body;
  }

  let priority = existing.priority;
  if (data.priority !== undefined) {
    if (
      typeof data.priority !== "string" ||
      !(PRIORITIES as readonly string[]).includes(data.priority)
    ) {
      return badRequest("Invalid priority");
    }
    priority = data.priority as typeof priority;
  }

  // --- SLA due time (admin only) ---
  let slaDueAt = existing.sla_due_at;
  if (data.slaDueAt !== undefined) {
    if (user.role !== "admin") {
      return forbidden("Only admins can change the SLA due time.");
    }
    if (data.slaDueAt === null || data.slaDueAt === "") {
      slaDueAt = null;
    } else if (typeof data.slaDueAt !== "string") {
      return badRequest("Invalid slaDueAt");
    } else {
      const parsed = new Date(data.slaDueAt);
      if (Number.isNaN(parsed.getTime())) return badRequest("Invalid slaDueAt");
      slaDueAt = parsed.toISOString();
    }
  }

  // --- assignment ---
  let assigneeId = existing.assignee_id;
  if (data.assigneeId !== undefined) {
    const target = data.assigneeId;
    if (target !== null && typeof target !== "string") {
      return badRequest("Invalid assigneeId");
    }
    const nextAssignee = target === null || target === "" ? null : target;

    if (user.role === "requester") {
      return forbidden("Requesters cannot assign tickets.");
    }

    if (user.role === "agent") {
      if (nextAssignee !== user.id) {
        return forbidden("Agents can only assign tickets to themselves.");
      }
      if (existing.assignee_id !== null) {
        return forbidden("This ticket is already assigned.");
      }
    }

    if (nextAssignee !== null) {
      const rows = (await sql`
        SELECT COALESCE(p.role, 'requester') AS role
        FROM neon_auth."user" u
        LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = ${nextAssignee}
      `) as { role: string }[];
      if (!rows[0]) return badRequest("Unknown assignee");
      if (rows[0].role !== "agent") {
        return unprocessable("Tickets can only be assigned to agents.");
      }
    }

    assigneeId = nextAssignee;
  }

  // --- status (workflow-checked) ---
  let status = existing.status;
  if (data.status !== undefined) {
    if (!isStatus(data.status)) return badRequest("Invalid status");
    if (data.status !== existing.status) {
      const check = checkTransition(existing.status, data.status, {
        role: user.role,
        userId: user.id,
        creatorId: existing.creator_id,
        assigneeId,
      });
      if (!check.ok) {
        return check.reason === "forbidden"
          ? forbidden(check.message)
          : unprocessable(check.message);
      }
      status = data.status;
    }
  }

  await sql`
    UPDATE tickets
    SET subject = ${subject}, body = ${body}, priority = ${priority},
        status = ${status}, assignee_id = ${assigneeId},
        sla_due_at = ${slaDueAt}
    WHERE id = ${id}
  `;

  if (status !== existing.status) {
    await logAudit({
      actorId: user.id,
      eventType: "status_transition",
      targetTicketId: id,
      oldValue: existing.status,
      newValue: status,
    });
  }

  const updated = await loadVisibleTicket(id, user);
  if (!updated) return notFound();
  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const existing = await loadVisibleTicket(id, user);
  if (!existing) return notFound();

  if (user.role !== "admin" && existing.creator_id !== user.id) {
    return forbidden("You are not allowed to delete this ticket.");
  }

  await sql`DELETE FROM tickets WHERE id = ${id}`;
  return Response.json({ ok: true });
}
