import { sql } from '@/db';
import { getCurrentUser } from '@/lib/current-user';

export type TenantUser = { id: string; name: string; email: string };
export type WorkspaceRole = 'owner' | 'member' | 'viewer';
export class TenantError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

export async function ensureUserWorkspace(user: TenantUser) {
  let memberships = await sql`SELECT m.id AS "membershipId", m.role, w.id AS "workspaceId", w.name AS "workspaceName" FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=${user.id} ORDER BY m.created_at`;
  if (!memberships.length) {
    const created = await sql`INSERT INTO workspaces (name, owner_user_id) VALUES (${`${user.name}'s Workspace`}, ${user.id}) RETURNING id, name`;
    await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${created[0].id}, ${user.id}, 'owner')`;
    await sql`INSERT INTO user_workspace_preferences (user_id, active_workspace_id) VALUES (${user.id}, ${created[0].id}) ON CONFLICT (user_id) DO UPDATE SET active_workspace_id=EXCLUDED.active_workspace_id, updated_at=now()`;
    memberships = await sql`SELECT m.id AS "membershipId", m.role, w.id AS "workspaceId", w.name AS "workspaceName" FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=${user.id} ORDER BY m.created_at`;
  } else {
    await sql`INSERT INTO user_workspace_preferences (user_id, active_workspace_id) SELECT ${user.id}, ${memberships[0].workspaceId} WHERE NOT EXISTS (SELECT 1 FROM user_workspace_preferences WHERE user_id=${user.id})`;
  }
  return memberships;
}

export async function getTenantContext(requestedWorkspaceId?: string) {
  const user = await getCurrentUser();
  if (!user) throw new TenantError('Unauthorized', 401);
  const memberships = await ensureUserWorkspace(user);
  if (requestedWorkspaceId && !memberships.some((membership) => membership.workspaceId === requestedWorkspaceId)) throw new TenantError('Forbidden', 403);
  const preference = await sql`SELECT w.id, w.name FROM user_workspace_preferences p JOIN workspaces w ON w.id=p.active_workspace_id JOIN workspace_memberships m ON m.workspace_id=w.id AND m.user_id=${user.id} WHERE p.user_id=${user.id}`;
  const workspace = preference[0] ?? memberships[0];
  const membership = memberships.find((item) => item.workspaceId === (workspace.workspaceId ?? workspace.id));
  return { user, workspace: { id: workspace.workspaceId ?? workspace.id, name: workspace.workspaceName ?? workspace.name }, role: membership?.role as WorkspaceRole, memberships };
}

export async function getWorkspaceMembership(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user) throw new TenantError('Unauthorized', 401);
  const rows = await sql`SELECT m.id AS "membershipId", m.user_id AS "userId", m.role, w.id AS "workspaceId", w.name AS "workspaceName" FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=${workspaceId} AND m.user_id=${user.id}`;
  if (!rows.length) throw new TenantError('Forbidden', 403);
  return { user, membership: rows[0] };
}

export function requireRole(role: WorkspaceRole, allowed: WorkspaceRole[]) { if (!allowed.includes(role)) throw new TenantError('Forbidden', 403); }
export function requestedWorkspaceId(request: Request) { return request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspaceId') || undefined; }
export function tenantResponse(error: unknown) { if (error instanceof TenantError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
