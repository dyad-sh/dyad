import { getActor, recordAudit } from "@/lib/auth/roles";

import { sql } from "@/db";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const statuses = ["open", "in_progress", "resolved", "closed"] as const;
type Status = (typeof statuses)[number];
const legal: Record<Status, Status[]> = { open: ["in_progress"], in_progress: ["resolved", "open"], resolved: ["closed", "open"], closed: ["open"] };

export async function POST(request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await params).id;
  const [ticket] = await sql`SELECT id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at FROM tickets WHERE id = ${id}`;

  if (!ticket || (user.role === "requester" && ticket.creator_id !== user.id)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const to = (await request.json()).to as Status;
  if (!statuses.includes(to) || !legal[ticket.status as Status]?.includes(to)) return Response.json({ error: "Illegal status transition" }, { status: 422 });

  const isAdmin = user.role === "admin";
  const isAssignedAgent = user.role === "agent" && ticket.assignee_id === user.id;
  const isRequester = user.role === "requester" && ticket.creator_id === user.id;
  const allowed = ticket.status === "open" && to === "in_progress"
    ? (isAdmin || isAssignedAgent) && Boolean(ticket.assignee_id)
    : ticket.status === "in_progress" && (to === "resolved" || to === "open")
      ? isAdmin || isAssignedAgent
      : ticket.status === "resolved" && (to === "closed" || to === "open")
        ? isAdmin || isRequester
        : ticket.status === "closed" && to === "open"
          ? isAdmin
          : false;
  if (!allowed) return Response.json({ error: "You are not allowed to make this transition" }, { status: 403 });

  const [updated] = await sql`
    UPDATE tickets SET status = ${to} WHERE id = ${id}
    RETURNING id, subject, body, priority, status, creator_id, assignee_id, sla_due_at, created_at, (sla_due_at < NOW() AND status NOT IN ('resolved', 'closed')) AS overdue
  `;
  await recordAudit(user.id, "status_transition", id, `${ticket.status} → ${to}`);
  return Response.json(updated);

}
