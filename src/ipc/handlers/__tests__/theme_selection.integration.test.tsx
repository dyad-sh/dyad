import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

async function openThemesMenu() {
  const trigger = await screen.findByTestId("auxiliary-actions-menu");
  fireEvent.click(trigger);

  const themesItem = await screen.findByRole("menuitem", { name: /Themes/ });
  fireEvent.mouseDown(themesItem);

  await screen.findByTestId("theme-option-none");
}

function clickThemeOption(testId: string) {
  const option = screen.getByTestId(testId);
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

describe("theme selection (integration)", () => {
  let harness: HybridChatHarness;

  const getAppThemeId = async () => {
    const app = await harness.db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
      columns: { themeId: true },
    });
    return app?.themeId ?? null;
  };

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("persists app-specific theme selections", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await openThemesMenu();
    expect(screen.getByTestId("theme-option-none").className).toContain(
      "bg-primary/10",
    );

    clickThemeOption("theme-option-default");
    await waitFor(async () => expect(await getAppThemeId()).toBe("default"));

    await openThemesMenu();
    await waitFor(() =>
      expect(screen.getByTestId("theme-option-default").className).toContain(
        "bg-primary/10",
      ),
    );

    clickThemeOption("theme-option-none");
    await waitFor(async () => expect(await getAppThemeId()).toBeNull());

    await openThemesMenu();
    await waitFor(() =>
      expect(screen.getByTestId("theme-option-none").className).toContain(
        "bg-primary/10",
      ),
    );
  });
});
