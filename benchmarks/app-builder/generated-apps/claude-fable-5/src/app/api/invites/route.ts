import { sql } from '@/db';
import { getSessionUser, unauthorized } from '@/lib/api-auth';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const rows = await sql`
    SELECT i.id, i.email, w.id AS workspace_id, w.name AS workspace_name
    FROM invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE lower(i.email) = ${user.email.toLowerCase()} AND i.status = 'pending'
    ORDER BY i.created_at DESC
  `;
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
    })),
  );
}
