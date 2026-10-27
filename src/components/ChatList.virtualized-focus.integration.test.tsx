import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode, Ref } from "react";
import { chats } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

// jsdom has no layout, so the real Virtuoso cannot scroll. This stand-in
// renders a fixed window of rows that scrollToIndex moves, like Virtuoso does.
vi.mock("react-virtuoso", async (importOriginal) => {
  const { useImperativeHandle, useState } = await import("react");
  const WINDOW_SIZE = 30;
  return {
    ...(await importOriginal<typeof import("react-virtuoso")>()),
    Virtuoso: function FakeVirtuoso<T>({
      ref,
      data,
      computeItemKey,
      itemContent,
      components,
    }: {
      ref?: Ref<{ scrollToIndex: (location: { index: number }) => void }>;
      data: T[];
      computeItemKey: (index: number, item: T) => string;
      itemContent: (index: number, item: T) => ReactNode;
      components: {
        List: ComponentType<{ children: ReactNode }>;
        Item: ComponentType<{ item: T; children: ReactNode }>;
      };
    }) {
      const [start, setStart] = useState(0);
      useImperativeHandle(ref, () => ({
        scrollToIndex: ({ index }) =>
          setStart(Math.max(0, index - WINDOW_SIZE / 2)),
      }));
      const { List, Item } = components;
      return (
        <List>
          {data.slice(start, start + WINDOW_SIZE).map((item, offset) => (
            <Item key={computeItemKey(start + offset, item)} item={item}>
              {itemContent(start + offset, item)}
            </Item>
          ))}
        </List>
      );
    },
  };
});

describe("ChatList virtualized favorite focus (integration)", () => {
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

  it("keeps keyboard focus on a favorite that moves outside the rendered rows", async () => {
    await harness.db.insert(chats).values(
      Array.from({ length: 300 }, (_, i) => ({
        appId: harness.appId,
        title: `Bulk chat ${i}`,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)),
      })),
    );
    // Once unfavorited, the oldest chat sorts last, far past the rendered rows.
    const [oldest] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        title: "Oldest favorite",
        isFavorite: true,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      })
      .returning();

    harness.mount({ withChatList: true });

    const favoriteButton = await screen.findByTestId(
      `chat-favorite-button-${oldest.id}`,
    );
    favoriteButton.focus();
    // detail: 0 is a keyboard activation, which restores focus.
    fireEvent.click(favoriteButton, { detail: 0 });

    await waitFor(() => {
      const moved = screen.getByTestId(`chat-favorite-button-${oldest.id}`);
      expect(moved.getAttribute("aria-pressed")).toBe("false");
      expect(document.activeElement).toBe(moved);
    });
    expect(screen.queryByText("Bulk chat 299")).toBeNull();
  }, 60_000);
});
