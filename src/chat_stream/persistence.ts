import { serialize } from "node:v8";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type * as schema from "@/db/schema";
import {
  chatQueueEntries,
  chatQueueStates,
  chatTurnIntents,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  hasMatchingDueFollowUp,
  rejectDueFollowUp,
} from "@/ipc/services/user_input_followup_service";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import {
  CHAT_STREAM_MAX_QUEUE_BYTES,
  SerializableChatTurnIntentSchema,
  type ChatQueueEntry,
  type SerializableChatTurnIntent,
} from "./transport";
import type { ChatStreamHostCommand } from "./host_state";
import { withChatQueueLock } from "./queue_lock";

type ChatDatabase = BetterSQLite3Database<typeof schema>;
type ChatPersistenceDatabase = Pick<
  ChatDatabase,
  "select" | "insert" | "update" | "delete"
>;

interface IntentRecord {
  intent: SerializableChatTurnIntent | null;
  chatId: number;
  payloadHash: string;
  acceptance: "queued" | "message-accepted" | "rejected";
  recovery: "not-started" | "started" | "terminal";
  acceptedMessageId?: number;
  durable: boolean;
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

function releaseIntentPayload(record: IntentRecord): void {
  record.intent = null;
}

type LiveIntentRecord = IntentRecord & {
  intent: SerializableChatTurnIntent;
};

interface SelectedQueueRecord {
  record: LiveIntentRecord;
  entry: ChatQueueEntry;
}

function liveRecordFor(intentId: string): LiveIntentRecord | undefined {
  const record = recordFor(intentId);
  return record?.intent ? (record as LiveIntentRecord) : undefined;
}

function assertMatchingIntent(
  existing: IntentRecord,
  intent: SerializableChatTurnIntent,
): void {
  if (
    existing.chatId !== intent.chatId ||
    existing.payloadHash !== intent.payloadHash
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
    persistence: intent.owner === undefined ? "durable" : "main-session",
    editable: intent.owner === undefined,
    removable: intent.owner?.kind !== "plan-handoff",
  };
}

export function assertQueueSnapshotWithinLimit(
  entries: readonly ChatQueueEntry[],
  maxBytes = CHAT_STREAM_MAX_QUEUE_BYTES,
): void {
  if (serialize(entries).byteLength <= maxBytes) return;
  throw new DyadError(
    "The queued messages are too large to synchronize between windows",
    DyadErrorKind.RateLimited,
  );
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
      const record = liveRecordFor(intentId);
      return record ? [toQueueEntry(record.intent)] : [];
    }),
  };
}

