import type React from "react";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Version } from "@/ipc/types";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    computeItemKey,
    data,
    itemContent,
  }: {
    computeItemKey?: (index: number, item: Version) => string;
    data: Version[];
    itemContent: (index: number, item: Version) => React.ReactNode;
  }) => (
    <div data-testid="virtualized-version-list" data-total-count={data.length}>
      {data.map((item, index) => (
        <div key={computeItemKey?.(index, item) ?? item.oid}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}));

describe("version search (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function openVersionPane() {
    const versionButton = await screen.findByRole("button", {
      name: /^Version 2$/,
    });
    fireEvent.click(versionButton);
    await screen.findByText("Version History");
    await screen.findByTestId("virtualized-version-list");
  }

  async function closeVersionPane() {
    fireEvent.click(screen.getByLabelText("Close version pane"));
    await waitFor(() => {
      expect(screen.queryByText("Version History")).toBeNull();
    });
  }

  function searchVersions(query: string) {
    fireEvent.change(screen.getByLabelText("Search versions"), {
      target: { value: query },
    });
  }

  it("searches, filters, favorites, and persists version notes", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat("tc=write-index", { chatId });
    send();
    await harness.waitForStreamEnd(chatId);
    await screen.findByRole(
      "button",
      { name: /^Version 2$/ },
      { timeout: 20_000 },
    );

    await openVersionPane();

    await screen.findByText("init");
    await screen.findByText(/Version 2 \(/);
    await screen.findByLabelText("Search versions");

    searchVersions("1");
    await screen.findByText("init");

    searchVersions("nonexistent-query-xyz");
    await screen.findByText("No matching versions");

    fireEvent.click(screen.getByLabelText("Clear search"));
    await screen.findByText("init");
    await screen.findByText(/Version 2 \(/);

    const favoriteButton = screen.getByTestId("version-favorite-button-2");
    fireEvent.click(favoriteButton);
    await waitFor(() => {
      expect(
        favoriteButton.querySelector("svg")?.getAttribute("class"),
      ).toMatch(/(?:^|\s)fill-\[#6c55dc\]/);
    });

    const versionNote = "Stable landing screen";
    fireEvent.click(screen.getByLabelText("Add note for version 2"));
    const noteInput = await screen.findByLabelText("Note for version 2");
    expect(noteInput.getAttribute("maxlength")).toBe("10000");
    fireEvent.change(noteInput, {
      target: { value: versionNote },
    });
    fireEvent.blur(noteInput);

    await closeVersionPane();
    await openVersionPane();
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Note for version 2") as HTMLTextAreaElement)
          .value,
      ).toBe(versionNote);
    });
    expect(
      screen.getByRole("button", { name: /^Version 2$/ }).textContent,
    ).toBe("Version 2");

    fireEvent.click(
      screen.getByRole("button", { name: "Show favorite versions only" }),
    );
    await screen.findByTestId("version-row-2");
    expect(screen.queryByTestId("version-row-1")).toBeNull();

    await closeVersionPane();
    await openVersionPane();
    await screen.findByTestId("version-row-1");
    expect(
      (screen.getByLabelText("Note for version 2") as HTMLTextAreaElement)
        .value,
    ).toBe(versionNote);
    expect(
      screen
        .getByTestId("version-favorite-button-2")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toMatch(/(?:^|\s)fill-\[#6c55dc\]/);

    searchVersions("Stable landing");
    await screen.findByTestId("version-row-2");
    expect(screen.queryByTestId("version-row-1")).toBeNull();
    fireEvent.click(screen.getByLabelText("Clear search"));

    searchVersions("init");
    await screen.findByText("init");
  }, 60_000);
});
