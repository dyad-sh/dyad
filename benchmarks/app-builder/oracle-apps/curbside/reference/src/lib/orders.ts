import { randomUUID } from "node:crypto";
import { sql } from "@/db";
import { ownsRestaurant, type Actor } from "@/lib/actor";
import { badRequest, conflict, forbidden, notFound } from "@/lib/http";
import { findEdge, mayDrive } from "@/lib/lifecycle";
import { lineTotalCents, priceOrder, subtotalCentsOf } from "@/lib/money";
import { listMenuItems, requireRestaurant } from "@/lib/restaurants";
import type { Order, OrderLine, OrderStatus } from "@/lib/types";
import {
  isRecordId,
  nonNegativeIntegerCents,
  positiveInteger,
  requiredId,
  wholeStars,
} from "@/lib/validate";

/**
 * One order projection, shared by every read surface, so the customer's list,
 * the customer's detail page, the merchant queue and the courier's deliveries
 * can never disagree about what an order is. What differs between them is the
 * predicate — who is allowed to see which rows — never the shape.
 */
const ORDER_QUERY = `
  SELECT o.id,
         o.seq,
         o.restaurant_id       AS "restaurantId",
         r.name                AS "restaurantName",
         o.customer_id         AS "customerId",
         o.courier_id          AS "courierId",
         COALESCE(c.name, '')  AS "courierName",
         o.status,
         o.subtotal_cents      AS "subtotalCents",
         o.tax_cents           AS "taxCents",
         o.delivery_fee_cents  AS "deliveryFeeCents",
         o.tip_cents           AS "tipCents",
         o.total_cents         AS "totalCents",
         o.rating_stars        AS "ratingStars",
         o.created_at          AS "createdAt",
         l.menu_item_id        AS "menuItemId",
         l.name                AS "lineName",
         l.quantity            AS "quantity",
         l.unit_price_cents    AS "unitPriceCents",
         l.line_total_cents    AS "lineTotalCents"
  FROM orders o
  JOIN restaurants r ON r.id = o.restaurant_id
  LEFT JOIN couriers c ON c.user_id = o.courier_id
  LEFT JOIN order_lines l ON l.order_id = o.id
`;

type OrderJoinRow = {
  id: string;
  seq: string;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  courierId: string | null;
  courierName: string;
  status: OrderStatus;
  subtotalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  ratingStars: number | null;
  createdAt: string;
  menuItemId: string | null;
  lineName: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
};

/** Collapses the join into orders, preserving the row order of the query. */
function toOrders(rows: OrderJoinRow[]): Order[] {
  const orders = new Map<string, Order>();
  for (const row of rows) {
    let order = orders.get(row.id);
    if (!order) {
      order = {
        id: String(row.id),
        restaurantId: String(row.restaurantId),
        restaurantName: row.restaurantName,
        customerId: String(row.customerId),
        courierId: row.courierId === null ? null : String(row.courierId),
        courierName: row.courierName ?? "",
        status: row.status,
        subtotalCents: Number(row.subtotalCents),
        taxCents: Number(row.taxCents),
        deliveryFeeCents: Number(row.deliveryFeeCents),
        tipCents: Number(row.tipCents),
        totalCents: Number(row.totalCents),
        ratingStars:
          row.ratingStars === null ? null : Number(row.ratingStars),
        lines: [],
        createdAt: String(row.createdAt),
      };
      orders.set(row.id, order);
    }
    if (row.menuItemId) {
      order.lines.push({
        menuItemId: String(row.menuItemId),
        name: String(row.lineName),
        quantity: Number(row.quantity),
        unitPriceCents: Number(row.unitPriceCents),
        lineTotalCents: Number(row.lineTotalCents),
      });
    }
  }
  return [...orders.values()];
}

// ---------------------------------------------------------------------------
// Read surfaces. Each is scoped by the predicate its actor is entitled to.
// ---------------------------------------------------------------------------

/** The caller's own orders, newest first. */
export async function listOrdersForCustomer(
  customerId: string,
): Promise<Order[]> {
  const rows = (await sql`
    ${sql.unsafe(ORDER_QUERY)}
    WHERE o.customer_id = ${customerId}
    ORDER BY o.seq DESC, l.created_at ASC
  `) as OrderJoinRow[];
  return toOrders(rows);
}

/** Orders belonging to restaurants this merchant owns — never anybody else's. */
export async function listOrdersForMerchant(actor: Actor): Promise<Order[]> {
  if (actor.restaurantIds.length === 0) return [];
  const rows = (await sql`
    ${sql.unsafe(ORDER_QUERY)}
    WHERE r.owner_id = ${actor.id}
    ORDER BY o.seq DESC, l.created_at ASC
  `) as OrderJoinRow[];
  return toOrders(rows);
}

