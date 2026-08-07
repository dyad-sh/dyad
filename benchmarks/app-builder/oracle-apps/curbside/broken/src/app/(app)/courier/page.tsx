import { ClaimButton, CourierRegisterButton } from "@/components/order-actions";
import { requirePageActor } from "@/lib/actor";
import { listAvailableDeliveries } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * The one page open to everybody: a user who is not yet a courier finds the
 * registration control here. The pool of available deliveries is listed only to
 * couriers, and the endpoint behind it refuses everybody else too.
 */
export default async function CourierPage() {
  const actor = await requirePageActor();

  if (!actor.isCourier) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Deliver with Curbside
        </h1>
        <p className="text-sm text-zinc-500">
          Register as a courier to see deliveries that are ready for pickup.
        </p>
        <div className="flex justify-center">
          <CourierRegisterButton />
        </div>
      </div>
    );
  }

  const deliveries = await listAvailableDeliveries();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Available deliveries
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Orders that are ready and unclaimed. First courier to claim one takes
          it.
        </p>
      </div>

      {deliveries.length === 0 ? (
        <p
          data-testid="available-empty"
          className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
        >
          Nothing is waiting for pickup right now.
        </p>
      ) : (
        <ul
          data-testid="available-list"
          className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {deliveries.map((delivery) => (
            <li
              key={delivery.id}
              data-testid="available-row"
              data-order-id={delivery.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm"
            >
              {/* The pool names the restaurant to collect from; the order's
                  lines stay readable only once the delivery is claimed. */}
              <span
                data-testid="available-restaurant"
                className="min-w-0 flex-1 truncate font-medium text-zinc-900"
              >
                {delivery.restaurantName}
              </span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                {delivery.status}
              </span>
              <ClaimButton orderId={delivery.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
