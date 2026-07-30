import { sql } from "@/db";
import type { Ticket } from "@/types/ticket";

export async function loadTicket(id: string): Promise<Ticket | null> {
  const [row] = await sql`
    SELECT
      t.id, t.subject, t.body, t.priority, t.status,
      t.owner_id, owner.name AS owner_name,
      t.assignee_id, assignee.name AS assignee_name,
      t.sla_due_at,
      (t.sla_due_at < now() AND t.status NOT IN ('resolved', 'closed')) AS overdue,
      t.created_at
    FROM tickets t
    LEFT JOIN app_users owner ON owner.id = t.owner_id
    LEFT JOIN app_users assignee ON assignee.id = t.assignee_id
    WHERE t.id = ${id}
  `;
  return (row as Ticket) ?? null;
}
