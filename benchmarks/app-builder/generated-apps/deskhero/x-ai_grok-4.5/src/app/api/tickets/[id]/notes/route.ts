import { sql } from "@/db";
import { requireRole } from "@/lib/api-auth";
import { getTicketById } from "@/lib/ticket-queries";
import { canViewTicket, mapNote } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const result = await requireRole("admin", "agent");
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const ticket = await getTicketById(id);
  if (
    !ticket ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT
      n.id,
      n.ticket_id,
      n.author_id,
      n.body,
      n.created_at,
      u.name AS author_name,
      u.email AS author_email
    FROM ticket_notes n
    LEFT JOIN neon_auth."user" u ON u.id = n.author_id
    WHERE n.ticket_id = ${id}
    ORDER BY n.created_at ASC
  `;

  return Response.json(rows.map((row) => mapNote(row as Record<string, unknown>)));
}

export async function POST(request: Request, context: RouteContext) {
  const result = await requireRole("admin", "agent");
  if ("response" in result) {
    return result.response;
  }

  const { id } = await context.params;
  const ticket = await getTicketById(id);
  if (
    !ticket ||
    !canViewTicket({
      role: result.user.role,
      userId: result.user.id,
      ticket,
    })
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { body?: unknown };
  const noteBody =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (!noteBody) {
    return Response.json({ error: "Note body is required" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO ticket_notes (ticket_id, author_id, body)
    VALUES (${id}, ${result.user.id}, ${noteBody})
    RETURNING id
  `;

  const noteId = String(rows[0].id);
  const created = await sql`
    SELECT
      n.id,
      n.ticket_id,
      n.author_id,
      n.body,
      n.created_at,
      u.name AS author_name,
      u.email AS author_email
    FROM ticket_notes n
    LEFT JOIN neon_auth."user" u ON u.id = n.author_id
    WHERE n.id = ${noteId}
    LIMIT 1
  `;

  return Response.json(mapNote(created[0] as Record<string, unknown>), {
    status: 201,
  });
}
