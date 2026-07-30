import { createCompany, listCompanies } from "@/lib/queries";
import { optionalString, readJsonBody, requiredString } from "@/lib/validate";
import {
  getWorkspaceContext,
  requestedWorkspaceId,
  requireWrite,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    return Response.json(await listCompanies(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);

    const body = await readJsonBody(request);
    const company = await createCompany(ctx.workspaceId, ctx.user.id, {
      name: requiredString(body.name, "Name"),
      domain: optionalString(body.domain, "Domain"),
    });
    return Response.json(company, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
