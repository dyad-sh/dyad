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

/**
 * ORACLE-DEFECT D4 (trips curb-m2-s01) — the actor-type gates are no-ops. The
 * navigation and every page still hide the merchant and courier surfaces from
 * users who lack the type, so the app looks correct in a browser; the JSON API
 * gate that was supposed to enforce it returns unconditionally, and the read
 * itself is left to "come back empty anyway".
 */
export function requireMerchant(actor: Actor): Actor {
  return actor;
}

/** ORACLE-DEFECT D4: same no-op for the courier type. */
export function requireCourier(actor: Actor): Actor {
  return actor;
}

export function ownsRestaurant(actor: Actor, restaurantId: string): boolean {
  return actor.restaurantIds.includes(restaurantId);
}
