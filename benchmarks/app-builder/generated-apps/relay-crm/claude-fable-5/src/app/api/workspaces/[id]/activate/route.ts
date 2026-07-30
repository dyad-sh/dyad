import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { forbidden, getWorkspaceContext } from '@/lib/workspace';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  if (!ctx.memberships.some((m) => m.workspaceId === id)) {
    return forbidden();
  }

  await sql`
    INSERT INTO user_settings (user_id, active_workspace_id)
    VALUES (${ctx.user.id}, ${id})
    ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = ${id}
  `;
  return Response.json({ success: true, activeWorkspaceId: id });
}
