import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

type RouteContext = { params: Promise<{ id: string }> };

async function participant(id: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false, exists: false };
  const [ticket] = await sql`SELECT creator_id, assignee_id FROM tickets WHERE id = ${id}`;
  if (!ticket) return { user, allowed: false, exists: false };
  return { user, exists: true, allowed: user.role === "admin" || ticket.creator_id === user.id || ticket.assignee_id === user.id };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { user, allowed, exists } = await participant(id);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const replies = await sql`SELECT r.id, r.body, r.created_at, p.name AS author_name, p.email AS author_email FROM ticket_replies r LEFT JOIN user_profiles p ON p.user_id = r.author_id WHERE r.ticket_id = ${id} ORDER BY r.created_at ASC`;
  return Response.json(replies);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { user, allowed, exists } = await participant(id);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const payload = await request.json().catch(() => null) as { body?: unknown } | null;
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body) return Response.json({ error: "Reply text is required." }, { status: 422 });
  const [reply] = await sql`INSERT INTO ticket_replies (ticket_id, author_id, body) VALUES (${id}, ${user.id}, ${body}) RETURNING id, body, created_at`;
  return Response.json({ ...reply, author_name: user.name, author_email: user.email }, { status: 201 });
}
