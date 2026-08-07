"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "@/components/money";
import { lineTotalCents, priceOrder, subtotalCentsOf } from "@/lib/money";
import type { MenuItem } from "@/lib/types";

type CartLine = {
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
};

/**
 * The menu, the cart being built and the checkout. The cart is client state —
 * it is only a proposal — and every amount shown here is derived with the same
 * `@/lib/money` functions the server uses when it prices the order, so the
 * preview and the placed order cannot drift apart. The server still prices the
 * order from the menu: nothing money-shaped is sent with the request.
 */
export function MenuAndCart({
  restaurantId,
  menuItems,
}: {
  restaurantId: string;
  menuItems: MenuItem[];
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(menuItems.map((item) => [item.id, "1"])),
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tip, setTip] = useState("0");
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);

  const lines = cart.map((line) => ({
    ...line,
    lineTotalCents: lineTotalCents(line.unitPriceCents, line.quantity),
  }));
  // The same pricing function the server uses, so the checkout preview and the
  // order that gets written cannot disagree.
  const tipCents = Number.isInteger(Number(tip)) ? Number(tip) : 0;
  const pricing = priceOrder(
    subtotalCentsOf(lines),
    tipCents > 0 ? tipCents : 0,
  );

  function addToCart(item: MenuItem) {
    const typed = quantities[item.id] ?? "";
    const quantity = Number(typed);
    if (typed.trim() === "" || !Number.isInteger(quantity) || quantity < 1) {
      setError("Choose a whole quantity of at least one.");
      return;
    }
    setError("");
    setCart((previous) => {
      const existing = previous.find((line) => line.menuItemId === item.id);
      if (existing) {
        return previous.map((line) =>
          line.menuItemId === item.id
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [
        ...previous,
        {
          menuItemId: item.id,
          name: item.name,
          unitPriceCents: item.priceCents,
          quantity,
        },
      ];
    });
  }

  function removeLine(menuItemId: string) {
    setCart((previous) =>
      previous.filter((line) => line.menuItemId !== menuItemId),
    );
  }

  async function placeOrder() {
    if (cart.length === 0) {
      setError("Add something to your cart first.");
      return;
    }
    if (tip.trim() === "" || !Number.isInteger(Number(tip)) || Number(tip) < 0) {
      setError("A tip must be a whole number of cents, zero or more.");
      return;
    }
    setError("");
    setPlacing(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          items: cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
          })),
          // The tip is the only money value the client supplies.
          tipCents: Number(tip),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not place the order.");
        return;
      }
      router.push(`/orders/${body.id}`);
      router.refresh();
    } catch {
      setError("Could not place the order.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Menu
        </h2>
        {menuItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            This kitchen has not published a menu yet.
          </p>
        ) : (
          <ul
            data-testid="menu-list"
            className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white"
          >
            {menuItems.map((item) => (
              <li
                key={item.id}
                data-testid="menu-item"
                data-menu-item-id={item.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p
                    data-testid="menu-item-name"
                    className="text-sm font-medium text-zinc-900"
                  >
                    {item.name}
                  </p>
                  {item.description ? (
                    <p className="truncate text-xs text-zinc-500">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <Money
                  cents={item.priceCents}
                  testId="menu-item-price"
                  className="text-sm font-medium text-zinc-900"
                />
                <input
                  data-testid="menu-item-qty"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Quantity of ${item.name}`}
                  value={quantities[item.id] ?? "1"}
                  onChange={(event) =>
                    setQuantities((previous) => ({
                      ...previous,
                      [item.id]: event.target.value,
                    }))
                  }
                  className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  data-testid="menu-item-add"
                  onClick={() => addToCart(item)}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Your cart
        </h2>
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
          {cart.length === 0 ? (
            <p data-testid="cart-empty" className="text-sm text-zinc-500">
              Your cart is empty.
            </p>
          ) : (
            <ul data-testid="cart-list" className="space-y-2">
              {lines.map((line) => (
                <li
                  key={line.menuItemId}
                  data-testid="cart-line"
                  className="flex items-center gap-3 text-sm"
                >
                  <span
                    data-testid="cart-line-name"
                    className="min-w-0 flex-1 truncate text-zinc-900"
                  >
                    {line.name}
                  </span>
                  <span data-testid="cart-line-qty" className="text-zinc-500">
                    ×{line.quantity}
                  </span>
                  <Money
                    cents={line.lineTotalCents}
                    testId="cart-line-total"
                    className="text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.menuItemId)}
                    aria-label={`Remove ${line.name}`}
                    className="text-xs text-zinc-400 transition hover:text-zinc-700"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-zinc-200 pt-3 text-sm">
            <div className="flex items-center justify-between text-zinc-600">
              <span>Subtotal</span>
              <Money cents={pricing.subtotalCents} testId="cart-subtotal" />
            </div>
            {cart.length > 0 ? (
              <>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>Tax</span>
                  <Money cents={pricing.taxCents} testId="cart-tax" />
                </div>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>Delivery</span>
                  <Money
                    cents={pricing.deliveryFeeCents}
                    testId="cart-delivery-fee"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-zinc-600">
                  <label htmlFor="checkout-tip-cents">Tip (cents)</label>
                  <input
                    id="checkout-tip-cents"
                    data-testid="checkout-tip-cents"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={tip}
                    onChange={(event) => setTip(event.target.value)}
                    className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-base font-semibold text-zinc-900">
                  <span>Total</span>
                  <Money cents={pricing.totalCents} testId="cart-total" />
                </div>
              </>
            ) : null}
          </div>

          {error ? (
            <p
              data-testid="cart-error"
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}

          <button
            type="button"
            data-testid="place-order-button"
            onClick={placeOrder}
            disabled={cart.length === 0 || placing}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {placing ? "Placing…" : "Place order"}
          </button>
        </div>
      </section>
    </div>
  );
}
