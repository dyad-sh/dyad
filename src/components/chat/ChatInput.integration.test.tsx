import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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
      settings: {
        enableDyadPro: false,
        providerSettings: {},
        isTestMode: true,
      },
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
      harness.setChatAttachments([
        { name: "submitted.txt", content: "submitted", mimeType: "text/plain" },
      ]);
      const submitted = "tc=no-code-response";
      const { send } = await harness.typeInChat(submitted, { chatId });
      send();
      try {
        // Assert before releasing admission: network speed cannot hide a regression.
        expect(harness.getChatInputValue(chatId)).toBe("");
        const list = within(screen.getByTestId("messages-list"));
        expect(list.getAllByText(submitted)).toHaveLength(1);
        expect(list.queryByText(/^Sending(?:…|\.\.\.)$/)).toBeNull();
        expect(list.queryByTestId("restore-to-message-button")).toBeNull();
        expect(list.getByText("submitted.txt")).toBeTruthy();
        expect(
          within(screen.getByTestId("chat-input-container")).queryByText(
            "submitted.txt",
          ),
        ).toBeNull();
        await waitFor(() =>
          expect(preflightSubscriptionTurn).toHaveBeenCalled(),
        );
        harness.setChatInputValue(nextDraft, { chatId });
        harness.setChatAttachments([
          {
            name: "new-draft.txt",
            content: "new draft",
            mimeType: "text/plain",
          },
        ]);
      } finally {
        release();
      }
      await harness.bridge.settleInFlight();
      await waitFor(() => {
        const composer = within(screen.getByTestId("chat-input-container"));
        expect(composer.getByText("new-draft.txt")).toBeTruthy();
        expect(composer.queryAllByText("submitted.txt")).toHaveLength(
          rejected ? 1 : 0,
        );
        expect(
          within(screen.getByTestId("messages-list")).queryAllByText(submitted),
        ).toHaveLength(rejected ? 0 : 1);
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