export function hydrateChatStreamPersistence(
  database: ChatDatabase,
  chatId: number,
): ReturnType<typeof loadChatQueue> {
  if (queues.has(chatId)) return loadChatQueue(database, chatId);

  database.transaction((tx) => {
    const persistedEntries = tx
      .select()
      .from(chatQueueEntries)
      .where(eq(chatQueueEntries.chatId, chatId))
      .orderBy(asc(chatQueueEntries.position))
      .all()
      .sort((left, right) => {
        if (left.status === right.status) return left.position - right.position;
        return left.status === "claimed" ? -1 : 1;
      });
    const persistedState = tx
      .select()
      .from(chatQueueStates)
      .where(eq(chatQueueStates.chatId, chatId))
      .get();

    const intentIds = persistedEntries.flatMap((entry) => {
      const row = tx
        .select()
        .from(chatTurnIntents)
        .where(eq(chatTurnIntents.intentId, entry.intentId))
        .get();
      let intent: SerializableChatTurnIntent | null = null;
      try {
        if (!row?.intent) throw new Error("missing intent payload");
        const parsed = SerializableChatTurnIntentSchema.safeParse(row.intent);
        if (!parsed.success) {
          throw new Error("invalid intent payload");
        }
        intent = parsed.data;
        assertChatTurnPayloadHash(intent);
        if (
          intent.chatId !== chatId ||
          intent.payloadHash !== row.payloadHash
        ) {
          throw new Error("intent does not match its queue row");
        }
      } catch (error) {
        console.error(
          `[chat-stream] Quarantining unusable persisted intent ${entry.intentId}`,
          error,
        );
        tx.delete(chatQueueEntries)
          .where(eq(chatQueueEntries.intentId, entry.intentId))
          .run();
        if (row) {
          tx.update(chatTurnIntents)
            .set({
              acceptance: "rejected",
              recovery: "terminal",
              intent: null,
              updatedAt: new Date(),
            })
            .where(eq(chatTurnIntents.intentId, entry.intentId))
            .run();
        }
        return [];
      }
      intentRecords.set(entry.intentId, {
        intent,
        chatId: row.chatId,
        payloadHash: row.payloadHash,
        acceptance: row.acceptance,
        recovery: row.recovery,
        acceptedMessageId: row.acceptedMessageId ?? undefined,
        durable: true,
      });
      return [entry.intentId];
    });
    let revision = persistedState?.revision ?? 0;
    let paused = persistedState?.paused ?? false;
    // A process restart may happen long after admission or while the head was
    // claimed. Restore every durable queue paused so no work runs invisibly.
    if (
      intentIds.length > 0 &&
      (!paused || persistedEntries.some((e) => e.status === "claimed"))
    ) {
      revision += 1;
      paused = true;
      tx.insert(chatQueueStates)
        .values({ chatId, revision, paused, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: chatQueueStates.chatId,
          set: { revision, paused, updatedAt: new Date() },
        })
        .run();
      tx.update(chatQueueEntries)
        .set({ status: "queued" })
        .where(
          and(
            eq(chatQueueEntries.chatId, chatId),
            eq(chatQueueEntries.status, "claimed"),
          ),
        )
        .run();
    }
    queues.set(chatId, { revision, paused, intentIds });
  });
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
  return persistIntentInQueue(database, intent, false);
}

export function isSessionQueuedIntent(intentId: string): boolean {
  return liveRecordFor(intentId)?.intent.owner?.kind === "user-input-follow-up";
}

export function completeSessionQueueAcceptance(intentId: string): void {
  const record = liveRecordFor(intentId);
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
    if (record.chatId === chatId) intentRecords.delete(intentId);
  }
}

export function hasSessionChatQueue(chatId: number): boolean {
  return queues.has(chatId);
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
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
  durable: boolean,
): PersistAdmissionResult {
  assertChatTurnPayloadHash(intent);
  let existing = recordFor(intent.intentId);
  if (!existing && durable) {
    const persisted = database
      .select()
      .from(chatTurnIntents)
      .where(eq(chatTurnIntents.intentId, intent.intentId))
      .get();
    if (persisted) {
      existing = {
        intent: persisted.intent,
        chatId: persisted.chatId,
        payloadHash: persisted.payloadHash,
        acceptance: persisted.acceptance,
        recovery: persisted.recovery,
        acceptedMessageId: persisted.acceptedMessageId ?? undefined,
        durable: true,
      };
      intentRecords.set(intent.intentId, existing);
    }
  }
  if (existing) {
    assertMatchingIntent(existing, intent);
    return replay(existing);
  }
  const aggregate = queueFor(intent.chatId);
  assertQueueSnapshotWithinLimit([
    ...aggregate.intentIds.flatMap((intentId) => {
      const record = liveRecordFor(intentId);
      return record ? [toQueueEntry(record.intent)] : [];
    }),
    toQueueEntry(intent),
  ]);
  const nextRevision = aggregate.revision + 1;
  if (durable) {
    database.transaction((tx) => {
      tx.insert(chatQueueStates)
        .values({
          chatId: intent.chatId,
          revision: aggregate.revision,
          paused: aggregate.paused,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: chatQueueStates.chatId })
        .run();
      tx.insert(chatTurnIntents)
        .values({
          intentId: intent.intentId,
          chatId: intent.chatId,
          payloadHash: intent.payloadHash,
          intent,
          acceptance: "queued",
          recovery: "not-started",
          updatedAt: new Date(),
        })
        .run();
      const lastPosition = tx
        .select({ position: chatQueueEntries.position })
        .from(chatQueueEntries)
        .where(eq(chatQueueEntries.chatId, intent.chatId))
        .orderBy(desc(chatQueueEntries.position))
        .get()?.position;
      tx.insert(chatQueueEntries)
        .values({
          intentId: intent.intentId,
          chatId: intent.chatId,
          position: (lastPosition ?? -1) + 1,
          status: "queued",
        })
        .run();
      tx.update(chatQueueStates)
        .set({ revision: nextRevision, updatedAt: new Date() })
        .where(eq(chatQueueStates.chatId, intent.chatId))
        .run();
    });
  }
  intentRecords.set(intent.intentId, {
    intent,
    chatId: intent.chatId,
    payloadHash: intent.payloadHash,
    acceptance: "queued",
    recovery: "not-started",
    durable,
  });
  aggregate.intentIds.push(intent.intentId);
  aggregate.revision = nextRevision;
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
  return persistIntentInQueue(database, intent, intent.owner === undefined);
}

