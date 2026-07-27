import { createTypedHandler } from "./base";
import { windowInfrastructureContracts } from "../types/window_infrastructure";
import { windowRegistry } from "../../window_infrastructure/main/window_registry";
import { queryInvalidationBus } from "../../window_infrastructure/main/query_invalidation_bus";
import {
  appOutputInterests,
  chatChunkInterests,
} from "../../window_infrastructure/main/production_high_volume";
import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  rendererMessageColumns,
  toRendererMessage,
} from "../utils/renderer_chat_message";
import type { ChatResponseChunk } from "../types/chat";

export function registerWindowInfrastructureHandlers(): void {
  createTypedHandler(
    windowInfrastructureContracts.bootstrap,
    async (event, input) => {
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      const synchronization = queryInvalidationBus.synchronize(
        input.lastSeenQueryInvalidationEpoch,
      );
      return {
        windowSessionId,
        currentQueryInvalidationEpoch: synchronization.currentEpoch,
        missedInvalidations: synchronization.invalidations,
        recoveryScopes: synchronization.recoveryScopes,
      };
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.setFocused,
    async (event) => {
      const sessionId = windowRegistry.ensureRegistered(event.sender);
      windowRegistry.setFocused(sessionId);
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.setVisibleEntities,
    async (event, entities) => {
      const sessionId = windowRegistry.ensureRegistered(event.sender);
      windowRegistry.setVisibleEntities(sessionId, entities);
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.attachInterest,
    async (event, interest) => {
      windowRegistry.ensureRegistered(event.sender);
      if (interest.kind === "app-output") {
        await appOutputInterests.attach(event.sender.id, interest, () => []);
        return;
      }
      await chatChunkInterests.attach(event.sender.id, interest, async () => {
        const chat = await db.query.chats.findFirst({
          where: eq(chats.id, interest.chatId),
          with: {
            messages: {
              columns: rendererMessageColumns,
              orderBy: (messages, { asc }) => [
                asc(messages.createdAt),
                asc(messages.id),
              ],
            },
          },
        });
        return chat
          ? ([
              {
                chatId: interest.chatId,
                // A distinct correlation identity ensures this bootstrap is
                // always projected through the passive peer-stream path even
                // if a local stream starts while the DB query is in flight.
                invocationRef: {
                  kind: "chat-stream",
                  entityKey: interest.chatId,
                  operationId: `window-bootstrap:${event.sender.id}`,
                },
                messages: chat.messages.map(toRendererMessage),
              },
            ] satisfies ChatResponseChunk[])
          : [];
      });
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.detachInterest,
    async (event, interest) => {
      const interests =
        interest.kind === "app-output"
          ? appOutputInterests
          : chatChunkInterests;
      interests.detach(event.sender.id, interest);
    },
  );
}
