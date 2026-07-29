import { requireSessionUser } from "@/lib/auth/session";
import {
  ensureUserWorkspace,
  requireWorkspaceMembership,
  setActiveWorkspace,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  await ensureUserWorkspace(user);

  let body: { workspaceId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = (body.workspaceId ?? "").trim();
  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const membership = await requireWorkspaceMembership(user.id, workspaceId);
  if (membership instanceof Response) return membership;

  await setActiveWorkspace(user.id, workspaceId);

  return Response.json({
    activeWorkspaceId: workspaceId,
    workspaceName: membership.workspaceName,
    role: membership.role,
  });
}
