import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import { planHandoffDefinition } from "@/plan_handoff/definition";
import { planHandoffKey } from "@/plan_handoff/transport";
import { chatStreamDefinition } from "@/chat_stream/definition";
import { chatStreamKey } from "@/chat_stream/transport";
import { waitForChatActorIdle } from "./chat_actor_service";

export async function settleChatActorsForDeletion(
  chatId: number,
): Promise<void> {
  await remoteMachineHost.entityDeleted(
    planHandoffDefinition.id,
    planHandoffKey(chatId),
  );
  await waitForChatActorIdle(chatId, { cancelActive: true });
  await remoteMachineHost.entityDeleted(
    chatStreamDefinition.id,
    chatStreamKey(chatId),
  );
}
