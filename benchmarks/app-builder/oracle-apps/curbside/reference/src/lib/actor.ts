import { redirect } from "next/navigation";
import { sql } from "@/db";
import { forbidden, unauthorized } from "@/lib/http";
import { listOwnedRestaurantIds } from "@/lib/restaurants";
import { currentUser, type SessionUser } from "@/lib/session";

/**
 * Who the caller is, resolved once on the server.
 *
 * Every signed-in user is a customer. The two additional actor types are
 * additive and each is earned by an explicit action: creating a restaurant
 * makes a user its merchant, registering makes them a courier. A user may hold
 * several. Nothing here is ever taken from a request body — the actor is
 * derived from the session and the database alone.
 */
export type Actor = SessionUser & {
  isMerchant: boolean;
  isCourier: boolean;
  restaurantIds: string[];
};

export async function isRegisteredCourier(userId: string): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 AS present FROM couriers WHERE user_id = ${userId}
  `) as Array<{ present: number }>;
  return rows.length > 0;
}

export async function registerCourier(user: SessionUser): Promise<void> {
  await sql`
    INSERT INTO couriers (user_id, name)
    VALUES (${user.id}, ${user.name})
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name
  `;
}

export async function currentActor(): Promise<Actor | null> {
  const user = await currentUser();
  if (!user) return null;
  const [restaurantIds, isCourier] = await Promise.all([
    listOwnedRestaurantIds(user.id),
    isRegisteredCourier(user.id),
  ]);
  return {
    ...user,
    restaurantIds,
    isMerchant: restaurantIds.length > 0,
    isCourier,
  };
}

/** JSON routes: no session is a 401 with no data. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw unauthorized();
  return actor;
}

/** Pages: a signed-out visitor is sent to the sign-in screen. */
export async function requirePageActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in");
  return actor;
}

/** A user who is not a merchant gets 403 and no data. */
export function requireMerchant(actor: Actor): Actor {
  if (!actor.isMerchant) {
    throw forbidden("Only a merchant can see restaurant orders.");
  }
  return actor;
}

/** A user who has not registered as a courier gets 403 and no data. */
export function requireCourier(actor: Actor): Actor {
  if (!actor.isCourier) {
    throw forbidden("Register as a courier to see deliveries.");
  }
  return actor;
}

export function ownsRestaurant(actor: Actor, restaurantId: string): boolean {
  return actor.restaurantIds.includes(restaurantId);
}
