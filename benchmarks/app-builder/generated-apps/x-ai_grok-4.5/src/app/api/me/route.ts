import { getSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await ensureUserWorkspace(user);

  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    activeWorkspaceId: context.workspaceId,
    memberships: context.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      workspaceName: m.workspaceName,
      membershipId: m.membershipId,
      role: m.role,
    })),
  });
}
