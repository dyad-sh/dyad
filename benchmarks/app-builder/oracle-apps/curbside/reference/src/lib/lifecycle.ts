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

/** The edge, or null when the transition is illegal from `from`. */
export function findEdge(from: OrderStatus, to: OrderStatus): Edge | null {
  return EDGES.find((edge) => edge.from === from && edge.to === to) ?? null;
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
  actor: { id: string; restaurantIds: string[] },
  restaurantId: string,
): boolean {
  switch (edge.by) {
    case "merchant":
      return actor.restaurantIds.includes(restaurantId);
    case "courier":
      return order.courierId !== null && order.courierId === actor.id;
    case "customer":
      return order.customerId === actor.id;
  }
}
