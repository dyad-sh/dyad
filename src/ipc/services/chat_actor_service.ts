import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatTurnIntents } from "@/db/schema";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { chatStreamDefinition } from "@/chat_stream/definition";
import {
  chatStreamKey,
  type SerializableChatTurnIntent,
} from "@/chat_stream/transport";

export async function waitForChatActorIdle(
  chatId: number,
  options: { cancelActive?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  const actor = remoteMachineHost.localRef(
    chatStreamDefinition,
    chatStreamKey(chatId),
  );
  const current = actor.getSnapshot();
  if (
    options.cancelActive &&
    current.active &&
    (current.phase === "admitting" || current.phase === "streaming")
  ) {
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
      const acceptance = actor.getSnapshot().lastAcceptance;
      if (acceptance?.intentId !== intent.intentId) return;
      if (
        acceptance.acceptance === "message-accepted" ||
        acceptance.acceptance === "replayed"
      ) {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
        resolve("accepted");
      } else if (acceptance.acceptance === "rejected") {
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
  const row = db
    .select({ acceptance: chatTurnIntents.acceptance })
    .from(chatTurnIntents)
    .where(eq(chatTurnIntents.intentId, intentId))
    .get();
  if (row?.acceptance !== "message-accepted") {
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
