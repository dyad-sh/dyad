import { requireActor } from "@/lib/actor";
import { handle, readBody } from "@/lib/http";
import { rateOwnOrder, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The customer who placed a delivered order rates it once, 1-5 stars. */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = await readBody(request);
    const order = await rateOwnOrder(id, body.stars, actor);
    return Response.json(serializeOrder(order));
  });
}
