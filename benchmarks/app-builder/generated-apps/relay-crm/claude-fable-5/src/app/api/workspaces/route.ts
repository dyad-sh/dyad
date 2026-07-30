import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { getWorkspaceContext } from '@/lib/workspace';

export async function GET() {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  return Response.json(
    ctx.memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceName })),
  );
}

export async function POST(request: Request) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return Response.json({ error: 'Name is required' }, { status: 400 });
  }
  if (name.length > 500) {
    return Response.json(
      { error: 'name must be 500 characters or fewer' },
      { status: 400 },
    );
  }

  const rows = await sql`
    INSERT INTO workspaces (name, owner_user_id)
    VALUES (${name}, ${ctx.user.id})
    RETURNING id, name
  `;
  const workspace = rows[0];
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${workspace.id}, ${ctx.user.id}, ${ctx.user.email}, 'owner')
  `;
  return Response.json({ id: workspace.id, name: workspace.name }, { status: 201 });
}
