import { requireActiveUser, type SessionContext } from "@/lib/roles";
import { sql } from "@/db";
import { findTicketById } from "@/lib/ticket-queries";

type Params = { params: Promise<{ id: string }> };

/**
 * Participants: ticket owner, assigned agent, admins.
 * Requesters who don't own the ticket get 404 (ticket invisible);
 * visible-but-not-participant callers get 403.
 */
async function loadTicketForParticipant(ctx: SessionContext, id: string) {
  const ticket = await findTicketById(id);
  if (!ticket) return { ticket: null, status: 404 as const };
  if (ctx.role === "requester" && ticket.user_id !== ctx.user.id) {
    return { ticket: null, status: 404 as const };
  }
  const isParticipant =
    ctx.role === "admin" ||
    ticket.user_id === ctx.user.id ||
    ticket.assignee_id === ctx.user.id;
  if (!isParticipant) return { ticket: null, status: 403 as const };
  return { ticket, status: 200 as const };
}

export async function GET(_request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const { ticket, status } = await loadTicketForParticipant(ctx, id);
  if (!ticket) {
    return Response.json(
      { error: status === 404 ? "Not found" : "Forbidden" },
      { status },
    );
  }
  const replies = await sql`
    SELECT r.id, r.content, r.created_at, r.author_id, u.name AS author_name
    FROM ticket_replies r
    LEFT JOIN neon_auth.users u ON u.id = r.author_id
    WHERE r.ticket_id = ${ticket.id}
    ORDER BY r.created_at ASC
  `;
  return Response.json(replies);
}

export async function POST(request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id } = await params;
  const { ticket, status } = await loadTicketForParticipant(ctx, id);
  if (!ticket) {
    return Response.json(
      { error: status === 404 ? "Not found" : "Forbidden" },
      { status },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = (payload as Record<string, unknown> | null)?.content;
  if (typeof content !== "string" || !content.trim()) {
    return Response.json(
      { error: "Reply content is required" },
      { status: 400 },
    );
  }

  const [reply] = await sql`
    INSERT INTO ticket_replies (ticket_id, author_id, content)
    VALUES (${ticket.id}, ${ctx.user.id}, ${content.trim()})
    RETURNING id, content, created_at, author_id
  `;
  return Response.json(
    { ...reply, author_name: ctx.user.name },
    { status: 201 },
  );
}
