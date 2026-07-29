import { unauthorized } from '@/lib/api-auth';
import { getWorkspaceContext } from '@/lib/workspace';

export async function GET() {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  return Response.json({
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    activeWorkspaceId: ctx.activeWorkspaceId,
    memberships: ctx.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      workspaceName: m.workspaceName,
      membershipId: m.membershipId,
      role: m.role,
    })),
  });
}
