import "server-only";
import { sql } from "@/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

export type WorkspaceRole = "owner" | "member" | "viewer";

export type Membership = {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

export type WorkspaceContext = {
  user: CurrentUser;
  activeWorkspace: { id: string; name: string; role: WorkspaceRole };
  memberships: Membership[];
};

type MembershipRow = Membership;

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  let memberships = await sql`
    SELECT m.id AS "membershipId", m.workspace_id AS "workspaceId", w.name AS "workspaceName", m.role
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${user.id}
    ORDER BY m.created_at, w.name` as MembershipRow[];

  if (!memberships.length) {
    const [workspace] = await sql`
      INSERT INTO workspaces (name, personal_owner_id)
      VALUES (${`${user.name}'s Workspace`}, ${user.id})
      ON CONFLICT (personal_owner_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name` as { id: string; name: string }[];
    await sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, email, role)
      VALUES (${workspace.id}, ${user.id}, ${user.email.toLowerCase()}, 'owner')
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET email = EXCLUDED.email`;
    await sql`
      INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
      VALUES (${user.id}, ${workspace.id})
      ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now()`;
    memberships = await sql`
      SELECT m.id AS "membershipId", m.workspace_id AS "workspaceId", w.name AS "workspaceName", m.role
      FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ${user.id} ORDER BY m.created_at, w.name` as MembershipRow[];
  }

  await sql`UPDATE workspace_memberships SET email = ${user.email.toLowerCase()} WHERE user_id = ${user.id} AND email IS DISTINCT FROM ${user.email.toLowerCase()}`;
  await sql`UPDATE workspaces SET name = ${`${user.name}'s Workspace`} WHERE personal_owner_id = ${user.id} AND name = 'Workspace'`;

  memberships = await sql`
    SELECT m.id AS "membershipId", m.workspace_id AS "workspaceId", w.name AS "workspaceName", m.role
    FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${user.id} ORDER BY m.created_at, w.name` as MembershipRow[];

  const [preference] = await sql`
    SELECT p.active_workspace_id AS "workspaceId"
    FROM user_workspace_preferences p
    JOIN workspace_memberships m ON m.workspace_id = p.active_workspace_id AND m.user_id = p.user_id
    WHERE p.user_id = ${user.id}` as { workspaceId: string }[];
  const activeMembership = memberships.find((membership) => membership.workspaceId === preference?.workspaceId) ?? memberships[0];

  if (!preference || preference.workspaceId !== activeMembership.workspaceId) {
    await sql`
      INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
      VALUES (${user.id}, ${activeMembership.workspaceId})
      ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now()`;
  }

  return {
    user,
    activeWorkspace: { id: activeMembership.workspaceId, name: activeMembership.workspaceName, role: activeMembership.role },
    memberships,
  };
}

export async function getWorkspaceMembership(workspaceId: string) {
  const context = await getWorkspaceContext();
  if (!context) return { status: 401 as const, context: null, membership: null };
  const membership = context.memberships.find((item) => item.workspaceId === workspaceId) ?? null;
  if (!membership) return { status: 403 as const, context, membership: null };
  return { status: 200 as const, context, membership };
}

export function canWriteRecords(context: WorkspaceContext) {
  return context.activeWorkspace.role === "owner" || context.activeWorkspace.role === "member";
}

export function hasForbiddenSuppliedWorkspace(
  context: WorkspaceContext,
  request: Request,
  body?: Record<string, unknown>,
) {

  const url = new URL(request.url);
  const supplied = [
    url.searchParams.get("workspaceId"),
    url.searchParams.get("workspace_id"),
    request.headers.get("x-workspace-id"),
    request.headers.get("workspace-id"),
    request.headers.get("workspaceid"),
    typeof body?.workspaceId === "string" ? body.workspaceId : null,
    typeof body?.workspace_id === "string" ? body.workspace_id : null,
  ].filter((value): value is string => Boolean(value));
  return supplied.some((workspaceId) => !context.memberships.some((membership) => membership.workspaceId === workspaceId));
}
