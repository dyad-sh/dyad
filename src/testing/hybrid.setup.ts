import { configure, prettyDOM } from "@testing-library/dom";
import { afterEach, vi } from "vitest";
import log from "electron-log";
import type { RendererIpcBridge } from "./renderer_ipc_bridge";

// Quiet electron-log's console transport during tests: per-request info/debug
// chatter from IPC handlers otherwise floods vitest output. Warnings and
// errors still print. Override with DYAD_TEST_LOG_LEVEL=debug (or another
// electron-log level) when debugging a test.
log.transports.console.level =
  (process.env.DYAD_TEST_LOG_LEVEL as typeof log.transports.console.level) ??
  "warn";

type HybridBridgeDiagnosticGlobal = typeof globalThis & {
  __DYAD_HYBRID_BRIDGE__?: RendererIpcBridge;
};

configure({ asyncUtilTimeout: 5_000 });

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

// The tsc problem-report worker needs a compiled worker script and Electron
// app paths, neither of which exists under vitest — every problems check would
// otherwise fail and dump a TypeError stack into the test output.
vi.mock("@/ipc/processors/tsc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/processors/tsc")>();
  return {
    ...actual,
    runTypeScriptCheck: async () => ({ problems: [] }),
  };
});

vi.mock("react-i18next", async () => {
  const [common, settings, chat, home, errors] = await Promise.all([
    import("@/i18n/locales/en/common.json"),
    import("@/i18n/locales/en/settings.json"),
    import("@/i18n/locales/en/chat.json"),
    import("@/i18n/locales/en/home.json"),
    import("@/i18n/locales/en/errors.json"),
  ]);
  const resources: Record<string, unknown> = {
    common: common.default,
    settings: settings.default,
    chat: chat.default,
    home: home.default,
    errors: errors.default,
  };

  const readPath = (source: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, source);

  const interpolate = (
    value: string,
    options: Record<string, unknown>,
  ): string =>
    value.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_match, name: string) =>
      options[name] == null ? "" : String(options[name]),
    );

  const lookup = (
    key: string,
    namespaces: string[],
    options: Record<string, unknown>,
  ): string | undefined => {
    const [explicitNamespace, explicitKey] = key.includes(":")
      ? (key.split(/:(.*)/s).filter(Boolean) as [string, string])
      : [undefined, undefined];
    const candidateNamespaces = explicitNamespace
      ? [explicitNamespace]
      : namespaces;
    const lookupKey = explicitKey ?? key;

    for (const namespace of candidateNamespaces) {
      const value = readPath(resources[namespace], lookupKey);
      if (typeof value === "string") {
        return interpolate(value, options);
      }
    }
    return undefined;
  };

  const namespaceList = (ns?: string | string[]): string[] => {
    const namespaces = Array.isArray(ns) ? ns : ns ? [ns] : ["common"];
    return [...namespaces, "common"].filter(
      (namespace, index, all) => all.indexOf(namespace) === index,
    );
  };

  const makeT =
    (ns?: string | string[]) =>
    (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown) => {
      const fallback =
        typeof fallbackOrOptions === "string" ? fallbackOrOptions : undefined;
      const options =
        (typeof fallbackOrOptions === "object" && fallbackOrOptions !== null
          ? fallbackOrOptions
          : maybeOptions) ?? {};
      const optionRecord = options as Record<string, unknown>;
      return (
        lookup(key, namespaceList(ns), optionRecord) ??
        (typeof optionRecord.defaultValue === "string"
          ? optionRecord.defaultValue
          : fallback) ??
        key
      );
    };

  return {
    useTranslation: (ns?: string | string[]) => ({
      t: makeT(ns),
      i18n: { language: "en", changeLanguage: async () => {} },
    }),
    Trans: ({ children }: { children?: unknown }) => children ?? null,
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

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
