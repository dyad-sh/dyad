import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canParticipate, canViewTicket, getTicket } from "@/lib/ticket-server";
import { replySchema, type TicketReply } from "@/lib/tickets";

const idSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function authorize(id: string) {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!idSchema.safeParse(id).success) return { response: Response.json({ error: "Ticket not found" }, { status: 404 }) };
  const ticket = await getTicket(id);
  if (!ticket || !canViewTicket(user, ticket)) return { response: Response.json({ error: "Ticket not found" }, { status: 404 }) };
  if (!canParticipate(user, ticket)) return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const result = await authorize(id);
  if ("response" in result) return result.response;
  const replies = (await sql`
    SELECT replies.id, replies.content, replies.created_at, replies.author_id,
      users.name AS author_name, users.email AS author_email
    FROM ticket_replies replies
    JOIN neon_auth."user" users ON users.id = replies.author_id
    WHERE replies.ticket_id = ${id}
    ORDER BY replies.created_at ASC
  `) as TicketReply[];
  return Response.json(replies);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const result = await authorize(id);
  if ("response" in result) return result.response;
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = replySchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid reply" }, { status: 400 });

  const rows = (await sql`
    INSERT INTO ticket_replies (ticket_id, author_id, content)
    VALUES (${id}, ${result.user.id}, ${parsed.data.content})
    RETURNING id
  `) as Array<{ id: string }>;
  const replies = (await sql`
    SELECT replies.id, replies.content, replies.created_at, replies.author_id,
      users.name AS author_name, users.email AS author_email
    FROM ticket_replies replies JOIN neon_auth."user" users ON users.id = replies.author_id
    WHERE replies.id = ${rows[0].id}
  `) as TicketReply[];
  return Response.json(replies[0], { status: 201 });
}
