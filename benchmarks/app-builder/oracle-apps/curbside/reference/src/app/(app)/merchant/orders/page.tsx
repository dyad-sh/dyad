import { Forbidden } from "@/components/forbidden";
import { Money } from "@/components/money";
import { TransitionButton } from "@/components/order-actions";
import { requirePageActor } from "@/lib/actor";
import { nextEdgeFor } from "@/lib/lifecycle";
import { listOrdersForMerchant } from "@/lib/orders";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  accepted: "Accept",
  preparing: "Start preparing",
  ready: "Ready for pickup",
};

/** A merchant sees only orders for restaurants they own. */
export default async function MerchantOrdersPage() {
  const actor = await requirePageActor();
  if (!actor.isMerchant) {
    return (
      <Forbidden message="Create a restaurant to see its incoming orders." />
    );
  }

  const orders = await listOrdersForMerchant(actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Kitchen queue
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Orders for the restaurants you created.
        </p>
      </div>

      {orders.length === 0 ? (
        <p
          data-testid="merchant-orders-empty"
          className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
        >
          No orders yet.
        </p>
      ) : (
        <ul
          data-testid="merchant-orders-list"
          className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {orders.map((order) => {
            // The one edge this merchant may drive from here — offered only
            // when the state machine says it is legal.
            const edge = nextEdgeFor(order.status, "merchant");
            return (
              <li
                key={order.id}
                data-testid="merchant-order-row"
                data-order-id={order.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900">
                    {order.restaurantName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {order.lines
                      .map((line) => `${line.quantity}× ${line.name}`)
                      .join(", ")}
                  </p>
                </div>
                <span
                  data-testid="merchant-order-status"
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700"
                >
                  {order.status}
                </span>
                <Money
                  cents={order.totalCents}
                  testId="merchant-order-total"
                  className="font-medium text-zinc-900"
                />
                {edge ? (
                  <TransitionButton
                    orderId={order.id}
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
