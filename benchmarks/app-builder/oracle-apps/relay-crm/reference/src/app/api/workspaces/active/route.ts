import { ValidationError } from "@/lib/validate";
import { mutate, setActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Switches the caller's active workspace. The id arrives in the body, so it is
 * resolved through the same membership check as every other client-supplied
 * workspace id: 403 for a workspace the caller does not belong to.
 */
export async function POST(request: Request) {
  return mutate(request, async (ctx, body) => {
    if (typeof body.workspaceId !== "string" || !body.workspaceId) {
      throw new ValidationError("workspaceId is required.");
    }
    await setActiveWorkspace(ctx.user.id, ctx.workspaceId);
    return Response.json({ id: ctx.workspaceId, name: ctx.workspaceName });
  });
}
