import { requireUser } from "@/lib/current-user";
import { loadTicket } from "@/lib/tickets";
import { findTransitionRule, type TicketStatus } from "@/lib/ticket-workflow";
import { recordAuditEvent } from "@/lib/audit";
import { sql } from "@/db";

const VALID_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

export async function POST(
  request: Request,
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

  const body = await request.json().catch(() => null);
  const to = body?.to;

  if (!VALID_STATUSES.includes(to)) {
    return Response.json({ error: "Illegal transition" }, { status: 422 });
  }

  const rule = findTransitionRule(ticket.status, to);
  if (!rule) {
    return Response.json({ error: "Illegal transition" }, { status: 422 });
  }

  const allowed = rule.isAllowed({
    role: user.role,
    userId: user.id,
    ownerId: ticket.owner_id,
    assigneeId: ticket.assignee_id,
  });
  if (!allowed) {
    return Response.json({ error: "Not allowed to perform this transition" }, { status: 403 });
  }

  await sql`UPDATE tickets SET status = ${to} WHERE id = ${id}`;
  await recordAuditEvent({
    actorId: user.id,
    actorEmail: user.email,
    eventType: "status_transition",
    targetLabel: ticket.subject,
    detail: `${ticket.status} -> ${to}`,
  });

  const updated = await loadTicket(id);
  return Response.json(updated);
}
