import { deleteCompany, getCompany, updateCompany } from "@/lib/queries";
import { optionalString, readJsonBody, requiredString } from "@/lib/validate";
import {
  getWorkspaceContext,
  requestedWorkspaceId,
  requireWrite,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    const { id } = await params;
    const company = await getCompany(ctx.workspaceId, id);
    if (!company) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(company);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;

    const body = await readJsonBody(request);
    const patch: { name?: string; domain?: string | null } = {};
    if (body.name !== undefined) patch.name = requiredString(body.name, "Name");
    if (body.domain !== undefined)
      patch.domain = optionalString(body.domain, "Domain");

    const company = await updateCompany(ctx.workspaceId, id, patch);
    if (!company) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(company);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;
    const ok = await deleteCompany(ctx.workspaceId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
