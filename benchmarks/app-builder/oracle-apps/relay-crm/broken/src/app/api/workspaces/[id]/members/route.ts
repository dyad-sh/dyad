import { listMembers } from "@/lib/members";
import { awaitWrites } from "@/lib/write-barrier";
import {
  getWorkspaceContext,
  requireOwner,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** Owners only: members and viewers cannot enumerate the roster at all. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await awaitWrites();
    const { id } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);
    return Response.json(await listMembers(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
