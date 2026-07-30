import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";
import { recordAudit } from "@/lib/audit";
import { STATUSES, canTransition, type Status } from "@/lib/tickets";
import { findTicketById } from "@/lib/ticket-queries";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const ticket = await findTicketById(id);
  if (!ticket || (ctx.role === "requester" && ticket.user_id !== ctx.user.id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const to = (payload as Record<string, unknown> | null)?.to;
  if (
    typeof to !== "string" ||
    !(STATUSES as readonly string[]).includes(to)
  ) {
    return Response.json({ error: "Invalid target status" }, { status: 422 });
  }

  const check = canTransition({
    role: ctx.role,
    userId: ctx.user.id,
    ticket: {
      status: ticket.status as Status,
      user_id: ticket.user_id as string,
      assignee_id: (ticket.assignee_id as string | null) ?? null,
    },
    to: to as Status,
  });
  if (!check.ok) {
    return Response.json(
      {
        error:
          check.code === 403
            ? "You are not allowed to perform this transition"
            : "Illegal status transition",
      },
      { status: check.code },
    );
  }

  await sql`UPDATE tickets SET status = ${to} WHERE id = ${ticket.id}`;
  await recordAudit({
    actorId: ctx.user.id,
    eventType: "status_transition",
    targetType: "ticket",
    targetId: ticket.id as string,
    detail: `${ticket.status} → ${to}`,
  });
  return Response.json(await findTicketById(ticket.id as string));
}
