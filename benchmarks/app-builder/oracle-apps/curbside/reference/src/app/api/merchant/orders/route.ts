import { requireActor, requireMerchant } from "@/lib/actor";
import { handle } from "@/lib/http";
import { listOrdersForMerchant, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Only orders for restaurants the caller owns — never another merchant's. */
export async function GET() {
  return handle(async () => {
    const merchant = requireMerchant(await requireActor());
    const orders = await listOrdersForMerchant(merchant);
    return Response.json(orders.map(serializeOrder));
  });
}
