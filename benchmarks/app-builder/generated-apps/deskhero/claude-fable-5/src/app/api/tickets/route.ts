import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";
import { PRIORITIES, SLA_HOURS, type Priority } from "@/lib/tickets";
import { findTicketById, listTickets } from "@/lib/ticket-queries";

export async function GET(request: Request) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const queue = new URL(request.url).searchParams.get("queue");

  if (queue === "unassigned" || queue === "mine") {
    if (ctx.role === "requester") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await listTickets(queue, ctx.user.id));
  }
  if (queue === "all") {
    if (ctx.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await listTickets("all", ctx.user.id));
  }
  return Response.json(await listTickets("own", ctx.user.id));
}

export async function POST(request: Request) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data = (payload ?? {}) as Record<string, unknown>;

  const subject = typeof data.subject === "string" ? data.subject.trim() : "";
  if (!subject) {
    return Response.json({ error: "Subject is required" }, { status: 400 });
  }

  const body = typeof data.body === "string" ? data.body : "";
  const priority: Priority =
    typeof data.priority === "string" &&
    (PRIORITIES as readonly string[]).includes(data.priority)
      ? (data.priority as Priority)
      : "medium";

  const slaDueAt = new Date(
    Date.now() + SLA_HOURS[priority] * 3600 * 1000,
  ).toISOString();

  const [created] = await sql`
    INSERT INTO tickets (user_id, subject, body, priority, sla_due_at)
    VALUES (${ctx.user.id}, ${subject}, ${body}, ${priority}, ${slaDueAt})
    RETURNING id
  `;
  const ticket = await findTicketById(created.id as string);
  return Response.json(ticket, { status: 201 });
}
