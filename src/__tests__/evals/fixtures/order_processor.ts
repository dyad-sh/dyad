// order_processor.ts — core order processing logic

import { createLogger } from "./logger";
import type {
  Order,
  InventoryItem,
  PaymentMethod,
  ShippingAddress,
} from "./types";

const logger = createLogger("order-processor");

interface ProcessResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

interface RefundResult {
  refundId: string;
  amount: number;
  status: "pending" | "completed" | "failed";
}

// ── External service stubs ─────────────────────────────────────────────────

async function getInventory(_productId: string): Promise<InventoryItem | null> {
  // Implementation elided — hits the warehouse API
  return null;
}

async function reserveInventory(
  _productId: string,
  _quantity: number,
): Promise<boolean> {
  // Implementation elided — locks inventory for the order
  return true;
}

async function releaseInventory(
  _productId: string,
  _quantity: number,
): Promise<void> {
  // Implementation elided — releases a previously-reserved hold
}

async function chargePayment(
  _method: PaymentMethod,
  _amount: number,
): Promise<{ transactionId: string }> {
  // Implementation elided — hits the payment gateway
  return { transactionId: "txn_placeholder" };
}

async function refundPayment(
  transactionId: string,
  amount: number,
): Promise<RefundResult> {
  // Implementation elided — issues a refund via the payment gateway
  return { refundId: "ref_placeholder", amount, status: "pending" };
}

async function createShipment(
  _address: ShippingAddress,
  _items: string[],
): Promise<{ trackingNumber: string; estimatedDelivery: string }> {
  // Implementation elided — hits the shipping API
  return {
    trackingNumber: "track_placeholder",
    estimatedDelivery: new Date(
      Date.now() + 5 * 24 * 3600 * 1000,
    ).toISOString(),
  };
}

async function cancelShipment(_trackingNumber: string): Promise<void> {
  // Implementation elided — cancels a shipment before it ships
}

async function saveOrder(_order: Order): Promise<string> {
  // Implementation elided — writes to DB
  return "order_placeholder";
}

async function updateOrderStatus(
  _orderId: string,
  _status: string,
): Promise<void> {
  // Implementation elided — updates DB record
}

async function notifyOrderConfirmed(
  _orderId: string,
  _email: string,
): Promise<void> {
  // Implementation elided — sends confirmation email
}

/**
 * Processes an order end-to-end.
 * Validation, payment, shipment creation, and persistence are all inlined here.
 * TODO: Extract the validation block into a separate `validateOrder` function.
 */
export async function processOrder(order: Order): Promise<ProcessResult> {
  logger.info(`Processing order for ${order.items.length} item(s)`);

  // ── Validation block (extract this into validateOrder) ────────────────────
  // Check inventory for each item
  for (const item of order.items) {
    const inventory = await getInventory(item.productId);
    if (!inventory) {
      logger.warn(`Product ${item.productId} not found in inventory`);
      return { success: false, error: `Product ${item.productId} not found` };
    }
    if (inventory.quantity < item.quantity) {
      logger.warn(
        `Insufficient stock for ${item.productId}: need ${item.quantity}, have ${inventory.quantity}`,
      );
      return {
        success: false,
        error: `Insufficient stock for ${item.productId}`,
      };
    }
  }

  // Validate payment method
  if (
    !order.payment.method ||
    !["card", "paypal", "bank"].includes(order.payment.method)
  ) {
    return { success: false, error: "Invalid payment method" };
  }
  if (!order.payment.amount || order.payment.amount <= 0) {
    return { success: false, error: "Invalid payment amount" };
  }

  // Validate shipping address
  if (!order.shipping.address.street || !order.shipping.address.city) {
    return { success: false, error: "Incomplete shipping address" };
  }
  if (!order.shipping.address.postalCode.match(/^\d{5}(-\d{4})?$/)) {
    return { success: false, error: "Invalid postal code" };
  }
  // ── End of validation block ───────────────────────────────────────────────

  // Reserve inventory
  const reservations: Array<{ productId: string; quantity: number }> = [];
  for (const item of order.items) {
    const ok = await reserveInventory(item.productId, item.quantity);
    if (!ok) {
      // Roll back any reservations already made
      for (const r of reservations) {
        await releaseInventory(r.productId, r.quantity);
      }
      return {
        success: false,
        error: `Could not reserve stock for ${item.productId}`,
      };
    }
    reservations.push({ productId: item.productId, quantity: item.quantity });
  }

  // Charge the customer
  let transaction: { transactionId: string };
  try {
    transaction = await chargePayment(
      order.payment.method,
      order.payment.amount,
    );
  } catch (err) {
    logger.error("Payment failed", err);
    for (const r of reservations) {
      await releaseInventory(r.productId, r.quantity);
    }
    return { success: false, error: "Payment processing failed" };
  }

  // Create shipment
  let shipment: { trackingNumber: string; estimatedDelivery: string };
  try {
    const itemIds = order.items.map((i) => i.productId);
    shipment = await createShipment(order.shipping.address, itemIds);
  } catch (err) {
    logger.error("Shipment creation failed", err);
    await refundPayment(transaction.transactionId, order.payment.amount);
    for (const r of reservations) {
      await releaseInventory(r.productId, r.quantity);
    }
    return { success: false, error: "Shipment creation failed" };
  }

  // Persist the order
  const enrichedOrder: Order = {
    ...order,
    transactionId: transaction.transactionId,
    trackingNumber: shipment.trackingNumber,
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
  };

  const orderId = await saveOrder(enrichedOrder);
  logger.info(
    `Order ${orderId} confirmed (tracking: ${shipment.trackingNumber})`,
  );

  // Send confirmation email (best-effort — don't fail the order)
  try {
    await notifyOrderConfirmed(orderId, order.customerEmail);
  } catch (err) {
    logger.warn(`Failed to send confirmation email for order ${orderId}`, err);
  }

  return { success: true, orderId };
}

