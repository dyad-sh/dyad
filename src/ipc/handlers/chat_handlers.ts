import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { desc, eq, and, like } from "drizzle-orm";
import type { ChatSearchResult, ChatSummary } from "../../lib/schemas";

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { entityDisposalBus } from "@/window_infrastructure/main/entity_disposal_bus";
import { chatContracts } from "../types/chat";
import { normalizeStoredChatMode } from "./chat_mode_resolution";
import {
  blockNewStreamsForChat,
  cancelActiveStreamsForChat,
} from "./chat_stream_handlers";
import type { WebContents } from "electron";
import {
  rendererMessageColumns,
  toRendererMessage,
} from "../utils/renderer_chat_message";
import { createChatForApp } from "../utils/chat_creation_utils";
import {
  getReferencedAppsForDisplay,
  readStoredReferencedAppIds,
} from "../utils/mention_apps";
import { firstPromptCreationRegistry } from "../services/first_prompt_creation_service";
import { userInputRegistry } from "@/user_input/main";
import {
  beginChatActorMutation,
  settleChatActorsForDeletion,
} from "@/ipc/services/chat_actor_deletion_service";
import {
  observeChatSubmissionStopPolicy,
  waitForChatActorIdle,
} from "@/ipc/services/chat_actor_service";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { withChatQueueLock } from "@/chat_stream/queue_lock";
import {
  BACKEND_SWITCH_REQUIRES_NEW_CHAT_MESSAGE,
  getBackendForModel,
  resolveChatExecutionBackend,
} from "@/shared/chat_backend";
import {
  blockSubagentAdmissionsForChat,
  settleSubagentsForChatDeletion,
} from "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager";

const logger = log.scope("chat_handlers");

async function mutateChatAfterDrainingStreams({
  chatId,
  sender,
  beforeLock,
  mutation,
}: {
  chatId: number;
  sender: WebContents;
  beforeLock?: () => Promise<void | (() => void)>;
  mutation: () => Promise<void>;
}): Promise<void> {
  const releaseActorAdmissionBlock = beginChatActorMutation(chatId);
  let releaseBeforeLock: (() => void) | undefined;
  try {
    const chat = await db.query.chats.findFirst({
      columns: { appId: true },
      where: eq(chats.id, chatId),
    });
    if (!chat) {
      return;
    }

    const releaseStreamAdmissionBlock = blockNewStreamsForChat(chatId);
    try {
      const beforeLockResult = beforeLock ? await beforeLock() : undefined;
      releaseBeforeLock =
        typeof beforeLockResult === "function" ? beforeLockResult : undefined;
      // Drain outside the app lock: an aborted stream may need the same lock to
      // finish a file write. The admission blocks close the gaps before and
      // after draining so another turn cannot enter around the mutation.
      await waitForChatActorIdle(chatId, { cancelActive: true });
      await cancelActiveStreamsForChat(chatId, sender);
      await appOperationCoordinator.run(
        {
          appId: chat.appId,
          operation: "mutate-chat-content",
          resources: ["chat-content"],
        },
        mutation,
      );
    } finally {
      releaseBeforeLock?.();
      releaseStreamAdmissionBlock();
    }
  } finally {
    releaseActorAdmissionBlock();
  }
}

