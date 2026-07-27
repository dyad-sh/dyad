import { and, asc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { chatQueueEntries, chatQueueState, chatTurnIntents } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  hasMatchingDueFollowUp,
  rejectDueFollowUp,
} from "@/ipc/services/user_input_followup_service";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { ChatQueueEntry, SerializableChatTurnIntent } from "./transport";
import { ChatQueueEntrySchema } from "./transport";
import type { ChatStreamHostCommand } from "./host_state";

type ChatDatabase = BetterSQLite3Database<typeof schema>;

const sessionIntents = new Map<string, SerializableChatTurnIntent>();
const queueOrderByChat = new Map<number, string[]>();

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
    persistence:
      intent.owner?.kind === "user-input-follow-up"
        ? "main-session"
        : "durable",
    editable: intent.owner === undefined,
    removable: true,
  };
}

function readQueueRows(database: ChatDatabase, chatId: number) {
  return database
    .select()
    .from(chatQueueEntries)
    .where(eq(chatQueueEntries.chatId, chatId))
    .orderBy(asc(chatQueueEntries.position))
    .all();
}

function queueOrder(database: ChatDatabase, chatId: number): string[] {
  let order = queueOrderByChat.get(chatId);
  if (!order) {
    order = readQueueRows(database, chatId).map((row) => row.intentId);
    queueOrderByChat.set(chatId, order);
  }
  return order;
}

export function loadChatQueue(
  database: ChatDatabase,
  chatId: number,
): {
  queueRevision: number;
  queuePaused: boolean;
  queue: ChatQueueEntry[];
} {
  const queueState = database
    .select()
    .from(chatQueueState)
    .where(eq(chatQueueState.chatId, chatId))
    .get();
  const durable = new Map(
    readQueueRows(database, chatId).map((row) => [
      row.intentId,
      ChatQueueEntrySchema.parse(JSON.parse(row.payloadJson)),
    ]),
  );
  const order = queueOrder(database, chatId);
  const queue = order.flatMap((intentId) => {
    const durableEntry = durable.get(intentId);
    if (durableEntry) return [durableEntry];
    const sessionIntent = sessionIntents.get(intentId);
    return sessionIntent ? [toQueueEntry(sessionIntent)] : [];
  });
  queueOrderByChat.set(
    chatId,
    queue.map((entry) => entry.intentId),
  );
  return {
    queueRevision: queueState?.revision ?? 0,
    queuePaused: queueState?.paused ?? false,
    queue,
  };
}

export function hydrateChatStreamPersistence(
  database: ChatDatabase,
  chatId: number,
): ReturnType<typeof loadChatQueue> {
  database.transaction((tx) => {
    tx.update(chatTurnIntents)
      .set({ recovery: "interrupted", updatedAt: new Date() })
      .where(
        and(
          eq(chatTurnIntents.chatId, chatId),
          eq(chatTurnIntents.recovery, "started"),
        ),
      )
      .run();
    const state = tx
      .select()
      .from(chatQueueState)
      .where(eq(chatQueueState.chatId, chatId))
      .get();
    const hasQueue =
      tx
        .select({ itemId: chatQueueEntries.itemId })
        .from(chatQueueEntries)
        .where(eq(chatQueueEntries.chatId, chatId))
        .get() !== undefined;
    if (state && hasQueue && !state.paused) {
      tx.update(chatQueueState)
        .set({ paused: true, revision: state.revision + 1 })
        .where(eq(chatQueueState.chatId, chatId))
        .run();
    }
  });
  return loadChatQueue(database, chatId);
}

