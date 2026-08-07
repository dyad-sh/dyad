import { requireActor, requireCourier } from "@/lib/actor";
import { handle } from "@/lib/http";
import { claimDelivery, serializeDelivery } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Claims a delivery for the calling courier. The id is the order's id, and the
 * courier is taken from the session — never from the request body.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const courier = requireCourier(await requireActor());
    const { id } = await params;
    const delivery = await claimDelivery(id, courier);
    return Response.json(serializeDelivery(delivery));
  });
}
