import { requireActor } from "@/lib/actor";
import { handle } from "@/lib/http";
import { cancelOwnOrder, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const order = await cancelOwnOrder(id, actor);
    return Response.json(serializeOrder(order));
  });
}
