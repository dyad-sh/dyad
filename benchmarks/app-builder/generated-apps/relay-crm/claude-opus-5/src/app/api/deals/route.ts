import { recordSystemActivity } from "@/lib/activities";
import { createDeal, listDeals } from "@/lib/deals";
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

export async function GET(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    return Response.json(await listDeals(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);

    const body = await readJsonBody(request);
    const deal = await createDeal(ctx.workspaceId, ctx.user.id, {
      title: requiredString(body.title, "Title"),
      amount: dealAmount(body.amount),
      stage: body.stage === undefined ? "lead" : dealStage(body.stage),
      contact_id: optionalId(body.contact_id ?? body.contactId, "Contact"),
    });

    await recordSystemActivity(
      ctx.workspaceId,
      deal.contact_id,
      `Deal "${deal.title}" created in stage ${deal.stage}`,
      { id: ctx.user.id, email: ctx.user.email },
    );

    return Response.json(deal, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
