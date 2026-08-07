import { awaitWrites } from "@/lib/write-barrier";
import { getWorkspaceContext, workspaceErrorResponse } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The caller's own identity, active workspace and memberships — nobody else's. */
export async function GET() {
  try {
    await awaitWrites();
    const ctx = await getWorkspaceContext();
    return Response.json({
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      activeWorkspaceId: ctx.workspaceId,
      memberships: ctx.memberships.map((m) => ({
        membershipId: m.membershipId,
        workspaceId: m.workspaceId,
        workspaceName: m.workspaceName,
        role: m.role,
      })),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
