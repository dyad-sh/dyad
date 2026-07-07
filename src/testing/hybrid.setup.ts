import { prettyDOM } from "@testing-library/dom";
import { afterEach, vi } from "vitest";
import type { RendererIpcBridge } from "./renderer_ipc_bridge";

type HybridBridgeDiagnosticGlobal = typeof globalThis & {
  __DYAD_HYBRID_BRIDGE__?: RendererIpcBridge;
};

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

export { h };

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

afterEach(({ task }) => {
  if (task.result?.state !== "fail") return;

  const body = globalThis.document?.body;
  if (!body) return;

  console.error(
    [
      "\n[hybrid.setup] DOM at test failure:",
      prettyDOM(body, 20_000) ?? "<empty document.body>",
    ].join("\n"),
  );

  const bridge = (globalThis as HybridBridgeDiagnosticGlobal)
    .__DYAD_HYBRID_BRIDGE__;
  if (!bridge) return;

  console.error(
    [
      "[hybrid.setup] Recent bridge event channels:",
      JSON.stringify(
        bridge.sentEvents.slice(-20).map((event) => event.channel),
      ),
    ].join("\n"),
  );
});
