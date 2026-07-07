/**
 * setupHybridChatHarness — the "hybrid" chat-flow harness: the real React
 * <ChatPanel> (React Testing Library under happy-dom) wired to the REAL
 * main-process IPC handlers in the same Node process.
 *
 * It composes three pieces:
 *   1. the node `setupChatFlowHarness` (real fake-LLM HTTP server, real sqlite,
 *      real git checkout, real chat:stream handler) — reused, not duplicated;
 *   2. `registerIpcHandlers()` — the SAME registration main.ts runs, so every
 *      channel the UI invokes (settings:get, chat:get, get-proposal, versions,
 *      token counts, ...) has a real handler;
 *   3. `installRendererIpcBridge` — a fake `window.electron` whose `invoke()`
 *      calls those captured handlers and whose event bus feeds renderer
 *      listeners, closing the loop both ways.
 *
 * The result: clicking the real Send button drives the whole stack and the
 * streamed assistant message renders in the DOM, exactly like production.
 *
 * WHEN TO USE HYBRID vs NODE: reach for the node harness
 * (`setupChatFlowHarness`) whenever a test only needs to assert on files / git /
 * db / the LLM request payload — it is faster and has no DOM. Use the hybrid
 * harness only when the assertion is about the RENDERED UI (a streamed message
 * appearing, an approval control, input clearing, a banner) or about a flow that
 * can only be driven through real UI events. See HYBRID_HARNESS.md.
 *
 * Hybrid harness tests run under the `integration` Vitest project, which
 * supplies happy-dom, the shared electron/posthog/i18n mocks, and the hoisted
 * electron mock handle exported from `src/testing/hybrid.setup.ts`.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createStore, Provider } from "jotai";
import React, { Suspense, lazy, useEffect } from "react";
import { Toaster } from "sonner";
import { fetch as undiciFetch } from "undici";
import { expect } from "vitest";

// IMPORTANT: `./chat_flow_harness` must be imported BEFORE `@/components/ChatPanel`.
// Loading it first pulls an app module that initializes `tslib`'s CJS interop
// helpers; without that, ChatPanel's transitive `react-remove-scroll` (Radix)
// throws "tslib_1.__importStar is not a function" at module load. Do not
// reorder these two below each other.
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
  type ChatFlowHarnessOptions,
} from "./chat_flow_harness";
import type { RendererEvent } from "./electron_mock";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { chatInputValuesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { registerRendererIpcListeners } from "@/app_wiring/registerRendererIpcListeners";
import { useQueueProcessor } from "@/hooks/useQueueProcessor";
import { usePlanEvents } from "@/hooks/usePlanEvents";
import { useAppBlueprintEvents } from "@/hooks/useAppBlueprintEvents";
import { ChatPanel } from "@/components/ChatPanel";
import { AppList } from "@/components/AppList";
import { ChatList } from "@/components/ChatList";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import { PlanPanel } from "@/components/preview_panel/PlanPanel";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TitleBar } from "@/app/TitleBar";
import { DeepLinkProvider } from "@/contexts/DeepLinkContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { chats } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { setModelClientFetchForTesting } from "@/ipc/utils/get_model_client";
// Import from the dedicated schema module, NOT "@/routes/chat": the route file
// statically imports ChatPage -> PreviewPanel -> Monaco, which would load into
// every hybrid test and throw "Canceled" rejections on teardown.
import { chatSearchSchema } from "@/routes/chatSearchSchema";
import { appDetailsSearchSchema } from "@/routes/appDetailsSearchSchema";

import {
  installRendererIpcBridge,
  type RendererIpcBridge,
} from "./renderer_ipc_bridge";

const SECOND_SETUP_ERROR =
  "Second harness setup in one process — one harness per test FILE " +
  "(forks pool isolation); split the file";

let activeHybridChatHarness = false;
type JotaiStore = ReturnType<typeof createStore>;
type HybridLocation = {
  href: string;
  pathname: string;
  search: Record<string, unknown>;
};
type HybridRouter = {
  state: { location: HybridLocation };
  navigate: (opts: unknown) => unknown;
};
type HybridBridgeDiagnosticGlobal = typeof globalThis & {
  __DYAD_HYBRID_BRIDGE__?: RendererIpcBridge;
};

const LazyAppDetailsPage = lazy(() => import("@/pages/app-details"));
const LazySettingsPage = lazy(() => import("@/pages/settings"));
const LazyMediaPage = lazy(() => import("@/pages/media"));
const LazyProviderSettingsPage = lazy(() =>
  import("@/components/settings/ProviderSettingsPage").then((module) => ({
    default: module.ProviderSettingsPage,
  })),
);
const LazyDatabaseSection = lazy(() =>
  import("@/components/preview_panel/DatabaseSection").then((module) => ({
    default: module.DatabaseSection,
  })),
);

export interface HybridChatHarnessOptions extends ChatFlowHarnessOptions {
  /**
   * Silence React's "not wrapped in act(...)" warnings by wrapping the bridge's
   * event dispatch in `act`. Async main->renderer events (stream chunks) update
   * renderer state outside any test-initiated `act` scope; the tests already
   * flush them via `waitFor`. Default true. Set false only when debugging a real
   * act-related issue.
   */
  silenceActWarnings?: boolean;
  /**
   * Fail dispose when renderer code invoked a channel with no registered
   * main-process handler. Default true; opt out only for a test that is
   * intentionally exercising that failure path.
   */
  assertNoMissingChannels?: boolean;
  /**
   * Emulate the E2E test build's import-time feature gates before importing
   * the main-process IPC graph. This routes GitHub/Neon handlers to the
   * harness fake server.
   */
  testBuild?: boolean;
}

