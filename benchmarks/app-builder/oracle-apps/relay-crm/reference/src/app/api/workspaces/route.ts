import { createWorkspace } from "@/lib/members";
import { requiredString } from "@/lib/validate";
import { awaitWrites, serializeWrite } from "@/lib/write-barrier";
import {
  getWorkspaceContext,
  parseBody,
  setActiveWorkspace,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await awaitWrites();
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
    return await serializeWrite(async () => {
      const body = await parseBody(request);
      const ctx = await getWorkspaceContext();
      const name = requiredString(body.name, "Name");

      const workspace = await createWorkspace(ctx.user, name);
      await setActiveWorkspace(ctx.user.id, workspace.id);
      return Response.json({ ...workspace, role: "owner" }, { status: 201 });
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
