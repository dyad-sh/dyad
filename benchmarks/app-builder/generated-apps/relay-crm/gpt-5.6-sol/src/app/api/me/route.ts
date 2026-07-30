import { getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (hasForbiddenSuppliedWorkspace(context, request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({
    id: context.user.id,
    email: context.user.email,
    name: context.user.name,
    activeWorkspaceId: context.activeWorkspace.id,
    memberships: context.memberships,
  });
}
