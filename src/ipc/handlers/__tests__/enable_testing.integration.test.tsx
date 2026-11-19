import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { apps, messages } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { userInputRegistry } from "@/user_input/main";
import {
  ENABLE_TESTING_FOLLOW_UP_PROMPT,
  DECLINE_TESTING_FOLLOW_UP_PROMPT,
} from "@/user_input/transition";

describe("enable testing from chat", () => {
  let harness: HybridChatHarness;
  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);
  afterEach(() => cleanup());
  afterAll(async () => {
    await harness?.dispose();
  });

  it.each([true, false])(
    "waits for enabled=%s and automatically resumes with the decision persisted",
    async (enabled) => {
      await harness.db
        .update(apps)
        .set({ testingEnabled: false, needsAppBlueprint: false })
        .where(eq(apps.id, harness.appId));
      const chatId = await harness.createChat();
      harness.mount({ chatId });
      await harness.selectChatMode("local-agent");
      const { send } = await harness.typeInChat(
        "tc=local-agent/enable-testing Please add tests.",
        { chatId },
      );
      send();
      await screen.findByTestId("enable-testing-card", undefined, {
        timeout: 20_000,
      });
      expect(
        screen.queryByText("Resumed after the testing decision."),
      ).toBeNull();
      const request = userInputRegistry
        .getPending()
        .find(
          (entry) =>
            entry.descriptor.chatId === chatId &&
            entry.descriptor.kind === "enable-testing",
        );
      expect(request?.status).toBe("awaiting");
      // Reload the renderer while the model is parked. The durable card and main
      // snapshot must be enough to recover the action without a new model call.
      cleanup();
      harness.mount({ chatId });
      await screen.findByRole("button", { name: "Enable testing" });
      fireEvent.click(
        screen.getByRole("button", {
          name: enabled ? "Enable testing" : "Not now",
        }),
      );
      await harness.waitForStreamEnd(chatId);
      await harness.waitForStreamEnd(chatId);
      await screen.findByText("Resumed after the testing decision.");
      expect(screen.queryByTestId("enable-testing-card")).toBeNull();
      const app = await harness.db.query.apps.findFirst({
        where: eq(apps.id, harness.appId),
      });
      expect(app?.testingEnabled).toBe(enabled);
      const followUps = await harness.db.query.messages.findMany({
        where: eq(messages.userInputRequestId, request!.descriptor.requestId),
      });
      expect(followUps).toHaveLength(1);
      expect(followUps[0].content).toBe(
        enabled
          ? ENABLE_TESTING_FOLLOW_UP_PROMPT
          : DECLINE_TESTING_FOLLOW_UP_PROMPT,
      );
      expect(
        userInputRegistry
          .getPending()
          .some((entry) => entry.descriptor.chatId === chatId),
      ).toBe(false);
      expect(
        harness.bridge.sentEvents.filter(
          (event) => event.channel === "chat:response:error",
        ),
      ).toHaveLength(0);
    },
    60_000,
  );

  it("does not enable testing when cancellation wins while approval waits for metadata", async () => {
    await harness.db
      .update(apps)
      .set({ testingEnabled: false })
      .where(eq(apps.id, harness.appId));
    const chatId = await harness.createChat();
    const requestId = userInputRegistry.request({
      kind: "enable-testing",
      chatId,
      appId: harness.appId,
      classifier: "none",
      followUpPrompt: ENABLE_TESTING_FOLLOW_UP_PROMPT,
    });
    const parked = userInputRegistry.park(requestId);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocker = appOperationCoordinator.run(
      {
        appId: harness.appId,
        operation: "test-hold-metadata",
        resources: ["metadata"],
      },
      async () => {
        started();
        await gate;
      },
    );
    await ready;
    try {
      const approval = ipc.userInput.respond({
        requestId,
        response: { kind: "enable-testing", enabled: true },
      });
      const rejected = expect(approval).rejects.toThrow("no longer pending");
      await waitFor(() =>
        expect(
          harness.bridge.lastInvoke("user-input:respond")?.args[0],
        ).toMatchObject({ requestId }),
      );
      userInputRegistry.sweepChat(chatId);
      release();
      await blocker;
      await rejected;
      expect(await parked).toBeNull();
      const app = await harness.db.query.apps.findFirst({
        where: eq(apps.id, harness.appId),
      });
      expect(app?.testingEnabled).toBe(false);
    } finally {
      release();
      await blocker;
      userInputRegistry.sweepChat(chatId);
    }
  });
});
