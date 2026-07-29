import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { badRequest } from '@/lib/validate';
import { forbidden, getWorkspaceContext } from '@/lib/workspace';

type Params = { params: Promise<{ id: string; memberId: string }> };

const ROLES = ['owner', 'member', 'viewer'];

async function ownerCount(workspaceId: string): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS count FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND role = 'owner'
  `;
  return rows[0].count as number;
}

export async function PATCH(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id, memberId } = await params;

  const membership = ctx.memberships.find((m) => m.workspaceId === id);
  if (!membership) return forbidden();
  if (membership.role !== 'owner') return forbidden();

  const target = await sql`
    SELECT id, user_id, email, role FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${id}
  `;
  if (target.length === 0) {
    return Response.json({ error: 'Member not found' }, { status: 404 });
  }
  const targetMember = target[0];

  // Nobody may change their own role.
  if ((targetMember.user_id as string) === ctx.user.id) {
    return Response.json(
      { error: 'You cannot change your own role' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const role = body.role;
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    return badRequest('Invalid role');
  }

  // A workspace must always keep at least one owner.
  if (targetMember.role === 'owner' && role !== 'owner') {
    if ((await ownerCount(id)) <= 1) {
      return badRequest('A workspace must keep at least one owner');
    }
  }

  const rows = await sql`
    UPDATE workspace_members SET role = ${role}
    WHERE id = ${memberId} AND workspace_id = ${id}
    RETURNING id, user_id, email, role
  `;
  const updated = rows[0];
  return Response.json({
    id: updated.id,
    userId: updated.user_id,
    email: updated.email,
    role: updated.role,
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id, memberId } = await params;

  const membership = ctx.memberships.find((m) => m.workspaceId === id);
  if (!membership) return forbidden();
  if (membership.role !== 'owner') return forbidden();

  const target = await sql`
    SELECT id, user_id, role FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${id}
  `;
  if (target.length === 0) {
    return Response.json({ error: 'Member not found' }, { status: 404 });
  }
  const targetMember = target[0];

  // A workspace must always keep at least one owner.
  if (targetMember.role === 'owner' && (await ownerCount(id)) <= 1) {
    return badRequest('A workspace must keep at least one owner');
  }

  await sql`
    DELETE FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${id}
  `;
  return Response.json({ success: true });
}