export type HybridSurfaceRoute =
  | "/"
  | "/chat"
  | "/app-details"
  | "/database"
  | "/settings"
  | "/settings/providers/$provider"
  | "/library/media"
  | "/media";

export interface MountOptions {
  /** Chat to load. Default: the harness's default chat. */
  chatId?: number;
  /** App to select. Default: the harness's default app. */
  appId?: number;
  /** Install the same main->renderer listeners AppRoot registers. Default true. */
  wireAppEvents?: boolean;
  /** Render the plan preview panel alongside ChatPanel for plan-mode tests. */
  withPlanPanel?: boolean;
  /** Render the real app sidebar list next to the mounted route. */
  withAppList?: boolean;
  /** Render the real chat sidebar list next to the mounted route. */
  withChatList?: boolean;
  /** Render the real telemetry privacy banner next to the mounted route. */
  withPrivacyBanner?: boolean;
}

export interface MountSurfaceOptions extends MountOptions {
  /** Route to mount. Default: "/chat". */
  route?: HybridSurfaceRoute;
  /** Route search params. Defaults are filled for chat/app-details. */
  search?: Record<string, unknown>;
  /** Route params, e.g. `{ provider: "auto" }` for provider settings. */
  params?: Record<string, string>;
  /** Render the real title bar above the mounted route. */
  withTitleBar?: boolean;
}

export interface TypeInChatResult {
  /** The real Send button (enabled). */
  sendButton: HTMLElement;
  /** Click Send — runs the real ChatInput.handleSubmit path. */
  send: () => void;
}

export interface HybridChatHarness extends ChatFlowHarness {
  /** The renderer<->main bridge (missingChannels, sentEvents, settleInFlight). */
  bridge: RendererIpcBridge;

  /**
   * Render the real <ChatPanel> for a chat, with the router/query/jotai
   * scaffolding it needs. Returns RTL's RenderResult. Call once per test (a
   * second call reseeds the store and renders a second tree — prefer separate
   * `it`s or remount only when you know why).
   */
  mount: (opts?: MountOptions) => RenderResult;

  /**
   * Render a supported app surface with the same query/jotai/theme/router
   * scaffolding as `mount()`, backed by the real IPC handlers.
   */
  mountSurface: (opts?: MountSurfaceOptions) => RenderResult;

  /** The most recently mounted private router. */
  router: () => HybridRouter;

  /** Current private router location, for navigation assertions. */
  currentLocation: () => HybridRouter["state"]["location"];

  /** Set the active selected app in the mounted Jotai store. */
  setSelectedAppId: (appId: number | null) => void;

  /** Drive a Base UI popover/menu trigger in happy-dom. */
  openPopover: (trigger: HTMLElement) => Promise<void>;

  /** Click an item inside an already-open popover/menu/dialog. */
  clickMenuItem: (name: string | RegExp) => Promise<HTMLElement>;

  /** Find a Base UI dialog by accessible name. */
  findDialog: (name: string | RegExp) => Promise<HTMLElement>;

