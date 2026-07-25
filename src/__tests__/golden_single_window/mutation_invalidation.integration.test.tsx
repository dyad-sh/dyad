import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("golden single-window: production mutation invalidation", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("invalidates each collection once through chat and app mutation UIs", async () => {
    harness.mount({ withChatList: true });
    await screen.findByTestId("chat-list-container");

    const queryClient = harness.queryClient();
    const invalidations: QueryKey[] = [];
    const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
      invalidations.push(filters?.queryKey ?? []);
      return originalInvalidate(filters);
    });

    const newChatButtons = await screen.findAllByTestId("new-chat-button");
    fireEvent.click(newChatButtons[0]);
    await waitFor(() =>
      expect(Number(harness.currentLocation().search.id)).not.toBe(
        harness.chatId,
      ),
    );
    // Protects chat-create deduplication in the Phase B invalidation channel.
    expect(
      invalidations.filter((key) => key === queryKeys.chats.all),
    ).toHaveLength(1);

    invalidations.length = 0;
    const selectedChatId = Number(harness.currentLocation().search.id);
    await screen.findByTestId(`chat-list-item-${selectedChatId}`);
    await harness.openPopover(
      (
        await screen.findAllByRole("button", {
          name: "Chat actions for New Chat",
        })
      )[0],
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Rename Chat",
      }),
    );
    const renameDialog = await screen.findByRole("dialog", {
      name: "Rename Chat",
    });
    fireEvent.change(within(renameDialog).getByLabelText("Title"), {
      target: { value: "Golden renamed chat" },
    });
    fireEvent.click(within(renameDialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByText("Golden renamed chat")).toBeTruthy(),
    );
    // Protects chat-update deduplication in the Phase B invalidation channel.
    expect(
      invalidations.filter((key) => key === queryKeys.chats.all),
    ).toHaveLength(1);

    invalidations.length = 0;
    await act(async () => {
      await harness.router().navigate({
        to: "/app-details",
        search: { appId: harness.appId },
      });
    });
    await screen.findByTestId("app-details-page");
    await harness.openPopover(
      await screen.findByTestId("app-details-more-options-button"),
    );
    await harness.clickMenuItem("Delete");
    await harness.confirmDialog(/Delete "/, "Delete App");
    await waitFor(() => expect(harness.currentLocation().pathname).toBe("/"));

    // Protects app-delete deduplication in the Phase B invalidation channel.
    expect(
      invalidations.filter((key) => key === queryKeys.appCollections.all),
    ).toHaveLength(1);
    expect(
      invalidations.filter((key) => key === queryKeys.apps.all),
    ).toHaveLength(1);
  }, 60_000);
});
