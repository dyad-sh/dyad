// event_handler.ts — dispatches application events to their handlers

import { createLogger } from "./logger";

const logger = createLogger("event-handler");

export type EventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.deactivated"
  | "user.role_changed"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "project.deleted"
  | "project.member_added"
  | "project.member_removed"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "subscription.created"
  | "subscription.cancelled"
  | "subscription.renewed";

export interface AppEvent {
  type: EventType;
  payload: Record<string, unknown>;
  timestamp: string;
  correlationId: string;
  sourceService: string;
}

// ── Individual handlers ────────────────────────────────────────────────────

async function notifyUserCreated(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Sending welcome email to ${payload.email}`);
  // implementation elided
}

async function syncUserToSearchIndex(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Syncing user ${payload.id} to search index`);
  // implementation elided
}

async function revokeUserSessions(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Revoking all sessions for user ${payload.id}`);
  // implementation elided
}

async function notifyUserRoleChanged(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Notifying user ${payload.id} of role change: ${payload.oldRole} → ${payload.newRole}`,
  );
  // implementation elided
}

async function notifyProjectCreated(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Notifying team about new project ${payload.id}`);
  // implementation elided
}

async function archiveProjectAssets(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Archiving assets for project ${payload.id}`);
  // implementation elided
}

async function cleanupProjectResources(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Cleaning up resources for deleted project ${payload.id}`);
  // implementation elided
}

async function notifyProjectMemberAdded(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Notifying user ${payload.memberId} they were added to project ${payload.projectId}`,
  );
  // implementation elided
}

async function notifyProjectMemberRemoved(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Notifying user ${payload.memberId} they were removed from project ${payload.projectId}`,
  );
  // implementation elided
}

async function recordPaymentSuccess(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(`Recording payment ${payload.transactionId}`);
  // implementation elided
}

async function handlePaymentFailure(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.warn(`Payment failed for order ${payload.orderId}`);
  // implementation elided
}

async function processRefund(payload: Record<string, unknown>): Promise<void> {
  logger.info(
    `Processing refund ${payload.refundId} for transaction ${payload.transactionId}`,
  );
  // implementation elided
}

async function provisionSubscriptionFeatures(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Provisioning features for subscription ${payload.subscriptionId}`,
  );
  // implementation elided
}

async function deprovisionSubscriptionFeatures(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Deprovisioning features for cancelled subscription ${payload.subscriptionId}`,
  );
  // implementation elided
}

async function extendSubscriptionAccess(
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info(
    `Extending access for renewed subscription ${payload.subscriptionId}`,
  );
  // implementation elided
}

/**
 * Routes an application event to the correct handler.
 * TODO: Refactor this switch into a Record<EventType, handler> map + dispatch function.
 */
export async function handleEvent(event: AppEvent): Promise<void> {
  logger.info(
    `Handling event ${event.type} (correlation: ${event.correlationId}, source: ${event.sourceService})`,
  );

  switch (event.type) {
    case "user.created":
      await notifyUserCreated(event.payload);
      await syncUserToSearchIndex(event.payload);
      break;

    case "user.updated":
      await syncUserToSearchIndex(event.payload);
      break;

    case "user.deleted":
      logger.info(`User ${event.payload.id} deleted — cleaning up`);
      await revokeUserSessions(event.payload);
      break;

    case "user.deactivated":
      logger.info(`User ${event.payload.id} deactivated`);
      await revokeUserSessions(event.payload);
      break;

    case "user.role_changed":
      await notifyUserRoleChanged(event.payload);
      break;

    case "project.created":
      await notifyProjectCreated(event.payload);
      break;

    case "project.updated":
      logger.info(`Project ${event.payload.id} updated`);
      break;

    case "project.archived":
      await archiveProjectAssets(event.payload);
      break;

    case "project.deleted":
      await cleanupProjectResources(event.payload);
      break;

    case "project.member_added":
      await notifyProjectMemberAdded(event.payload);
      break;

    case "project.member_removed":
      await notifyProjectMemberRemoved(event.payload);
      break;

    case "payment.succeeded":
      await recordPaymentSuccess(event.payload);
      break;

    case "payment.failed":
      await handlePaymentFailure(event.payload);
      break;

    case "payment.refunded":
      await processRefund(event.payload);
      break;

    case "subscription.created":
      await provisionSubscriptionFeatures(event.payload);
      break;

    case "subscription.cancelled":
      await deprovisionSubscriptionFeatures(event.payload);
      break;

    case "subscription.renewed":
      await extendSubscriptionAccess(event.payload);
      break;

    default: {
      const exhaustiveCheck: never = event.type;
      logger.warn(`Unknown event type: ${exhaustiveCheck}`);
    }
  }
}

// ── Batch processing ───────────────────────────────────────────────────────

export interface EventBatch {
  events: AppEvent[];
  batchId: string;
  enqueuedAt: string;
}

export interface BatchResult {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ correlationId: string; message: string }>;
}

/**
 * Processes a batch of events sequentially. Failures are recorded but
 * do not abort the remaining events in the batch.
 */
export async function handleEventBatch(
  batch: EventBatch,
): Promise<BatchResult> {
  logger.info(
    `Processing batch ${batch.batchId} with ${batch.events.length} event(s)`,
  );
  const result: BatchResult = {
    batchId: batch.batchId,
    total: batch.events.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const event of batch.events) {
    try {
      await handleEvent(event);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        correlationId: event.correlationId,
        message: err instanceof Error ? err.message : String(err),
      });
      logger.error(
        `Batch ${batch.batchId}: event ${event.correlationId} (${event.type}) failed`,
        err,
      );
    }
  }

  logger.info(
    `Batch ${batch.batchId} complete — succeeded: ${result.succeeded}, failed: ${result.failed}`,
  );
  return result;
}

// ── Dead-letter retry ──────────────────────────────────────────────────────

interface DeadLetterEntry {
  event: AppEvent;
  failedAt: string;
  reason: string;
  attempts: number;
}

const MAX_RETRY_ATTEMPTS = 3;

export async function retryDeadLetter(
  entries: DeadLetterEntry[],
): Promise<{ retried: number; exhausted: number }> {
  let retried = 0;
  let exhausted = 0;

  for (const entry of entries) {
    if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
      logger.warn(
        `Dead-letter entry for ${entry.event.correlationId} exhausted (${entry.attempts} attempts)`,
      );
      exhausted++;
      continue;
    }
    try {
      await handleEvent(entry.event);
      retried++;
      logger.info(
        `Retried dead-letter event ${entry.event.correlationId} successfully`,
      );
    } catch (err) {
      logger.error(
        `Retry failed for dead-letter event ${entry.event.correlationId}`,
        err,
      );
    }
  }

  return { retried, exhausted };
}

// ── Metrics ────────────────────────────────────────────────────────────────

const handledCounts = new Map<EventType, number>();

export function getHandledCount(type: EventType): number {
  return handledCounts.get(type) ?? 0;
}

export function resetHandledCounts(): void {
  handledCounts.clear();
  logger.info("Event handled counts reset");
}

export function getAllHandledCounts(): Record<string, number> {
  return Object.fromEntries(handledCounts.entries());
}
