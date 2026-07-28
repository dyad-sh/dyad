import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { chatStreamDefinition } from "@/chat_stream/definition";
import { getIntentAcceptance } from "@/chat_stream/persistence";
import {
  chatStreamKey,
  type ChatStreamWireEvent,
  type SerializableChatTurnIntent,
} from "@/chat_stream/transport";
import type { ChatStreamHostState } from "@/chat_stream/host_state";
import type { ChatStreamHostIgnoreReason } from "@/chat_stream/host_transition";
import {
  beginChatActorDeletion,
  beginChatActorMutation,
} from "./chat_actor_deletion_fence";
import { beginAppChatMutation } from "./app_chat_creation_fence";
import { userInputRegistry } from "@/user_input/main";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  PLAN_HANDOFF_MACHINE_ID,
  planHandoffKey,
} from "@/plan_handoff/transport";
import { entityDisposalBus } from "@/window_infrastructure/main/entity_disposal_bus";

export async function settleChatActorsForDeletion(
  chatId: number,
): Promise<void> {
  await remoteMachineHost.entityDeleted(
    PLAN_HANDOFF_MACHINE_ID,
    planHandoffKey(chatId),
  );
  await waitForChatActorIdle(chatId, { cancelActive: true });
  await remoteMachineHost.entityDeleted(
    chatStreamDefinition.id,
    chatStreamKey(chatId),
  );
}

export async function deleteOwnedChatAfterSettlingActors(
  chatId: number,
): Promise<void> {
  const releaseAdmission = beginChatActorDeletion(chatId);
  try {
    await userInputRegistry.settleChat(chatId);
    await settleChatActorsForDeletion(chatId);
    await db.delete(chats).where(eq(chats.id, chatId));
    entityDisposalBus.publish({ kind: "chat", id: chatId });
  } finally {
    releaseAdmission();
  }
}

export async function waitForChatActorIdle(
  chatId: number,
  options: { cancelActive?: boolean; signal?: AbortSignal } = {},
): Promise<boolean> {
  options.signal?.throwIfAborted();
  const actor = remoteMachineHost.peek<
    ChatStreamHostState,
    ChatStreamWireEvent,
    ChatStreamHostIgnoreReason
  >(chatStreamDefinition.id, chatStreamKey(chatId));
  if (!actor) return false;
  const current = actor.getSnapshot();
  const didRequestCancellation = Boolean(
    options.cancelActive &&
    current.active &&
    (current.phase === "admitting" || current.phase === "streaming"),
  );
  if (didRequestCancellation && current.active) {
    actor.send({
      type: "CANCEL",
      invocationRef: current.active.invocationRef,
    });
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      options.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      options.signal?.removeEventListener("abort", abort);
      reject(options.signal?.reason);
    };
    const inspect = () => {
      const phase = actor.getSnapshot().phase;
      if (phase !== "idle" && phase !== "errored") return;
      finish();
    };
    unsubscribe = actor.subscribe(inspect);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    inspect();
  });
  return didRequestCancellation;
}

export async function waitForAppChatActorsIdle(
  appId: number,
  options: { cancelActive?: boolean; signal?: AbortSignal } = {},
): Promise<boolean> {
  options.signal?.throwIfAborted();
  const appChats = await db.query.chats.findMany({
    columns: { id: true },
    where: eq(chats.appId, appId),
  });
  const cancellationResults = await Promise.all(
    appChats.map(({ id }) => waitForChatActorIdle(id, options)),
  );
  return cancellationResults.some(Boolean);
}

export async function beginAppChatActorMutation(
  appId: number,
): Promise<() => void> {
  const releaseChatCreation = beginAppChatMutation(appId);
  const releaseActorAdmissions: Array<() => void> = [];
  try {
    const appChats = await db.query.chats.findMany({
      columns: { id: true },
      where: eq(chats.appId, appId),
    });
    releaseActorAdmissions.push(
      ...appChats.map(({ id }) => beginChatActorMutation(id)),
    );
  } catch (error) {
    releaseChatCreation();
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const release of releaseActorAdmissions.reverse()) {
      release();
    }
    releaseChatCreation();
  };
}

export async function dispatchChatIntentAndWait(
  intent: SerializableChatTurnIntent,
  signal?: AbortSignal,
): Promise<"accepted" | "rejected"> {
  signal?.throwIfAborted();
  const actor = remoteMachineHost.localRef(
    chatStreamDefinition,
    chatStreamKey(intent.chatId),
  );
  const settled = new Promise<"accepted" | "rejected">((resolve, reject) => {
    const abort = () => {
      unsubscribe();
      reject(signal?.reason);
    };
    const inspect = () => {
      const snapshot = actor.getSnapshot();
      const acceptance = snapshot.lastAcceptance;
      if (
        (acceptance?.intentId === intent.intentId &&
          acceptance.acceptance === "message-accepted") ||
        (acceptance?.intentId === intent.intentId &&
          acceptance.acceptance === "replayed")
      ) {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
        resolve("accepted");
      } else if (
        (acceptance?.intentId === intent.intentId &&
          acceptance.acceptance === "rejected") ||
        getIntentAcceptance(intent.intentId) === "rejected" ||
        snapshot.lastCompletion?.intentId === intent.intentId
      ) {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
        resolve("rejected");
      }
    };
    const unsubscribe = actor.subscribe(inspect);
    signal?.addEventListener("abort", abort, { once: true });
    inspect();
  });
  actor.send({ type: "SUBMIT", intent });
  return settled;
}

export async function dispatchPlanImplementationTurn(input: {
  handoffId: string;
  targetChatId: number;
  appId: number;
  planSlug: string;
  originWindowSessionId?: string;
  signal: AbortSignal;
}): Promise<void> {
  const intentId = `${input.handoffId}:implementation`;
  const withoutHash = {
    schemaVersion: 1 as const,
    intentId,
    chatId: input.targetChatId,
    appId: input.appId,
    invocationRef: {
      kind: "chat-stream" as const,
      entityKey: input.targetChatId,
      operationId: `${input.handoffId}:stream`,
    },
    prompt: `/implement-plan=${input.planSlug}`,
    selectedComponents: [],
    requestedChatMode: "local-agent" as const,
    owner: {
      kind: "plan-handoff" as const,
      handoffId: input.handoffId,
    },
    originWindowSessionId: input.originWindowSessionId,
  };
  const intent: SerializableChatTurnIntent = {
    ...withoutHash,
    payloadHash: computeChatTurnPayloadHash(withoutHash),
  };
  const result = await dispatchChatIntentAndWait(intent, input.signal);
  if (result === "rejected") {
    throw new Error("Implementation turn was rejected");
  }
  if (getIntentAcceptance(intentId) !== "message-accepted") {
    throw new Error("Implementation turn acceptance was not committed");
  }
}

export async function dispatchUserInputFollowUp(input: {
  requestId: string;
  chatId: number;
  prompt: string;
}): Promise<"accepted" | "rejected"> {
  const withoutHash = {
    schemaVersion: 1 as const,
    intentId: input.requestId,
    chatId: input.chatId,
    invocationRef: {
      kind: "chat-stream" as const,
      entityKey: input.chatId,
      operationId: `${input.requestId}:follow-up`,
    },
    prompt: input.prompt,
    selectedComponents: [],
    requestedChatMode: "local-agent" as const,
    userInputRequestId: input.requestId,
    owner: {
      kind: "user-input-follow-up" as const,
      requestId: input.requestId,
    },
  };
  return dispatchChatIntentAndWait({
    ...withoutHash,
    payloadHash: computeChatTurnPayloadHash(withoutHash),
  });
}
