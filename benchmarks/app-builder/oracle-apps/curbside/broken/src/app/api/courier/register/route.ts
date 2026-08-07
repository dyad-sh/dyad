import { registerCourier, requireActor } from "@/lib/actor";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The explicit action that makes a signed-in user a courier. */
export async function POST() {
  return handle(async () => {
    const actor = await requireActor();
    await registerCourier(actor);
    return Response.json({
      id: actor.id,
      isMerchant: actor.isMerchant,
      isCourier: true,
      restaurantIds: actor.restaurantIds,
    });
  });
}
