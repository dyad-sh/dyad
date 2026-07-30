import { sql } from '@/db';
import { getSessionUser, SessionUser } from '@/lib/api-auth';

export type Membership = {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
};

export type WorkspaceContext = {
  user: SessionUser;
  memberships: Membership[];
  activeWorkspaceId: string;
  activeRole: string;
};

async function loadMemberships(userId: string): Promise<Membership[]> {
  const rows = await sql`
    SELECT m.id AS membership_id, m.role, w.id AS workspace_id, w.name AS workspace_name
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${userId}
    ORDER BY m.created_at ASC
  `;
  return rows.map((r) => ({
    membershipId: r.membership_id as string,
    workspaceId: r.workspace_id as string,
    workspaceName: r.workspace_name as string,
    role: r.role as string,
  }));
}

/**
 * Resolves the session user and their active workspace, entirely server-side.
 * If the user has no workspace yet, creates "<name>'s Workspace", makes them
 * owner, and migrates their pre-workspace records into it.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  let memberships = await loadMemberships(user.id);

  if (memberships.length === 0) {
    const created = await sql`
      INSERT INTO workspaces (name, owner_user_id)
      VALUES (${`${user.name}'s Workspace`}, ${user.id})
      RETURNING id
    `;
    const workspaceId = created[0].id as string;
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, email, role)
      VALUES (${workspaceId}, ${user.id}, ${user.email}, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `;
    // Migrate milestone-1 records created by this user into their workspace.
    await sql`
      UPDATE contacts SET workspace_id = ${workspaceId}
      WHERE user_id = ${user.id} AND workspace_id IS NULL
    `;
    await sql`
      UPDATE companies SET workspace_id = ${workspaceId}
      WHERE user_id = ${user.id} AND workspace_id IS NULL
    `;
    memberships = await loadMemberships(user.id);
  }

  const settings = await sql`
    SELECT active_workspace_id FROM user_settings WHERE user_id = ${user.id}
  `;
  let activeWorkspaceId = (settings[0]?.active_workspace_id as string | null) ?? null;

  if (!activeWorkspaceId || !memberships.some((m) => m.workspaceId === activeWorkspaceId)) {
    activeWorkspaceId = memberships[0].workspaceId;
    await sql`
      INSERT INTO user_settings (user_id, active_workspace_id)
      VALUES (${user.id}, ${activeWorkspaceId})
      ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = ${activeWorkspaceId}
    `;
  }

  const activeRole =
    memberships.find((m) => m.workspaceId === activeWorkspaceId)?.role ?? 'member';

  return { user, memberships, activeWorkspaceId, activeRole };
}

/**
 * Returns true when the request supplies a workspace id (query string or body)
 * for a workspace the caller is NOT a member of. Such requests must get 403.
 * A supplied id is never used for scoping — scoping always uses the
 * server-resolved active workspace.
 */
export function suppliedWorkspaceViolation(
  ctx: WorkspaceContext,
  requestUrl: string,
  body?: unknown,
): boolean {
  const candidates: unknown[] = [];
  const params = new URL(requestUrl).searchParams;
  for (const key of ['workspaceId', 'workspace_id']) {
    if (params.has(key)) candidates.push(params.get(key));
    if (body && typeof body === 'object' && key in (body as Record<string, unknown>)) {
      candidates.push((body as Record<string, unknown>)[key]);
    }
  }
  return candidates.some(
    (v) =>
      typeof v === 'string' &&
      v.length > 0 &&
      !ctx.memberships.some((m) => m.workspaceId === v),
  );
}

export function forbidden() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}

/** Owners and members can write; viewers are read-only. */
export function canWrite(ctx: WorkspaceContext): boolean {
  return ctx.activeRole === 'owner' || ctx.activeRole === 'member';
}