export function stageActiveIntent(
  _database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult | null {
  assertChatTurnPayloadHash(intent);
  const existing = recordFor(intent.intentId);
  if (existing) {
    assertMatchingIntent(existing, intent);
    if (
      existing.acceptance === "queued" &&
      !queueFor(intent.chatId).intentIds.includes(intent.intentId)
    ) {
      // The dispatcher has already claimed this queued turn. It is no longer
      // a duplicate admission and must continue into execution.
      return null;
    }
    return replay(existing);
  }
  if (intent.owner?.kind === "user-input-follow-up") {
    assertMatchingDueFollowUp(intent);
  }
  intentRecords.set(intent.intentId, {
    intent,
    chatId: intent.chatId,
    payloadHash: intent.payloadHash,
    acceptance: "queued",
    recovery: "not-started",
    durable: false,
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
    chatId: intent.chatId,
    payloadHash: intent.payloadHash,
    acceptance: "queued",
    recovery: "not-started",
    durable: false,
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

export function getRetainedIntentPayloadBytes(intentId: string): number {
  const intent = recordFor(intentId)?.intent;
  return intent ? serialize(intent).byteLength : 0;
}

export function persistAcceptedChatTurn(
  database: ChatPersistenceDatabase,
  intent: SerializableChatTurnIntent | undefined,
  intentId: string | undefined,
  acceptedMessageId: number,
): void {
  if (intent?.owner !== undefined) return;
  if (intent) assertChatTurnPayloadHash(intent);
  const durableIntentId = intent?.intentId ?? intentId;
  if (!durableIntentId) return;
  const existing = database
    .select()
    .from(chatTurnIntents)
    .where(eq(chatTurnIntents.intentId, durableIntentId))
    .get();
  if (existing && intent) {
    assertMatchingIntent(
      {
        intent: existing.intent,
        chatId: existing.chatId,
        payloadHash: existing.payloadHash,
        acceptance: existing.acceptance,
        recovery: existing.recovery,
        acceptedMessageId: existing.acceptedMessageId ?? undefined,
        durable: true,
      },
      intent,
    );
  } else if (intent) {
    database
      .insert(chatTurnIntents)
      .values({
        intentId: intent.intentId,
        chatId: intent.chatId,
        payloadHash: intent.payloadHash,
        intent: null,
        acceptance: "message-accepted",
        recovery: "started",
        acceptedMessageId,
        updatedAt: new Date(),
      })
      .run();
  }

  const queued = database
    .select({ status: chatQueueEntries.status })
    .from(chatQueueEntries)
    .where(eq(chatQueueEntries.intentId, durableIntentId))
    .get();
  database
    .update(chatTurnIntents)
    .set({
      acceptance: "message-accepted",
      recovery: "started",
      acceptedMessageId,
      intent: null,
      updatedAt: new Date(),
    })
    .where(eq(chatTurnIntents.intentId, durableIntentId))
    .run();
  if (queued) {
    database
      .delete(chatQueueEntries)
      .where(eq(chatQueueEntries.intentId, durableIntentId))
      .run();
    if (queued.status === "queued") {
      database
        .update(chatQueueStates)
        .set({
          revision: sql`${chatQueueStates.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(chatQueueStates.chatId, existing?.chatId ?? intent!.chatId))
        .run();
    }
  }
}

function persistDurableQueueMutation(
  database: ChatDatabase,
  chatId: number,
  aggregate: QueueAggregate,
  selected: SelectedQueueRecord[],
  mutation: Extract<
    ChatStreamHostCommand,
    { type: "mutate-queue" }
  >["mutation"],
): void {
  const state = database
    .select({ chatId: chatQueueStates.chatId })
    .from(chatQueueStates)
    .where(eq(chatQueueStates.chatId, chatId))
    .get();
  if (!state) return;

  database.transaction((tx) => {
    tx.update(chatQueueStates)
      .set({
        revision: aggregate.revision,
        paused: aggregate.paused,
        updatedAt: new Date(),
      })
      .where(eq(chatQueueStates.chatId, chatId))
      .run();

    const claimedEntries = tx
      .select({
        intentId: chatQueueEntries.intentId,
        position: chatQueueEntries.position,
      })
      .from(chatQueueEntries)
      .where(
        and(
          eq(chatQueueEntries.chatId, chatId),
          eq(chatQueueEntries.status, "claimed"),
        ),
      )
      .orderBy(asc(chatQueueEntries.position))
      .all();
    for (const [position, entry] of claimedEntries.entries()) {
      tx.update(chatQueueEntries)
        .set({ position })
        .where(eq(chatQueueEntries.intentId, entry.intentId))
        .run();
    }
    let durablePosition = claimedEntries.length;
    for (const intentId of aggregate.intentIds) {
      const record = liveRecordFor(intentId);
      if (!record?.durable) continue;
      tx.update(chatQueueEntries)
        .set({ position: durablePosition, status: "queued" })
        .where(eq(chatQueueEntries.intentId, intentId))
        .run();
      tx.update(chatTurnIntents)
        .set({
          intent: record.intent,
          payloadHash: record.payloadHash,
          updatedAt: new Date(),
        })
        .where(eq(chatTurnIntents.intentId, intentId))
        .run();
      durablePosition += 1;
    }

    if (mutation.type === "remove" || mutation.type === "clear") {
      for (const { record } of selected) {
        if (!record.durable) continue;
        tx.delete(chatQueueEntries)
          .where(eq(chatQueueEntries.intentId, record.intent.intentId))
          .run();
        tx.update(chatTurnIntents)
          .set({
            acceptance: "rejected",
            recovery: "terminal",
            intent: null,
            updatedAt: new Date(),
          })
          .where(eq(chatTurnIntents.intentId, record.intent.intentId))
          .run();
      }
    }
  });
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
  if (record.intent?.owner === undefined) record.durable = true;
  const aggregate = queueFor(record.chatId);
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
      const record = liveRecordFor(intentId);
      return record ? [{ record, entry: toQueueEntry(record.intent) }] : [];
    });
    const selected =
      mutation.type === "clear"
        ? entries.filter(({ entry }) => entry.removable)
        : "itemId" in mutation
          ? entries.filter(({ entry }) => entry.itemId === mutation.itemId)
          : [];
    if (
      mutation.type === "remove" &&
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
    const originalPaused = aggregate.paused;
    const originalRevision = aggregate.revision;
    const originalRecords = new Map(
      selected.map(({ record }) => [
        record,
        {
          intent: record.intent,
          payloadHash: record.payloadHash,
          acceptance: record.acceptance,
          recovery: record.recovery,
        },
      ]),
    );
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
        const updatedIntent = {
          ...withoutHash,
          payloadHash: computeChatTurnPayloadHash(withoutHash),
        };
        assertQueueSnapshotWithinLimit(
          entries.map(({ record }) =>
            record === selectedRecord
              ? toQueueEntry(updatedIntent)
              : toQueueEntry(record.intent),
          ),
        );
        selectedRecord.intent = updatedIntent;
        selectedRecord.payloadHash = updatedIntent.payloadHash;
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

    try {
      persistDurableQueueMutation(
        database,
        chatId,
        aggregate,
        selected,
        mutation,
      );
    } catch (error) {
      aggregate.intentIds = originalIntentIds;
      aggregate.paused = originalPaused;
      aggregate.revision = originalRevision;
      for (const [record, original] of originalRecords) {
        record.intent = original.intent;
        record.payloadHash = original.payloadHash;
        record.acceptance = original.acceptance;
        record.recovery = original.recovery;
      }
      throw error;
    }

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
    if (mutation.type === "remove" || mutation.type === "clear") {
      for (const { record } of selected) releaseIntentPayload(record);
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
  const aggregate = queueFor(record.chatId);
  const originalAggregate = {
    revision: aggregate.revision,
    paused: aggregate.paused,
    intentIds: [...aggregate.intentIds],
  };
  const originalRecord = {
    intent: record.intent,
    acceptance: record.acceptance,
    recovery: record.recovery,
  };
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
  if (record.durable) {
    try {
      database.transaction((tx) => {
        tx.delete(chatQueueEntries)
          .where(eq(chatQueueEntries.intentId, intent.intentId))
          .run();
        tx.update(chatTurnIntents)
          .set({
            acceptance: record.acceptance,
            recovery: "terminal",
            intent: null,
            updatedAt: new Date(),
          })
          .where(eq(chatTurnIntents.intentId, intent.intentId))
          .run();
        tx.update(chatQueueStates)
          .set({
            revision: aggregate.revision,
            paused: aggregate.paused,
            updatedAt: new Date(),
          })
          .where(eq(chatQueueStates.chatId, record.chatId))
          .run();
      });
    } catch (error) {
      aggregate.revision = originalAggregate.revision;
      aggregate.paused = originalAggregate.paused;
      aggregate.intentIds = originalAggregate.intentIds;
      record.intent = originalRecord.intent;
      record.acceptance = originalRecord.acceptance;
      record.recovery = originalRecord.recovery;
      throw error;
    }
  }
  const queue = loadChatQueue(database, record.chatId);
  // Terminal replay only needs the immutable identity/hash and acceptance
  // receipt retained above. Release prompts and base64 attachments immediately
  // so repeated large turns cannot grow main-process memory without bound.
  record.intent = null;
  return queue;
}

export async function claimQueueHead(
  database: ChatDatabase,
  chatId: number,
): Promise<{
  intent: SerializableChatTurnIntent;
  queue: ReturnType<typeof loadChatQueue>;
} | null> {
  return withChatQueueLock(chatId, async () => {
    const aggregate = queueFor(chatId);
    if (aggregate.paused) return null;
    const intentId = aggregate.intentIds[0];
    if (!intentId) return null;
    const record = liveRecordFor(intentId);
    if (!record) {
      aggregate.intentIds.shift();
      aggregate.revision += 1;
      return null;
    }
    const nextRevision = aggregate.revision + 1;
    if (record.durable) {
      database.transaction((tx) => {
        const claimed = tx
          .update(chatQueueEntries)
          .set({ status: "claimed" })
          .where(
            and(
              eq(chatQueueEntries.intentId, intentId),
              eq(chatQueueEntries.status, "queued"),
            ),
          )
          .run();
        if (claimed.changes !== 1) {
          throw new DyadError(
            "Queued chat intent could not be claimed",
            DyadErrorKind.Conflict,
          );
        }
        tx.update(chatQueueStates)
          .set({ revision: nextRevision, updatedAt: new Date() })
          .where(eq(chatQueueStates.chatId, chatId))
          .run();
      });
    }
    aggregate.intentIds.shift();
    aggregate.revision = nextRevision;
    return {
      intent: record.intent,
      queue: loadChatQueue(database, chatId),
    };
  });
}

export async function restoreClaimedQueueHead(
  database: ChatDatabase,
  chatId: number,
  intentId: string,
): Promise<ReturnType<typeof loadChatQueue>> {
  return withChatQueueLock(chatId, async () => {
    const aggregate = queueFor(chatId);
    const record = liveRecordFor(intentId);
    if (
      record?.acceptance === "queued" &&
      !aggregate.intentIds.includes(intentId)
    ) {
      const nextRevision = aggregate.revision + 1;
      if (record.durable) {
        database.transaction((tx) => {
          tx.update(chatQueueEntries)
            .set({ status: "queued", position: 0 })
            .where(eq(chatQueueEntries.intentId, intentId))
            .run();
          tx.update(chatQueueStates)
            .set({ revision: nextRevision, updatedAt: new Date() })
            .where(eq(chatQueueStates.chatId, chatId))
            .run();
        });
      }
      aggregate.intentIds.unshift(intentId);
      aggregate.revision = nextRevision;
    }
    return loadChatQueue(database, chatId);
  });
}
