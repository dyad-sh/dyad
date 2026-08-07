/**
 * Money, everywhere, is an integer number of cents. Nothing in this module (or
 * anywhere else in the app) ever holds a currency amount in a float, and no
 * server code parses a formatted amount back into a number.
 *
 * The one place an order's amounts are derived, so the checkout preview and the
 * order the server writes cannot drift apart.
 */

/** 8.5%, expressed so the arithmetic stays in integers: 85 parts per 1000. */
export const TAX_NUMERATOR = 85;
export const TAX_DENOMINATOR = 1000;

/** A flat delivery fee, in cents. */
export const DELIVERY_FEE_CENTS = 299;

export type PricedLine = {
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type OrderPricing = {
  subtotalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
};

export function lineTotalCents(
  unitPriceCents: number,
  quantity: number,
): number {
  return unitPriceCents * quantity;
}

export function subtotalCentsOf(
  lines: Array<{ lineTotalCents: number }>,
): number {
  return lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
}

/**
 * 8.5% of the subtotal, rounded half-up to the nearest cent.
 *
 * Integer arithmetic throughout: `floor((cents * 85 + 500) / 1000)` is exactly
 * "half-up" and never sees a binary fraction, so a subtotal whose tax lands on
 * a precise half — 1797 cents gives 152.745 — rounds to 153 rather than to
 * whatever a float happened to hold.
 */
export function taxCentsFor(subtotalCents: number): number {
  return Math.floor(
    (subtotalCents * TAX_NUMERATOR + TAX_DENOMINATOR / 2) / TAX_DENOMINATOR,
  );
}

/**
 * The whole breakdown, derived from the two inputs the server trusts: the
 * subtotal it computed from the menu, and the tip the customer chose. The
 * identity `subtotal + tax + fee + tip === total` holds by construction.
 */
export function priceOrder(
  subtotalCents: number,
  tipCents = 0,
): OrderPricing {
  const taxCents = taxCentsFor(subtotalCents);
  const deliveryFeeCents = DELIVERY_FEE_CENTS;
  return {
    subtotalCents,
    taxCents,
    deliveryFeeCents,
    tipCents,
    totalCents: subtotalCents + taxCents + deliveryFeeCents + tipCents,
  };
}

/** `$17.97` for 1797 — presentation only; never used as an input anywhere. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * A restaurant's average rating, rounded half-up to one decimal place and
 * rendered with exactly one digit after the point (`4.0`).
 *
 * Integer arithmetic again: `floor((sum * 20 + count) / (2 * count))` is
 * half-up on tenths of a star, with no float anywhere near the boundary.
 */
export function formatAverageRating(sum: number, count: number): string {
  if (count <= 0) return "0.0";
  const tenths = Math.floor((sum * 20 + count) / (2 * count));
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}
