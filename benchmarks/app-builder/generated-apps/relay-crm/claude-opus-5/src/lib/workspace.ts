import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireUser } from "@/lib/auth/server";
import { canManageMembers, canWrite } from "@/lib/types";
import { validationResponse } from "@/lib/validate";

export type SessionUser = { id: string; email: string; name: string };

export type Membership = {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
};

export type WorkspaceContext = {
  user: SessionUser;
  workspaceId: string;
  workspaceName: string;
  role: string;
  memberships: Membership[];
};

async function fetchMemberships(userId: string): Promise<Membership[]> {
  const rows = (await sql`
    SELECT m.id AS "membershipId",
           m.workspace_id AS "workspaceId",
           w.name AS "workspaceName",
           m.role AS role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${userId}
    ORDER BY w.created_at ASC
  `) as Membership[];
  return rows;
}

/**
 * Guarantees the user has at least one workspace. On first sign-in this creates
 * `<name>'s Workspace` and adopts any records the user created before
 * workspaces existed.
 */
async function ensureWorkspace(user: SessionUser): Promise<Membership[]> {
  await sql`
    UPDATE workspace_members SET email = ${user.email}
    WHERE user_id = ${user.id} AND email IS DISTINCT FROM ${user.email}
  `;

  let memberships = await fetchMemberships(user.id);
  if (memberships.length > 0) return memberships;

  const label = (user.name && user.name.trim()) || user.email;
  const created = (await sql`
    INSERT INTO workspaces (name, owner_id)
    VALUES (${`${label}'s Workspace`}, ${user.id})
    RETURNING id
  `) as { id: string }[];
  const workspaceId = created[0].id;

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${workspaceId}, ${user.id}, ${user.email}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;

  await sql`
    UPDATE contacts SET workspace_id = ${workspaceId}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;
  await sql`
    UPDATE companies SET workspace_id = ${workspaceId}
    WHERE user_id = ${user.id} AND workspace_id IS NULL
  `;

  await setActiveWorkspace(user.id, workspaceId);

  memberships = await fetchMemberships(user.id);
  return memberships;
}

export async function setActiveWorkspace(userId: string, workspaceId: string) {
  await sql`
    INSERT INTO user_settings (user_id, active_workspace_id, updated_at)
    VALUES (${userId}, ${workspaceId}, now())
    ON CONFLICT (user_id)
    DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now()
  `;
}

async function getStoredActiveWorkspace(userId: string) {
  const rows = (await sql`
    SELECT active_workspace_id FROM user_settings WHERE user_id = ${userId}
  `) as { active_workspace_id: string | null }[];
  return rows[0]?.active_workspace_id ?? null;
}

export class WorkspaceAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the workspace to operate on. A client-supplied id is only honoured
 * when the session user is actually a member of it; otherwise this throws 403.
 */
export async function getWorkspaceContext(
  requestedWorkspaceId?: string | null,
): Promise<WorkspaceContext> {
  const user = await requireUser();
  if (!user) throw new WorkspaceAccessError(401, "Unauthorized");

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
  };
  const memberships = await ensureWorkspace(sessionUser);

  let active: Membership | undefined;
  if (requestedWorkspaceId) {
    active = memberships.find((m) => m.workspaceId === requestedWorkspaceId);
    if (!active) throw new WorkspaceAccessError(403, "Forbidden");
  } else {
    const stored = await getStoredActiveWorkspace(user.id);
    active = memberships.find((m) => m.workspaceId === stored) ?? memberships[0];
    if (active && active.workspaceId !== stored) {
      await setActiveWorkspace(user.id, active.workspaceId);
    }
  }

  if (!active) throw new WorkspaceAccessError(403, "Forbidden");

  return {
    user: sessionUser,
    workspaceId: active.workspaceId,
    workspaceName: active.workspaceName,
    role: active.role,
    memberships,
  };
}

/** Throws 403 unless the caller may create/edit/delete workspace records. */
export function requireWrite(ctx: WorkspaceContext): void {
  if (!canWrite(ctx.role)) {
    throw new WorkspaceAccessError(
      403,
      "Your role does not allow changing records in this workspace.",
    );
  }
}

/** Throws 403 unless the caller owns the workspace. */
export function requireOwner(ctx: WorkspaceContext): void {
  if (!canManageMembers(ctx.role)) {
    throw new WorkspaceAccessError(
      403,
      "Only the workspace owner can manage members.",
    );
  }
}

/** Page-level variant: sends signed-out visitors to the sign-in screen. */
export async function pageWorkspaceContext(): Promise<WorkspaceContext> {
  try {
    return await getWorkspaceContext();
  } catch (error) {
    if (error instanceof WorkspaceAccessError) redirect("/auth/sign-in");
    throw error;
  }
}

/** Maps auth/role failures (401/403) and validation failures (400) to JSON. */
export function workspaceErrorResponse(error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const validation = validationResponse(error);
  if (validation) return validation;
  throw error;
}

/** Reads an optional workspace id from the query string of an API request. */
export function requestedWorkspaceId(request: Request): string | null {
  const url = new URL(request.url);
  return (
    url.searchParams.get("workspaceId") ??
    url.searchParams.get("workspace_id") ??
    request.headers.get("x-workspace-id")
  );
}
