import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatChunkInterests } from "@/window_infrastructure/main/production_high_volume";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { publishQueryInvalidations } from "../utils/query_invalidation_delivery";
import { createChatExecutionContext } from "./chat_execution_presentation";

describe("chat execution presentation", () => {
  const producerId = 93_001;
  const observerId = 93_002;
  afterEach(() => {
    queryInvalidationBus.flush();
    windowRegistry.unregister(producerId);
    windowRegistry.unregister(observerId);
  });

  it.each(["destroyed", "crashed"] as const)(
    "keeps streaming to other windows after the origin is %s without resurrecting it",
    async (loss) => {
      let unavailable = false;
      const producer = {
        id: producerId,
        isDestroyed: () => unavailable && loss === "destroyed",
        isCrashed: () => unavailable && loss === "crashed",
        send: vi.fn(),
      };
      const observer = {
        id: observerId,
        isDestroyed: () => false,
        send: vi.fn(),
      };
      windowRegistry.register(producer, randomUUID() as WindowSessionId);
      windowRegistry.register(observer, randomUUID() as WindowSessionId);
      await chatChunkInterests.attach(
        observerId,
        { kind: "chat-chunk", chatId: 7 },
        () => [],
      );
      const context = createChatExecutionContext(producer);
      const firstChunk = { chatId: 7, streamingPreview: { content: "first" } };
      context.onProgress({ type: "chunk", payload: firstChunk });
      expect(producer.send).toHaveBeenCalledWith(
        "chat:response:chunk",
        firstChunk,
      );

      unavailable = true;
      windowRegistry.unregister(producerId);
      const lastChunk = { chatId: 7, streamingPreview: { content: "last" } };
      context.onProgress({ type: "chunk", payload: lastChunk });
      publishQueryInvalidations(
        [{ family: "chat", chatId: 7 }],
        context.presentation.sender,
      );
      queryInvalidationBus.flush();

      expect(windowRegistry.sessionForWebContents(producerId)).toBeUndefined();
      expect(producer.send).toHaveBeenCalledTimes(1);
      expect(observer.send).toHaveBeenCalledWith(
        "chat:response:chunk",
        lastChunk,
      );
      expect(observer.send).toHaveBeenCalledWith(
        "window:query-invalidations",
        expect.anything(),
      );
    },
  );
});
