import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { chats } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const LONG_TITLE =
  "Plan an Indian restaurant website with online ordering and table booking";
const SHORT_TITLE = "Short chat";

// happy-dom has no layout, so simulate the sidebar cutting off long titles.
function mockTitleLayout() {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.textContent === LONG_TITLE ? 400 : 80;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(160);
}

function hover(element: HTMLElement) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
  fireEvent.pointerMove(element, { pointerType: "mouse" });
  fireEvent.mouseMove(element);
}

describe("ChatList title tooltip (integration)", () => {
  let harness: HybridChatHarness;
  let longChatId: number;
  let shortChatId: number;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    await harness.db
      .update(chats)
      .set({ title: LONG_TITLE })
      .where(eq(chats.id, harness.chatId));
    longChatId = harness.chatId;
    const [shortChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, title: SHORT_TITLE })
      .returning();
    shortChatId = shortChat.id;
  }, 60_000);

  // Testing Library unmounts after every test, so mount per test.
  beforeEach(() => {
    mockTitleLayout();
    harness.mount({ withChatList: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows the full title on hover when the title is truncated", async () => {
    const row = await screen.findByTestId(
      `chat-list-item-${longChatId}`,
      {},
      { timeout: 10_000 },
    );
    // The row stays a single button: the tooltip trigger must not nest one.
    expect(row.tagName).toBe("BUTTON");
    expect(row.querySelector("button")).toBeNull();
    expect(row.className).toContain("h-auto");

    hover(row);

    // The tooltip waits 500ms so it doesn't flash while scanning the list.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getAllByText(LONG_TITLE)).toHaveLength(1);

    await waitFor(
      () => {
        // Title text appears twice: the truncated row label and the tooltip.
        expect(screen.getAllByText(LONG_TITLE)).toHaveLength(2);
      },
      { timeout: 3_000 },
    );
  }, 15_000);

  it("does not show a tooltip when the title fits", async () => {
    const row = await screen.findByTestId(
      `chat-list-item-${shortChatId}`,
      {},
      { timeout: 10_000 },
    );

    hover(row);

    // Wait past the 500ms open delay before asserting nothing opened.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(screen.getAllByText(SHORT_TITLE)).toHaveLength(1);
  }, 15_000);
});
