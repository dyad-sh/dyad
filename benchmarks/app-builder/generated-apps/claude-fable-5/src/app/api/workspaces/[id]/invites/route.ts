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
    SELECT i.id, i.email, i.role, w.id AS workspace_id, w.name AS workspace_name
    FROM invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.workspace_id = ${id} AND i.status = 'pending'
    ORDER BY i.created_at DESC
  `;
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
    })),
  );
}

export async function POST(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const membership = ctx.memberships.find((m) => m.workspaceId === id);
  if (!membership) return forbidden();
  if (membership.role !== 'owner') {
    return Response.json(
      { error: 'Only the workspace owner can invite members' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (email.length > 500) {
    return Response.json(
      { error: 'email must be 500 characters or fewer' },
      { status: 400 },
    );
  }
  const inviteRole =
    typeof body.role === 'string' && body.role ? body.role : 'member';
  if (inviteRole !== 'member' && inviteRole !== 'viewer') {
    return Response.json(
      { error: 'Role must be member or viewer' },
      { status: 400 },
    );
  }

  const existingMember = await sql`
    SELECT id FROM workspace_members
    WHERE workspace_id = ${id} AND lower(email) = ${email}
  `;
  if (existingMember.length > 0) {
    return Response.json(
      { error: 'That person is already a member' },
      { status: 400 },
    );
  }

  const existingInvite = await sql`
    SELECT id FROM invites
    WHERE workspace_id = ${id} AND lower(email) = ${email} AND status = 'pending'
  `;
  if (existingInvite.length > 0) {
    return Response.json(
      { error: 'That email already has a pending invite' },
      { status: 400 },
    );
  }

  const rows = await sql`
    INSERT INTO invites (workspace_id, email, role)
    VALUES (${id}, ${email}, ${inviteRole})
    RETURNING id, email, role
  `;
  const workspace = ctx.memberships.find((m) => m.workspaceId === id)!;
  return Response.json(
    {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      workspaceId: id,
      workspaceName: workspace.workspaceName,
    },
    { status: 201 },
  );
}
