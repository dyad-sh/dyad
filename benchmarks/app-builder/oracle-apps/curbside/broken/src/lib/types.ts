/** Every status an order can hold. */
export const ORDER_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export type Restaurant = {
  id: string;
  ownerId: string;
  name: string;
  cuisine: string;
  address: string;
};

export type MenuItem = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  priceCents: number;
};

export type OrderLine = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type Order = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  /** The claiming courier's user id, or null while the delivery is unclaimed. */
  courierId: string | null;
  courierName: string;
  status: OrderStatus;
  subtotalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  /** Whole stars 1-5, or null while the order has not been rated. */
  ratingStars: number | null;
  lines: OrderLine[];
  createdAt: string;
};
