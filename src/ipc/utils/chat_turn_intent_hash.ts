import { createHash } from "node:crypto";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";
import { serializeImmutableChatTurnPayload } from "@/chat_stream/intent_payload";

export function computeChatTurnPayloadHash(
  intent: Omit<SerializableChatTurnIntent, "payloadHash">,
): string {
  return createHash("sha256")
    .update(serializeImmutableChatTurnPayload(intent))
    .digest("hex");
}
