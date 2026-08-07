import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

const priorities = ["low", "medium", "high"] as const;
type RouteContext = { params: Promise<{ id: string }> };

// ORACLE-DEFECT D5: m3-p-note-serialization (and its M2 ancestor m2-p-notes-leak)
// The detail row now carries the ticket's internal notes as `internal_notes`,
// for every viewer including the requester who filed the ticket. Redaction has
// moved from the query to the client: ticket-detail.tsx renders the notes
// section only when `user.role !== "requester"`, so the rendered page is
// identical to the reference and m3-workflow-regression (which inspects
// page.content()) still passes — but the marker is right there in the raw JSON
// body. This is exactly the "client-side filtering of an included field" that
// the design says must fail the probe.
async function findTicket(id: string) {
  const [ticket] = await sql`SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at, t.creator_id, t.assignee_id, t.sla_due_at, p.name AS assignee_name, p.email AS assignee_email, COALESCE((SELECT json_agg(json_build_object('id', n.id, 'body', n.body, 'author_name', np.name) ORDER BY n.created_at) FROM ticket_notes n LEFT JOIN user_profiles np ON np.user_id = n.author_id WHERE n.ticket_id = t.id), '[]'::json) AS internal_notes FROM tickets t LEFT JOIN user_profiles p ON p.user_id = t.assignee_id WHERE t.id = ${id}`;
  return ticket as Record<string, unknown> | undefined;
}
function canView(ticket: Record<string, unknown>, user: { id: string; role: string }) { return user.role !== "requester" || ticket.creator_id === user.id; }

// ORACLE-DEFECT D9: m1-p-idor-read, m1-p-idor-write, m2-p-idor
// Row ownership has MOVED from the server to the browser. `canView` still
// exists and DELETE still calls it, but the read and the update no longer do:
// any signed-in caller who knows a ticket id can read it and rewrite its
// subject/body/priority. The redaction that used to live here now lives in
// ticket-detail.tsx, which renders "Ticket not found" when the fetched ticket's
// creator_id is not the viewing requester — so the browser behaves exactly like
// the reference (m1-isolation-ui and m2-isolation still pass) and the hole is
// visible only to a raw HTTP client. This is the canonical "client-side-only
// gating" the design says the probes exist to catch.
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = await findTicket(id);
  if (!ticket) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(ticket);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = await findTicket(id);
  // ORACLE-DEFECT D9 (write half): m1-p-idor-write
  if (!ticket) return Response.json({ error: "Not found" }, { status: 404 });
  const input = await request.json().catch(() => null) as { subject?: unknown; body?: unknown; priority?: unknown; assigneeId?: unknown; status?: unknown; slaDueAt?: unknown } | null;
  if (input?.status !== undefined) return Response.json({ error: "Use the transition endpoint to change status." }, { status: 422 });
  if (input?.subject !== undefined && (typeof input.subject !== "string" || !input.subject.trim())) return Response.json({ error: "Subject is required." }, { status: 400 });
  if (input?.body !== undefined && typeof input.body !== "string") return Response.json({ error: "Body must be text." }, { status: 400 });
  if (input?.priority !== undefined && !priorities.includes(input.priority as (typeof priorities)[number])) return Response.json({ error: "Choose a valid priority." }, { status: 400 });
  let assigneeId = ticket.assignee_id as string | null;
  if (input?.assigneeId !== undefined) {
    if (typeof input.assigneeId !== "string" && input.assigneeId !== null) return Response.json({ error: "Choose a valid assignee." }, { status: 422 });
    if (user.role === "requester") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (user.role === "agent" && (ticket.assignee_id !== null || input.assigneeId !== user.id)) return Response.json({ error: "Agents can only assign unassigned tickets to themselves." }, { status: 403 });
    if (input.assigneeId !== null) { const [assignee] = await sql`SELECT user_id FROM user_profiles WHERE user_id = ${input.assigneeId as string} AND role = 'agent' AND active = true`; if (!assignee) return Response.json({ error: "Assignee must be an active agent." }, { status: 422 }); }
    assigneeId = input.assigneeId as string | null;
  }
  let slaDueAt = ticket.sla_due_at as string;
  if (input?.slaDueAt !== undefined) {
    // ORACLE-DEFECT D7: m3-p-sla-edit-role
    // M3 makes the SLA due time admin-only. The `user.role !== "admin"` guard
    // is removed, so any viewer of the ticket (here: the assigned agent) can
    // rewrite the deadline and clear or fabricate an overdue badge. The
    // sla-due-input/save controls are still rendered only for `isAdmin`, so
    // the UI-driven SLA CUJs are untouched.
    if (typeof input.slaDueAt !== "string" || Number.isNaN(Date.parse(input.slaDueAt))) return Response.json({ error: "Choose a valid SLA due time." }, { status: 422 });
    slaDueAt = new Date(input.slaDueAt).toISOString();
  }
  const subject = input?.subject === undefined ? ticket.subject as string : input.subject.trim();
  const ticketBody = input?.body === undefined ? ticket.body as string : input.body as string;
  const priority = input?.priority === undefined ? ticket.priority as string : input.priority as string;
  const [updated] = await sql`UPDATE tickets SET subject = ${subject}, body = ${ticketBody}, priority = ${priority}, assignee_id = ${assigneeId}, sla_due_at = ${slaDueAt} WHERE id = ${id} RETURNING id, subject, body, priority, status, created_at, creator_id, assignee_id, sla_due_at`;
  return Response.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ticket = await findTicket(id);
  if (!ticket || !canView(ticket, user)) return Response.json({ error: "Not found" }, { status: 404 });
  if (user.role !== "requester" && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const [deleted] = await sql`DELETE FROM tickets WHERE id = ${id} RETURNING id`;
  if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
