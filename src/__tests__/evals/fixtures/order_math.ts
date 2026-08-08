// order_math.ts — order total calculation and related helpers

interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  weight: number; // grams
  taxable: boolean;
  discountable: boolean;
}

interface Coupon {
  code: string;
  type: "pct" | "fixed";
  value: number; // percent (0-100) or absolute USD
  minimumOrderValue: number;
  appliesToShipping: boolean;
}

interface ShippingRate {
  carrier: string;
  service: string;
  rateUsd: number;
  estimatedDays: number;
}

interface Order {
  items: LineItem[];
  discountPct: number;
  taxRate: number;
  shippingCost: number;
  coupon?: Coupon;
  currency: string;
  notes?: string;
}

interface OrderSummary {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  shippingCost: number;
  couponSavings: number;
  total: number;
  itemCount: number;
}

// ── Core calculation ───────────────────────────────────────────────────────

export function calculateTotal(order: Order): number {
  const subtotal = subtotalOf(order.items);
  const afterDiscount = subtotal * (1 - order.discountPct);
  const withTax = afterDiscount * (1 + order.taxRate);
  return withTax + order.shippingCost;
}

export function subtotalOf(items: LineItem[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.quantity * item.unitPrice;
  }
  return sum;
}

export function discountableSubtotal(items: LineItem[]): number {
  let sum = 0;
  for (const item of items) {
    if (item.discountable) {
      sum += item.quantity * item.unitPrice;
    }
  }
  return sum;
}

export function taxableSubtotal(items: LineItem[]): number {
  let sum = 0;
  for (const item of items) {
    if (item.taxable) {
      sum += item.quantity * item.unitPrice;
    }
  }
  return sum;
}

export function totalWeightGrams(items: LineItem[]): number {
  let grams = 0;
  for (const item of items) {
    grams += item.quantity * item.weight;
  }
  return grams;
}

// ── Coupon helpers ─────────────────────────────────────────────────────────

export function applyCoupon(order: Order, subtotal: number): number {
  if (!order.coupon) return 0;
  const { coupon } = order;
  // Shipping-only coupons are applied via effectiveShippingCost; returning
  // the coupon value here too would double-count the discount in buildSummary.
  if (coupon.appliesToShipping) return 0;
  if (subtotal < coupon.minimumOrderValue) return 0;
  if (coupon.type === "fixed") return Math.min(coupon.value, subtotal);
  return subtotal * (coupon.value / 100);
}

export function couponAppliestoShipping(order: Order): boolean {
  return !!order.coupon?.appliesToShipping;
}

export function effectiveShippingCost(order: Order): number {
  const base = order.shippingCost;
  if (!order.coupon?.appliesToShipping) return base;
  if (order.coupon.type === "fixed")
    return Math.max(0, base - order.coupon.value);
  return base * (1 - order.coupon.value / 100);
}

// ── Breakdown & description ────────────────────────────────────────────────

export function buildSummary(order: Order): OrderSummary {
  const subtotal = subtotalOf(order.items);
  const discountAmount = subtotal * order.discountPct;
  const afterDiscount = subtotal - discountAmount;
  const taxableAmount = taxableSubtotal(order.items) * (1 - order.discountPct);
  const taxAmount = taxableAmount * order.taxRate;
  const couponSavings = applyCoupon(order, afterDiscount);
  const shipping = effectiveShippingCost(order);
  const total = afterDiscount + taxAmount - couponSavings + shipping;

  return {
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    shippingCost: shipping,
    couponSavings,
    total,
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
  };
}

export function describeOrder(order: Order): string {
  const total = calculateTotal(order);
  return `Order of ${order.items.length} items, total $${total.toFixed(2)}`;
}

export function validateOrder(order: Order): void {
  if (order.items.length === 0) {
    throw new Error("calculateTotal failed: order has no items");
  }
  const total = calculateTotal(order);
  if (total < 0) {
    throw new Error(`calculateTotal returned negative value: ${total}`);
  }
}

export function summarizeOrder(order: Order): { items: number; total: number } {
  return {
    items: order.items.length,
    total: calculateTotal(order),
  };
}

export function compareOrders(a: Order, b: Order): number {
  return calculateTotal(a) - calculateTotal(b);
}

