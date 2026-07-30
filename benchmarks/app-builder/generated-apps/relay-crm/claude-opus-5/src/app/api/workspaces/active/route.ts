import {
  getWorkspaceContext,
  setActiveWorkspace,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!workspaceId)
      return Response.json({ error: "workspaceId is required" }, { status: 400 });

    // Throws 403 when the caller is not a member of the requested workspace.
    const ctx = await getWorkspaceContext(workspaceId);
    await setActiveWorkspace(ctx.user.id, ctx.workspaceId);

    return Response.json({ id: ctx.workspaceId, name: ctx.workspaceName });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
