import { sql } from "@/db";
import { authorize, badRequest, forbidden, notFound } from "@/lib/api-auth";
import {
  isConversationParticipant,
  loadVisibleTicket,
} from "@/lib/ticket-queries";

export const dynamic = "force-dynamic";

/**
 * Public conversation. Only participants (ticket owner, assigned agent, admins)
 * may read or write, so a requester can never reach another requester's
 * replies. Internal note columns are never touched here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const { id } = await params;
  const ticket = await loadVisibleTicket(id, user);
  if (!ticket) return notFound();
  if (!isConversationParticipant(ticket, user)) {
    return forbidden("You are not a participant on this ticket.");
  }

  const rows = await sql`
    SELECT r.id, r.body, r.created_at, r.author_id,
           u.name AS author_name, u.email AS author_email
    FROM ticket_replies r
    LEFT JOIN neon_auth."user" u ON u.id = r.author_id
    WHERE r.ticket_id = ${id}
    ORDER BY r.created_at ASC
  `;

  return Response.json(rows);
}

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
  if (!isConversationParticipant(ticket, user)) {
    return forbidden("You are not a participant on this ticket.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const raw = (payload as { body?: unknown } | null)?.body;
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return badRequest("Reply cannot be empty");

  const rows = await sql`
    INSERT INTO ticket_replies (ticket_id, author_id, body)
    VALUES (${id}, ${user.id}, ${body})
    RETURNING id, body, created_at, author_id
  `;

  return Response.json(
    { ...rows[0], author_name: user.name, author_email: user.email },
    { status: 201 },
  );
}
