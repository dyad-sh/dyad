import {
  getWorkspaceContext,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
