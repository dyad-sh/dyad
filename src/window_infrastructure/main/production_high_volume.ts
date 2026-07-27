import type { WebContents } from "electron";
import type { ChatResponseChunk } from "@/ipc/types/chat";
import type { AppOutput } from "@/ipc/types/misc";
import { safeSend } from "@/ipc/utils/safe_sender";
import { HighVolumeWindowInterests } from "./high_volume_interests";
import { windowRegistry } from "./window_registry";

export const appOutputInterests = new HighVolumeWindowInterests<AppOutput>(
  windowRegistry,
  "app:output-batch",
  100,
);

export const chatChunkInterests =
  new HighVolumeWindowInterests<ChatResponseChunk>(
    windowRegistry,
    "chat:response:chunk",
    0,
    "individual",
  );

export function ensureProducerInterest(
  sender: WebContents,
  interest:
    | { kind: "app-output"; appId: number }
    | { kind: "chat-chunk"; chatId: number },
): void {
  windowRegistry.ensureRegistered(sender);
  if (interest.kind === "app-output") {
    appOutputInterests.attachLive(sender.id, interest);
  } else {
    chatChunkInterests.attachLive(sender.id, interest);
  }
}

export function sendChatChunk(
  sender: WebContents,
  payload: ChatResponseChunk,
): void {
  if (!Number.isInteger(sender.id) || sender.isDestroyed()) {
    safeSend(sender, "chat:response:chunk", payload);
  } else {
    ensureProducerInterest(sender, {
      kind: "chat-chunk",
      chatId: payload.chatId,
    });
  }
  const interest = { kind: "chat-chunk" as const, chatId: payload.chatId };
  chatChunkInterests.sendImmediate(interest, payload, "chat:response:chunk");
}

export function releaseChatProducerInterest(
  sender: WebContents,
  chatId: number,
): void {
  if (!Number.isInteger(sender.id)) return;
  chatChunkInterests.releaseLive(sender.id, {
    kind: "chat-chunk",
    chatId,
  });
}
