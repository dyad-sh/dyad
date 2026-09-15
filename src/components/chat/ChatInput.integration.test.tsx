import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { preflightSubscriptionTurn } from "@/ipc/services/subscription_turn_preflight";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

vi.mock("@/ipc/services/subscription_turn_preflight", () => ({
  preflightSubscriptionTurn: vi.fn(),
}));

describe("chat input during turn admission", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { enableDyadPro: false, providerSettings: {} },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
    vi.mocked(preflightSubscriptionTurn).mockReset();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it.each([
    { rejected: false, nextDraft: "tc=no-code-response" },
    { rejected: true, nextDraft: "" },
    { rejected: true, nextDraft: "A new draft" },
  ])(
    "clears before preflight and preserves drafts (rejected=$rejected, next=$nextDraft)",
    async ({ rejected, nextDraft }) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(preflightSubscriptionTurn).mockImplementation(async (model) => {
        await pending;
        if (rejected) {
          throw new DyadError("Out of credits", DyadErrorKind.Precondition);
        }
        return { model };
      });
      const chatId = await harness.createChat();
      harness.mount({ chatId });
      const submitted = "tc=no-code-response";
      const { send } = await harness.typeInChat(submitted, { chatId });
      send();
      try {
        // Assert before releasing admission: network speed cannot hide a regression.
        expect(harness.getChatInputValue(chatId)).toBe("");
        await waitFor(() =>
          expect(preflightSubscriptionTurn).toHaveBeenCalled(),
        );
        harness.setChatInputValue(nextDraft, { chatId });
      } finally {
        release();
      }
      await harness.bridge.settleInFlight();
      await waitFor(() => {
        expect(harness.getChatInputValue(chatId)).toBe(
          rejected
            ? nextDraft
              ? `${submitted}\n\n${nextDraft}`
              : submitted
            : nextDraft,
        );
      });
    },
    60_000,
  );
});
