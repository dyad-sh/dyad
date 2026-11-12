import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { asc, eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import { versionPreviewHandlerService } from "@/ipc/handlers/version_handlers";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("prompts submitted during undo", () => {
  let harness: HybridChatHarness;
  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });
  afterAll(async () => {
    await harness?.dispose();
  }, 60_000);

  it.each(["Enter", "Send"])(
    "queues %s submissions until undo finishes",
    async (method) => {
      const chatId = await harness.createChat();
      harness.mount({ chatId });
      const finished = harness.waitForNextStreamEnd(chatId);
      (
        await harness.typeInChat("tc=local-agent/write-index", { chatId })
      ).send();
      await finished;
      await harness.bridge.settleInFlight();
      const undo = await screen.findByRole("button", { name: /Undo/ });
      await waitFor(() => expect(undo.hasAttribute("disabled")).toBe(false));

      let releaseUndo!: () => void;
      const undoGate = new Promise<void>((resolve) => {
        releaseUndo = resolve;
      });
      const revert = versionPreviewHandlerService.revertVersion.bind(
        versionPreviewHandlerService,
      );
      const blockedUndo = vi
        .spyOn(versionPreviewHandlerService, "revertVersion")
        .mockImplementationOnce(async (...args) => {
          await undoGate;
          return revert(...args);
        });
      try {
        fireEvent.click(undo);
        await waitFor(() => expect(blockedUndo).toHaveBeenCalledOnce());
        const startCount = harness.eventCount("chat:stream:start");
        const prompt = "tc=local-agent/write-index-2";
        if (method === "Enter")
          await harness.pressEnterInChat(prompt, { chatId });
        else (await harness.typeInChat(prompt, { chatId })).send();

        const queue = await screen.findByTestId("queue-header");
        expect(within(queue).getByText(prompt)).toBeTruthy();
        expect(harness.eventCount("chat:stream:start")).toBe(startCount);
        const beforeUndo = await harness.db.query.messages.findMany({
          where: eq(messages.chatId, chatId),
        });
        expect(
          beforeUndo
            .filter((message) => message.role === "user")
            .map((message) => message.content),
        ).toEqual(["tc=local-agent/write-index"]);

        const queuedFinished = harness.waitForNextStreamEnd(chatId);
        releaseUndo();
        await queuedFinished;
        await harness.bridge.settleInFlight();
        const afterUndo = await harness.db.query.messages.findMany({
          where: eq(messages.chatId, chatId),
          orderBy: [asc(messages.id)],
        });
        expect(
          afterUndo
            .filter((message) => message.role === "user")
            .map((message) => message.content),
        ).toEqual([prompt]);
        expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
          "Testing:write-index(2)!",
        );
        await waitFor(() =>
          expect(screen.queryByTestId("queue-header")).toBeNull(),
        );
      } finally {
        releaseUndo();
        await harness.bridge.settleInFlight();
      }
    },
    60_000,
  );
});
