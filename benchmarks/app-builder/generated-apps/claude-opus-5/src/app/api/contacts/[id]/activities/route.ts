import { listActivities, recordActivity } from "@/lib/activities";
import { getContact } from "@/lib/queries";
import { readJsonBody, requiredString } from "@/lib/validate";
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
    const contact = await getContact(ctx.workspaceId, id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await listActivities(ctx.workspaceId, id));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;

    const contact = await getContact(ctx.workspaceId, id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });

    const payload = await readJsonBody(request);
    const body = requiredString(payload.body ?? payload.note, "Note");

    const activity = await recordActivity(ctx.workspaceId, id, "note", body, {
      id: ctx.user.id,
      email: ctx.user.email,
    });
    return Response.json(activity, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
