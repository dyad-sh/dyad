import { sql } from "@/db";
import { requireUser } from "@/lib/api-auth";
import { slaDueAtFrom } from "@/lib/sla";
import {
  countTicketsByStatus,
  getTicketById,
  listAllTickets,
  listTicketsAssignedTo,
  listTicketsForCreator,
  listUnassignedOpenTickets,
} from "@/lib/ticket-queries";
import { isPriority } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  const { user } = result;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  // Requesters only ever receive their own tickets.
  if (user.role === "requester") {
    return Response.json(await listTicketsForCreator(user.id));
  }

  if (scope === "unassigned") {
    if (user.role !== "admin" && user.role !== "agent") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await listUnassignedOpenTickets());
  }

  if (scope === "mine") {
    if (user.role !== "admin" && user.role !== "agent") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await listTicketsAssignedTo(user.id));
  }

  if (scope === "stats") {
    if (user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await countTicketsByStatus());
  }

  return Response.json(await listAllTickets());
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as {
    subject?: unknown;
    body?: unknown;
    priority?: unknown;
  };

  const subject =
    typeof payload.subject === "string" ? payload.subject.trim() : "";
  if (!subject) {
    return Response.json({ error: "Subject is required" }, { status: 400 });
  }

  const ticketBody =
    typeof payload.body === "string"
      ? payload.body
      : payload.body == null
        ? ""
        : String(payload.body);

  const priority = payload.priority ?? "medium";
  if (!isPriority(priority)) {
    return Response.json({ error: "Invalid priority" }, { status: 400 });
  }

  const createdAt = new Date();
  const slaDueAt = slaDueAtFrom(createdAt, priority);

  const rows = await sql`
    INSERT INTO tickets (subject, body, priority, creator_id, created_at, sla_due_at)
    VALUES (
      ${subject},
      ${ticketBody},
      ${priority},
      ${result.user.id},
      ${createdAt.toISOString()},
      ${slaDueAt.toISOString()}
    )
    RETURNING id
  `;

  const created = await getTicketById(String(rows[0].id));
  if (!created) {
    return Response.json({ error: "Failed to create ticket" }, { status: 500 });
  }

  return Response.json(created, { status: 201 });
}
