import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  userInputFollowUpHandoffs,
  type UserInputFollowUpHandoffStatus,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const SCHEMA_VERSION = 1;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const NONTERMINAL_STATUSES = [
  "created",
  "accepted",
  "executing",
] as const satisfies readonly UserInputFollowUpHandoffStatus[];

type HandoffDatabase = Pick<
  BetterSQLite3Database<typeof schema>,
  "delete" | "insert" | "select" | "transaction" | "update"
>;

export interface UserInputFollowUpHandoffPayload {
  requestId: string;
  chatId: number;
  prompt: string;
}

export interface UserInputFollowUpHandoffStore {
  recoverOwnerSession(): void;
  create(payload: UserInputFollowUpHandoffPayload): void;
  accept(payload: UserInputFollowUpHandoffPayload): void;
  beginExecution(requestId: string): void;
  retry(requestId: string, error: string): void;
  reject(requestId: string, reason: string): void;
}

function assertSamePayload(
  existing: {
    chatId: number;
    prompt: string;
    schemaVersion: number;
    ownerSessionId: string;
    status: UserInputFollowUpHandoffStatus;
  },
  ownerSessionId: string,
  payload: UserInputFollowUpHandoffPayload,
): void {
  if (
    existing.schemaVersion !== SCHEMA_VERSION ||
    existing.ownerSessionId !== ownerSessionId ||
    existing.chatId !== payload.chatId ||
    existing.prompt !== payload.prompt
  ) {
    throw new DyadError(
      `User-input handoff idempotency collision: ${payload.requestId}`,
      DyadErrorKind.Conflict,
    );
  }
  if (existing.status === "rejected") {
    throw new DyadError(
      `User-input handoff was rejected: ${payload.requestId}`,
      DyadErrorKind.Conflict,
    );
  }
}

export function createUserInputFollowUpHandoffStore(
  database: HandoffDatabase,
  ownerSessionId: string,
  now: () => Date = () => new Date(),
): UserInputFollowUpHandoffStore {
  const get = (requestId: string) =>
    database
      .select()
      .from(userInputFollowUpHandoffs)
      .where(eq(userInputFollowUpHandoffs.requestId, requestId))
      .get();

  const requireOwned = (requestId: string) => {
    const record = get(requestId);
    if (!record || record.ownerSessionId !== ownerSessionId) {
      throw new DyadError(
        `No live user-input handoff: ${requestId}`,
        DyadErrorKind.NotFound,
      );
    }
    return record;
  };

  return {
    recoverOwnerSession() {
      const timestamp = now();
      database.transaction((tx) => {
        tx.update(userInputFollowUpHandoffs)
          .set({
            status: "rejected",
            lastError: "owning main-process session ended",
            updatedAt: timestamp,
            settledAt: timestamp,
          })
          .where(
            and(
              ne(userInputFollowUpHandoffs.ownerSessionId, ownerSessionId),
              inArray(userInputFollowUpHandoffs.status, [
                ...NONTERMINAL_STATUSES,
              ]),
            ),
          )
          .run();
        tx.delete(userInputFollowUpHandoffs)
          .where(
            and(
              isNotNull(userInputFollowUpHandoffs.settledAt),
              lt(
                userInputFollowUpHandoffs.settledAt,
                new Date(timestamp.getTime() - TERMINAL_RETENTION_MS),
              ),
            ),
          )
          .run();
      });
    },

    create(payload) {
      const timestamp = now();
      database
        .insert(userInputFollowUpHandoffs)
        .values({
          ...payload,
          schemaVersion: SCHEMA_VERSION,
          ownerSessionId,
          status: "created",
          updatedAt: timestamp,
        })
        .onConflictDoNothing()
        .run();
      const existing = requireOwned(payload.requestId);
      assertSamePayload(existing, ownerSessionId, payload);
    },

    accept(payload) {
      database.transaction((tx) => {
        const existing = tx
          .select()
          .from(userInputFollowUpHandoffs)
          .where(eq(userInputFollowUpHandoffs.requestId, payload.requestId))
          .get();
        if (!existing) {
          throw new DyadError(
            `No created user-input handoff: ${payload.requestId}`,
            DyadErrorKind.NotFound,
          );
        }
        assertSamePayload(existing, ownerSessionId, payload);
        if (existing.status === "created") {
          tx.update(userInputFollowUpHandoffs)
            .set({ status: "accepted", updatedAt: now(), lastError: null })
            .where(eq(userInputFollowUpHandoffs.requestId, payload.requestId))
            .run();
        }
      });
    },

    beginExecution(requestId) {
      const record = requireOwned(requestId);
      if (record.status === "acknowledged") return;
      if (record.status !== "accepted" && record.status !== "executing") {
        throw new DyadError(
          `User-input handoff is not accepted: ${requestId}`,
          DyadErrorKind.Conflict,
        );
      }
      database
        .update(userInputFollowUpHandoffs)
        .set({
          status: "executing",
          attemptCount: record.attemptCount + 1,
          lastError: null,
          updatedAt: now(),
        })
        .where(eq(userInputFollowUpHandoffs.requestId, requestId))
        .run();
    },

    retry(requestId, error) {
      const record = requireOwned(requestId);
      if (record.status === "acknowledged" || record.status === "rejected") {
        return;
      }
      database
        .update(userInputFollowUpHandoffs)
        .set({ status: "accepted", lastError: error, updatedAt: now() })
        .where(eq(userInputFollowUpHandoffs.requestId, requestId))
        .run();
    },

    reject(requestId, reason) {
      const record = requireOwned(requestId);
      if (record.status === "acknowledged" || record.status === "rejected") {
        return;
      }
      const timestamp = now();
      database
        .update(userInputFollowUpHandoffs)
        .set({
          status: "rejected",
          lastError: reason,
          updatedAt: timestamp,
          settledAt: timestamp,
        })
        .where(eq(userInputFollowUpHandoffs.requestId, requestId))
        .run();
    },
  };
}
