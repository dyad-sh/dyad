import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { forbidden, getWorkspaceContext } from '@/lib/workspace';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const membership = ctx.memberships.find((m) => m.workspaceId === id);
  if (!membership || membership.role !== 'owner') {
    return forbidden();
  }

  const rows = await sql`
    SELECT id, user_id, email, role
    FROM workspace_members
    WHERE workspace_id = ${id}
    ORDER BY created_at ASC
  `;
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      role: r.role,
    })),
  );
}
