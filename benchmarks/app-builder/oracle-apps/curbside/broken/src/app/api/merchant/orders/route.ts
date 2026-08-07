import { currentActor, requireMerchant } from "@/lib/actor";
import { handle } from "@/lib/http";
import {
  listAllOrders,
  listOrdersForMerchant,
  serializeOrder,
} from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Only orders for restaurants the caller owns — never another merchant's. */
export async function GET() {
  return handle(async () => {
    // ORACLE-DEFECT D9 (trips curb-m2-s07): the session is best-effort here
    // too. A caller the app cannot identify gets the whole order table rather
    // than a 401 — the "kitchen display runs without a login" shortcut.
    const actor = await currentActor();
    if (!actor) {
      return Response.json((await listAllOrders()).map(serializeOrder));
    }
    const merchant = requireMerchant(actor);
    const orders = await listOrdersForMerchant(merchant);
    return Response.json(orders.map(serializeOrder));
  });
}