export function registerChatHandlers() {
  createTypedHandler(
    chatContracts.observeSubmissionStopPolicy,
    async (_, chatId) => observeChatSubmissionStopPolicy(chatId),
  );
  createTypedHandler(chatContracts.createChat, async (event, input) => {
    const { appId, initialChatMode, firstPromptCreationOperationId } =
      typeof input === "number"
        ? {
            appId: input,
            initialChatMode: undefined,
            firstPromptCreationOperationId: undefined,
          }
        : input;

    if (firstPromptCreationOperationId) {
      firstPromptCreationRegistry.track(
        firstPromptCreationOperationId,
        event.sender,
      );
    }
    let chatId: number | undefined;
    try {
      chatId = await createChatForApp({ appId, initialChatMode });
      return chatId;
    } finally {
      if (firstPromptCreationOperationId) {
        if (chatId === undefined) {
          firstPromptCreationRegistry.commit(firstPromptCreationOperationId);
        } else {
          const createdChatId = chatId;
          await firstPromptCreationRegistry.complete(
            firstPromptCreationOperationId,
            async () => {
              await db.delete(chats).where(eq(chats.id, createdChatId));
            },
          );
        }
      }
    }
  });

  createTypedHandler(chatContracts.getChat, async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: {
        id: true,
        appId: true,
        title: true,
        initialCommitHash: true,
        chatMode: true,
        modelSelection: true,
        executionBackend: true,
        referencedAppIds: true,
      },
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

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title ?? "",
      initialCommitHash: chat.initialCommitHash,
      chatMode: normalizeStoredChatMode(chat.chatMode),
      modelSelection: chat.modelSelection ?? null,
      executionBackend: chat.executionBackend ?? null,
      referencedApps: await getReferencedAppsForDisplay(chat.referencedAppIds),
      messages: chat.messages.map(toRendererMessage),
    };
  });

  createTypedHandler(
    chatContracts.removeChatReferencedApp,
    async (event, { chatId, appId }) => {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, chatId),
        columns: { id: true },
      });

      if (!chat) {
        throw new DyadError("Chat not found", DyadErrorKind.NotFound);
      }

      // Detaching revokes read access, so it has to reach the turn that is
      // already running: an in-flight agent resolved this chat's references
      // into its tool context up front and would keep reading the app until
      // the turn ended. Draining cancels that turn and blocks new ones until
      // the write lands, which also stops the stream's whole-array union
      // (computed before the removal) from putting the id back.
      await mutateChatAfterDrainingStreams({
        chatId,
        sender: event.sender,
        mutation: async () => {
          // Re-read inside the mutation: the drained stream may have persisted
          // its own union on the way out.
          const drainedChat = await db.query.chats.findFirst({
            where: eq(chats.id, chatId),
            columns: { referencedAppIds: true },
          });
          if (!drainedChat) {
            return;
          }

          const remaining = readStoredReferencedAppIds(
            drainedChat.referencedAppIds,
          ).filter((id) => id !== appId);

          await db
            .update(chats)
            .set({ referencedAppIds: remaining })
            .where(eq(chats.id, chatId));
        },
      });
    },
  );

  createTypedHandler(chatContracts.getChatMetadata, async (_, chatId) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: {
        id: true,
        appId: true,
        title: true,
        createdAt: true,
        chatMode: true,
        isFavorite: true,
      },
    });

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title,
      createdAt: chat.createdAt,
      chatMode: normalizeStoredChatMode(chat.chatMode),
      isFavorite: chat.isFavorite,
    };
  });

  createTypedHandler(chatContracts.getChats, async (_, appId) => {
    // If appId is provided, filter chats for that app
    const query = appId
      ? db.query.chats.findMany({
          where: eq(chats.appId, appId),
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
            chatMode: true,
            isFavorite: true,
          },
          orderBy: [desc(chats.createdAt)],
        })
      : db.query.chats.findMany({
          columns: {
            id: true,
            title: true,
            createdAt: true,
            appId: true,
            chatMode: true,
            isFavorite: true,
          },
          orderBy: [desc(chats.createdAt)],
        });

    const allChats = await query;
    return allChats.map((chat) => ({
      ...chat,
      chatMode: normalizeStoredChatMode(chat.chatMode),
    })) satisfies ChatSummary[];
  });

  createTypedHandler(chatContracts.deleteChat, async (event, chatId) => {
    // Sweep due follow-ups before closing chat admission. Starting both fences
    // in this synchronous turn prevents either new sub-agents or a deletion
    // race from changing the follow-up outcome from swept to rejected.
    const userInputSettlement = userInputRegistry.settleChat(chatId);
    const releaseSubagentAdmission = blockSubagentAdmissionsForChat(chatId);
    try {
      await mutateChatAfterDrainingStreams({
        chatId,
        sender: event.sender,
        beforeLock: async () => {
          await userInputSettlement;
          const releaseSubagents = await settleSubagentsForChatDeletion(chatId);
          try {
            await settleChatActorsForDeletion(chatId);
            return releaseSubagents;
          } catch (error) {
            releaseSubagents();
            throw error;
          }
        },
        mutation: async () => {
          await db.delete(chats).where(eq(chats.id, chatId));
          entityDisposalBus.publish({ kind: "chat", id: chatId });
        },
      });
    } finally {
      releaseSubagentAdmission();
    }
  });

  createTypedHandler(chatContracts.updateChat, async (_, params) => {
    const { chatId, title, chatMode, modelSelection, executionBackend } =
      params;
    const updates: Partial<typeof chats.$inferInsert> = {};
    if (title !== undefined) {
      updates.title = title;
    }
    if (chatMode !== undefined) {
      updates.chatMode = chatMode;
    }
    if (modelSelection !== undefined) {
      updates.modelSelection = modelSelection;
    }
    if (executionBackend !== undefined) {
      updates.executionBackend = executionBackend;
    }
    if (Object.keys(updates).length === 0) {
      return;
    }
    if (
      chatMode !== undefined ||
      modelSelection !== undefined ||
      executionBackend !== undefined
    ) {
      await withChatQueueLock(chatId, async () => {
        const current = db
          .select({
            executionBackend: chats.executionBackend,
            modelSelection: chats.modelSelection,
          })
          .from(chats)
          .where(eq(chats.id, chatId))
          .get();
        if (!current) {
          throw new DyadError("Chat not found", DyadErrorKind.NotFound);
        }
        // A chat never changes backend after it is bound; the renderer offers
        // "Start new chat" instead. Reject both an explicit re-bind and a
        // model selection whose backend disagrees with the bound one.
        const boundBackend = resolveChatExecutionBackend(current);
        const requestedBackend =
          executionBackend ??
          (modelSelection ? getBackendForModel(modelSelection) : null);
        if (
          boundBackend !== null &&
          requestedBackend !== null &&
          requestedBackend !== boundBackend
        ) {
          throw new DyadError(
            BACKEND_SWITCH_REQUIRES_NEW_CHAT_MESSAGE,
            DyadErrorKind.Precondition,
          );
        }
        await db.update(chats).set(updates).where(eq(chats.id, chatId));
      });
    } else {
      await db.update(chats).set(updates).where(eq(chats.id, chatId));
    }
  });

  createTypedHandler(chatContracts.setChatFavorite, async (_, params) => {
    const updated = await db
      .update(chats)
      .set({ isFavorite: params.isFavorite })
      .where(eq(chats.id, params.chatId))
      .returning({ isFavorite: chats.isFavorite });

    if (updated.length === 0) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return updated[0];
  });

  createTypedHandler(chatContracts.deleteMessages, async (event, chatId) => {
    await mutateChatAfterDrainingStreams({
      chatId,
      sender: event.sender,
      mutation: async () => {
        // Clearing the conversation clears its referenced apps too: the
        // mentions that established them are gone, so keeping the agent's
        // read access to other apps would outlive anything the user can see.
        // Both writes commit together — a failure or exit between them would
        // leave sticky cross-app read access behind an empty history, where
        // nothing on screen explains why the agent can still read that app.
        db.transaction((tx) => {
          tx.delete(messages).where(eq(messages.chatId, chatId)).run();
          tx.update(chats)
            .set({ referencedAppIds: [] })
            .where(eq(chats.id, chatId))
            .run();
        });
      },
    });
  });

  createTypedHandler(chatContracts.searchChats, async (_, params) => {
    const { appId, query } = params;
    // 1) Find chats by title and map to ChatSearchResult with no matched message
    const chatTitleMatches = await db
      .select({
        id: chats.id,
        appId: chats.appId,
        title: chats.title,
        createdAt: chats.createdAt,
      })
      .from(chats)
      .where(and(eq(chats.appId, appId), like(chats.title, `%${query}%`)))
      .orderBy(desc(chats.createdAt))
      .limit(10);

    const titleResults: ChatSearchResult[] = chatTitleMatches.map((c) => ({
      id: c.id,
      appId: c.appId,
      title: c.title,
      createdAt: c.createdAt,
      matchedMessageContent: null,
    }));

    // 2) Find messages that match and join to chats to build one result per message
    const messageResults = await db
      .select({
        id: chats.id,
        appId: chats.appId,
        title: chats.title,
        createdAt: chats.createdAt,
        matchedMessageContent: messages.content,
      })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(eq(chats.appId, appId), like(messages.content, `%${query}%`)))
      .orderBy(desc(chats.createdAt))
      .limit(10);

    // Combine: keep title matches and per-message matches
    const combined: ChatSearchResult[] = [...titleResults, ...messageResults];
    const uniqueChats = Array.from(
      new Map(combined.map((item) => [item.id, item])).values(),
    );

    // Sort newest chats first
    uniqueChats.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return uniqueChats;
  });

  logger.debug("Registered chat IPC handlers");
}
