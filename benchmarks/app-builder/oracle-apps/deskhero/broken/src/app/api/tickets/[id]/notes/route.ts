import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

type RouteContext = { params: Promise<{ id: string }> };

async function authorized(id: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, exists: false };
  const [ticket] = await sql`SELECT id FROM tickets WHERE id = ${id}`;
  return { user, exists: Boolean(ticket) };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { user, exists } = await authorized(id);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });

  const notes = await sql`SELECT n.id, n.body, n.created_at, p.name AS author_name FROM ticket_notes n LEFT JOIN user_profiles p ON p.user_id = n.author_id WHERE n.ticket_id = ${id} ORDER BY n.created_at ASC`;
  return Response.json(notes);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { user, exists } = await authorized(id);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });

  const payload: unknown = await request.json().catch(() => null);
  const note = typeof (payload as { body?: unknown } | null)?.body === "string" ? (payload as { body: string }).body.trim() : "";
  if (!note) return Response.json({ error: "Note text is required." }, { status: 422 });
  const [created] = await sql`INSERT INTO ticket_notes (ticket_id, author_id, body) VALUES (${id}, ${user.id}, ${note}) RETURNING id, body, created_at`;
  return Response.json({ ...created, author_name: user.name }, { status: 201 });
}
