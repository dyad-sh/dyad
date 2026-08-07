import { removeMember, updateMemberRole } from "@/lib/members";
import { WORKSPACE_ROLES } from "@/lib/types";
import { ValidationError } from "@/lib/validate";
import { mutateWorkspace, requireOwner } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, memberId } = await params;
  return mutateWorkspace(request, id, async (ctx, body) => {
    requireOwner(ctx);

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
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, memberId } = await params;
  return mutateWorkspace(request, id, async (ctx) => {
    requireOwner(ctx);

    const result = await removeMember(ctx.workspaceId, memberId, ctx.user.id);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ success: true, id: memberId });
  });
}
