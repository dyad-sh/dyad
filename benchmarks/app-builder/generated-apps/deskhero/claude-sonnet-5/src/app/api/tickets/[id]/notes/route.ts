import { requireUser } from "@/lib/current-user";
import { loadTicket } from "@/lib/tickets";
import { sql } from "@/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const ticket = await loadTicket(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const notes = await sql`
    SELECT n.id, n.ticket_id, n.author_id, author.name AS author_name, n.body, n.created_at
    FROM ticket_notes n
    LEFT JOIN app_users author ON author.id = n.author_id
    WHERE n.ticket_id = ${id}
    ORDER BY n.created_at ASC
  `;

  return Response.json(notes);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = auth.user;

  const { id } = await params;
  const ticket = await loadTicket(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const noteBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!noteBody) {
    return Response.json({ error: "Note body is required" }, { status: 400 });
  }

  const [note] = await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, body)
    VALUES (${id}, ${user.id}, ${noteBody})
    RETURNING id, ticket_id, author_id, body, created_at
  `;

  return Response.json(
    { ...note, author_name: user.name },
    { status: 201 },
  );
}
