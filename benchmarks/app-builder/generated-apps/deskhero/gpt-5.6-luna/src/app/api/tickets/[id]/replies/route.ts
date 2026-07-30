import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

type Context = { params: Promise<{ id: string }> };

async function participant(id: string) {
  const [ticket] = await sql`SELECT id, creator_id, assignee_id FROM tickets WHERE id = ${id}`;
  return ticket as { id: string; creator_id: string; assignee_id: string | null } | undefined;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = await participant((await params).id);
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  if (user.role !== "admin" && ticket.creator_id !== user.id && ticket.assignee_id !== user.id) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await sql`SELECT r.id, r.content, r.author_id, r.created_at, u.name AS author_name FROM ticket_replies r LEFT JOIN neon_auth."user" u ON u.id = r.author_id WHERE r.ticket_id = ${ticket.id} ORDER BY r.created_at ASC`);
}

export async function POST(request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = await participant((await params).id);
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  if (user.role !== "admin" && ticket.creator_id !== user.id && ticket.assignee_id !== user.id) return Response.json({ error: "Forbidden" }, { status: 403 });
  const payload = await request.json();
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!content) return Response.json({ error: "Reply content is required" }, { status: 400 });
  const [reply] = await sql`INSERT INTO ticket_replies (ticket_id, author_id, content) VALUES (${ticket.id}, ${user.id}, ${content}) RETURNING id, content, author_id, created_at`;
  return Response.json(reply, { status: 201 });
}
