import { sql } from '@/db';
import { getSessionUser, unauthorized } from '@/lib/api-auth';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const rows = await sql`
    SELECT id, workspace_id, email, role FROM invites
    WHERE id = ${id} AND status = 'pending'
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Invite not found' }, { status: 404 });
  }
  const invite = rows[0];

  // Only the invited email address may accept.
  if ((invite.email as string).toLowerCase() !== user.email.toLowerCase()) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const inviteRole =
    invite.role === 'viewer' || invite.role === 'member'
      ? (invite.role as string)
      : 'member';
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${invite.workspace_id}, ${user.id}, ${user.email}, ${inviteRole})
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
  await sql`UPDATE invites SET status = 'accepted' WHERE id = ${id}`;

  return Response.json({ success: true, workspaceId: invite.workspace_id });
}
