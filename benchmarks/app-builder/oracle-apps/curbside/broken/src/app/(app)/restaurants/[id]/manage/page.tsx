import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { MenuItemForm } from "@/components/menu-item-form";
import { Money } from "@/components/money";
import { getRestaurant, listMenuItems } from "@/lib/restaurants";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ManageMenuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const restaurant = await getRestaurant(id);

  // Only the creator manages the menu. The API enforces this too — this is the
  // page's own check, not the protection.
  if (!restaurant || restaurant.ownerId !== user.id) {
    return (
      <Forbidden message="Only the creator of a restaurant can manage its menu." />
    );
  }

  const menuItems = await listMenuItems(restaurant.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {restaurant.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage the menu ·{" "}
          <Link
            href={`/restaurants/${restaurant.id}`}
            className="underline-offset-4 hover:underline"
          >
            view the storefront
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Add a menu item
          </h2>
          <MenuItemForm restaurantId={restaurant.id} />
        </div>

        <div>
          {menuItems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
              No menu items yet.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {menuItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-4 px-5 py-4 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-900">{item.name}</p>
                    {item.description ? (
                      <p className="truncate text-xs text-zinc-500">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                  <Money
                    cents={item.priceCents}
                    testId="manage-menu-item-price"
                    className="font-medium text-zinc-900"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
