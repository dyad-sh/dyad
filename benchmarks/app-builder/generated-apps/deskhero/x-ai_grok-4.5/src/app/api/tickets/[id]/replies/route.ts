import { sql } from "@/db";
import { requireUser } from "@/lib/api-auth";
import { getTicketById } from "@/lib/ticket-queries";
import { canParticipateInTicket, canViewTicket, mapReply } from "@/lib/tickets";

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

  // Participants only: owner, assigned agent, admins.
  if (
    !ticket ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    }) ||
    !canParticipateInTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT
      r.id,
      r.ticket_id,
      r.author_id,
      r.body,
      r.created_at,
      u.name AS author_name,
      u.email AS author_email
    FROM ticket_replies r
    LEFT JOIN neon_auth."user" u ON u.id = r.author_id
    WHERE r.ticket_id = ${id}
    ORDER BY r.created_at ASC
  `;

  return Response.json(
    rows.map((row) => mapReply(row as Record<string, unknown>)),
  );
}

export async function POST(request: Request, context: RouteContext) {
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
    }) ||
    !canParticipateInTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
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

  const payload = body as { body?: unknown };
  const replyBody =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (!replyBody) {
    return Response.json({ error: "Reply body is required" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO ticket_replies (ticket_id, author_id, body)
    VALUES (${id}, ${result.user.id}, ${replyBody})
    RETURNING id
  `;

  const replyId = String(rows[0].id);
  const created = await sql`
    SELECT
      r.id,
      r.ticket_id,
      r.author_id,
      r.body,
      r.created_at,
      u.name AS author_name,
      u.email AS author_email
    FROM ticket_replies r
    LEFT JOIN neon_auth."user" u ON u.id = r.author_id
    WHERE r.id = ${replyId}
    LIMIT 1
  `;

  return Response.json(mapReply(created[0] as Record<string, unknown>), {
    status: 201,
  });
}
