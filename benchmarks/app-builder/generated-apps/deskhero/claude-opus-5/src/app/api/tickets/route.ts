import { sql } from "@/db";
import { authorize, badRequest } from "@/lib/api-auth";
import { listVisibleTickets, loadVisibleTicket } from "@/lib/ticket-queries";
import { SLA_HOURS } from "@/lib/sla";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "medium", "high"] as const;

export async function GET(request: Request) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const tickets = await listVisibleTickets(gate.user, {
    assignedToMe: url.searchParams.get("assignee") === "me",
    unassigned: url.searchParams.get("unassigned") === "1",
    status: url.searchParams.get("status") ?? undefined,
  });

  return Response.json(tickets);
}

export async function POST(request: Request) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const data = (payload ?? {}) as Record<string, unknown>;
  const subject = typeof data.subject === "string" ? data.subject.trim() : "";
  const body = typeof data.body === "string" ? data.body : "";
  const priority =
    typeof data.priority === "string" &&
    (PRIORITIES as readonly string[]).includes(data.priority)
      ? (data.priority as keyof typeof SLA_HOURS)
      : "medium";

  if (!subject) return badRequest("Subject is required");

  // The SLA due time is derived server-side from the priority.
  const slaInterval = `${SLA_HOURS[priority]} hours`;

  const rows = (await sql`
    INSERT INTO tickets (subject, body, priority, status, creator_id, sla_due_at)
    VALUES (
      ${subject}, ${body}, ${priority}, 'open', ${user.id},
      now() + ${slaInterval}::interval
    )
    RETURNING id
  `) as { id: string }[];

  const ticket = await loadVisibleTicket(rows[0].id, user);
  return Response.json(ticket, { status: 201 });
}
