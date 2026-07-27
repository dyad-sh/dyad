import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { apps, chats, planHandoffs } from "@/db/schema";
import type { DistributedMachineDefinition } from "@/distributed_machines/definition";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createChatForApp } from "@/ipc/utils/chat_creation_utils";
import { savePlanToDisk } from "@/ipc/handlers/planPersistence";
import { getDyadAppPath } from "@/paths/paths";
import {
  publishChatInvalidations,
  routePlanHandoffPresentation,
} from "@/ipc/services/chat_actor_platform";
import {
  dispatchPlanImplementationTurn,
  waitForChatActorIdle,
} from "@/ipc/services/chat_actor_service";
import {
  PLAN_HANDOFF_MACHINE_ID,
  PlanHandoffIntentEventSchema,
  PlanHandoffKeySchema,
  PlanHandoffRemoteSnapshotSchema,
  planHandoffKey,
  serializePlanDocument,
  type PlanHandoffIntent,
  type PlanHandoffKey,
  type PlanHandoffRemoteSnapshot,
} from "./transport";
import {
  type PlanHandoffCommand,
  type PlanHandoffHostEvent,
  type PlanHandoffHostState,
  type PlanHandoffIgnoreReason,
} from "./host_state";
import {
  PLAN_HANDOFF_DISPLAY_MS,
  transitionPlanHandoffHost,
} from "./host_transition";

function decodeState(sourceChatId: number): PlanHandoffHostState {
  const row = db
    .select()
    .from(planHandoffs)
    .where(eq(planHandoffs.sourceChatId, sourceChatId))
    .orderBy(desc(planHandoffs.id))
    .get();
  if (!row) {
    return {
      intent: null,
      targetChatId: null,
      phase: "idle",
      failure: null,
    };
  }
  return {
    intent: JSON.parse(row.planJson) as PlanHandoffIntent,
    targetChatId: row.targetChatId,
    phase: row.phase,
    failure: row.failure,
  };
}

function assertPlanHash(intent: PlanHandoffIntent): void {
  const actual = createHash("sha256")
    .update(serializePlanDocument(intent.plan))
    .digest("hex");
  if (actual !== intent.planHash || intent.planVersion !== actual) {
    throw new DyadError(
      "Plan handoff payload does not match its immutable version",
      DyadErrorKind.Validation,
    );
  }
}