  /** Click a dialog action button and wait for the dialog to close. */
  confirmDialog: (
    dialogName: string | RegExp,
    buttonName: string | RegExp,
  ) => Promise<void>;

  /** Toggle a Base UI switch and wait for its checked state. */
  setSwitch: (switchElement: HTMLElement, checked: boolean) => Promise<void>;

  /**
   * Seed the chat input the way LexicalChatInput's onChange does (happy-dom
   * can't type into its contenteditable), then wait for Send to enable. Returns
   * the button and a `send()` click helper.
   */
  typeInChat: (text: string, opts?: MountOptions) => Promise<TypeInChatResult>;

  /**
   * Seed the chat input without waiting for Send to enable. Use this when the
   * scenario expects Send to stay disabled, e.g. while a proposal is pending.
   */
  setChatInputValue: (text: string, opts?: MountOptions) => void;

  /**
   * Seed the chat input, then submit via the Lexical Enter command (a real
   * keydown on the contenteditable, handled by EnterKeyPlugin ->
   * ChatInput.handleSubmit). This is the only submit path available while a
   * stream is active — the Send button is swapped for Cancel — and submitting
   * during a stream QUEUES the prompt, exactly like pressing Enter in the app.
   */
  pressEnterInChat: (text: string, opts?: MountOptions) => Promise<void>;

  /**
   * Resolve with the next NOT-YET-CONSUMED `chat:response:end` event
   * (optionally for a chatId). Each call consumes one matching event: the
   * first call in a test resolves on the first turn's end (even if it already
   * arrived), a second call genuinely waits for the second turn's end — a
   * stale prior-turn event can never satisfy a later wait. For capturing an
   * explicit pre-action baseline (e.g. before a Retry click), use
   * `waitForNextStreamEnd`.
   */
  waitForStreamEnd: (
    chatId?: number,
    timeoutMs?: number,
  ) => Promise<RendererEvent>;

  /**
   * Baseline-aware end-of-stream: snapshots the current count of
   * `chat:response:end` events (optionally for `chatId`) SYNCHRONOUSLY, then
   * resolves only when a NEW one arrives past that baseline. This is the correct
   * gate for a second turn / retry in the same `it`. Call it right before the
   * action that starts the new turn (or capture the returned promise before, and
   * await it after) so a stale end from a prior turn can't satisfy it.
   */
  waitForNextStreamEnd: (
    chatId?: number,
    timeoutMs?: number,
  ) => Promise<RendererEvent>;

  /** How many events on `channel` the bridge has received so far (a baseline). */
  eventCount: (channel: string) => number;

  /** Resolve with the first bridge event on `channel` matching `predicate`. */
  waitForEvent: (
    channel: string,
    predicate?: (payload: unknown) => boolean,
    timeoutMs?: number,
  ) => Promise<RendererEvent>;

  /**
   * Wait until matching rendered text exists and the match count is stable
   * across two wait ticks. Useful around stream end, where streamed and
   * persisted renderings can briefly overlap.
   */
  waitForRenderedText: (
    matcher: string | RegExp,
    timeoutMs?: number,
  ) => Promise<HTMLElement[]>;

  /**
   * Drive a Base UI `<Select>` (Radix-style) to an option in happy-dom, where a
   * bare click does nothing. Focuses + ArrowDown to open the popup, then
   * pointerDown+pointerUp+click+Enter on the matched option to commit it.
   */
  selectFromBaseUiSelect: (
    trigger: HTMLElement,
    optionMatcher: string | RegExp,
  ) => Promise<void>;

  /**
   * Convenience over `selectFromBaseUiSelect` for the chat-mode selector: opens
   * the `chat-mode-selector` and picks `mode`, then waits for the trigger's
   * aria-label to reflect it (which persists chatMode onto the chat row).
   */
  selectChatMode: (
    mode: "build" | "ask" | "plan" | "local-agent",
  ) => Promise<void>;

  /** Insert a new chat row (same app by default) and return its id. */
  createChat: (appId?: number) => Promise<number>;

  github: {
    pushEvents: () => Promise<unknown>;
    clearPushEvents: () => Promise<void>;
    resetRepos: () => Promise<void>;
  };
}

/** Bridge sentEvents store `{ channel, args }`; the payload is `args[0]`. */
function eventPayload(e: { args: unknown[] }): unknown {
  return e.args[0];
}

