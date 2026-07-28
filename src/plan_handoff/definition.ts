import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { apps, chats } from "@/db/schema";
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
import { assertChatActorAdmissionOpen } from "@/ipc/services/chat_actor_deletion_fence";
import {
  PLAN_HANDOFF_MACHINE_ID,
  PlanHandoffIntentEventSchema,
  PlanHandoffKeySchema,
  PlanHandoffRemoteSnapshotSchema,
  planHandoffKey,
  serializePlanDocument,
  type PlanHandoffIntent,
  type PlanHandoffKey,
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

function initialState(_key?: PlanHandoffKey): PlanHandoffHostState {
  return {
    intent: null,
    targetChatId: null,
    phase: "idle",
    failure: null,
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
        assertPlanHash(intent);
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
      assertPlanHash(intent);
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
      const planSlug = await savePlanToDisk({
        appPath: getDyadAppPath(app.path),
        chatId: intent.sourceChatId,
        title: intent.plan.title,
        summary: intent.plan.summary,
        content: intent.plan.content,
        status: "accepted",
      });
      signal.throwIfAborted();
      emit({
        type: "CHECKPOINT",
        handoffId: intent.handoffId,
        phase: "preparing-chat",
      });

      let targetChatId = context.getSnapshot().targetChatId;
      if (!targetChatId) {
        if (intent.acceptInNewChat) {
          targetChatId = await createChatForApp({
            appId: intent.appId,
            initialChatMode: "local-agent",
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
      emit({ type: "FAILED", handoffId: intent.handoffId, error: message });
    } finally {
      if (signal.aborted && ownedTargetChatId !== null) {
        db.delete(chats).where(eq(chats.id, ownedTargetChatId)).run();
      }
      context.tasks.remove(taskKey);
    }
  };
}

function requireSourceChat(sourceChatId: number, appId?: number): void {
  assertChatActorAdmissionOpen(sourceChatId);
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
  initialState,
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
    restartPersistence: "ephemeral",
    flushOnShutdown: false,
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
