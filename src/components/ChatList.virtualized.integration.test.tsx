import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { chats } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("ChatList virtualization (integration)", () => {
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

  it("renders only a window of rows when an app has many chats", async () => {
    const chatCount = 300;
    await harness.db.insert(chats).values(
      Array.from({ length: chatCount }, (_, i) => ({
        appId: harness.appId,
        title: `Bulk chat ${i}`,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)),
      })),
    );

    harness.mount({ withChatList: true });

    await waitFor(() => {
      expect(screen.getAllByTestId(/^chat-list-item-/).length).toBeGreaterThan(
        0,
      );
    });
    const rendered = screen.getAllByTestId(/^chat-list-item-/);
    expect(rendered.length).toBeLessThan(chatCount);
    expect(
      screen.getByTestId("chat-list-container").contains(rendered[0]),
    ).toBe(true);
    expect(screen.getAllByTestId(/^chat-group-/).length).toBeGreaterThan(0);
    // Newest seeded chat renders near the top, after the harness's own chat.
    const newestRow = rendered.find((row) =>
      row.textContent?.includes(`Bulk chat ${chatCount - 1}`),
    );
    expect(newestRow).toBeTruthy();
    expect(screen.queryByText("Bulk chat 0")).toBeNull();

    fireEvent.click(newestRow!);
    const newest = await harness.db.query.chats.findFirst({
      where: (c, { eq }) => eq(c.title, `Bulk chat ${chatCount - 1}`),
    });
    await waitFor(() => {
      expect(Number(harness.currentLocation().search.id)).toBe(newest?.id);
    });
  }, 60_000);
});