export function persistSessionQueuedIntent(
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult {
  assertChatTurnPayloadHash(intent);
  if (intent.owner?.kind !== "user-input-follow-up") {
    throw new DyadError(
      "Session queue requires a live user-input owner",
      DyadErrorKind.Validation,
    );
  }
  const owner = intent.owner;
  if (
    !hasMatchingDueFollowUp({
      requestId: owner.requestId,
      chatId: intent.chatId,
      prompt: intent.prompt,
    })
  ) {
    throw new DyadError(
      "No matching due user-input follow-up",
      DyadErrorKind.NotFound,
    );
  }
  const existing = sessionIntents.get(intent.intentId);
  if (existing) {
    if (
      existing.chatId !== intent.chatId ||
      existing.payloadHash !== intent.payloadHash
    ) {
      throw new DyadError(
        "Session intent id was reused with different content",
        DyadErrorKind.Conflict,
      );
    }
    return { kind: "replayed", acceptance: "queued" };
  }
  const queueRevision = database.transaction((tx) => {
    const state = tx
      .select()
      .from(chatQueueState)
      .where(eq(chatQueueState.chatId, intent.chatId))
      .get() ?? {
      chatId: intent.chatId,
      revision: 0,
      paused: false,
      legacyMigrated: false,
    };
    tx.insert(chatQueueState).values(state).onConflictDoNothing().run();
    const revision = state.revision + 1;
    tx.update(chatQueueState)
      .set({ revision })
      .where(eq(chatQueueState.chatId, intent.chatId))
      .run();
    return revision;
  });
  sessionIntents.set(intent.intentId, intent);
  queueOrder(database, intent.chatId).push(intent.intentId);
  return {
    kind: "queued",
    entry: toQueueEntry(intent),
    queueRevision,
  };
}

export function isSessionQueuedIntent(intentId: string): boolean {
  return sessionIntents.has(intentId);
}

export function completeSessionQueueAcceptance(intentId: string): void {
  const intent = sessionIntents.get(intentId);
  if (!intent) return;
  sessionIntents.delete(intentId);
  const order = queueOrderByChat.get(intent.chatId);
  if (order) {
    queueOrderByChat.set(
      intent.chatId,
      order.filter((candidate) => candidate !== intentId),
    );
  }
}

export function disposeSessionChatQueue(chatId: number): void {
  const order = queueOrderByChat.get(chatId) ?? [];
  for (const intentId of order) sessionIntents.delete(intentId);
  queueOrderByChat.delete(chatId);
}

export function importLegacyChatQueue(
  database: ChatDatabase,
  chatId: number,
  intents: readonly SerializableChatTurnIntent[],
): void {
  for (const intent of intents) assertChatTurnPayloadHash(intent);
  database.transaction((tx) => {
    const state = tx
      .select()
      .from(chatQueueState)
      .where(eq(chatQueueState.chatId, chatId))
      .get() ?? {
      chatId,
      revision: 0,
      paused: false,
      legacyMigrated: false,
    };
    if (state.legacyMigrated) return;
    tx.insert(chatQueueState).values(state).onConflictDoNothing().run();
    let position =
      tx
        .select({
          value: sql<number>`coalesce(max(${chatQueueEntries.position}), -1)`,
        })
        .from(chatQueueEntries)
        .where(eq(chatQueueEntries.chatId, chatId))
        .get()?.value ?? -1;
    for (const intent of intents) {
      if (intent.chatId !== chatId || intent.owner) {
        throw new DyadError(
          "Legacy queue contains an invalid durable owner",
          DyadErrorKind.Validation,
        );
      }
      const existing = tx
        .select()
        .from(chatTurnIntents)
        .where(eq(chatTurnIntents.intentId, intent.intentId))
        .get();
      if (existing) {
        if (
          existing.chatId !== chatId ||
          existing.payloadHash !== intent.payloadHash
        ) {
          throw new DyadError(
            "Legacy queue intent conflicts with durable state",
            DyadErrorKind.Conflict,
          );
        }
        continue;
      }
      const entry = toQueueEntry(intent);
      position += 1;
      tx.insert(chatTurnIntents)
        .values({
          intentId: intent.intentId,
          chatId,
          payloadHash: intent.payloadHash,
          envelopeJson: JSON.stringify(intent),
          acceptance: "queued",
          recovery: "not-started",
        })
        .run();
      tx.insert(chatQueueEntries)
        .values({
          itemId: entry.itemId,
          intentId: entry.intentId,
          chatId,
          position,
          payloadJson: JSON.stringify(entry),
          persistence: "durable",
        })
        .run();
    }
    tx.update(chatQueueState)
      .set({
        paused: intents.length > 0 || state.paused,
        revision: state.revision + (intents.length > 0 ? 1 : 0),
        legacyMigrated: true,
      })
      .where(eq(chatQueueState.chatId, chatId))
      .run();
  });
  queueOrderByChat.delete(chatId);
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

export function persistQueuedIntent(
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult {
  assertChatTurnPayloadHash(intent);
  if (intent.owner?.kind === "user-input-follow-up") {
    throw new DyadError(
      "Memory-owned follow-ups must use the live session queue",
      DyadErrorKind.Validation,
    );
  }
  const order = queueOrder(database, intent.chatId);
  const result = database.transaction((tx) => {
    const existing = tx
      .select()
      .from(chatTurnIntents)
      .where(eq(chatTurnIntents.intentId, intent.intentId))
      .get();
    if (existing) {
      if (
        existing.chatId !== intent.chatId ||
        existing.payloadHash !== intent.payloadHash
      ) {
        throw new DyadError(
          "Intent id was already used with a different immutable payload",
          DyadErrorKind.Conflict,
        );
      }
      return {
        kind: "replayed" as const,
        acceptance: existing.acceptance,
        ...(existing.acceptedMessageId === null
          ? {}
          : { acceptedMessageId: existing.acceptedMessageId }),
      };
    }

    const state = tx
      .insert(chatQueueState)
      .values({ chatId: intent.chatId, revision: 0, paused: false })
      .onConflictDoNothing()
      .returning()
      .get();
    const current =
      state ??
      tx
        .select()
        .from(chatQueueState)
        .where(eq(chatQueueState.chatId, intent.chatId))
        .get();
    if (!current) {
      throw new Error("Failed to initialize chat queue state");
    }
    const lastPosition =
      tx
        .select({
          value: sql<number>`coalesce(max(${chatQueueEntries.position}), -1)`,
        })
        .from(chatQueueEntries)
        .where(eq(chatQueueEntries.chatId, intent.chatId))
        .get()?.value ?? -1;
    const entry = toQueueEntry(intent);
    tx.insert(chatTurnIntents)
      .values({
        intentId: intent.intentId,
        chatId: intent.chatId,
        payloadHash: intent.payloadHash,
        envelopeJson: JSON.stringify(intent),
        acceptance: "queued",
        recovery: "not-started",
      })
      .run();
    tx.insert(chatQueueEntries)
      .values({
        itemId: entry.itemId,
        intentId: entry.intentId,
        chatId: intent.chatId,
        position: lastPosition + 1,
        payloadJson: JSON.stringify(entry),
        persistence: entry.persistence,
      })
      .run();
    const nextRevision = current.revision + 1;
    tx.update(chatQueueState)
      .set({ revision: nextRevision })
      .where(eq(chatQueueState.chatId, intent.chatId))
      .run();
    return { kind: "queued" as const, entry, queueRevision: nextRevision };
  });
  if (result.kind === "queued" && !order.includes(intent.intentId)) {
    order.push(intent.intentId);
  }
  return result;
}

export function stageActiveIntent(
  database: ChatDatabase,
  intent: SerializableChatTurnIntent,
): PersistAdmissionResult | null {
  assertChatTurnPayloadHash(intent);
  if (intent.owner?.kind === "user-input-follow-up") return null;
  return database.transaction((tx) => {
    const existing = tx
      .select()
      .from(chatTurnIntents)
      .where(eq(chatTurnIntents.intentId, intent.intentId))
      .get();
    if (existing) {
      if (
        existing.chatId !== intent.chatId ||
        existing.payloadHash !== intent.payloadHash
      ) {
        throw new DyadError(
          "Intent id was already used with a different immutable payload",
          DyadErrorKind.Conflict,
        );
      }
      return {
        kind: "replayed" as const,
        acceptance: existing.acceptance,
        ...(existing.acceptedMessageId === null
          ? {}
          : { acceptedMessageId: existing.acceptedMessageId }),
      };
    }
    tx.insert(chatTurnIntents)
      .values({
        intentId: intent.intentId,
        chatId: intent.chatId,
        payloadHash: intent.payloadHash,
        envelopeJson: JSON.stringify(intent),
        acceptance: "queued",
        recovery: "not-started",
      })
      .run();
    return null;
  });
}

function rewriteQueuePositions(
  tx: Parameters<Parameters<ChatDatabase["transaction"]>[0]>[0],
  chatId: number,
  rows: ReturnType<typeof readQueueRows>,
): void {
  rows.forEach((row, index) => {
    tx.update(chatQueueEntries)
      .set({ position: -index - 1 })
      .where(eq(chatQueueEntries.itemId, row.itemId))
      .run();
  });
  rows.forEach((row, index) => {
    tx.update(chatQueueEntries)
      .set({ position: index })
      .where(eq(chatQueueEntries.itemId, row.itemId))
      .run();
  });
}

export async function mutateChatQueue(
  database: ChatDatabase,
  chatId: number,
  command: Extract<ChatStreamHostCommand, { type: "mutate-queue" }>,
): Promise<ReturnType<typeof loadChatQueue>> {
  const ownersToReject: string[] = [];
  const mutation = command.mutation;
  const aggregateQueue = loadChatQueue(database, chatId).queue;
  const sessionEntries = aggregateQueue.filter(
    (entry) =>
      entry.persistence === "main-session" &&
      (mutation.type === "clear" ||
        ("itemId" in mutation && mutation.itemId === entry.itemId)),
  );
  if (
    (mutation.type === "edit" || mutation.type === "reorder") &&
    sessionEntries.length > 0
  ) {
    throw new DyadError(
      "Machine-owned queued messages cannot be edited or reordered",
      DyadErrorKind.Precondition,
    );
  }
  for (const entry of sessionEntries) {
    const owner = sessionIntents.get(entry.intentId)?.owner;
    if (owner?.kind === "user-input-follow-up") {
      await rejectDueFollowUp(owner.requestId);
    }
  }
  let nextOrder: string[] | undefined;
  database.transaction((tx) => {
    const state = tx
      .select()
      .from(chatQueueState)
      .where(eq(chatQueueState.chatId, chatId))
      .get() ?? { chatId, revision: 0, paused: false };
    if (state.revision !== command.expectedQueueRevision) {
      throw new DyadError(
        "Chat queue changed in another window",
        DyadErrorKind.Conflict,
      );
    }
    tx.insert(chatQueueState).values(state).onConflictDoNothing().run();
    const rows = tx
      .select()
      .from(chatQueueEntries)
      .where(eq(chatQueueEntries.chatId, chatId))
      .orderBy(asc(chatQueueEntries.position))
      .all();
    let nextRows = rows;
    let paused = state.paused;
    switch (mutation.type) {
      case "pause":
        paused = true;
        break;
      case "resume":
        paused = false;
        break;
      case "edit": {
        const row = rows.find(
          (candidate) => candidate.itemId === mutation.itemId,
        );
        if (!row) {
          throw new DyadError(
            "Queued message not found",
            DyadErrorKind.NotFound,
          );
        }
        const entry = ChatQueueEntrySchema.parse(JSON.parse(row.payloadJson));
        if (!entry.editable) {
          throw new DyadError(
            "Machine-owned queued messages cannot be edited",
            DyadErrorKind.Precondition,
          );
        }
        const updated = {
          ...entry,
          prompt: mutation.prompt,
          attachments: mutation.attachments,
          selectedComponents: mutation.selectedComponents,
        };
        const intentRow = tx
          .select({ envelopeJson: chatTurnIntents.envelopeJson })
          .from(chatTurnIntents)
          .where(eq(chatTurnIntents.intentId, entry.intentId))
          .get();
        if (!intentRow) {
          throw new Error("Queued message is missing its owning intent");
        }
        const currentIntent = JSON.parse(
          intentRow.envelopeJson,
        ) as SerializableChatTurnIntent;
        const updatedIntentWithoutHash = {
          ...currentIntent,
          prompt: mutation.prompt,
          attachments: mutation.attachments,
          selectedComponents: mutation.selectedComponents,
        };
        const updatedIntent: SerializableChatTurnIntent = {
          ...updatedIntentWithoutHash,
          payloadHash: computeChatTurnPayloadHash(updatedIntentWithoutHash),
        };
        tx.update(chatQueueEntries)
          .set({ payloadJson: JSON.stringify(updated) })
          .where(eq(chatQueueEntries.itemId, row.itemId))
          .run();
        tx.update(chatTurnIntents)
          .set({
            envelopeJson: JSON.stringify(updatedIntent),
            payloadHash: updatedIntent.payloadHash,
            updatedAt: new Date(),
          })
          .where(eq(chatTurnIntents.intentId, entry.intentId))
          .run();
        break;
      }
      case "reorder": {
        const order = aggregateQueue.map((entry) => entry.intentId);
        const from = order.indexOf(mutation.itemId);
        if (from < 0 || mutation.toIndex >= order.length) {
          throw new DyadError(
            "Queued message reorder is out of range",
            DyadErrorKind.Validation,
          );
        }
        nextOrder = [...order];
        const [moved] = nextOrder.splice(from, 1);
        nextOrder.splice(mutation.toIndex, 0, moved);
        const rowByIntent = new Map(rows.map((row) => [row.intentId, row]));
        nextRows = nextOrder.flatMap((intentId) => {
          const row = rowByIntent.get(intentId);
          return row ? [row] : [];
        });
        rewriteQueuePositions(tx, chatId, nextRows);
        break;
      }
      case "remove":
      case "clear": {
        const removed =
          mutation.type === "clear"
            ? rows
            : rows.filter((candidate) => candidate.itemId === mutation.itemId);
        if (
          mutation.type === "remove" &&
          removed.length === 0 &&
          sessionEntries.length === 0
        ) {
          throw new DyadError(
            "Queued message not found",
            DyadErrorKind.NotFound,
          );
        }
        for (const row of removed) {
          const entry = ChatQueueEntrySchema.parse(JSON.parse(row.payloadJson));
          if (entry.persistence === "main-session") {
            const intent = JSON.parse(
              tx
                .select({ envelopeJson: chatTurnIntents.envelopeJson })
                .from(chatTurnIntents)
                .where(eq(chatTurnIntents.intentId, entry.intentId))
                .get()?.envelopeJson ?? "{}",
            ) as SerializableChatTurnIntent;
            if (intent.owner?.kind === "user-input-follow-up") {
              ownersToReject.push(intent.owner.requestId);
            }
          }
          tx.delete(chatQueueEntries)
            .where(eq(chatQueueEntries.itemId, row.itemId))
            .run();
          tx.update(chatTurnIntents)
            .set({ acceptance: "rejected", updatedAt: new Date() })
            .where(eq(chatTurnIntents.intentId, row.intentId))
            .run();
        }
        nextRows = rows.filter(
          (row) =>
            !removed.some((removedRow) => removedRow.itemId === row.itemId),
        );
        const removedIds = new Set([
          ...removed.map((row) => row.intentId),
          ...sessionEntries.map((entry) => entry.intentId),
        ]);
        nextOrder = aggregateQueue
          .map((entry) => entry.intentId)
          .filter((intentId) => !removedIds.has(intentId));
        rewriteQueuePositions(tx, chatId, nextRows);
        break;
      }
    }
    tx.update(chatQueueState)
      .set({ revision: state.revision + 1, paused })
      .where(eq(chatQueueState.chatId, chatId))
      .run();
  });
  for (const requestId of ownersToReject) {
    await rejectDueFollowUp(requestId);
  }
  if (nextOrder) queueOrderByChat.set(chatId, nextOrder);
  for (const entry of sessionEntries) {
    completeSessionQueueAcceptance(entry.intentId);
  }
  return loadChatQueue(database, chatId);
}

export function markIntentTerminal(
  database: ChatDatabase,
  intentId: string,
  pauseQueue: boolean,
): ReturnType<typeof loadChatQueue> {
  const intent = database
    .select()
    .from(chatTurnIntents)
    .where(eq(chatTurnIntents.intentId, intentId))
    .get();
  if (!intent) {
    throw new DyadError("Chat turn intent not found", DyadErrorKind.NotFound);
  }
  database.transaction((tx) => {
    tx.update(chatTurnIntents)
      .set({ recovery: "terminal", updatedAt: new Date() })
      .where(eq(chatTurnIntents.intentId, intentId))
      .run();
    const state = tx
      .select()
      .from(chatQueueState)
      .where(eq(chatQueueState.chatId, intent.chatId))
      .get() ?? { chatId: intent.chatId, revision: 0, paused: false };
    tx.insert(chatQueueState).values(state).onConflictDoNothing().run();
    tx.update(chatQueueState)
      .set({
        revision: state.revision + (pauseQueue && !state.paused ? 1 : 0),
        paused: state.paused || pauseQueue,
      })
      .where(eq(chatQueueState.chatId, intent.chatId))
      .run();
  });
  return loadChatQueue(database, intent.chatId);
}

export function peekQueueHead(
  database: ChatDatabase,
  chatId: number,
): SerializableChatTurnIntent | null {
  const state = database
    .select()
    .from(chatQueueState)
    .where(eq(chatQueueState.chatId, chatId))
    .get();
  if (state?.paused) return null;
  const firstIntentId = loadChatQueue(database, chatId).queue[0]?.intentId;
  if (!firstIntentId) return null;
  const sessionIntent = sessionIntents.get(firstIntentId);
  if (sessionIntent) return sessionIntent;
  const head = database
    .select()
    .from(chatQueueEntries)
    .where(
      and(
        eq(chatQueueEntries.chatId, chatId),
        eq(chatQueueEntries.intentId, firstIntentId),
      ),
    )
    .get();
  if (!head) return null;
  const intent = database
    .select()
    .from(chatTurnIntents)
    .where(
      and(
        eq(chatTurnIntents.intentId, head.intentId),
        eq(chatTurnIntents.chatId, chatId),
      ),
    )
    .get();
  if (!intent) {
    throw new Error("Queued chat intent is missing its owning record");
  }
  return JSON.parse(intent.envelopeJson) as SerializableChatTurnIntent;
}
