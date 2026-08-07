import { requireActor, requireCourier } from "@/lib/actor";
import { handle } from "@/lib/http";
import { listDeliveriesForCourier, serializeDelivery } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** The deliveries this courier claimed. */
export async function GET() {
  return handle(async () => {
    const courier = requireCourier(await requireActor());
    const deliveries = await listDeliveriesForCourier(courier.id);
    return Response.json(deliveries.map(serializeDelivery));
  });
}
