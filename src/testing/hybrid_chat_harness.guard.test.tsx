// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: async () => {} },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { setupHybridChatHarness } from "@/testing/hybrid_chat_harness";

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
