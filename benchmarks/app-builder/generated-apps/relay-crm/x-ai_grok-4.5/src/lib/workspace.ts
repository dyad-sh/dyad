import { sql } from "@/db";
import type { AuthUser } from "@/lib/auth/session";
import type { Membership, MembershipRole } from "@/lib/types";

export type ActiveWorkspaceContext = {
  user: AuthUser;
  workspaceId: string;
  workspaceName: string;
  membershipId: string;
  role: MembershipRole;
  memberships: Membership[];
};

function workspaceNameForUser(user: AuthUser): string {
  const base = (user.name || user.email || "User").trim() || "User";
  return `${base}'s Workspace`;
}

function asRole(value: unknown): MembershipRole {
  if (value === "owner" || value === "member" || value === "viewer") {
    return value;
  }
  return "member";
}

async function createPersonalWorkspace(user: AuthUser): Promise<string> {
  const name = workspaceNameForUser(user);
  const rows = await sql`
    INSERT INTO workspaces (name)
    VALUES (${name})
    RETURNING id
  `;
  const workspaceId = String(rows[0].id);

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${workspaceId}, ${user.id}, ${user.email}, 'owner')
  `;

  await sql`
    INSERT INTO user_workspace_settings (user_id, active_workspace_id, updated_at)
    VALUES (${user.id}, ${workspaceId}, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET active_workspace_id = EXCLUDED.active_workspace_id,
        updated_at = NOW()
  `;

  await sql`
    UPDATE companies
    SET workspace_id = ${workspaceId}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;
  await sql`
    UPDATE contacts
    SET workspace_id = ${workspaceId}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;

  return workspaceId;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await sql`
    SELECT
      wm.id AS membership_id,
      wm.workspace_id,
      wm.role,
      w.name AS workspace_name
    FROM workspace_members wm
    INNER JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId}
    ORDER BY w.created_at ASC
  `;

  return rows.map((row) => ({
    membershipId: String(row.membership_id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    role: asRole(row.role),
  }));
}

async function getStoredActiveWorkspaceId(userId: string): Promise<string | null> {
  const rows = await sql`
    SELECT active_workspace_id
    FROM user_workspace_settings
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0 || !rows[0].active_workspace_id) {
    return null;
  }
  return String(rows[0].active_workspace_id);
}

export async function setActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await sql`
    INSERT INTO user_workspace_settings (user_id, active_workspace_id, updated_at)
    VALUES (${userId}, ${workspaceId}, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET active_workspace_id = EXCLUDED.active_workspace_id,
        updated_at = NOW()
  `;
}

export async function ensureUserWorkspace(
  user: AuthUser,
): Promise<ActiveWorkspaceContext> {
  let memberships = await listMemberships(user.id);

  if (memberships.length === 0) {
    await createPersonalWorkspace(user);
    memberships = await listMemberships(user.id);
  } else {
    const firstOwner = memberships.find((m) => m.role === "owner") ?? memberships[0];
    await sql`
      UPDATE companies
      SET workspace_id = ${firstOwner.workspaceId}
      WHERE user_id = ${user.id} AND workspace_id IS NULL
    `;
    await sql`
      UPDATE contacts
      SET workspace_id = ${firstOwner.workspaceId}
      WHERE user_id = ${user.id} AND workspace_id IS NULL
    `;
  }

  const activeId = await getStoredActiveWorkspaceId(user.id);
  const activeMembership =
    memberships.find((m) => m.workspaceId === activeId) ?? memberships[0];

  if (activeId !== activeMembership.workspaceId) {
    await setActiveWorkspace(user.id, activeMembership.workspaceId);
  }

  return {
    user,
    workspaceId: activeMembership.workspaceId,
    workspaceName: activeMembership.workspaceName,
    membershipId: activeMembership.membershipId,
    role: activeMembership.role,
    memberships,
  };
}

export async function requireActiveWorkspace(
  user: AuthUser,
): Promise<ActiveWorkspaceContext | Response> {
  try {
    return await ensureUserWorkspace(user);
  } catch (error) {
    console.error("Failed to resolve active workspace", error);
    return Response.json({ error: "Failed to resolve workspace" }, { status: 500 });
  }
}

export async function requireWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<
  | { membershipId: string; role: MembershipRole; workspaceName: string }
  | Response
> {
  const rows = await sql`
    SELECT wm.id, wm.role, w.name
    FROM workspace_members wm
    INNER JOIN workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = ${userId} AND wm.workspace_id = ${workspaceId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return {
    membershipId: String(rows[0].id),
    role: asRole(rows[0].role),
    workspaceName: String(rows[0].name),
  };
}

export async function createWorkspace(
  user: AuthUser,
  name: string,
): Promise<{ id: string; name: string }> {
  const rows = await sql`
    INSERT INTO workspaces (name)
    VALUES (${name})
    RETURNING id, name
  `;
  const workspace = rows[0];

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${workspace.id}, ${user.id}, ${user.email}, 'owner')
  `;

  await setActiveWorkspace(user.id, String(workspace.id));

  return { id: String(workspace.id), name: String(workspace.name) };
}

export async function countOwners(workspaceId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND role = 'owner'
  `;
  return Number(rows[0]?.count ?? 0);
}
