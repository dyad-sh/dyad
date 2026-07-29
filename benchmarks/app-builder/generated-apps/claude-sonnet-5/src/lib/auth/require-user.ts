import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { ensureUserWorkspace, getActiveWorkspace, getMembershipRole, type Workspace } from "@/lib/workspace";
import { canWrite, type WorkspaceRole } from "@/lib/roles";

export async function getSessionUser() {
  const { data: session } = await auth.getSession();
  return session?.user ?? null;
}

type WorkspaceContext = {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  role: WorkspaceRole;
};

/**
 * Resolves the session user and their active workspace, verifying membership
 * server-side. Never trust a workspace id from the client for this — the
 * active workspace is always looked up from server-side state.
 */
export async function requireWorkspaceContext(): Promise<
  { context: WorkspaceContext; error?: undefined } | { context?: undefined; error: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  await ensureUserWorkspace(user);
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 403 }) };
  }

  const role = await getMembershipRole(user.id, workspace.id);
  if (!role) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { context: { user, workspace, role: role as WorkspaceRole } };
}

/**
 * Same as requireWorkspaceContext, but also enforces that the caller's role
 * allows creating/editing/deleting workspace data (owner or member). Viewers
 * get a 403 and no data is changed.
 */
export async function requireWorkspaceWriteContext(): Promise<
  { context: WorkspaceContext; error?: undefined } | { context?: undefined; error: NextResponse }
> {
  const result = await requireWorkspaceContext();
  if (result.error) return result;

  if (!canWrite(result.context.role)) {
    return { error: NextResponse.json({ error: "You do not have permission to do this" }, { status: 403 }) };
  }

  return result;
}
