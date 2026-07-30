import { sql } from "@/db";
import {
  authorize,
  badRequest,
  forbidden,
  notFound,
} from "@/lib/api-auth";
import { loadVisibleTicket } from "@/lib/ticket-queries";

export const dynamic = "force-dynamic";

/** Internal notes are agent/admin only — requesters must never read them. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;
  if (user.role === "requester") {
    return forbidden("Internal notes are staff only");
  }

  const { id } = await params;
  const ticket = await loadVisibleTicket(id, user);
  if (!ticket) return notFound();

  const rows = await sql`
    SELECT n.id, n.body, n.created_at, n.author_id,
           u.name AS author_name, u.email AS author_email
    FROM ticket_notes n
    LEFT JOIN neon_auth."user" u ON u.id = n.author_id
    WHERE n.ticket_id = ${id}
    ORDER BY n.created_at ASC
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
  if (user.role === "requester") {
    return forbidden("Internal notes are staff only");
  }

  const { id } = await params;
  const ticket = await loadVisibleTicket(id, user);
  if (!ticket) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const raw = (payload as { body?: unknown } | null)?.body;
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return badRequest("Note cannot be empty");

  const rows = await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, body)
    VALUES (${id}, ${user.id}, ${body})
    RETURNING id, body, created_at, author_id
  `;

  return Response.json(
    { ...rows[0], author_name: user.name, author_email: user.email },
    { status: 201 },
  );
}