/** The unclaimed pool: every order that is `ready` and has no courier. */
export async function listAvailableDeliveries(): Promise<Order[]> {
  const rows = (await sql`
    ${sql.unsafe(ORDER_QUERY)}
    WHERE o.status = 'ready' AND o.courier_id IS NULL
    ORDER BY o.seq DESC, l.created_at ASC
  `) as OrderJoinRow[];
  return toOrders(rows);
}

/** The deliveries this courier claimed. */
export async function listDeliveriesForCourier(
  courierId: string,
): Promise<Order[]> {
  const rows = (await sql`
    ${sql.unsafe(ORDER_QUERY)}
    WHERE o.courier_id = ${courierId}
    ORDER BY o.seq DESC, l.created_at ASC
  `) as OrderJoinRow[];
  return toOrders(rows);
}

export async function getOrder(id: string): Promise<Order | null> {
  if (!isRecordId(id)) return null;
  const rows = (await sql`
    ${sql.unsafe(ORDER_QUERY)}
    WHERE o.id = ${id}
    ORDER BY l.created_at ASC
  `) as OrderJoinRow[];
  return toOrders(rows)[0] ?? null;
}

/**
 * An order's detail is readable by the customer who placed it and by the
 * courier who has claimed it — nobody else, including the merchant, whose own
 * surface is the queue. A missing order and a forbidden one answer alike, so a
 * caller guessing ids learns nothing from the difference.
 */
export function canReadOrder(order: Order, actorId: string): boolean {
  return order.customerId === actorId || order.courierId === actorId;
}

export async function requireReadableOrder(
  id: string,
  actorId: string,
): Promise<Order> {
  const order = await getOrder(id);
  if (!order || !canReadOrder(order, actorId)) {
    throw forbidden("That order is not yours.");
  }
  return order;
}

export async function requireOwnOrder(
  id: string,
  customerId: string,
): Promise<Order> {
  const order = await getOrder(id);
  if (!order || order.customerId !== customerId) {
    throw forbidden("That order is not yours.");
  }
  return order;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type RequestedItem = { menuItemId: string; quantity: number };

/**
 * Validates the requested cart against the restaurant's own menu and prices it
 * from the database. Nothing a client sends about money is read: the unit price
 * of every line comes from `menu_items`.
 */
export async function priceCart(
  restaurantId: string,
  items: RequestedItem[],
): Promise<OrderLine[]> {
  const menu = await listMenuItems(restaurantId);
  const byId = new Map(menu.map((item) => [item.id, item]));
  return items.map((item) => {
    const menuItem = byId.get(item.menuItemId);
    if (!menuItem) {
      throw badRequest(
        "Every item in an order must come from that restaurant's menu.",
      );
    }
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity: item.quantity,
      unitPriceCents: menuItem.priceCents,
      lineTotalCents: lineTotalCents(menuItem.priceCents, item.quantity),
    };
  });
}

/**
 * Reads the only three fields of the request body that count. Everything else
 * a client might send — `id`, `status`, `courierId`, `customerId`, and every
 * money field except the tip — is not read at all, so it cannot be stored.
 */
export function parseCart(body: Record<string, unknown>): {
  restaurantId: string;
  items: RequestedItem[];
  tipCents: number;
} {
  const restaurantId = requiredId(body.restaurantId, "Restaurant");
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("An order needs at least one item.");
  }
  const items = raw.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw badRequest("Every cart item must name a menu item and a quantity.");
    }
    const item = entry as Record<string, unknown>;
    return {
      menuItemId: requiredId(item.menuItemId, "Menu item"),
      quantity: positiveInteger(item.quantity, "Quantity"),
    };
  });
  // The tip is the one money value a client may supply.
  const tipCents =
    body.tipCents === undefined || body.tipCents === null
      ? 0
      : nonNegativeIntegerCents(body.tipCents, "Tip");
  return { restaurantId, items, tipCents };
}

/**
 * Creates an order the server priced itself. The order and its lines are
 * written in one transaction, so an order can never exist without its lines.
 */
export async function createOrder(
  customerId: string,
  input: { restaurantId: string; items: RequestedItem[]; tipCents?: number },
): Promise<Order> {
  const restaurant = await requireRestaurant(input.restaurantId);
  const lines = await priceCart(restaurant.id, input.items);
  const pricing = priceOrder(subtotalCentsOf(lines), input.tipCents ?? 0);

  const orderId = randomUUID();
  await sql.transaction([
    sql`
      INSERT INTO orders (id, restaurant_id, customer_id, status,
                          subtotal_cents, tax_cents, delivery_fee_cents,
                          tip_cents, total_cents)
      VALUES (${orderId}, ${restaurant.id}, ${customerId}, 'placed',
              ${pricing.subtotalCents}, ${pricing.taxCents},
              ${pricing.deliveryFeeCents}, ${pricing.tipCents},
              ${pricing.totalCents})
    `,
    ...lines.map(
      (line) => sql`
        INSERT INTO order_lines (order_id, menu_item_id, name,
                                 unit_price_cents, quantity, line_total_cents)
        VALUES (${orderId}, ${line.menuItemId}, ${line.name},
                ${line.unitPriceCents}, ${line.quantity}, ${line.lineTotalCents})
      `,
    ),
  ]);

  const order = await getOrder(orderId);
  if (!order) throw badRequest("The order could not be created.");
  return order;
}

