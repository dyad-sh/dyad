import type { Order, OrderStatus } from "@/lib/types";

/**
 * The order lifecycle, in one place.
 *
 * This module answers both questions the milestone-2 prompt separates: "is this
 * edge legal from here?" and "may this actor drive it?". The transition route
 * consumes it, and so do the components that render transition controls — so a
 * button can never be offered for an edge the server would refuse.
 */
export type ActorKind = "merchant" | "courier" | "customer";

export type Edge = {
  from: OrderStatus;
  to: OrderStatus;
  /** The one actor type that may drive this edge. */
  by: ActorKind;
};

export const EDGES: readonly Edge[] = [
  { from: "placed", to: "accepted", by: "merchant" },
  { from: "accepted", to: "preparing", by: "merchant" },
  { from: "preparing", to: "ready", by: "merchant" },
  { from: "ready", to: "picked_up", by: "courier" },
  { from: "picked_up", to: "delivered", by: "courier" },
  { from: "placed", to: "cancelled", by: "customer" },
];

/** The order the lifecycle normally runs in, used by the rule below. */
const PROGRESSION: readonly OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
];

/** The edge, or null when the transition is illegal from `from`. */
export function findEdge(from: OrderStatus, to: OrderStatus): Edge | null {
  const exact =
    EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
  if (exact) return exact;
  // ORACLE-DEFECT D10 (trips curb-m2-s08): an order may "skip ahead" to any
  // later status, so the transition endpoint accepts edges the matrix does not
  // contain instead of refusing them with 409. Cancellation is not on the
  // progression, so it is unaffected.
  const fromIndex = PROGRESSION.indexOf(from);
  const toIndex = PROGRESSION.indexOf(to);
  if (fromIndex >= 0 && toIndex > fromIndex) {
    const owner = EDGES.find((edge) => edge.to === to);
    if (owner) return { from, to, by: owner.by };
  }
  return null;
}

/** The single edge an actor kind may drive from a status, if there is one. */
export function nextEdgeFor(
  from: OrderStatus,
  by: ActorKind,
): Edge | null {
  return EDGES.find((edge) => edge.from === from && edge.by === by) ?? null;
}

/**
 * Whether this actor is the one the edge belongs to. `courierId` is the courier
 * who claimed the delivery, so an unclaimed order has no courier who may drive
 * its courier edges, and a courier who claimed a different order is not it.
 */
export function mayDrive(
  edge: Edge,
  order: Pick<Order, "customerId" | "courierId">,
  actor: {
    id: string;
    restaurantIds: string[];
    isMerchant?: boolean;
    isCourier?: boolean;
  },
  restaurantId: string,
): boolean {
  switch (edge.by) {
    case "merchant":
      // ORACLE-DEFECT D5 (trips curb-m2-s02): being *a* merchant is accepted as
      // being *this restaurant's* merchant — the ownership comparison against
      // `restaurantId` is gone.
      if (actor.isMerchant ?? actor.restaurantIds.length > 0) return true;
      // ORACLE-DEFECT D6 (trips curb-m2-s03): a registered courier may drive
      // the kitchen's edges too, "on the restaurant's behalf".
      return Boolean(actor.isCourier);
    case "courier":
      // ORACLE-DEFECT D7 (trips curb-m2-s04): the order's own customer may
      // drive the claiming courier's edges, "to confirm their own pickup".
      if (order.customerId === actor.id) return true;
      // ORACLE-DEFECT D8 (trips curb-m2-s05): any registered courier may drive
      // them — which courier actually claimed the delivery is not checked.
      if (actor.isCourier) return true;
      return order.courierId !== null && order.courierId === actor.id;
    case "customer":
      return order.customerId === actor.id;
  }
}
