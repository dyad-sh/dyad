import { sql } from "@/db";
import type { SessionUser } from "@/lib/api-auth";
import type { Ticket } from "@/lib/tickets";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

/**
 * Loads a ticket the caller is allowed to see: requesters only ever see their
 * own tickets, agents and admins see all. Returns null when the ticket does not
 * exist or is out of the caller's scope (callers should answer 404).
 *
 * Internal note columns are never selected here, so note content cannot leak
 * into any ticket payload — notes are only served by the staff-only notes
 * endpoint.
 */
export async function loadVisibleTicket(
  id: string,
  user: SessionUser,
): Promise<Ticket | null> {
  if (!isUuid(id)) return null;

  const rows = (await sql`
    SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
           t.assignee_id, t.created_at, t.sla_due_at,
           c.name AS creator_name, c.email AS creator_email,
           a.name AS assignee_name, a.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" c ON c.id = t.creator_id
    LEFT JOIN neon_auth."user" a ON a.id = t.assignee_id
    WHERE t.id = ${id}
      AND (${user.role} <> 'requester' OR t.creator_id = ${user.id})
  `) as Ticket[];

  return rows[0] ?? null;
}

export type ListFilters = {
  assignedToMe?: boolean;
  unassigned?: boolean;
  status?: string;
};

export async function listVisibleTickets(
  user: SessionUser,
  filters: ListFilters = {},
): Promise<Ticket[]> {
  const assignedToMe = filters.assignedToMe ? "1" : "0";
  const unassigned = filters.unassigned ? "1" : "0";
  const status = filters.status ?? "";

  const rows = (await sql`
    SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
           t.assignee_id, t.created_at, t.sla_due_at,
           c.name AS creator_name, c.email AS creator_email,
           a.name AS assignee_name, a.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" c ON c.id = t.creator_id
    LEFT JOIN neon_auth."user" a ON a.id = t.assignee_id
    WHERE (${user.role} <> 'requester' OR t.creator_id = ${user.id})
      AND (${assignedToMe} = '0' OR t.assignee_id = ${user.id})
      AND (${unassigned} = '0' OR t.assignee_id IS NULL)
      AND (${status} = '' OR t.status = ${status})
    ORDER BY t.created_at DESC, t.id DESC
  `) as Ticket[];

  return rows;
}

/**
 * Public conversation participants: the ticket owner, the assigned agent, and
 * admins. Everyone else (including unassigned agents and other requesters) is
 * refused.
 */
export function isConversationParticipant(
  ticket: Pick<Ticket, "creator_id" | "assignee_id">,
  user: SessionUser,
): boolean {
  if (user.role === "admin") return true;
  if (ticket.creator_id === user.id) return true;
  return user.role === "agent" && ticket.assignee_id === user.id;
}
