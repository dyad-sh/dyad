import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { chats } from "@/db/schema";
import { ipc } from "@/ipc/types";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("ChatList favorites (integration)", () => {
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

  it("pins favorite chats without losing keyboard focus or scroll position", async () => {
    await harness.db
      .update(chats)
      .set({
        title: "Selected chat",
        createdAt: new Date("2025-01-03T00:00:00Z"),
      })
      .where(eq(chats.id, harness.chatId));
    const [olderChat] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        title: "Older chat",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })
      .returning();

    harness.mount({ withChatList: true });
    expect(screen.queryByTestId("chat-group-favorites")).toBeNull();

    const listContainer = await screen.findByTestId("chat-list-container");
    expect(listContainer.className).toContain("overflow-x-hidden");
    listContainer.scrollTop = 120;
    const olderFavoriteButton = await screen.findByRole("button", {
      name: "Add Older chat to favorites",
    });
    expect(olderFavoriteButton.className).not.toContain("group-hover/chat-row");
    expect(
      screen.getByRole("button", {
        name: "Chat actions for Older chat",
      }).className,
    ).toContain("group-hover/chat-row:opacity-100");
    olderFavoriteButton.focus();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const setChatFavorite = ipc.chat.setChatFavorite.bind(ipc.chat);
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutationSpy = vi
      .spyOn(ipc.chat, "setChatFavorite")
      .mockImplementation(async (params) => {
        await mutationGate;
        return setChatFavorite(params);
      });
    fireEvent.click(olderFavoriteButton, { detail: 0 });

    const favoritesGroup = await screen.findByTestId("chat-group-favorites");
    expect(within(favoritesGroup).getByText("Older chat")).toBeTruthy();
    expect(screen.getAllByText("Older chat")).toHaveLength(1);
    await waitFor(() => {
      const pendingFavoriteButton = screen.getByRole("button", {
        name: "Remove Older chat from favorites",
      });
      expect(document.activeElement).toBe(pendingFavoriteButton);
      expect(document.activeElement?.getAttribute("aria-disabled")).toBe(
        "true",
      );
      expect(pendingFavoriteButton.className).not.toContain(
        "aria-disabled:pointer-events-none",
      );
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(listContainer.scrollTop).toBe(120);
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Older chat from favorites",
      }),
    );
    expect(mutationSpy).toHaveBeenCalledTimes(1);
    expect(Number(harness.currentLocation().search.id)).toBe(harness.chatId);
    releaseMutation();
    focusSpy.mockRestore();
    await waitFor(async () => {
      const persisted = await harness.db.query.chats.findFirst({
        where: eq(chats.id, olderChat.id),
      });
      expect(persisted?.isFavorite).toBe(true);
    });
    mutationSpy.mockRestore();

    await harness.openPopover(
      screen.getByRole("button", {
        name: "Chat actions for Selected chat",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Add to favorites",
      }),
    );

    await waitFor(() => {
      const favoriteRows = within(
        screen.getByTestId("chat-group-favorites"),
      ).getAllByTestId(/^chat-list-item-/);
      expect(favoriteRows).toHaveLength(2);
      expect(favoriteRows[0].textContent).toContain("Selected chat");
      expect(favoriteRows[1].textContent).toContain("Older chat");
    });
    expect(Number(harness.currentLocation().search.id)).toBe(harness.chatId);

    await harness.openPopover(
      screen.getByRole("button", {
        name: "Chat actions for Selected chat",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Remove from favorites",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Older chat from favorites",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-group-favorites")).toBeNull();
      expect(
        within(screen.getByTestId("chat-group-older")).getByText("Older chat"),
      ).toBeTruthy();
    });

    harness.seedChatStreamResidue(olderChat.id);
    expect(harness.hasChatStreamResidue(olderChat.id)).toBe(true);
    await harness.openPopover(
      screen.getByRole("button", {
        name: "Chat actions for Older chat",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Delete Chat",
      }),
    );
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "Delete Chat",
    });
    fireEvent.click(
      within(deleteDialog).getByRole("button", { name: "Delete Chat" }),
    );

    await waitFor(async () => {
      const deleted = await harness.db.query.chats.findFirst({
        where: eq(chats.id, olderChat.id),
      });
      expect(deleted).toBeUndefined();
      expect(harness.hasChatStreamResidue(olderChat.id)).toBe(false);
    });
  }, 60_000);
});
