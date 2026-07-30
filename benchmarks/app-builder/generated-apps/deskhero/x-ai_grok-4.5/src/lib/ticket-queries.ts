import { sql } from "@/db";
import { mapTicket, type Ticket } from "@/lib/tickets";

export async function getTicketById(id: string): Promise<Ticket | null> {
  const rows = await sql`
    SELECT
      t.id,
      t.subject,
      t.body,
      t.priority,
      t.status,
      t.creator_id,
      t.assignee_id,
      t.created_at,
      t.sla_due_at,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    WHERE t.id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return mapTicket(rows[0] as Record<string, unknown>);
}

export async function listTicketsForCreator(userId: string): Promise<Ticket[]> {
  const rows = await sql`
    SELECT
      t.id,
      t.subject,
      t.body,
      t.priority,
      t.status,
      t.creator_id,
      t.assignee_id,
      t.created_at,
      t.sla_due_at,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    WHERE t.creator_id = ${userId}
    ORDER BY t.created_at DESC
  `;

  return rows.map((row) => mapTicket(row as Record<string, unknown>));
}

export async function listUnassignedOpenTickets(): Promise<Ticket[]> {
  const rows = await sql`
    SELECT
      t.id,
      t.subject,
      t.body,
      t.priority,
      t.status,
      t.creator_id,
      t.assignee_id,
      t.created_at,
      t.sla_due_at,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    WHERE t.status = 'open' AND t.assignee_id IS NULL
    ORDER BY t.created_at DESC
  `;

  return rows.map((row) => mapTicket(row as Record<string, unknown>));
}

export async function listTicketsAssignedTo(userId: string): Promise<Ticket[]> {
  const rows = await sql`
    SELECT
      t.id,
      t.subject,
      t.body,
      t.priority,
      t.status,
      t.creator_id,
      t.assignee_id,
      t.created_at,
      t.sla_due_at,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    WHERE t.assignee_id = ${userId}
    ORDER BY t.created_at DESC
  `;

  return rows.map((row) => mapTicket(row as Record<string, unknown>));
}

export async function listAllTickets(): Promise<Ticket[]> {
  const rows = await sql`
    SELECT
      t.id,
      t.subject,
      t.body,
      t.priority,
      t.status,
      t.creator_id,
      t.assignee_id,
      t.created_at,
      t.sla_due_at,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM tickets t
    LEFT JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    ORDER BY t.created_at DESC
  `;

  return rows.map((row) => mapTicket(row as Record<string, unknown>));
}

export async function countTicketsByStatus(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT status, COUNT(*)::int AS count
    FROM tickets
    GROUP BY status
  `;

  const counts: Record<string, number> = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  };

  for (const row of rows) {
    counts[String(row.status)] = Number(row.count);
  }

  return counts;
}
