import { sql } from "@/db";
import { requireUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { getTicketById } from "@/lib/ticket-queries";
import {
  allowedTransitions,
  canViewTicket,
  checkTransition,
  isStatus,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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

  const payload = body as { to?: unknown };
  if (!isStatus(payload.to)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const check = checkTransition({
    from: existing.status,
    to: payload.to,
    role: result.user.role,
    userId: result.user.id,
    ticket: existing,
  });

  if (!check.ok) {
    return Response.json({ error: check.error }, { status: check.status });
  }

  await sql`
    UPDATE tickets
    SET status = ${payload.to}
    WHERE id = ${id}
  `;

  await recordAuditEvent({
    actorId: result.user.id,
    eventType: "status_transition",
    targetType: "ticket",
    targetId: id,
    detail: `${existing.status} → ${payload.to}`,
  });

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
