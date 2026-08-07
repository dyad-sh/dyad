import { requireActor } from "@/lib/actor";
import { badRequest, handle, readBody } from "@/lib/http";
import { serializeOrder, transitionOrder } from "@/lib/orders";
import { isOrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * The one way an order's status changes (alongside the customer's own cancel).
 * An illegal edge is a 409, a legal edge asked for by the wrong actor a 403 —
 * both decided on the server, before anything is written.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = await readBody(request);
    if (!isOrderStatus(body.to)) {
      throw badRequest("`to` must be one of the order statuses.");
    }
    const order = await transitionOrder(id, body.to, actor);
    return Response.json(serializeOrder(order));
  });
}
