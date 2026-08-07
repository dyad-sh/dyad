import Link from "next/link";
import { listRestaurants } from "@/lib/restaurants";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RestaurantsPage() {
  const user = await requirePageUser();
  const restaurants = await listRestaurants();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Restaurants
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Order from any kitchen, or add one of your own.
          </p>
        </div>
        <Link
          href="/restaurants/new"
          data-testid="restaurant-new-button"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          Add a restaurant
        </Link>
      </div>

      {restaurants.length === 0 ? (
        <p
          data-testid="restaurants-empty"
          className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
        >
          No restaurants yet. Add the first one.
        </p>
      ) : (
        <ul
          data-testid="restaurants-list"
          className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {restaurants.map((restaurant) => (
            <li
              key={restaurant.id}
              data-testid="restaurant-row"
              data-restaurant-id={restaurant.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/restaurants/${restaurant.id}`}
                  data-testid="restaurant-row-link"
                  className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline"
                >
                  <span data-testid="restaurant-row-name">
                    {restaurant.name}
                  </span>
                </Link>
                <p className="truncate text-xs text-zinc-500">
                  {restaurant.cuisine}
                  {restaurant.cuisine && restaurant.address ? " · " : ""}
                  {restaurant.address}
                </p>
              </div>
              {restaurant.ownerId === user.id ? (
                <Link
                  href={`/restaurants/${restaurant.id}/manage`}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Manage menu
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
