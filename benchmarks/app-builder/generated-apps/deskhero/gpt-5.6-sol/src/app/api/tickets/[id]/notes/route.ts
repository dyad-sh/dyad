import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTicket } from "@/lib/ticket-server";
import { noteSchema, type TicketNote } from "@/lib/tickets";

const idSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function authorize(id: string) {
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role === "requester") return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  if (!idSchema.safeParse(id).success || !(await getTicket(id))) {
    return { response: Response.json({ error: "Ticket not found" }, { status: 404 }) };
  }
  return { user };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const result = await authorize(id);
  if ("response" in result) return result.response;

  const notes = (await sql`
    SELECT notes.id, notes.content, notes.created_at, notes.author_id,
      users.name AS author_name, users.email AS author_email
    FROM ticket_notes notes
    JOIN neon_auth."user" users ON users.id = notes.author_id
    WHERE notes.ticket_id = ${id}
    ORDER BY notes.created_at ASC
  `) as TicketNote[];
  return Response.json(notes);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const result = await authorize(id);
  if ("response" in result) return result.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = noteSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid note" }, { status: 400 });

  const rows = (await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, content)
    VALUES (${id}, ${result.user.id}, ${parsed.data.content})
    RETURNING id
  `) as Array<{ id: string }>;
  const notes = (await sql`
    SELECT notes.id, notes.content, notes.created_at, notes.author_id,
      users.name AS author_name, users.email AS author_email
    FROM ticket_notes notes
    JOIN neon_auth."user" users ON users.id = notes.author_id
    WHERE notes.id = ${rows[0].id}
  `) as TicketNote[];
  return Response.json(notes[0], { status: 201 });
}