const HYBRID_EXTRA_ENV_KEYS = [
  "DYAD_SKIP_MANAGED_PNPM_INSTALL",
  "E2E_TEST_BUILD",
  "FAKE_LLM_PORT",
] as const;

function snapshotHybridEnv(): Map<string, string | undefined> {
  return new Map(HYBRID_EXTRA_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreHybridEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function encodeSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function HybridAppEventWiring({
  store,
  queryClient,
}: {
  store: JotaiStore;
  queryClient: QueryClient;
}) {
  useEffect(
    () =>
      registerRendererIpcListeners({
        ipcClient: ipc,
        store,
        queryClient,
      }),
    [queryClient, store],
  );
  return null;
}

// The real app runs the queue processor at the layout level
// (src/app/layout.tsx), above the chat route — so queued prompts drain even
// when the chat page is closed. Mount the SAME hook here (hasChatId: false
// internally, so it needs no router context) rather than replicating its
// logic.
function HybridAppShellHooks() {
  useQueueProcessor();
  usePlanEvents();
  useAppBlueprintEvents();
  return null;
}

export async function setupHybridChatHarness(
  options: HybridChatHarnessOptions,
): Promise<HybridChatHarness> {
  if (activeHybridChatHarness) {
    throw new Error(SECOND_SETUP_ERROR);
  }
  activeHybridChatHarness = true;

  const envSnapshot = snapshotHybridEnv();
  process.env.DYAD_SKIP_MANAGED_PNPM_INSTALL = "true";
  if (options.testBuild) {
    process.env.E2E_TEST_BUILD = "true";
  }
  setModelClientFetchForTesting(
    undiciFetch as unknown as Parameters<
      typeof setModelClientFetchForTesting
    >[0],
  );

  let node: ChatFlowHarness | undefined;

  try {
    // registerIpcHandlers() below registers the chat:stream handlers; the node
    // harness must not register them too (the electron mock, like real
    // Electron, throws on a duplicate ipcMain.handle).
    node = await setupChatFlowHarness({
      ...options,
      registerChatStreamHandlers: false,
    });
    const nodeHarness = node;

    if (options.testBuild) {
      process.env.FAKE_LLM_PORT = String(nodeHarness.fakeLlmPort);
    }

    // Register every handler the UI invokes (the node harness only registers
    // chat_stream). Same code path as main.ts. Imported dynamically (after the
    // electron mock + db are live) — a static top-level import of the full
    // handler graph perturbs CJS/ESM interop ordering for transitive deps
    // (react-remove-scroll's tslib) and fails at module load.
    const { registerIpcHandlers } = await import("@/ipc/ipc_host");
    registerIpcHandlers();

    const silenceActWarnings = options.silenceActWarnings ?? true;
    const bridge = installRendererIpcBridge(options.electronMock, {
      wrapDispatch: silenceActWarnings
        ? (dispatch) => {
            // Sync dispatch; act flushes the resulting renders/effects. The
            // returned thenable resolves synchronously for sync work, so not
            // awaiting it is safe here.
            void act(() => {
              dispatch();
            });
          }
        : undefined,
    });
    (globalThis as HybridBridgeDiagnosticGlobal).__DYAD_HYBRID_BRIDGE__ =
      bridge;

    let activeStore: JotaiStore | undefined;
    const queryClients: QueryClient[] = [];
    const assertNoMissingChannels = options.assertNoMissingChannels ?? true;

    const getActiveStore = (): JotaiStore => {
      if (!activeStore) {
        throw new Error(
          "setupHybridChatHarness.mount() must be called before using this helper",
        );
      }
      return activeStore;
    };

    let activeRouter: HybridRouter | undefined;

    const getActiveRouter = (): HybridRouter => {
      if (!activeRouter) {
        throw new Error(
          "setupHybridChatHarness.mountSurface() must be called before reading the router",
        );
      }
      return activeRouter;
    };

    const mountSurface = (opts: MountSurfaceOptions = {}): RenderResult => {
      const chatId = opts.chatId ?? nodeHarness.chatId;
      const appId = opts.appId ?? nodeHarness.appId;
      const route = opts.route ?? "/chat";
      const store = createStore();
      activeStore = store;

      store.set(selectedAppIdAtom, appId);
      store.set(selectedChatIdAtom, route === "/chat" ? chatId : null);

      const RootComponent = () => (
        <div data-testid="hybrid-surface-root">
          {opts.wireAppEvents !== false && <HybridAppShellHooks />}
          {opts.withTitleBar && <TitleBar />}
          {opts.withAppList && <AppList show />}
          {opts.withChatList && <ChatList show />}
          {opts.withPrivacyBanner && <PrivacyBanner />}
          <Outlet />
        </div>
      );

      // Private route tree: the harness uses the same route paths/search
      // schemas that route consumers address, but renders narrow route
      // components so mounting a surface does not pull in the full app shell.
      const rootRoute = createRootRoute({ component: RootComponent });
      const chatTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/chat",
        validateSearch: chatSearchSchema,
        component: function HybridChatRoute() {
          const search = chatTestRoute.useSearch();
          return (
            <>
              <ChatPanel
                chatId={search.id}
                isPreviewOpen={!!opts.withPlanPanel}
                onTogglePreview={() => {}}
              />
              {opts.withPlanPanel && <PlanPanel />}
            </>
          );
        },
      });
      const appDetailsTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/app-details",
        validateSearch: appDetailsSearchSchema,
        component: function HybridAppDetailsRoute() {
          return (
            <Suspense fallback={<div data-testid="hybrid-surface-loading" />}>
              <LazyAppDetailsPage />
            </Suspense>
          );
        },
      });
      const databaseTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/database",
        component: function HybridDatabaseRoute() {
          return (
            <Suspense fallback={<div data-testid="hybrid-surface-loading" />}>
              <LazyDatabaseSection appId={appId} />
            </Suspense>
          );
        },
      });
      const settingsTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/settings",
        component: function HybridSettingsRoute() {
          return (
            <Suspense fallback={<div data-testid="hybrid-surface-loading" />}>
              <LazySettingsPage />
            </Suspense>
          );
        },
      });
      const providerSettingsTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/settings/providers/$provider",
        params: {
          parse: (params: { provider: string }) => ({
            provider: params.provider,
          }),
        },
        component: function HybridProviderSettingsRoute() {
          const params = providerSettingsTestRoute.useParams() as {
            provider: string;
          };
          return (
            <Suspense fallback={<div data-testid="hybrid-surface-loading" />}>
              <LazyProviderSettingsPage provider={params.provider} />
            </Suspense>
          );
        },
      });
      const mediaTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/library/media",
        component: function HybridMediaRoute() {
          return (
            <Suspense fallback={<div data-testid="hybrid-surface-loading" />}>
              <LazyMediaPage />
            </Suspense>
          );
        },
      });
      const homeLiteRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: function HybridHomeLiteRoute() {
          return <div data-testid="hybrid-home-lite" />;
        },
      });

      const routeTree = rootRoute.addChildren([
        homeLiteRoute,
        chatTestRoute,
        appDetailsTestRoute,
        databaseTestRoute,
        settingsTestRoute,
        providerSettingsTestRoute,
        mediaTestRoute,
      ]);

      const search = opts.search ?? {};
      let initialPath: string;
      if (route === "/chat") {
        initialPath = `/chat${encodeSearch({ id: chatId, appId, ...search })}`;
      } else if (route === "/app-details") {
        initialPath = `/app-details${encodeSearch({ appId, ...search })}`;
      } else if (route === "/database") {
        initialPath = `/database${encodeSearch(search)}`;
      } else if (route === "/settings/providers/$provider") {
        const provider = opts.params?.provider ?? "auto";
        initialPath = `/settings/providers/${provider}${encodeSearch(search)}`;
      } else if (route === "/media" || route === "/library/media") {
        initialPath = `/library/media${encodeSearch(search)}`;
      } else if (route === "/settings") {
        initialPath = `/settings${encodeSearch(search)}`;
      } else {
        initialPath = `/${encodeSearch(search)}`;
      }

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: [initialPath],
        }),
      });
      activeRouter = router as unknown as HybridRouter;

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      queryClients.push(queryClient);

      const result = render(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <ThemeProvider>
              <DeepLinkProvider>
                <SidebarProvider defaultOpen={false}>
                  {opts.wireAppEvents !== false && (
                    <HybridAppEventWiring
                      store={store}
                      queryClient={queryClient}
                    />
                  )}
                  <RouterProvider router={router as never} />
                  <Toaster richColors expand duration={500} />
                </SidebarProvider>
              </DeepLinkProvider>
            </ThemeProvider>
          </Provider>
        </QueryClientProvider>,
      );
      return result;
    };

    const mount = (opts: MountOptions = {}): RenderResult =>
      mountSurface({ ...opts, route: "/chat" });

    const setSelectedAppId = (appId: number | null) => {
      const store = getActiveStore();
      act(() => {
        store.set(selectedAppIdAtom, appId);
      });
    };

    const openPopover = async (trigger: HTMLElement): Promise<void> => {
      trigger.focus();
      fireEvent.pointerDown(trigger);
      fireEvent.pointerUp(trigger);
      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      await waitFor(() => {
        expect(
          document.querySelector('[data-slot="popover-content"]'),
        ).toBeTruthy();
      });
    };

    const clickMenuItem = async (
      name: string | RegExp,
    ): Promise<HTMLElement> => {
      const item = await screen.findByRole("button", { name });
      fireEvent.pointerDown(item);
      fireEvent.pointerUp(item);
      fireEvent.click(item);
      return item;
    };

    const findDialog = async (name: string | RegExp): Promise<HTMLElement> =>
      screen.findByRole("dialog", { name });

    const confirmDialog = async (
      dialogName: string | RegExp,
      buttonName: string | RegExp,
    ): Promise<void> => {
      const dialog = await findDialog(dialogName);
      const button = await screen.findByRole("button", { name: buttonName });
      fireEvent.click(button);
      await waitFor(() => expect(dialog.isConnected).toBe(false));
    };

    const setSwitch = async (
      switchElement: HTMLElement,
      checked: boolean,
    ): Promise<void> => {
      if (switchElement.getAttribute("aria-checked") !== String(checked)) {
        fireEvent.click(switchElement);
      }
      await waitFor(() => {
        expect(switchElement.getAttribute("aria-checked")).toBe(
          String(checked),
        );
      });
    };

    // Exactly what LexicalChatInput's onChange writes. Wrapped in act because
    // the atom write re-renders ChatInput (enabling Send).
    const seedChatInput = (text: string, opts: MountOptions = {}) => {
      const chatId = opts.chatId ?? nodeHarness.chatId;
      const store = getActiveStore();
      const current = store.get(chatInputValuesByIdAtom);
      const next = new Map(current);
      next.set(chatId, text);
      act(() => {
        store.set(chatInputValuesByIdAtom, next);
      });
    };

    const typeInChat = async (
      text: string,
      opts: MountOptions = {},
    ): Promise<TypeInChatResult> => {
      seedChatInput(text, opts);

      const sendButton = await screen.findByLabelText(
        /^(sendMessage|Send message)$/,
      );
      await waitFor(() => {
        expect((sendButton as HTMLButtonElement).hasAttribute("disabled")).toBe(
          false,
        );
      });
      return {
        sendButton,
        send: () => fireEvent.click(sendButton),
      };
    };

    const pressEnterInChat = async (
      text: string,
      opts: MountOptions = {},
    ): Promise<void> => {
      seedChatInput(text, opts);
      const container = screen.getByTestId("chat-input-container");
      const editable = container.querySelector('[contenteditable="true"]');
      if (!editable) {
        throw new Error(
          "pressEnterInChat: no contenteditable found inside chat-input-container",
        );
      }
      // Lexical's root keydown listener dispatches KEY_ENTER_COMMAND, which
      // EnterKeyPlugin routes to ChatInput.handleSubmit — send when idle,
      // queue while streaming.
      fireEvent.keyDown(editable, { key: "Enter", keyCode: 13 });
    };

    const waitForEvent = async (
      channel: string,
      predicate?: (payload: unknown) => boolean,
      timeoutMs = 20_000,
    ): Promise<RendererEvent> => {
      const existing = bridge.sentEvents.find(
        (e) =>
          e.channel === channel && (!predicate || predicate(eventPayload(e))),
      );
      if (existing) {
        return { channel, payload: eventPayload(existing) };
      }
      const event = await bridge.once(
        channel,
        (e) => !predicate || predicate(eventPayload(e)),
        timeoutMs,
      );
      return { channel, payload: eventPayload(event) };
    };

    // Predicate that keeps only chat:response:end events for a given chatId (or
    // all of them when chatId is undefined).
    const streamEndPredicate = (chatId?: number) =>
      chatId === undefined
        ? undefined
        : (payload: unknown) =>
            !!payload &&
            typeof payload === "object" &&
            (payload as { chatId?: number }).chatId === chatId;

    const matchingStreamEnds = (chatId?: number) => {
      const predicate = streamEndPredicate(chatId);
      return bridge.sentEvents.filter(
        (e) =>
          e.channel === "chat:response:end" &&
          (!predicate || predicate(eventPayload(e))),
      );
    };

    const eventCount = (channel: string): number =>
      bridge.sentEvents.filter((e) => e.channel === channel).length;

    // Per-chatId count of stream-end events already handed out by
    // waitForStreamEnd, so a second call waits for the second turn instead of
    // resolving instantly on the first turn's recorded event.
    const consumedStreamEnds = new Map<number | "any", number>();

    const waitForStreamEnd = async (
      chatId?: number,
      timeoutMs = 20_000,
    ): Promise<RendererEvent> => {
      const key = chatId ?? "any";
      const index = consumedStreamEnds.get(key) ?? 0;

      const resolveAt = (): RendererEvent | undefined => {
        const matches = matchingStreamEnds(chatId);
        return matches.length > index
          ? {
              channel: "chat:response:end",
              payload: eventPayload(matches[index]),
            }
          : undefined;
      };

      const existing = resolveAt();
      if (existing) {
        consumedStreamEnds.set(key, index + 1);
        return existing;
      }
      await bridge.once(
        "chat:response:end",
        (event) => {
          const predicate = streamEndPredicate(chatId);
          return (
            (!predicate || predicate(eventPayload(event))) &&
            matchingStreamEnds(chatId).length > index
          );
        },
        timeoutMs,
      );
      const arrived = resolveAt();
      if (!arrived) {
        throw new Error(
          "waitForStreamEnd: matching event disappeared after arrival (bug)",
        );
      }
      consumedStreamEnds.set(key, index + 1);
      return arrived;
    };

    const waitForNextStreamEnd = (
      chatId?: number,
      timeoutMs = 20_000,
    ): Promise<RendererEvent> => {
      // Snapshot the baseline SYNCHRONOUSLY (before returning the promise) so a
      // stale end from a prior turn can't satisfy the wait; resolve on the first
      // matching end past the baseline.
      const baseline = matchingStreamEnds(chatId).length;
      return bridge
        .once(
          "chat:response:end",
          (event) => {
            const predicate = streamEndPredicate(chatId);
            return (
              (!predicate || predicate(eventPayload(event))) &&
              matchingStreamEnds(chatId).length > baseline
            );
          },
          timeoutMs,
        )
        .then((event) => ({
          channel: "chat:response:end",
          payload: eventPayload(event),
        }));
    };

    const selectFromBaseUiSelect = async (
      trigger: HTMLElement,
      optionMatcher: string | RegExp,
    ): Promise<void> => {
      // happy-dom won't open a Base UI Select on a bare click. Focus + ArrowDown
      // opens the popup; then pointer events + click + Enter on the option commit
      // the value (a bare click alone does nothing).
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const option = await screen.findByRole("option", { name: optionMatcher });
      fireEvent.pointerDown(option);
      fireEvent.pointerUp(option);
      fireEvent.click(option);
      fireEvent.keyDown(option, { key: "Enter" });
    };

    const selectChatMode = async (
      mode: "build" | "ask" | "plan" | "local-agent",
    ): Promise<void> => {
      // One matcher per mode works for both the option text and the trigger's
      // resulting aria-label ("Chat mode: <name>"): Build/Ask/Plan match verbatim;
      // "Agent" matches "Agent v2"/"Basic Agent" (pro/non-pro) and the "Agent"/
      // "Basic Agent" aria label.
      const matcher: Record<typeof mode, RegExp> = {
        build: /Build/,
        ask: /Ask/,
        plan: /Plan/,
        "local-agent": /Agent/,
      };
      const trigger = await screen.findByTestId("chat-mode-selector");
      await selectFromBaseUiSelect(trigger, matcher[mode]);
      await waitFor(() =>
        expect(trigger.getAttribute("aria-label")).toMatch(matcher[mode]),
      );
    };

    const createChat = async (appId?: number): Promise<number> => {
      const [row] = await nodeHarness.db
        .insert(chats)
        .values({ appId: appId ?? nodeHarness.appId })
        .returning();
      return row.id;
    };

    const waitForRenderedText = async (
      matcher: string | RegExp,
      timeoutMs = 20_000,
    ): Promise<HTMLElement[]> => {
      let previousCount = -1;
      let stableTicks = 0;
      await waitFor(
        () => {
          const matches = screen.queryAllByText(matcher);
          expect(matches.length).toBeGreaterThan(0);
          if (matches.length === previousCount) {
            stableTicks += 1;
          } else {
            previousCount = matches.length;
            stableTicks = 0;
          }
          expect(stableTicks).toBeGreaterThan(0);
        },
        { timeout: timeoutMs },
      );
      return screen.getAllByText(matcher);
    };

    const githubFetch = async (path: string, init?: RequestInit) => {
      const response = await undiciFetch(`${nodeHarness.fakeLlmUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...init?.headers,
        },
      } as Parameters<typeof undiciFetch>[1]);
      if (!response.ok) {
        throw new Error(
          `Fake GitHub helper failed ${path}: ${response.status} ${response.statusText}`,
        );
      }
      return response;
    };

    const github = {
      pushEvents: async (): Promise<unknown> => {
        const response = await githubFetch("/github/api/test/push-events");
        return response.json();
      },
      clearPushEvents: async (): Promise<void> => {
        await githubFetch("/github/api/test/clear-push-events", {
          method: "POST",
        });
      },
      resetRepos: async (): Promise<void> => {
        await githubFetch("/github/api/test/reset-repos", { method: "POST" });
      },
    };

    const dispose = async (): Promise<void> => {
      // Teardown ordering is load-bearing (see HYBRID_HARNESS.md "Race-free
      // teardown"):
      //   1. unmount React first — stops new UI-driven invokes;
      //   2. drain in-flight invokes — their handlers read the db;
      //   3. clear per-mount query caches and drop the active jotai store;
      //   4. uninstall the bridge;
      //   5. THEN dispose the node harness (closes the db, removes temp dir).
      // Closing the db before (2) throws "Database not initialized" from
      // still-resolving background queries (proposals, token counts).
      let teardownError: unknown;
      // A settle timeout (a handler hung past the budget) must FAIL the test,
      // but the rest of teardown still runs so the db/temp dir/env don't leak
      // into the next file's worker.
      let settleError: unknown;
      let missingChannels: string[] = [];
      try {
        cleanup();
        try {
          await bridge.settleInFlight();
        } catch (error) {
          settleError = error;
        }
        missingChannels = [...bridge.missingChannels];
        for (const qc of queryClients) {
          qc.clear();
        }
        activeStore = undefined;
        activeRouter = undefined;
        bridge.uninstall();
        await nodeHarness.dispose();
      } catch (error) {
        teardownError = error;
      } finally {
        const diagnosticGlobal = globalThis as HybridBridgeDiagnosticGlobal;
        if (diagnosticGlobal.__DYAD_HYBRID_BRIDGE__ === bridge) {
          delete diagnosticGlobal.__DYAD_HYBRID_BRIDGE__;
        }
        activeHybridChatHarness = false;
        setModelClientFetchForTesting(undefined);
        restoreHybridEnv(envSnapshot);
      }

      if (settleError) {
        throw settleError;
      }
      if (teardownError) {
        throw teardownError;
      }
      if (assertNoMissingChannels && missingChannels.length > 0) {
        throw new Error(
          `Hybrid harness renderer invoked channels with no registered handler: ${missingChannels.join(
            ", ",
          )}`,
        );
      }
    };

    return {
      ...nodeHarness,
      bridge,
      mount,
      mountSurface,
      router: getActiveRouter,
      currentLocation: () => getActiveRouter().state.location,
      setSelectedAppId,
      openPopover,
      clickMenuItem,
      findDialog,
      confirmDialog,
      setSwitch,
      setChatInputValue: seedChatInput,
      typeInChat,
      pressEnterInChat,
      waitForStreamEnd,
      waitForNextStreamEnd,
      eventCount,
      waitForEvent,
      waitForRenderedText,
      selectFromBaseUiSelect,
      selectChatMode,
      createChat,
      github,
      dispose,
    };
  } catch (error) {
    activeHybridChatHarness = false;
    setModelClientFetchForTesting(undefined);
    restoreHybridEnv(envSnapshot);
    if (node) {
      await node.dispose();
    }
    throw error;
  }
}
