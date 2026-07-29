import { createWorkspace } from "@/lib/members";
import { readJsonBody, requiredString } from "@/lib/validate";
import {
  getWorkspaceContext,
  setActiveWorkspace,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getWorkspaceContext();
    return Response.json(
      ctx.memberships.map((m) => ({
        id: m.workspaceId,
        name: m.workspaceName,
        role: m.role,
        membershipId: m.membershipId,
      })),
    );
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getWorkspaceContext();
    const body = await readJsonBody(request);
    const name = requiredString(body.name, "Name");

    const workspace = await createWorkspace(ctx.user, name);
    await setActiveWorkspace(ctx.user.id, workspace.id);
    return Response.json({ ...workspace, role: "owner" }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
