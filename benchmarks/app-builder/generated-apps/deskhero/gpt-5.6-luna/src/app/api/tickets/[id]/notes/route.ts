import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).id;
  const [ticket] = await sql`SELECT id FROM tickets WHERE id = ${id}`;
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const notes = await sql`
    SELECT n.id, n.content, n.author_id, n.created_at, u.name AS author_name
    FROM ticket_notes n LEFT JOIN neon_auth."user" u ON u.id = n.author_id

    WHERE n.ticket_id = ${id} ORDER BY n.created_at ASC
  `;
  return Response.json(notes);
}

export async function POST(request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).id;
  const [ticket] = await sql`SELECT id FROM tickets WHERE id = ${id}`;
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const payload = await request.json();
  const content = typeof payload.content === "string" ? payload.content.trim() : "";

  if (!content) return Response.json({ error: "Note content is required" }, { status: 400 });
  const [note] = await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, content) VALUES (${id}, ${user.id}, ${content})
    RETURNING id, content, author_id, created_at
  `;
  return Response.json(note, { status: 201 });
}
