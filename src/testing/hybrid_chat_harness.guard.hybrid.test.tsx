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

    await expect(
      (window as TestWindow).electron.ipcRenderer.invoke(
        "missing:test-channel",
      ),
    ).rejects.toThrow("missing:test-channel");

    await expect(harness.dispose()).rejects.toThrow("missing:test-channel");

    const nextHarness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    await nextHarness.dispose();
  }, 60_000);
});
