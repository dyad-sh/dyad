import { sql } from "@/db";
import {
  authorize,
  badRequest,
  forbidden,
  notFound,
  unprocessable,
} from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { loadVisibleTicket } from "@/lib/ticket-queries";
import { checkTransition, isStatus } from "@/lib/workflow";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await params;
  const ticket = await loadVisibleTicket(id, user);
  if (!ticket) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const to = (payload as { to?: unknown } | null)?.to;
  if (!isStatus(to)) return badRequest("Invalid target status");

  const check = checkTransition(ticket.status, to, {
    role: user.role,
    userId: user.id,
    creatorId: ticket.creator_id,
    assigneeId: ticket.assignee_id,
  });

  if (!check.ok) {
    return check.reason === "forbidden"
      ? forbidden(check.message)
      : unprocessable(check.message);
  }

  await sql`UPDATE tickets SET status = ${to} WHERE id = ${id}`;

  await logAudit({
    actorId: user.id,
    eventType: "status_transition",
    targetTicketId: id,
    oldValue: ticket.status,
    newValue: to,
  });

  const updated = await loadVisibleTicket(id, user);
  return Response.json(updated);
}
