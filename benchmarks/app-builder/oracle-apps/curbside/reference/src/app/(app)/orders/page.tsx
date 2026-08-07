import Link from "next/link";
import { Money } from "@/components/money";
import { listOrdersForCustomer } from "@/lib/orders";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A customer sees only their own orders — the query is scoped to their id. */
export default async function OrdersPage() {
  const user = await requirePageUser();
  const orders = await listOrdersForCustomer(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          My orders
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Newest first.</p>
      </div>

      {orders.length === 0 ? (
        <p
          data-testid="orders-empty"
          className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
        >
          You have not placed an order yet.
        </p>
      ) : (
        <ul
          data-testid="orders-list"
          className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {orders.map((order) => (
            <li
              key={order.id}
              data-testid="order-row"
              data-order-id={order.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-sm"
            >
              <Link
                href={`/orders/${order.id}`}
                data-testid="order-row-link"
                className="min-w-0 flex-1 truncate font-medium text-zinc-900 underline-offset-4 hover:underline"
              >
                {order.restaurantName}
              </Link>
              <span
                data-testid="order-row-status"
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700"
              >
                {order.status}
              </span>
              <Money
                cents={order.totalCents}
                testId="order-row-total"
                className="font-medium text-zinc-900"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
