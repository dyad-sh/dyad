import { createTypedHandler } from "./base";
import { windowInfrastructureContracts } from "../types/window_infrastructure";
import { windowRegistry } from "../../window_infrastructure/main/window_registry";
import { queryInvalidationBus } from "../../window_infrastructure/main/query_invalidation_bus";
import {
  appOutputInterests,
  chatChunkInterests,
} from "../../window_infrastructure/main/production_high_volume";
import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  rendererMessageColumns,
  toRendererMessage,
} from "../utils/renderer_chat_message";
import type { ChatResponseChunk } from "../types/chat";
import { getWindowProductController } from "../../window_infrastructure/main/window_product_controller";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ChatTabTransferCoordinator } from "@/window_infrastructure/main/chat_tab_transfer_coordinator";
import { readSettings } from "@/main/settings";
import {
  chatNotificationTarget,
  deliverChatNavigationToExistingWindow,
} from "@/window_infrastructure/main/chat_notification_routing";

const chatTabTransfers = new ChatTabTransferCoordinator(windowRegistry);

export function registerWindowInfrastructureHandlers(): void {
  createTypedHandler(
    windowInfrastructureContracts.bootstrap,
    async (event, input) => {
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      const synchronization = queryInvalidationBus.synchronize(
        input.lastSeenQueryInvalidationEpoch,
      );
      const controller = getWindowProductController();
      let initialEntity = controller?.initialEntityForSession(windowSessionId);
      let initialChatAppId: number | undefined;
      if (initialEntity?.kind === "app") {
        const existingApp = await db.query.apps.findFirst({
          where: eq(apps.id, initialEntity.id),
        });
        if (!existingApp) {
          controller?.setVisibleEntities(windowSessionId, []);
          initialEntity = undefined;
        }
      } else if (initialEntity?.kind === "chat") {
        const existingChat = await db.query.chats.findFirst({
          where: eq(chats.id, initialEntity.id),
        });
        if (!existingChat) {
          controller?.setVisibleEntities(windowSessionId, []);
          initialEntity = undefined;
        } else {
          initialChatAppId = existingChat.appId;
        }
      }
      return {
        windowSessionId,
        currentQueryInvalidationEpoch: synchronization.currentEpoch,
        missedInvalidations: synchronization.invalidations,
        recoveryScopes: synchronization.recoveryScopes,
        initialEntity,
        initialChatAppId,
        mayMigrateLegacyChatTabSession:
          controller?.mayMigrateLegacyChatTabSession(windowSessionId) ?? true,
        restorableWindowSessionIds: Array.from(
          controller?.restorableWindowSessionIds() ?? [windowSessionId],
        ),
      };
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.confirmSourceChatTabRemoval,
    async (event, input) => {
      const sourceWindowSessionId = windowRegistry.ensureRegistered(
        event.sender,
      );
      chatTabTransfers.confirmSourceRemoval(sourceWindowSessionId, input);
      windowRegistry.removeOwnedChatTab(
        sourceWindowSessionId,
        input.chatId,
        input.tabInstanceId,
      );
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.openEntityInNewWindow,
    async (_event, entity) => {
      const controller = getWindowProductController();
      if (!controller) {
        throw new DyadError(
          "Window product controller is not ready",
          DyadErrorKind.Precondition,
        );
      }
      const exists =
        entity.kind === "app"
          ? await db.query.apps.findFirst({ where: eq(apps.id, entity.id) })
          : await db.query.chats.findFirst({ where: eq(chats.id, entity.id) });
      if (!exists) {
        throw new DyadError(
          entity.kind === "app" ? "App not found" : "Chat not found",
          DyadErrorKind.NotFound,
        );
      }
      return {
        windowSessionId: await controller.openEntityInNewWindow(entity),
      };
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.beginChatTabTransfer,
    async (event, { transferId, payload, tabs }) => {
      const sourceWindowSessionId = windowRegistry.ensureRegistered(
        event.sender,
      );
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, payload.chatId),
      });
      if (!chat || chat.appId !== payload.appId) {
        throw new DyadError("Chat not found", DyadErrorKind.NotFound);
      }
      if (
        !windowRegistry.refreshChatTabOwnershipForTransfer(
          sourceWindowSessionId,
          tabs,
          payload.chatId,
          payload.tabInstanceId,
        )
      ) {
        throw new DyadError(
          "The source window does not own this chat tab",
          DyadErrorKind.Precondition,
        );
      }
      return {
        transferId: chatTabTransfers.begin(
          transferId,
          sourceWindowSessionId,
          payload,
        ),
      };
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.adoptChatTabTransfer,
    async (event, { transferId }) =>
      chatTabTransfers.adopt(
        windowRegistry.ensureRegistered(event.sender),
        transferId,
      ),
  );

  createTypedHandler(
    windowInfrastructureContracts.rejectChatTabTransfer,
    async (event, { transferId }) => ({
      aborted: chatTabTransfers.reject(
        windowRegistry.ensureRegistered(event.sender),
        transferId,
      ),
    }),
  );

  createTypedHandler(
    windowInfrastructureContracts.acknowledgeChatTabTransfer,
    async (event, { transferId }) =>
      chatTabTransfers.acknowledge(
        windowRegistry.ensureRegistered(event.sender),
        transferId,
      ),
  );

  createTypedHandler(
    windowInfrastructureContracts.focusChat,
    async (_event, { chatId }) => {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, chatId),
      });
      if (!chat) {
        throw new DyadError("Chat not found", DyadErrorKind.NotFound);
      }
      const entity = { kind: "chat" as const, id: chatId };
      const targetSession = chatNotificationTarget(
        windowRegistry,
        entity,
        !!readSettings().enableMultiWindow,
      );
      if (
        targetSession &&
        deliverChatNavigationToExistingWindow(windowRegistry, targetSession, {
          chatId,
          appId: chat.appId,
        })
      ) {
        return { windowSessionId: targetSession };
      }
      const controller = getWindowProductController();
      if (!controller) {
        throw new DyadError(
          "Window product controller is not ready",
          DyadErrorKind.Precondition,
        );
      }
      return {
        windowSessionId: await controller.openEntityInNewWindow(entity),
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
      getWindowProductController()?.setVisibleEntities(sessionId, entities);
    },
  );

  createTypedHandler(
    windowInfrastructureContracts.setChatTabOwnership,
    async (event, tabs) => {
      const sessionId = windowRegistry.ensureRegistered(event.sender);
      windowRegistry.setChatTabOwnership(sessionId, tabs);
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
