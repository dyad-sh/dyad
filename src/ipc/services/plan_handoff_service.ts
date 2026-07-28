import { createHash } from "node:crypto";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import { planHandoffDefinition } from "@/plan_handoff/definition";
import {
  planHandoffKey,
  serializePlanDocument,
  type PlanHandoffIntent,
} from "@/plan_handoff/transport";
import { uuidIdSource } from "@/state_machines/clock";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { readPlanFromDisk } from "@/ipc/handlers/planPersistence";
import { assertChatActorAdmissionOpen } from "./chat_actor_deletion_fence";

type PlanDocument = PlanHandoffIntent["plan"];

const planDrafts = new Map<number, PlanDocument>();

export function rememberPlanDraft(chatId: number, plan: PlanDocument): void {
  planDrafts.set(chatId, plan);
}

export async function startPlanHandoffFromMain(input: {
  sourceChatId: number;
  appId: number;
  appPath: string;
  acceptInNewChat: boolean;
  senderWebContentsId: number;
}): Promise<string> {
  assertChatActorAdmissionOpen(input.sourceChatId);
  const plan =
    planDrafts.get(input.sourceChatId) ??
    (await readPlanFromDisk({
      appPath: input.appPath,
      chatId: input.sourceChatId,
    }));
  assertChatActorAdmissionOpen(input.sourceChatId);
  const planHash = createHash("sha256")
    .update(serializePlanDocument(plan))
    .digest("hex");
  const handoffId = uuidIdSource.next("plan-handoff");
  const intent: PlanHandoffIntent = {
    schemaVersion: 1,
    handoffId,
    sourceChatId: input.sourceChatId,
    appId: input.appId,
    acceptInNewChat: input.acceptInNewChat,
    planId: `chat-${input.sourceChatId}`,
    planVersion: planHash,
    planHash,
    plan,
    originWindowSessionId: windowRegistry.sessionForWebContents(
      input.senderWebContentsId,
    ),
  };
  const actor = remoteMachineHost.localRef(
    planHandoffDefinition,
    planHandoffKey(input.sourceChatId),
  );
  const outcome = await actor.enqueue({ type: "ACCEPT", intent }).settled;
  if (outcome.kind === "failed") {
    throw outcome.error;
  }
  if (outcome.kind === "disposed") {
    throw new DyadError(
      "Plan handoff admission was disposed",
      DyadErrorKind.Precondition,
    );
  }
  if (outcome.kind === "ignored") {
    throw new DyadError(
      `Plan handoff was ignored: ${outcome.reason}`,
      outcome.reason === "already-running"
        ? DyadErrorKind.Conflict
        : DyadErrorKind.Precondition,
    );
  }
  planDrafts.delete(input.sourceChatId);
  return handoffId;
}
