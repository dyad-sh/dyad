import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";
import { findTicketById } from "@/lib/ticket-queries";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ticket = await findTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const notes = await sql`
    SELECT n.id, n.content, n.created_at, n.author_id, u.name AS author_name
    FROM ticket_notes n
    LEFT JOIN neon_auth.users u ON u.id = n.author_id
    WHERE n.ticket_id = ${ticket.id}
    ORDER BY n.created_at ASC
  `;
  return Response.json(notes);
}

export async function POST(request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role === "requester") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ticket = await findTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = (payload as Record<string, unknown> | null)?.content;
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Note content is required" }, { status: 400 });
  }

  const [note] = await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, content)
    VALUES (${ticket.id}, ${ctx.user.id}, ${content.trim()})
    RETURNING id, content, created_at, author_id
  `;
  return Response.json(
    { ...note, author_name: ctx.user.name },
    { status: 201 },
  );
}
