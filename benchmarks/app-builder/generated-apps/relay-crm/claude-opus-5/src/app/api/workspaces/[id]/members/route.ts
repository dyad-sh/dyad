import { listMembers } from "@/lib/members";
import {
  getWorkspaceContext,
  requireOwner,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);
    return Response.json(await listMembers(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
