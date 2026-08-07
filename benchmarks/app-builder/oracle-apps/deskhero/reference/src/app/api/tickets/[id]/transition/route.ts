import { sql } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/current-user";
import { checkTransition } from "@/lib/workflow";

type RouteContext = { params: Promise<{ id: string }> };
const statuses = ["open", "in_progress", "resolved", "closed"] as const;
type Status = (typeof statuses)[number];

export async function POST(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [ticket] = await sql`SELECT id, creator_id, assignee_id, status FROM tickets WHERE id = ${id}`;
  if (!ticket || (user.role === "requester" && ticket.creator_id !== user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null) as { to?: unknown } | null;
  const to = body?.to;
  if (!statuses.includes(to as Status)) return Response.json({ error: "Choose a valid status." }, { status: 422 });
  const from = ticket.status as Status;
  // Single source of truth, shared with the detail page's buttons.
  const verdict = checkTransition(from, to as Status, !!ticket.assignee_id, {
    role: user.role,
    isOwner: ticket.creator_id === user.id,
    isAssignee: ticket.assignee_id === user.id,
  });
  if (verdict === "illegal") {
    return Response.json(
      { error: "That status transition is not allowed." },
      { status: 422 },
    );
  }
  if (verdict === "forbidden") {
    return Response.json(
      { error: "You cannot perform this transition." },
      { status: 403 },
    );
  }
  const [updated] = await sql`UPDATE tickets SET status = ${to as string} WHERE id = ${id} RETURNING id, subject, body, priority, status, created_at, creator_id, assignee_id, sla_due_at`;
  await recordAudit({ actorId: user.id, eventType: "status_transition", targetTicketId: id, detail: `${from} → ${to}` });
  return Response.json(updated);
}
