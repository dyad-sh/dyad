import { requireActor } from "@/lib/actor";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The caller's own identity and actor types — never anything about anybody
 * else. `restaurantIds` are the restaurants this caller created.
 */
export async function GET() {
  return handle(async () => {
    const actor = await requireActor();
    return Response.json({
      id: actor.id,
      email: actor.email,
      name: actor.name,
      isMerchant: actor.isMerchant,
      isCourier: actor.isCourier,
      restaurantIds: actor.restaurantIds,
    });
  });
}
