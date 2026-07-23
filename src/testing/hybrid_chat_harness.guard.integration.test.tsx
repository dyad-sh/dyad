import { describe, expect, it } from "vitest";

import { screen } from "@testing-library/react";

import { setupHybridChatHarness } from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

type TestWindow = Window &
  typeof globalThis & {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      };
    };
  };

describe("hybrid chat harness guards", () => {
  it("mounts non-chat surfaces without pulling preview UI into the DOM", async () => {
    const surfaceCases = [
      {
        route: "/app-details" as const,
        testId: "app-details-page",
        withTitleBar: true,
      },
      { route: "/database" as const, testId: "database-section" },
      { route: "/settings" as const, text: "Settings" },
      {
        route: "/settings/providers/$provider" as const,
        text: "Configure Dyad",
      },
      { route: "/library/media" as const, text: "Media" },
      { route: "/import-app" as const, text: "Import App" },
    ];

    for (const surface of surfaceCases) {
      const harness = await setupHybridChatHarness({
        electronMock: h,
        settings: { isTestMode: true },
      });
      try {
        harness.mountSurface({
          route: surface.route,
          withTitleBar: surface.withTitleBar,
        });

        if (surface.testId) {
          expect(await screen.findByTestId(surface.testId)).toBeTruthy();
        } else if (surface.text) {
          expect(await screen.findByText(surface.text)).toBeTruthy();
        }
        expect(screen.queryByTestId("preview-iframe-element")).toBeNull();
        // FileEditor has no root testid; its header save button renders
        // unconditionally, so it proxies "FileEditor mounted".
        expect(screen.queryByTestId("save-file-button")).toBeNull();
      } finally {
        await harness.dispose();
      }
    }
  }, 120_000);

  it("fails dispose on missing renderer channels and clears the setup guard", async () => {
    const harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });

    // A channel OUTSIDE the preload whitelist throws synchronously, exactly
    // like preload.ts does in the packaged app.
    expect(() =>
      (window as TestWindow).electron.ipcRenderer.invoke(
        "missing:test-channel",
      ),
    ).toThrow("Invalid channel: missing:test-channel");

    // A whitelisted channel with no registered handler (the test:* channels
    // are always whitelisted but only registered in E2E builds) rejects and
    // is recorded in missingChannels, failing dispose.
    await expect(
      (window as TestWindow).electron.ipcRenderer.invoke("test:set-node-mock"),
    ).rejects.toThrow("test:set-node-mock");

    await expect(harness.dispose()).rejects.toThrow("test:set-node-mock");

    const nextHarness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    await nextHarness.dispose();
  }, 60_000);

  it("provides a deterministic clock for first-prompt timer transitions", async () => {
    const harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });

    try {
      expect(() => harness.advanceFirstPromptClock(1)).toThrow(
        "mountSurface() must be called",
      );

      harness.mountSurface({ route: "/settings" });
      expect(() => harness.advanceFirstPromptClock(60_000)).not.toThrow();
    } finally {
      await harness.dispose();
    }
  }, 60_000);
});
