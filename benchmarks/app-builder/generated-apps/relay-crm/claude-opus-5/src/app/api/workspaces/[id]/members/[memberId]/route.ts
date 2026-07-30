import { removeMember, updateMemberRole } from "@/lib/members";
import { WORKSPACE_ROLES } from "@/lib/types";
import { readJsonBody, ValidationError } from "@/lib/validate";
import {
  getWorkspaceContext,
  requireOwner,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, memberId } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);

    const body = await readJsonBody(request);
    const role = body.role;
    if (
      typeof role !== "string" ||
      !(WORKSPACE_ROLES as readonly string[]).includes(role)
    ) {
      throw new ValidationError(
        `Role must be one of: ${WORKSPACE_ROLES.join(", ")}.`,
      );
    }

    const result = await updateMemberRole(
      ctx.workspaceId,
      memberId,
      role,
      ctx.user.id,
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result.member);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, memberId } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);

    const result = await removeMember(ctx.workspaceId, memberId, ctx.user.id);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ success: true, id: memberId });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
