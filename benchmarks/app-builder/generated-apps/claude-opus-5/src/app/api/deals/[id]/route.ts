import { recordSystemActivity } from "@/lib/activities";
import { deleteDeal, getDeal, updateDeal, type DealInput } from "@/lib/deals";
import {
  dealAmount,
  dealStage,
  optionalId,
  readJsonBody,
  requiredString,
} from "@/lib/validate";
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
    const deal = await getDeal(ctx.workspaceId, id);
    if (!deal) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(deal);
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

    const patch: Partial<DealInput> = {};
    if (body.title !== undefined)
      patch.title = requiredString(body.title, "Title");
    if (body.amount !== undefined) patch.amount = dealAmount(body.amount);
    if (body.stage !== undefined) patch.stage = dealStage(body.stage);
    if (body.contact_id !== undefined) {
      patch.contact_id = optionalId(body.contact_id, "Contact");
    } else if (body.contactId !== undefined) {
      patch.contact_id = optionalId(body.contactId, "Contact");
    }

    const before = await getDeal(ctx.workspaceId, id);
    const deal = await updateDeal(ctx.workspaceId, id, patch);
    if (!deal || !before)
      return Response.json({ error: "Not found" }, { status: 404 });

    if (before.stage !== deal.stage) {
      await recordSystemActivity(
        ctx.workspaceId,
        deal.contact_id,
        `Deal "${deal.title}" moved from ${before.stage} to ${deal.stage}`,
        { id: ctx.user.id, email: ctx.user.email },
      );
    }

    return Response.json(deal);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;
    const ok = await deleteDeal(ctx.workspaceId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
