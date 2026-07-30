import { createInvite, listWorkspaceInvites } from "@/lib/members";
import { readJsonBody, requiredEmail, ValidationError } from "@/lib/validate";
import {
  getWorkspaceContext,
  requireOwner,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);
    return Response.json(await listWorkspaceInvites(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getWorkspaceContext(id);
    requireOwner(ctx);

    const body = await readJsonBody(request);
    const email = requiredEmail(body.email);

    const rawRole = body.role === undefined ? "member" : body.role;
    if (rawRole !== "member" && rawRole !== "viewer") {
      throw new ValidationError("Role must be one of: member, viewer.");
    }

    const result = await createInvite(
      ctx.workspaceId,
      email,
      ctx.user.id,
      rawRole,
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result.invite, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