function checkpoint(
  handoffId: string,
  phase: Exclude<PlanHandoffRemoteSnapshot["phase"], "idle">,
  targetChatId?: number,
  failure?: string,
): void {
  db.update(planHandoffs)
    .set({
      phase,
      ...(targetChatId === undefined ? {} : { targetChatId }),
      failure: failure ?? null,
      revision:
        1 +
        (db
          .select({ revision: planHandoffs.revision })
          .from(planHandoffs)
          .where(eq(planHandoffs.handoffId, handoffId))
          .get()?.revision ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(planHandoffs.handoffId, handoffId))
    .run();
}

function persistAcceptance(
  intent: PlanHandoffIntent,
): typeof planHandoffs.$inferSelect {
  assertPlanHash(intent);
  const existing = db
    .select()
    .from(planHandoffs)
    .where(eq(planHandoffs.handoffId, intent.handoffId))
    .get();
  if (existing) {
    if (!isMatchingPlanHandoffReplay(existing, intent)) {
      throw new DyadError(
        "Plan handoff id was reused with different content",
        DyadErrorKind.Conflict,
      );
    }
    return existing;
  }
  return db
    .insert(planHandoffs)
    .values({
      handoffId: intent.handoffId,
      sourceChatId: intent.sourceChatId,
      appId: intent.appId,
      planId: intent.planId,
      planVersion: intent.planVersion,
      planJson: JSON.stringify(intent),
      acceptInNewChat: intent.acceptInNewChat,
      phase: "accepted",
    })
    .returning()
    .get();
}

export function isMatchingPlanHandoffReplay(
  existing: Pick<
    typeof planHandoffs.$inferSelect,
    "sourceChatId" | "planVersion" | "acceptInNewChat"
  >,
  intent: PlanHandoffIntent,
): boolean {
  return (
    existing.sourceChatId === intent.sourceChatId &&
    existing.planVersion === intent.planVersion &&
    existing.acceptInNewChat === intent.acceptInNewChat
  );
}

function createCommandRunner(
  context: Parameters<
    NonNullable<
      DistributedMachineDefinition<
        typeof PLAN_HANDOFF_MACHINE_ID,
        PlanHandoffKey,
        PlanHandoffHostState,
        PlanHandoffHostEvent,
        PlanHandoffCommand,
        PlanHandoffIgnoreReason
      >["createCommandRunner"]
    >
  >[0],
) {
  context.send({ type: "RESUME" });
  return async (
    command: PlanHandoffCommand,
    emit: (event: PlanHandoffHostEvent) => void,
  ) => {
    const { intent } = command;
    const taskKey = `handoff:${intent.handoffId}`;
    if (command.type === "begin-handoff") {
      try {
        persistAcceptance(intent);
        context.timers.replace(
          taskKey,
          intent.handoffId,
          PLAN_HANDOFF_DISPLAY_MS,
          () => ({
            type: "DISPLAY_ELAPSED",
            handoffId: intent.handoffId,
          }),
          emit,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "FAILED", handoffId: intent.handoffId, error: message });
      }
      return;
    }
    const abortController = new AbortController();
    context.tasks.replace(taskKey, () => abortController.abort());
    const { signal } = abortController;
    let ownedTargetChatId: number | null = null;
    try {
      signal.throwIfAborted();
      let row = persistAcceptance(intent);
      if (
        row.phase === "started" ||
        row.phase === "failed" ||
        row.phase === "cancelled"
      ) {
        return;
      }
      emit({
        type: "CHECKPOINT",
        handoffId: intent.handoffId,
        phase: row.phase,
        ...(row.targetChatId === null
          ? {}
          : { targetChatId: row.targetChatId }),
      });

      let planSlug: string;
      if (row.phase === "accepted" || row.phase === "persisting") {
        checkpoint(intent.handoffId, "persisting");
        emit({
          type: "CHECKPOINT",
          handoffId: intent.handoffId,
          phase: "persisting",
        });
        const app = db
          .select({ path: apps.path })
          .from(apps)
          .where(eq(apps.id, intent.appId))
          .get();
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        planSlug = await savePlanToDisk({
          appPath: getDyadAppPath(app.path),
          chatId: intent.sourceChatId,
          title: intent.plan.title,
          summary: intent.plan.summary,
          content: intent.plan.content,
          status: "accepted",
        });
        signal.throwIfAborted();
        checkpoint(intent.handoffId, "preparing-chat");
      } else {
        const app = db
          .select({ path: apps.path })
          .from(apps)
          .where(eq(apps.id, intent.appId))
          .get();
        if (!app) {
          throw new DyadError("App not found", DyadErrorKind.NotFound);
        }
        planSlug = await savePlanToDisk({
          appPath: getDyadAppPath(app.path),
          chatId: intent.sourceChatId,
          title: intent.plan.title,
          summary: intent.plan.summary,
          content: intent.plan.content,
          status: "accepted",
        });
        signal.throwIfAborted();
      }

      row = db
        .select()
        .from(planHandoffs)
        .where(eq(planHandoffs.handoffId, intent.handoffId))
        .get()!;
      let targetChatId = row.targetChatId;
      if (!targetChatId) {
        if (intent.acceptInNewChat) {
          targetChatId = await createChatForApp({
            appId: intent.appId,
            initialChatMode: "local-agent",
            planHandoffId: intent.handoffId,
          });
          ownedTargetChatId = targetChatId;
          signal.throwIfAborted();
        } else {
          targetChatId = intent.sourceChatId;
          db.update(chats)
            .set({ chatMode: "local-agent" })
            .where(eq(chats.id, targetChatId))
            .run();
        }
        checkpoint(intent.handoffId, "awaiting-stream-idle", targetChatId);
      }
      emit({
        type: "CHECKPOINT",
        handoffId: intent.handoffId,
        phase: "awaiting-stream-idle",
        targetChatId,
      });
      routePlanHandoffPresentation({
        handoffId: intent.handoffId,
        sourceChatId: intent.sourceChatId,
        targetChatId,
        appId: intent.appId,
        originWindowSessionId: intent.originWindowSessionId,
      });
      await waitForChatActorIdle(targetChatId, {
        cancelActive: targetChatId === intent.sourceChatId,
        signal,
      });

      checkpoint(intent.handoffId, "submitting", targetChatId);
      emit({
        type: "CHECKPOINT",
        handoffId: intent.handoffId,
        phase: "submitting",
        targetChatId,
      });
      await dispatchPlanImplementationTurn({
        handoffId: intent.handoffId,
        targetChatId,
        appId: intent.appId,
        planSlug,
        originWindowSessionId: intent.originWindowSessionId,
        signal,
      });
      checkpoint(intent.handoffId, "started", targetChatId);
      emit({
        type: "CHECKPOINT",
        handoffId: intent.handoffId,
        phase: "started",
        targetChatId,
      });
      publishChatInvalidations(targetChatId);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      checkpoint(intent.handoffId, "failed", undefined, message);
      emit({ type: "FAILED", handoffId: intent.handoffId, error: message });
    } finally {
      if (
        ownedTargetChatId !== null &&
        !db
          .select({ handoffId: planHandoffs.handoffId })
          .from(planHandoffs)
          .where(eq(planHandoffs.handoffId, intent.handoffId))
          .get()
      ) {
        db.delete(chats)
          .where(
            and(
              eq(chats.id, ownedTargetChatId),
              eq(chats.planHandoffId, intent.handoffId),
            ),
          )
          .run();
      }
      context.tasks.remove(taskKey);
    }
  };
}

function requireSourceChat(sourceChatId: number, appId?: number): void {
  const chat = db
    .select({ appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, sourceChatId))
    .get();
  if (!chat || (appId !== undefined && chat.appId !== appId)) {
    throw new DyadError(
      "Plan handoff chat is not authorized",
      DyadErrorKind.Auth,
    );
  }
}

export const planHandoffDefinition = {
  id: PLAN_HANDOFF_MACHINE_ID,
  host: "main",
  initialState: (key) => decodeState(key.sourceChatId),
  transition: (state, event) => transitionPlanHandoffHost(state, event),
  createScheduler: () => ({
    schedule(batch, execute) {
      for (const command of batch.commands) {
        void execute(command).catch((error) => {
          console.error("[plan-handoff] Host command failed", {
            command: command.type,
            error,
          });
        });
      }
    },
  }),
  createCommandRunner,
  lifecycle: {
    subscriptionCreates: true,
    dispatchCreates: false,
    idleEviction: { kind: "retain" },
    terminalRetention: { kind: "retain" },
    entityDeletion: "dispose",
    rendererOwnership: "host",
    survivesRendererReload: true,
    restartPersistence: "persistent",
    flushOnShutdown: true,
  },
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: PlanHandoffKeySchema,
    encodeKey: (key) => key,
    canonicalizeKeyAfterAuthorization: (key) =>
      planHandoffKey(key.sourceChatId),
    eventCodec: PlanHandoffIntentEventSchema as z.ZodType<PlanHandoffHostEvent>,
    snapshotCodec: PlanHandoffRemoteSnapshotSchema,
    keyToString: (key) => String(key.sourceChatId),
    projectSnapshot: (state, key, metadata) => ({
      schemaVersion: 1 as const,
      sourceChatId: key.sourceChatId,
      revision: metadata.snapshotRevision,
      handoffId: state.intent?.handoffId ?? null,
      targetChatId: state.targetChatId,
      planId: state.intent?.planId ?? null,
      phase: state.phase,
      failure: state.failure,
    }),
    unavailableSnapshot: (key) => ({
      schemaVersion: 1 as const,
      sourceChatId: key.sourceChatId,
      revision: 0,
      handoffId: null,
      targetChatId: null,
      planId: null,
      phase: "idle" as const,
      failure: null,
    }),
    revisionPolicy: () => "allow-stale" as const,
    authorizeSubscribe: ({ key }) => requireSourceChat(key.sourceChatId),
    authorizeDispatch: ({ sender, key, event }) => {
      if (event.type !== "ACCEPT") return;
      requireSourceChat(key.sourceChatId, event.intent.appId);
      if (event.intent.sourceChatId !== key.sourceChatId) {
        throw new DyadError(
          "Plan handoff does not belong to the routed chat",
          DyadErrorKind.Auth,
        );
      }
      if (
        event.intent.originWindowSessionId &&
        event.intent.originWindowSessionId !== sender.windowSessionId
      ) {
        throw new DyadError(
          "Plan handoff origin does not match the sender",
          DyadErrorKind.Auth,
        );
      }
      event.intent.originWindowSessionId = sender.windowSessionId;
    },
  },
} satisfies DistributedMachineDefinition<
  typeof PLAN_HANDOFF_MACHINE_ID,
  PlanHandoffKey,
  PlanHandoffHostState,
  PlanHandoffHostEvent,
  PlanHandoffCommand,
  PlanHandoffIgnoreReason
>;
