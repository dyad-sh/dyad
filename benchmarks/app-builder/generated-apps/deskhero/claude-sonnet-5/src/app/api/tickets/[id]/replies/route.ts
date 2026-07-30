import { requireUser } from "@/lib/current-user";
import { loadTicket } from "@/lib/tickets";
import { sql } from "@/db";
import type { Ticket } from "@/types/ticket";
import type { CurrentUser } from "@/lib/current-user";

function isParticipant(ticket: Ticket, user: CurrentUser) {
  return (
    user.role === "admin" ||
    ticket.owner_id === user.id ||
    ticket.assignee_id === user.id
  );
}

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
  if (!isParticipant(ticket, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const replies = await sql`
    SELECT r.id, r.ticket_id, r.author_id, author.name AS author_name, r.body, r.created_at
    FROM ticket_replies r
    LEFT JOIN app_users author ON author.id = r.author_id
    WHERE r.ticket_id = ${id}
    ORDER BY r.created_at ASC
  `;

  return Response.json(replies);
}

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
  if (!isParticipant(ticket, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const replyBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!replyBody) {
    return Response.json({ error: "Reply body is required" }, { status: 400 });
  }

  const [reply] = await sql`
    INSERT INTO ticket_replies (ticket_id, author_id, body)
    VALUES (${id}, ${user.id}, ${replyBody})
    RETURNING id, ticket_id, author_id, body, created_at
  `;

  return Response.json(
    { ...reply, author_name: user.name },
    { status: 201 },
  );
}