/**
 * Moves an order along the lifecycle.
 *
 * Legality first, then the actor: an edge that does not exist from the order's
 * current status is a 409 whoever asks, and a legal edge asked for by the wrong
 * actor is a 403. Both are decided before anything is written, and the UPDATE
 * itself repeats the `from` status so two racing requests cannot both apply.
 */
export async function transitionOrder(
  id: string,
  to: OrderStatus,
  actor: Actor,
): Promise<Order> {
  const order = await getOrder(id);
  if (!order) throw notFound("That order does not exist.");

  const edge = findEdge(order.status, to);
  if (!edge) {
    throw conflict(`An order that is ${order.status} cannot become ${to}.`);
  }
  if (!mayDrive(edge, order, actor, order.restaurantId)) {
    throw forbidden(`You may not move this order to ${to}.`);
  }

  const rows = (await sql`
    UPDATE orders SET status = ${to}
    WHERE id = ${order.id} AND status = ${edge.from}
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw conflict("That order has already moved on.");
  }
  return (await getOrder(order.id))!;
}

/** A customer cancels their own order; the rule is the `placed → cancelled` edge. */
export async function cancelOwnOrder(
  id: string,
  actor: Actor,
): Promise<Order> {
  const order = await requireOwnOrder(id, actor.id);
  return transitionOrder(order.id, "cancelled", actor);
}

/**
 * Assigns the calling courier to a `ready`, unclaimed delivery.
 *
 * The assignment IS the guard: one conditional UPDATE whose WHERE clause states
 * every precondition, so of any number of simultaneous claims exactly one can
 * affect a row. There is no read-then-write window to lose.
 */
export async function claimDelivery(
  orderId: string,
  courier: Actor,
): Promise<Order> {
  if (!isRecordId(orderId)) throw notFound("That delivery does not exist.");
  const rows = (await sql`
    UPDATE orders SET courier_id = ${courier.id}
    WHERE id = ${orderId} AND status = 'ready' AND courier_id IS NULL
    RETURNING id
  `) as Array<{ id: string }>;

  if (rows.length === 0) {
    const existing = await getOrder(orderId);
    if (!existing) throw notFound("That delivery does not exist.");
    if (existing.courierId) {
      throw conflict("Another courier has already claimed that delivery.");
    }
    throw conflict("That delivery is not ready to be picked up.");
  }
  return (await getOrder(orderId))!;
}

/**
 * The customer who placed an order rates it once, after it is delivered.
 *
 * The rules are checked in the order the prompt states them — somebody else's
 * order is a 403 before anything about its state is considered — and the write
 * repeats every precondition, so two simultaneous ratings cannot both land.
 */
export async function rateOwnOrder(
  id: string,
  stars: unknown,
  actor: Actor,
): Promise<Order> {
  const order = await requireOwnOrder(id, actor.id);
  const value = wholeStars(stars);
  if (order.status !== "delivered") {
    throw conflict("Only a delivered order can be rated.");
  }
  if (order.ratingStars !== null) {
    throw conflict("That order has already been rated.");
  }
  const rows = (await sql`
    UPDATE orders SET rating_stars = ${value}
    WHERE id = ${order.id}
      AND customer_id = ${actor.id}
      AND status = 'delivered'
      AND rating_stars IS NULL
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw conflict("That order has already been rated.");
  }
  return (await getOrder(order.id))!;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** The JSON shape the prompts pin for an order. */
export function serializeOrder(order: Order) {
  return {
    id: order.id,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    status: order.status,
    courierId: order.courierId,
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    ratingStars: order.ratingStars,
    createdAt: order.createdAt,
    lines: order.lines.map((line) => ({
      menuItemId: line.menuItemId,
      name: line.name,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
    })),
  };
}

/**
 * A delivery is the same order seen by a courier: its id, its status and the
 * courier who claimed it, plus enough about the restaurant to find the pickup.
 * It deliberately does not carry the order's lines — those are readable only
 * once the delivery has been claimed, through the order endpoint.
 */
export function serializeDelivery(order: Order) {
  return {
    id: order.id,
    status: order.status,
    courierId: order.courierId,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
  };
}
