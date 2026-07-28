import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  hasMatchingDueFollowUp,
  rejectDueFollowUp,
} from "@/ipc/services/user_input_followup_service";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { ChatQueueEntry, SerializableChatTurnIntent } from "./transport";
import type { ChatStreamHostCommand } from "./host_state";
import { withChatQueueLock } from "./queue_lock";

type ChatDatabase = BetterSQLite3Database<typeof schema>;

interface IntentRecord {
  intent: SerializableChatTurnIntent;
  acceptance: "queued" | "message-accepted" | "rejected";
  recovery: "not-started" | "started" | "terminal";
  acceptedMessageId?: number;
}

interface QueueAggregate {
  revision: number;
  paused: boolean;
  intentIds: string[];
}

const intentRecords = new Map<string, IntentRecord>();
const queues = new Map<number, QueueAggregate>();

function queueFor(chatId: number): QueueAggregate {
  let queue = queues.get(chatId);
  if (!queue) {
    queue = { revision: 0, paused: false, intentIds: [] };
    queues.set(chatId, queue);
  }
  return queue;
}

function recordFor(intentId: string): IntentRecord | undefined {
  return intentRecords.get(intentId);
}

function assertMatchingIntent(
  existing: IntentRecord,
  intent: SerializableChatTurnIntent,
): void {
  if (
    existing.intent.chatId !== intent.chatId ||
    existing.intent.payloadHash !== intent.payloadHash
  ) {
    throw new DyadError(
      "Intent id was already used with a different immutable payload",
      DyadErrorKind.Conflict,
    );
  }
}

function replay(existing: IntentRecord): PersistAdmissionResult {
  return {
    kind: "replayed",
    acceptance: existing.acceptance,
    ...(existing.acceptedMessageId === undefined
      ? {}
      : { acceptedMessageId: existing.acceptedMessageId }),
  };
}

export function assertChatTurnPayloadHash(
  intent: SerializableChatTurnIntent,
): void {
  const expected = computeChatTurnPayloadHash(intent);
  if (expected !== intent.payloadHash) {
    throw new DyadError(
      "Chat turn payload hash does not match its immutable payload",
      DyadErrorKind.Validation,
    );
  }
}

export function toQueueEntry(
  intent: SerializableChatTurnIntent,
): ChatQueueEntry {
  return {
    itemId: intent.intentId,
    intentId: intent.intentId,
    prompt: intent.prompt,
    attachments: intent.attachments,
    selectedComponents: intent.selectedComponents,
    redo: intent.redo,
    appId: intent.appId,
    requestedChatMode: intent.requestedChatMode,
    persistence: "main-session",
    editable: intent.owner === undefined,
    removable: intent.owner?.kind !== "plan-handoff",
  };
}

export function loadChatQueue(
  _database: ChatDatabase,
  chatId: number,
): {
  queueRevision: number;
  queuePaused: boolean;
  queue: ChatQueueEntry[];
} {
  const aggregate = queueFor(chatId);
  return {
    queueRevision: aggregate.revision,
    queuePaused: aggregate.paused,
    queue: aggregate.intentIds.flatMap((intentId) => {
      const record = recordFor(intentId);
      return record ? [toQueueEntry(record.intent)] : [];
    }),
  };
}

export function hydrateChatStreamPersistence(
  database: ChatDatabase,
  chatId: number,
): ReturnType<typeof loadChatQueue> {
  return loadChatQueue(database, chatId);
}

function assertMatchingDueFollowUp(intent: SerializableChatTurnIntent): void {
  if (intent.owner?.kind !== "user-input-follow-up") {
    throw new DyadError(
      "Session queue requires a live user-input owner",
      DyadErrorKind.Validation,
    );
  }
  if (
    !hasMatchingDueFollowUp({
      requestId: intent.owner.requestId,
      chatId: intent.chatId,
      prompt: intent.prompt,
    })
  ) {
    throw new DyadError(
      "No matching due user-input follow-up",
      DyadErrorKind.NotFound,
    );
  }
}

