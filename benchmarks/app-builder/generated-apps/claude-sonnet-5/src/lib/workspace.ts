import { sql } from "@/db";

export type SessionUser = { id: string; email: string; name: string };

export type Workspace = { id: string; name: string };

/**
 * Ensures the given user has at least one workspace. If not, creates one
 * named "<user name>'s Workspace", makes the user its owner, migrates any
 * legacy (pre-workspace) contacts/companies they created into it, and sets
 * it as their active workspace.
 */
export async function ensureUserWorkspace(user: SessionUser): Promise<void> {
  const memberships = await sql`
    SELECT workspace_id FROM workspace_members WHERE user_id = ${user.id} LIMIT 1
  `;
  if (memberships.length > 0) return;

  const [workspace] = await sql`
    INSERT INTO workspaces (name, owner_user_id)
    VALUES (${`${user.name}'s Workspace`}, ${user.id})
    RETURNING id
  `;

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspace.id}, ${user.id}, 'owner')
  `;

  await sql`
    UPDATE contacts SET workspace_id = ${workspace.id}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;
  await sql`
    UPDATE companies SET workspace_id = ${workspace.id}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;

  await sql`
    INSERT INTO user_settings (user_id, active_workspace_id)
    VALUES (${user.id}, ${workspace.id})
    ON CONFLICT (user_id) DO NOTHING
  `;
}

/** Returns the caller's memberships (their own workspaces + role). */
export async function listUserMemberships(userId: string) {
  const rows = await sql`
    SELECT wm.id AS "membershipId", wm.workspace_id AS "workspaceId",
           w.name AS "workspaceName", wm.role
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId}
    ORDER BY wm.created_at ASC
  `;
  return rows as {
    membershipId: string;
    workspaceId: string;
    workspaceName: string;
    role: string;
  }[];
}

/** Resolves (and self-heals) the caller's active workspace. */
export async function getActiveWorkspace(
  userId: string,
): Promise<Workspace | null> {
  const rows = await sql`
    SELECT w.id, w.name
    FROM user_settings us
    JOIN workspace_members wm ON wm.workspace_id = us.active_workspace_id AND wm.user_id = ${userId}
    JOIN workspaces w ON w.id = us.active_workspace_id
    WHERE us.user_id = ${userId}
  `;
  if (rows.length > 0) return rows[0] as Workspace;

  const fallback = await sql`
    SELECT w.id, w.name
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId}
    ORDER BY wm.created_at ASC
    LIMIT 1
  `;
  if (fallback.length === 0) return null;

  await setActiveWorkspace(userId, fallback[0].id as string);
  return fallback[0] as Workspace;
}

/** Sets the caller's active workspace. Caller must verify membership first. */
export async function setActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await sql`
    INSERT INTO user_settings (user_id, active_workspace_id)
    VALUES (${userId}, ${workspaceId})
    ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id
  `;
}

/** Returns the caller's role in a workspace, or null if not a member. */
export async function getMembershipRole(
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT role FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  return rows.length > 0 ? (rows[0].role as string) : null;
}
