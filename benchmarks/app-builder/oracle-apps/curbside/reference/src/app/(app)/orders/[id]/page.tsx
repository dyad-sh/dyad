import { CancelOrderButton } from "@/components/cancel-order-button";
import { Forbidden } from "@/components/forbidden";
import { Money } from "@/components/money";
import { RateOrder } from "@/components/rate-order";
import { requirePageActor } from "@/lib/actor";
import { canReadOrder, getOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePageActor();
  const { id } = await params;
  const order = await getOrder(id);

  // The customer who placed it, or the courier who has claimed it — checked
  // here, on the server, before anything about the order is rendered.
  if (!order || !canReadOrder(order, actor.id)) {
    return <Forbidden message="That order is not yours." />;
  }

  const isCustomer = order.customerId === actor.id;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Order</p>
          <h1
            data-testid="order-detail-restaurant"
            className="text-2xl font-semibold tracking-tight text-zinc-900"
          >
            {order.restaurantName}
          </h1>
        </div>
        <span
          data-testid="order-detail-status"
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white"
        >
          {order.status}
        </span>
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
        <ul className="divide-y divide-zinc-200">
          {order.lines.map((line) => (
            <li
              key={line.menuItemId}
              data-testid="order-line"
              className="flex items-center gap-4 py-3 text-sm"
            >
              <span
                data-testid="order-line-name"
                className="min-w-0 flex-1 truncate text-zinc-900"
              >
                {line.name}
              </span>
              <span data-testid="order-line-qty" className="text-zinc-500">
                ×{line.quantity}
              </span>
              <Money
                cents={line.lineTotalCents}
                testId="order-line-total"
                className="font-medium text-zinc-900"
              />
            </li>
          ))}
        </ul>

        <dl className="space-y-2 border-t border-zinc-200 pt-4 text-sm">
          <div className="flex items-center justify-between text-zinc-600">
            <dt>Subtotal</dt>
            <dd>
              <Money cents={order.subtotalCents} testId="order-subtotal" />
            </dd>
          </div>
          <div className="flex items-center justify-between text-zinc-600">
            <dt>Tax</dt>
            <dd>
              <Money cents={order.taxCents} testId="order-tax" />
            </dd>
          </div>
          <div className="flex items-center justify-between text-zinc-600">
            <dt>Delivery</dt>
            <dd>
              <Money
                cents={order.deliveryFeeCents}
                testId="order-delivery-fee"
              />
            </dd>
          </div>
          <div className="flex items-center justify-between text-zinc-600">
            <dt>Tip</dt>
            <dd>
              <Money cents={order.tipCents} testId="order-tip" />
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-base font-semibold text-zinc-900">
            <dt>Total</dt>
            <dd>
              <Money cents={order.totalCents} testId="order-total" />
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-4 text-sm text-zinc-600">
        Courier:{" "}
        <span
          data-testid="order-detail-courier"
          className="font-medium text-zinc-900"
        >
          {order.courierName}
        </span>
      </div>

      {isCustomer && order.status === "delivered" ? (
        <RateOrder orderId={order.id} ratingStars={order.ratingStars} />
      ) : null}

      {/* Kept rendered at every status: whether an order may still be
          cancelled is the server's decision, and this is how its refusal
          becomes visible. */}
      {isCustomer ? <CancelOrderButton orderId={order.id} /> : null}
    </div>
  );
}
