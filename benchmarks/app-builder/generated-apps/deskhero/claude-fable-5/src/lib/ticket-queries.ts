import { sql } from "@/db";

const SELECT = `
  SELECT t.id, t.subject, t.body, t.priority, t.status, t.created_at,
         t.sla_due_at, t.user_id, t.assignee_id,
         au.name AS assignee_name, ru.name AS requester_name
  FROM tickets t
  LEFT JOIN neon_auth.users au ON au.id = t.assignee_id
  LEFT JOIN neon_auth.users ru ON ru.id = t.user_id
`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findTicketById(id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await sql.query(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listTickets(
  where: "own" | "unassigned" | "mine" | "all",
  userId: string,
) {
  const clauses: Record<typeof where, string> = {
    own: "WHERE t.user_id = $1",
    unassigned: "WHERE t.assignee_id IS NULL AND t.status = 'open'",
    mine: "WHERE t.assignee_id = $1",
    all: "",
  };
  const clause = clauses[where];
  const params = clause.includes("$1") ? [userId] : [];
  return sql.query(`${SELECT} ${clause} ORDER BY t.created_at DESC`, params);
}
