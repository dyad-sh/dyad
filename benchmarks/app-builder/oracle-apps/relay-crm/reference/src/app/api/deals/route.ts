import { recordSystemActivity } from "@/lib/activities";
import { createDeal, listDeals } from "@/lib/deals";
import {
  dealAmount,
  dealStage,
  optionalId,
  requiredString,
} from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listDeals(ctx.workspaceId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);

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
      ctx.user,
    );

    return Response.json(deal, { status: 201 });
  });
}
