import { describe, expect, it } from "vitest";

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
});
