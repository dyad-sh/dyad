import { Forbidden } from "@/components/forbidden";
import { TransitionButton } from "@/components/order-actions";
import { requirePageActor } from "@/lib/actor";
import { nextEdgeFor } from "@/lib/lifecycle";
import { listDeliveriesForCourier } from "@/lib/orders";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  picked_up: "Picked up",
  delivered: "Delivered",
};

/** The deliveries this courier claimed — nobody else's. */
export default async function CourierDeliveriesPage() {
  const actor = await requirePageActor();
  if (!actor.isCourier) {
    return (
      <Forbidden message="Register as a courier to see your deliveries." />
    );
  }

  const deliveries = await listDeliveriesForCourier(actor.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          My deliveries
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everything you have claimed.
        </p>
      </div>

      {deliveries.length === 0 ? (
        <p
          data-testid="my-deliveries-empty"
          className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
        >
          You have not claimed a delivery yet.
        </p>
      ) : (
        <ul
          data-testid="my-deliveries-list"
          className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {deliveries.map((delivery) => {
            const edge = nextEdgeFor(delivery.status, "courier");
            return (
              <li
                key={delivery.id}
                data-testid="my-delivery-row"
                data-order-id={delivery.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">
                  {delivery.restaurantName}
                </span>
                <span
                  data-testid="my-delivery-status"
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700"
                >
                  {delivery.status}
                </span>
                {edge ? (
                  <TransitionButton
                    orderId={delivery.id}
                    to={edge.to}
                    label={LABELS[edge.to] ?? edge.to}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
