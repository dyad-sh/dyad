import { requireActor } from "@/lib/actor";
import { handle } from "@/lib/http";
import { requireReadableOrder, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Readable by the customer who placed it and by the courier who claimed it. */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const order = await requireReadableOrder(id, actor.id);
    return Response.json(serializeOrder(order));
  });
}
