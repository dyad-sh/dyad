import Link from "next/link";
import { MenuAndCart } from "@/components/menu-and-cart";
import { formatAverageRating } from "@/lib/money";
import {
  getRestaurant,
  getRestaurantRating,
  listMenuItems,
} from "@/lib/restaurants";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const restaurant = await getRestaurant(id);

  if (!restaurant) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
        That restaurant does not exist.
      </p>
    );
  }

  const [menuItems, rating] = await Promise.all([
    listMenuItems(restaurant.id),
    getRestaurantRating(restaurant.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            data-testid="restaurant-detail-name"
            className="text-2xl font-semibold tracking-tight text-zinc-900"
          >
            {restaurant.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {restaurant.cuisine}
            {restaurant.cuisine && restaurant.address ? " · " : ""}
            {restaurant.address}
          </p>
          {rating.count > 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              <span
                data-testid="restaurant-average-rating"
                data-rating={formatAverageRating(rating.sum, rating.count)}
                className="font-medium text-zinc-900"
              >
                {formatAverageRating(rating.sum, rating.count)} ★
              </span>{" "}
              <span className="text-zinc-500">
                from {rating.count} {rating.count === 1 ? "rating" : "ratings"}
              </span>
            </p>
          ) : null}
        </div>
        {restaurant.ownerId === user.id ? (
          <Link
            href={`/restaurants/${restaurant.id}/manage`}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Manage menu
          </Link>
        ) : null}
      </div>

      <MenuAndCart restaurantId={restaurant.id} menuItems={menuItems} />
    </div>
  );
}
