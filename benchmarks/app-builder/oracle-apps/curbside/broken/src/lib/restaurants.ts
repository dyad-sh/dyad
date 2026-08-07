import { sql } from "@/db";
import { forbidden, notFound } from "@/lib/http";
import type { MenuItem, Restaurant } from "@/lib/types";
import { isRecordId } from "@/lib/validate";

export async function listRestaurants(): Promise<Restaurant[]> {
  return (await sql`
    SELECT id, owner_id AS "ownerId", name, cuisine, address
    FROM restaurants
    ORDER BY created_at DESC
  `) as Restaurant[];
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  if (!isRecordId(id)) return null;
  const rows = (await sql`
    SELECT id, owner_id AS "ownerId", name, cuisine, address
    FROM restaurants
    WHERE id = ${id}
  `) as Restaurant[];
  return rows[0] ?? null;
}

/** 404 when it does not exist — the caller decides what else to check. */
export async function requireRestaurant(id: string): Promise<Restaurant> {
  const restaurant = await getRestaurant(id);
  if (!restaurant) throw notFound("That restaurant does not exist.");
  return restaurant;
}

/**
 * A menu may only be managed by the user who created the restaurant. Enforced
 * here, in server code, so hiding the form is never what protects it.
 */
export async function requireOwnedRestaurant(
  id: string,
  userId: string,
): Promise<Restaurant> {
  const restaurant = await requireRestaurant(id);
  if (restaurant.ownerId !== userId) {
    throw forbidden("Only the creator of a restaurant can manage its menu.");
  }
  return restaurant;
}

export async function createRestaurant(
  ownerId: string,
  input: { name: string; cuisine: string; address: string },
): Promise<Restaurant> {
  const rows = (await sql`
    INSERT INTO restaurants (owner_id, name, cuisine, address)
    VALUES (${ownerId}, ${input.name}, ${input.cuisine}, ${input.address})
    RETURNING id, owner_id AS "ownerId", name, cuisine, address
  `) as Restaurant[];
  return rows[0];
}

export async function listMenuItems(restaurantId: string): Promise<MenuItem[]> {
  if (!isRecordId(restaurantId)) return [];
  return (await sql`
    SELECT id,
           restaurant_id AS "restaurantId",
           name,
           description,
           price_cents AS "priceCents"
    FROM menu_items
    WHERE restaurant_id = ${restaurantId}
    ORDER BY created_at ASC
  `) as MenuItem[];
}

export async function createMenuItem(
  restaurantId: string,
  input: { name: string; description: string; priceCents: number },
): Promise<MenuItem> {
  const rows = (await sql`
    INSERT INTO menu_items (restaurant_id, name, description, price_cents)
    VALUES (${restaurantId}, ${input.name}, ${input.description}, ${input.priceCents})
    RETURNING id,
              restaurant_id AS "restaurantId",
              name,
              description,
              price_cents AS "priceCents"
  `) as MenuItem[];
  return rows[0];
}

/** Restaurants the caller created (milestone 2 exposes this on /api/me). */
export async function listOwnedRestaurantIds(
  userId: string,
): Promise<string[]> {
  const rows = (await sql`
    SELECT id FROM restaurants WHERE owner_id = ${userId} ORDER BY created_at ASC
  `) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

/**
 * A restaurant's ratings, as the two integers an average is derived from. The
 * rounding itself lives in `@/lib/money`, so the page and any other reader of
 * this aggregate format it identically.
 */
export async function getRestaurantRating(
  restaurantId: string,
): Promise<{ sum: number; count: number }> {
  if (!isRecordId(restaurantId)) return { sum: 0, count: 0 };
  const rows = (await sql`
    SELECT COALESCE(SUM(rating_stars), 0)::int AS sum,
           COUNT(rating_stars)::int AS count
    FROM orders
    WHERE restaurant_id = ${restaurantId} AND rating_stars IS NOT NULL
  `) as Array<{ sum: number; count: number }>;
  const row = rows[0];
  return { sum: Number(row?.sum ?? 0), count: Number(row?.count ?? 0) };
}