export function persistSessionQueuedIntent(
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult {
  assertMatchingDueFollowUp(intent);
  return persistIntentInQueue(database, intent);
}

export function isSessionQueuedIntent(intentId: string): boolean {
  return recordFor(intentId)?.intent.owner?.kind === "user-input-follow-up";
}

export function completeSessionQueueAcceptance(intentId: string): void {
  const record = recordFor(intentId);
  if (!record || record.intent.owner?.kind !== "user-input-follow-up") return;
  const queue = queueFor(record.intent.chatId);
  const index = queue.intentIds.indexOf(intentId);
  if (index >= 0) {
    queue.intentIds.splice(index, 1);
    queue.revision += 1;
  }
}

export function disposeSessionChatQueue(chatId: number): void {
  queues.delete(chatId);
  for (const [intentId, record] of intentRecords) {
    if (record.intent.chatId === chatId) intentRecords.delete(intentId);
  }
}

export type PersistAdmissionResult =
  | {
      kind: "queued";
      entry: ChatQueueEntry;
      queueRevision: number;
    }
  | {
      kind: "replayed";
      acceptance: "queued" | "message-accepted" | "rejected";
      acceptedMessageId?: number;
    };

function persistIntentInQueue(
  _database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult {
  assertChatTurnPayloadHash(intent);
  const existing = recordFor(intent.intentId);
  if (existing) {
    assertMatchingIntent(existing, intent);
    return replay(existing);
  }
  intentRecords.set(intent.intentId, {
    intent,
    acceptance: "queued",
    recovery: "not-started",
  });
  const aggregate = queueFor(intent.chatId);
  aggregate.intentIds.push(intent.intentId);
  aggregate.revision += 1;
  return {
    kind: "queued",
    entry: toQueueEntry(intent),
    queueRevision: aggregate.revision,
  };
}

export function persistQueuedIntent(
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult {
  if (intent.owner?.kind === "user-input-follow-up") {
    throw new DyadError(
      "Memory-owned follow-ups must use the live session queue",
      DyadErrorKind.Validation,
    );
  }
  return persistIntentInQueue(database, intent);
}

export function stageActiveIntent(
  _database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult | null {
  assertChatTurnPayloadHash(intent);
  if (intent.owner?.kind === "user-input-follow-up") {
    assertMatchingDueFollowUp(intent);
  }
  const existing = recordFor(intent.intentId);
  if (existing) {
    assertMatchingIntent(existing, intent);
    return replay(existing);
  }
  intentRecords.set(intent.intentId, {
    intent,
    acceptance: "queued",
    recovery: "not-started",
  });
  return null;
}

export function ensureIntentRecord(intent: SerializableChatTurnIntent): void {
  assertChatTurnPayloadHash(intent);
  const existing = recordFor(intent.intentId);
  if (existing) {
    assertMatchingIntent(existing, intent);
    return;
  }
  intentRecords.set(intent.intentId, {
    intent,
    acceptance: "queued",
    recovery: "not-started",
  });
}

export function getIntentAcceptance(
  intentId: string,
): IntentRecord["acceptance"] | undefined {
  return recordFor(intentId)?.acceptance;
}

export function getAcceptedMessageId(intentId: string): number | undefined {
  return recordFor(intentId)?.acceptedMessageId;
}

export function markIntentAccepted(
  intentId: string | undefined,
  acceptedMessageId: number,
): void {
  if (!intentId) return;
  const record = recordFor(intentId);
  if (!record) {
    throw new DyadError("Chat turn intent not found", DyadErrorKind.NotFound);
  }
  record.acceptance = "message-accepted";
  record.recovery = "started";
  record.acceptedMessageId = acceptedMessageId;
  const aggregate = queueFor(record.intent.chatId);
  const index = aggregate.intentIds.indexOf(intentId);
  if (index >= 0) {
    aggregate.intentIds.splice(index, 1);
    aggregate.revision += 1;
  }
}

export async function mutateChatQueue(
  database: ChatDatabase,
  chatId: number,
  command: Extract<ChatStreamHostCommand, { type: "mutate-queue" }>,
): Promise<ReturnType<typeof loadChatQueue>> {
  return withChatQueueLock(chatId, async () => {
    const aggregate = queueFor(chatId);
    if (aggregate.revision !== command.expectedQueueRevision) {
      throw new DyadError(
        "Chat queue changed in another window",
        DyadErrorKind.Conflict,
      );
    }
    const mutation = command.mutation;
    const entries = aggregate.intentIds.flatMap((intentId) => {
      const record = recordFor(intentId);
      return record ? [{ record, entry: toQueueEntry(record.intent) }] : [];
    });
    const selected =
      mutation.type === "clear"
        ? entries
        : "itemId" in mutation
          ? entries.filter(({ entry }) => entry.itemId === mutation.itemId)
          : [];
    if (
      (mutation.type === "remove" || mutation.type === "clear") &&
      selected.some(
        ({ record }) => record.intent.owner?.kind === "plan-handoff",
      )
    ) {
      throw new DyadError(
        "Plan implementation turns cannot be removed while their handoff is active",
        DyadErrorKind.Precondition,
      );
    }
    if (
      (mutation.type === "edit" || mutation.type === "reorder") &&
      selected.some(({ entry }) => !entry.editable)
    ) {
      throw new DyadError(
        "Machine-owned queued messages cannot be edited or reordered",
        DyadErrorKind.Precondition,
      );
    }

    const originalIntentIds = [...aggregate.intentIds];
    switch (mutation.type) {
      case "pause":
        aggregate.paused = true;
        break;
      case "resume":
        aggregate.paused = false;
        break;
      case "edit": {
        const selectedRecord = selected[0]?.record;
        if (!selectedRecord) {
          throw new DyadError(
            "Queued message not found",
            DyadErrorKind.NotFound,
          );
        }
        const withoutHash = {
          ...selectedRecord.intent,
          prompt: mutation.prompt,
          attachments: mutation.attachments,
          selectedComponents: mutation.selectedComponents,
        };
        selectedRecord.intent = {
          ...withoutHash,
          payloadHash: computeChatTurnPayloadHash(withoutHash),
        };
        break;
      }
      case "reorder": {
        const from = aggregate.intentIds.indexOf(mutation.itemId);
        if (from < 0 || mutation.toIndex >= aggregate.intentIds.length) {
          throw new DyadError(
            "Queued message reorder is out of range",
            DyadErrorKind.Validation,
          );
        }
        const [moved] = aggregate.intentIds.splice(from, 1);
        aggregate.intentIds.splice(mutation.toIndex, 0, moved);
        break;
      }
      case "remove": {
        if (selected.length === 0) {
          throw new DyadError(
            "Queued message not found",
            DyadErrorKind.NotFound,
          );
        }
        const removedId = selected[0].record.intent.intentId;
        aggregate.intentIds = aggregate.intentIds.filter(
          (intentId) => intentId !== removedId,
        );
        selected[0].record.acceptance = "rejected";
        break;
      }
      case "clear": {
        const removedIds = new Set(
          selected.map(({ record }) => record.intent.intentId),
        );
        aggregate.intentIds = aggregate.intentIds.filter(
          (intentId) => !removedIds.has(intentId),
        );
        for (const { record } of selected) record.acceptance = "rejected";
        break;
      }
    }
    aggregate.revision += 1;

    const sessionRecords = selected.filter(
      ({ record }) =>
        record.intent.owner?.kind === "user-input-follow-up" &&
        (mutation.type === "remove" || mutation.type === "clear"),
    );
    const settlements = await Promise.allSettled(
      sessionRecords.map(({ record }) =>
        rejectDueFollowUp(
          (
            record.intent.owner as {
              kind: "user-input-follow-up";
              requestId: string;
            }
          ).requestId,
        ),
      ),
    );
    const failed = sessionRecords.filter(
      (_, index) => settlements[index]?.status === "rejected",
    );
    if (failed.length > 0) {
      const failedIds = new Set(
        failed.map(({ record }) => record.intent.intentId),
      );
      aggregate.intentIds = [
        ...originalIntentIds.filter(
          (intentId) =>
            failedIds.has(intentId) || aggregate.intentIds.includes(intentId),
        ),
        ...aggregate.intentIds.filter(
          (intentId) => !originalIntentIds.includes(intentId),
        ),
      ];
      for (const { record } of failed) record.acceptance = "queued";
      throw new AggregateError(
        settlements.flatMap((settlement) =>
          settlement.status === "rejected" ? [settlement.reason] : [],
        ),
        "Failed to settle one or more queued message owners",
      );
    }
    return loadChatQueue(database, chatId);
  });
}

export function markIntentTerminal(
  database: ChatDatabase,
  intent: Pick<SerializableChatTurnIntent, "chatId" | "intentId" | "owner">,
  pauseQueue: boolean,
  rejectBeforeAcceptance = false,
): ReturnType<typeof loadChatQueue> {
  const record = recordFor(intent.intentId);
  if (!record) {
    if (intent.owner?.kind === "user-input-follow-up") {
      return loadChatQueue(database, intent.chatId);
    }
    throw new DyadError("Chat turn intent not found", DyadErrorKind.NotFound);
  }
  const aggregate = queueFor(record.intent.chatId);
  let changed = false;
  if (rejectBeforeAcceptance && record.acceptance === "queued") {
    const index = aggregate.intentIds.indexOf(intent.intentId);
    if (index >= 0) {
      aggregate.intentIds.splice(index, 1);
      changed = true;
    }
    record.acceptance = "rejected";
  }
  record.recovery = "terminal";
  if (pauseQueue && !aggregate.paused) {
    aggregate.paused = true;
    changed = true;
  }
  if (changed) aggregate.revision += 1;
  return loadChatQueue(database, record.intent.chatId);
}

export function peekQueueHead(
  _database: ChatDatabase,
  chatId: number,
): SerializableChatTurnIntent | null {
  const aggregate = queueFor(chatId);
  if (aggregate.paused) return null;
  const intentId = aggregate.intentIds[0];
  return intentId ? (recordFor(intentId)?.intent ?? null) : null;
}
