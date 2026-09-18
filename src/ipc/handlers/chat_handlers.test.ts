import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, messages } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerChatHandlers } from "./chat_handlers";

const cli = vi.hoisted(() => ({
  status: vi.fn().mockResolvedValue({ connected: true }),
  models: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/ipc/services/claude_code/runtime", async (original) => ({
  ...(await original<typeof import("@/ipc/services/claude_code/runtime")>()),
  claudeStatus: cli.status,
  listClaudeModels: cli.models,
}));
vi.mock("@/ipc/services/claude_code/disclosure", () => ({
  hasClaudeDisclosure: async () => true,
  acceptClaudeDisclosure: vi.fn(),
}));
const deletionOrder = vi.hoisted(() => [] as string[]);
vi.mock("@/ipc/services/chat_journal_cleanup", () => ({
  deleteChatJournals: vi.fn(async () => {
    deletionOrder.push("delete-journals");
  }),
}));
// Lets a test observe database state at the moment streams are drained, which
// is where the revoke-vs-stream-union ordering matters.
const drainHooks = vi.hoisted(
  () => ({ onDrain: undefined }) as { onDrain?: () => void },
);

vi.mock("./chat_stream_handlers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./chat_stream_handlers")>();
  return {
    ...actual,
    blockNewStreamsForChat: vi.fn(() => {
      deletionOrder.push("barrier");
      return () => deletionOrder.push("release");
    }),
    cancelActiveStreamsForChat: vi.fn(async () => {
      deletionOrder.push("drain");
      drainHooks.onDrain?.();
      return true;
    }),
  };
});

vi.mock("@/ipc/services/chat_actor_deletion_service", () => ({
  beginChatActorMutation: vi.fn(() => {
    deletionOrder.push("actor-barrier");
    return () => deletionOrder.push("actor-release");
  }),
  settleChatActorsForDeletion: vi.fn(async () => {
    deletionOrder.push("settle-actors");
  }),
}));

