import "server-only";

import { sql } from "@/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { DeskheroUser, Ticket } from "@/lib/tickets";

export async function getTicket(id: string) {
  const rows = (await sql`
    SELECT t.id, t.subject, t.body, t.priority, t.status, t.creator_id,
      creator.name AS creator_name, creator.email AS creator_email,
      t.assignee_id, assignee.name AS assignee_name, assignee.email AS assignee_email,
      t.created_at, t.sla_due_at
    FROM tickets t
    JOIN neon_auth."user" creator ON creator.id = t.creator_id
    LEFT JOIN neon_auth."user" assignee ON assignee.id = t.assignee_id
    WHERE t.id = ${id}
  `) as Ticket[];
  return rows[0] ?? null;
}

export function canViewTicket(user: CurrentUser, ticket: Ticket) {
  return user.role !== "requester" || ticket.creator_id === user.id;
}

export function canParticipate(user: CurrentUser, ticket: Ticket) {
  return user.role === "admin" || ticket.creator_id === user.id || (user.role === "agent" && ticket.assignee_id === user.id);
}

export async function getAgents() {
  return (await sql`
    SELECT users.id, users.name, users.email, profiles.role, profiles.active
    FROM neon_auth."user" users
    JOIN user_profiles profiles ON profiles.user_id = users.id
    WHERE profiles.role = 'agent' AND profiles.active = true
    ORDER BY users.name, users.email
  `) as DeskheroUser[];
}