// ── Cancellation ───────────────────────────────────────────────────────────

export async function cancelOrder(
  orderId: string,
  transactionId: string,
  trackingNumber: string,
  amount: number,
  reservations: Array<{ productId: string; quantity: number }>,
): Promise<ProcessResult> {
  logger.info(`Cancelling order ${orderId}`);

  try {
    await cancelShipment(trackingNumber);
  } catch (err) {
    logger.warn(
      `Could not cancel shipment ${trackingNumber} for order ${orderId}`,
      err,
    );
  }

  let refundOk = false;
  try {
    await refundPayment(transactionId, amount);
    refundOk = true;
  } catch (err) {
    logger.error(`Refund failed for order ${orderId}`, err);
  }

  for (const r of reservations) {
    await releaseInventory(r.productId, r.quantity);
  }

  await updateOrderStatus(
    orderId,
    refundOk ? "cancelled" : "cancellation_pending",
  );
  logger.info(`Order ${orderId} cancelled (refund ok: ${refundOk})`);
  return { success: true, orderId };
}

// ── Order lookup helpers ───────────────────────────────────────────────────

export async function getOrderStatus(orderId: string): Promise<string | null> {
  logger.info(`Looking up status for order ${orderId}`);
  // Implementation elided — queries DB
  return null;
}

export async function listOrdersForCustomer(
  customerEmail: string,
  page: number,
  _limit: number,
): Promise<Order[]> {
  logger.info(`Listing orders for customer ${customerEmail} (page=${page})`);
  // Implementation elided — queries DB
  return [];
}

// ── Order enrichment ───────────────────────────────────────────────────────

export async function enrichOrderWithTracking(
  order: Order,
): Promise<Order & { trackingUrl: string }> {
  if (!order.trackingNumber) {
    throw new Error("Order has no tracking number");
  }
  const carrier = order.trackingNumber.startsWith("UPS") ? "ups" : "fedex";
  const trackingUrl = `https://tracking.${carrier}.com/${order.trackingNumber}`;
  logger.info(`Enriched order with tracking URL (carrier: ${carrier})`);
  return { ...order, trackingUrl };
}

export async function estimateDeliveryDate(
  address: ShippingAddress,
  expedited: boolean,
): Promise<string> {
  const baseDays = expedited ? 2 : 5;
  const regionBuffer = address.country !== "US" ? 7 : 0;
  const estimate = new Date(
    Date.now() + (baseDays + regionBuffer) * 24 * 3600 * 1000,
  );
  return estimate.toISOString();
}

// ── Duplicate detection ────────────────────────────────────────────────────

interface IdempotencyRecord {
  key: string;
  orderId: string;
  createdAt: string;
}

const idempotencyStore = new Map<string, IdempotencyRecord>();

export function checkIdempotency(key: string): string | null {
  return idempotencyStore.get(key)?.orderId ?? null;
}

export function registerIdempotency(key: string, orderId: string): void {
  idempotencyStore.set(key, {
    key,
    orderId,
    createdAt: new Date().toISOString(),
  });
  logger.info(`Registered idempotency key ${key} → order ${orderId}`);
}

export async function processOrderIdempotent(
  order: Order,
  idempotencyKey: string,
): Promise<ProcessResult> {
  const existing = checkIdempotency(idempotencyKey);
  if (existing) {
    logger.info(
      `Idempotency hit: returning existing order ${existing} for key ${idempotencyKey}`,
    );
    return { success: true, orderId: existing };
  }
  const result = await processOrder(order);
  if (result.success && result.orderId) {
    registerIdempotency(idempotencyKey, result.orderId);
  }
  return result;
}