vi.mock("@/ipc/services/chat_actor_service", () => ({
  waitForChatActorIdle: vi.fn(async () => {
    deletionOrder.push("drain-actor");
  }),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    settleChat: vi.fn(async () => {
      deletionOrder.push("settle-input");
    }),
  },
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager",
  () => ({
    blockSubagentAdmissionsForChat: vi.fn(() => {
      deletionOrder.push("subagent-barrier");
      return () => deletionOrder.push("subagent-admission-release");
    }),
    settleSubagentsForChatDeletion: vi.fn(async () => {
      deletionOrder.push("settle-subagents");
      return () => deletionOrder.push("release-subagents");
    }),
  }),
);

describe("registerChatHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    deletionOrder.length = 0;
    drainHooks.onDrain = undefined;
    harness = setupHandlerTestHarness();
    registerChatHandlers();
  });

  afterEach(() => {
    harness.dispose();
  });

  it.each(["claude-code:models", "claude-code:status"])(
    "gates %s before spawning the CLI",
    async (channel) => {
      cli.status.mockClear();
      cli.models.mockClear();
      await expect(harness.invokeHandler(channel)).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
      });
      expect(cli.status).not.toHaveBeenCalled();
      expect(cli.models).not.toHaveBeenCalled();
      harness.writeSettings({ enableClaudeCodeSubscription: true });
      await expect(harness.invokeHandler(channel)).resolves.toBeDefined();
      expect(
        channel.endsWith("models") ? cli.models : cli.status,
      ).toHaveBeenCalledOnce();
    },
  );

  it.each(["dyad", "claude-code"] as const)(
    "switches an empty %s chat backend and rejects switching once messages exist",
    async (executionBackend) => {
      const appId = Number(
        harness.db.insert(apps).values({ name: "switch", path: "switch" }).run()
          .lastInsertRowid,
      );
      const chatId = Number(
        harness.db.insert(chats).values({ appId, executionBackend }).run()
          .lastInsertRowid,
      );
      const modelSelection = {
        provider: executionBackend === "dyad" ? "claude-code" : "auto",
        name: executionBackend === "dyad" ? "sonnet" : "auto",
        effortLevel: "medium",
      };
      await harness.invokeHandler("update-chat", { chatId, modelSelection });
      const updated = harness.db
        .select()
        .from(chats)
        .where(eq(chats.id, chatId))
        .get();
      expect(updated).toMatchObject({
        executionBackend: executionBackend === "dyad" ? "claude-code" : "dyad",
        modelSelection,
      });
      harness.db
        .insert(messages)
        .values({
          chatId,
          role: "assistant",
          content: "Hello",
          executionBackend:
            executionBackend === "dyad" ? "claude-code" : "dyad",
        })
        .run();
      await expect(
        harness.invokeHandler("update-chat", {
          chatId,
          modelSelection: {
            provider: executionBackend === "dyad" ? "auto" : "claude-code",
            name: "sonnet",
            effortLevel: "medium",
          },
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(
        harness.db.select().from(chats).where(eq(chats.id, chatId)).get(),
      ).toEqual(updated);
    },
  );

  it.each(["dyad", "claude-code"] as const)(
    "uses %s message history when the stored backend disagrees",
    async (historyBackend) => {
      const otherBackend = historyBackend === "dyad" ? "claude-code" : "dyad";
      const appId = Number(
        harness.db
          .insert(apps)
          .values({ name: "history", path: "history" })
          .run().lastInsertRowid,
      );
      const chatId = Number(
        harness.db
          .insert(chats)
          .values({ appId, executionBackend: otherBackend })
          .run().lastInsertRowid,
      );
      harness.db
        .insert(messages)
        .values({
          chatId,
          role: "assistant",
          content: "Hello",
          executionBackend: historyBackend,
        })
        .run();
      const selection = (backend: "dyad" | "claude-code") => ({
        provider: backend === "dyad" ? "openai" : "claude-code",
        name: "model",
        effortLevel: "medium",
      });
      await expect(
        harness.invokeHandler("update-chat", {
          chatId,
          modelSelection: selection(otherBackend),
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      await harness.invokeHandler("update-chat", {
        chatId,
        modelSelection: selection(historyBackend),
      });
      expect(
        harness.db.select().from(chats).where(eq(chats.id, chatId)).get(),
      ).toMatchObject({
        executionBackend: historyBackend,
        modelSelection: selection(historyBackend),
      });
    },
  );

  it("does not expose main-process AI message history through get-chat", async () => {
    const appResult = harness.db
      .insert(apps)
      .values({ name: "test-app", path: "test-app" })
      .run();
    const appId = Number(appResult.lastInsertRowid);
    const chatResult = harness.db.insert(chats).values({ appId }).run();
    const chatId = Number(chatResult.lastInsertRowid);

    harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content: "Visible response",
        maxTokensUsed: 123,
        aiMessagesJson: {
          version: 6,
          messages: [
            {
              role: "assistant",
              content: "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
            },
          ],
        } as any,
      })
      .run();

    const result = await harness.invokeHandler<{
      messages: Array<Record<string, unknown>>;
    }>("get-chat", chatId);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      role: "assistant",
      content: "Visible response",
      totalTokens: 123,
    });
    expect(result.messages[0]).not.toHaveProperty("aiMessagesJson");
    expect(JSON.stringify(result)).not.toContain(
      "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
    );
  });

  it("sets a chat favorite explicitly and exposes it in chat summaries", async () => {
    const appResult = harness.db
      .insert(apps)
      .values({ name: "favorites-app", path: "favorites-app" })
      .run();
    const appId = Number(appResult.lastInsertRowid);
    const olderChatResult = harness.db
      .insert(chats)
      .values({
        appId,
        title: "Older chat",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })
      .run();
    const olderChatId = Number(olderChatResult.lastInsertRowid);
    const newerChatResult = harness.db
      .insert(chats)
      .values({
        appId,
        title: "Newer chat",
        createdAt: new Date("2025-01-02T00:00:00Z"),
      })
      .run();
    const newerChatId = Number(newerChatResult.lastInsertRowid);

    const initialSummaries = await harness.invokeHandler<
      Array<{ id: number; isFavorite: boolean }>
    >("get-chats", appId);
    expect(initialSummaries).toEqual([
      expect.objectContaining({ id: newerChatId, isFavorite: false }),
      expect.objectContaining({ id: olderChatId, isFavorite: false }),
    ]);

    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: olderChatId,
        isFavorite: true,
      }),
    ).resolves.toEqual({ isFavorite: true });

    const favoritedSummaries = await harness.invokeHandler<
      Array<{ id: number; isFavorite: boolean }>
    >("get-chats", appId);
    expect(favoritedSummaries).toEqual([
      expect.objectContaining({ id: newerChatId, isFavorite: false }),
      expect.objectContaining({ id: olderChatId, isFavorite: true }),
    ]);

    await expect(
      harness.invokeHandler("get-chat-metadata", olderChatId),
    ).resolves.toEqual(
      expect.objectContaining({ id: olderChatId, isFavorite: true }),
    );

    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: olderChatId,
        isFavorite: false,
      }),
    ).resolves.toEqual({ isFavorite: false });
  });

  it("throws NotFound when favoriting a missing chat", async () => {
    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: 123,
        isFavorite: true,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Chat not found",
    });
  });

  it("holds the stream barrier while actors drain and the chat is deleted", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "delete-app", path: "delete-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db.insert(chats).values({ appId }).run().lastInsertRowid,
    );

    await harness.invokeHandler("delete-chat", chatId);
    deletionOrder.push(
      (await harness.db.query.chats.findFirst({
        where: (row, { eq }) => eq(row.id, chatId),
      }))
        ? "row-present"
        : "row-deleted",
    );

    expect(deletionOrder).toEqual([
      "settle-input",
      "subagent-barrier",
      "actor-barrier",
      "barrier",
      "settle-subagents",
      "settle-actors",
      "drain-actor",
      "drain",
      "delete-journals",
      "release-subagents",
      "release",
      "actor-release",
      "subagent-admission-release",
      "row-deleted",
    ]);
  });

  it("drains an admitting actor before deleting chat messages", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "clear-app", path: "clear-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db.insert(chats).values({ appId }).run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({ chatId, role: "user", content: "delete me" })
      .run();

    await harness.invokeHandler("delete-messages", chatId);

    expect(deletionOrder).toEqual([
      "settle-input",
      "subagent-barrier",
      "actor-barrier",
      "barrier",
      "settle-subagents",
      "settle-actors",
      "drain-actor",
      "drain",
      "delete-journals",
      "release-subagents",
      "release",
      "actor-release",
      "subagent-admission-release",
    ]);
    await expect(
      harness.db.query.messages.findMany({
        where: (row, { eq }) => eq(row.chatId, chatId),
      }),
    ).resolves.toEqual([]);
  });

  it("clears sticky referenced apps in the same transaction as the messages", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "sticky-app", path: "sticky-app" })
        .run().lastInsertRowid,
    );
    const referencedAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "other-app", path: "other-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({
          appId,
          referencedAppIds: [referencedAppId],
          executionBackend: "claude-code",
          claudeSessionId: "old-session",
          claudeSessionState: "ready",
        })
        .run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({ chatId, role: "user", content: "@app:other-app what is this?" })
      .run();

    await harness.invokeHandler("delete-messages", chatId);

    // Read access must not outlive the history that granted it: an empty chat
    // that still carries referenced ids would keep cross-app reads alive with
    // nothing on screen explaining why.
    expect(readStoredIds(chatId)).toEqual([]);
    expect(
      await harness.db.query.chats.findFirst({
        where: (row, { eq }) => eq(row.id, chatId),
      }),
    ).toMatchObject({ claudeSessionId: null, claudeSessionState: null });
    await expect(
      harness.db.query.messages.findMany({
        where: (row, { eq }) => eq(row.chatId, chatId),
      }),
    ).resolves.toEqual([]);
  });

  it("revokes a referenced app only after the in-flight turn has drained", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "revoke-app", path: "revoke-app" })
        .run().lastInsertRowid,
    );
    const detachedAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "detached-app", path: "detached-app" })
        .run().lastInsertRowid,
    );
    const keptAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "kept-app", path: "kept-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({ appId, referencedAppIds: [detachedAppId, keptAppId] })
        .run().lastInsertRowid,
    );

    drainHooks.onDrain = () => {
      deletionOrder.push(`ids-at-drain:${readStoredIds(chatId).join(",")}`);
    };

    await harness.invokeHandler("remove-chat-referenced-app", {
      chatId,
      appId: detachedAppId,
    });

    // The revoking write lands after the drain, so a stream that resolved the
    // whole reference set before the removal cannot persist it back.
    expect(deletionOrder).toEqual([
      "actor-barrier",
      "barrier",
      "drain-actor",
      "drain",
      `ids-at-drain:${detachedAppId},${keptAppId}`,
      "release",
      "actor-release",
    ]);
    expect(readStoredIds(chatId)).toEqual([keptAppId]);
  });

  it("throws NotFound when detaching a referenced app from a missing chat", async () => {
    await expect(
      harness.invokeHandler("remove-chat-referenced-app", {
        chatId: 4242,
        appId: 1,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Chat not found",
    });
  });

  function readStoredIds(chatId: number): number[] {
    return (
      harness.db
        .select({ referencedAppIds: chats.referencedAppIds })
        .from(chats)
        .where(eq(chats.id, chatId))
        .get()?.referencedAppIds ?? []
    );
  }
});