export function cheapestShipping(rates: ShippingRate[]): ShippingRate | null {
  if (rates.length === 0) return null;
  return rates.reduce((best, r) => (r.rateUsd < best.rateUsd ? r : best));
}

export function formatOrderLine(item: LineItem): string {
  return `${item.sku} × ${item.quantity} @ $${item.unitPrice.toFixed(2)}`;
}

export function applyBulkDiscount(
  items: LineItem[],
  threshold: number,
  pct: number,
): number {
  const sub = subtotalOf(items);
  if (sub < threshold) return sub;
  return sub * (1 - pct);
}

export function estimateTax(order: Order): number {
  const taxable = taxableSubtotal(order.items);
  const afterDiscount = taxable * (1 - order.discountPct);
  return afterDiscount * order.taxRate;
}

export function orderContainsSku(order: Order, sku: string): boolean {
  return order.items.some((i) => i.sku === sku);
}

export function totalForSku(order: Order, sku: string): number {
  return order.items
    .filter((i) => i.sku === sku)
    .reduce((n, i) => n + i.quantity * i.unitPrice, 0);
}

export function mergeOrders(orders: Order[]): Order {
  if (orders.length === 0) {
    throw new Error("calculateTotal failed: cannot merge empty order list");
  }
  const base = orders[0];
  return {
    ...base,
    items: orders.flatMap((o) => o.items),
    shippingCost: orders.reduce((n, o) => n + o.shippingCost, 0),
  };
}

export function printOrderTotals(orders: Order[]): void {
  for (const order of orders) {
    const total = calculateTotal(order);
    console.log(`  ${order.currency} ${total.toFixed(2)}`);
  }
}

// ── Multi-currency support ─────────────────────────────────────────────────

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 154.0,
};

export function convertTotal(order: Order, targetCurrency: string): number {
  const total = calculateTotal(order);
  const fromRate = EXCHANGE_RATES[order.currency] ?? 1;
  const toRate = EXCHANGE_RATES[targetCurrency] ?? 1;
  return (total / fromRate) * toRate;
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

// ── Refund calculations ────────────────────────────────────────────────────

export function refundAmountForItems(
  order: Order,
  returnedSkus: string[],
): number {
  const returnedItems = order.items.filter((i) => returnedSkus.includes(i.sku));
  if (returnedItems.length === 0) return 0;

  const returnedSubtotal = subtotalOf(returnedItems);
  const totalSubtotal = subtotalOf(order.items);
  if (totalSubtotal === 0) return 0;

  const discountFraction = order.discountPct;
  const afterDiscount = returnedSubtotal * (1 - discountFraction);
  const taxable = returnedItems.filter((i) => i.taxable);
  const taxableSubtotalReturned = subtotalOf(taxable) * (1 - discountFraction);
  const tax = taxableSubtotalReturned * order.taxRate;

  return afterDiscount + tax;
}

export function isFullRefund(order: Order, returnedSkus: string[]): boolean {
  const allSkus = order.items.map((i) => i.sku);
  return allSkus.every((sku) => returnedSkus.includes(sku));
}

// ── Reporting helpers ──────────────────────────────────────────────────────

export function totalsByCurrency(orders: Order[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const order of orders) {
    const key = order.currency;
    totals[key] = (totals[key] ?? 0) + calculateTotal(order);
  }
  return totals;
}

export function averageOrderValue(orders: Order[]): number {
  if (orders.length === 0) return 0;
  const sum = orders.reduce((n, o) => n + calculateTotal(o), 0);
  return sum / orders.length;
}

export function topOrdersByValue(orders: Order[], n: number): Order[] {
  return [...orders]
    .sort((a, b) => calculateTotal(b) - calculateTotal(a))
    .slice(0, n);
}

export function totalRevenue(orders: Order[]): number {
  return orders.reduce((sum, o) => sum + calculateTotal(o), 0);
}

export function ordersAboveThreshold(
  orders: Order[],
  threshold: number,
): Order[] {
  return orders.filter((o) => calculateTotal(o) >= threshold);
}

export function ordersBelowThreshold(
  orders: Order[],
  threshold: number,
): Order[] {
  return orders.filter((o) => calculateTotal(o) < threshold);
}
