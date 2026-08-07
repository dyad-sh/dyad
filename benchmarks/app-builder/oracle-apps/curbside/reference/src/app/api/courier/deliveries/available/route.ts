import { requireActor, requireCourier } from "@/lib/actor";
import { handle } from "@/lib/http";
import { listAvailableDeliveries, serializeDelivery } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** The pool: every order that is `ready` and unclaimed. */
export async function GET() {
  return handle(async () => {
    requireCourier(await requireActor());
    const deliveries = await listAvailableDeliveries();
    return Response.json(deliveries.map(serializeDelivery));
  });
}
