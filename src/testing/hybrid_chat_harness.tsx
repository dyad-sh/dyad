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
 * Hybrid tests run under the `hybrid` Vitest project, which supplies happy-dom,
 * the shared electron/posthog/i18n mocks, and the hoisted electron mock handle
 * exported from `src/testing/hybrid.setup.ts`.
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
import React, { useEffect } from "react";
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
import { ChatPanel } from "@/components/ChatPanel";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { chats } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { setModelClientFetchForTesting } from "@/ipc/utils/get_model_client";
// Import from the dedicated schema module, NOT "@/routes/chat": the route file
// statically imports ChatPage -> PreviewPanel -> Monaco, which would load into
// every hybrid test and throw "Canceled" rejections on teardown.
import { chatSearchSchema } from "@/routes/chatSearchSchema";

import {
  installRendererIpcBridge,
  type RendererIpcBridge,
} from "./renderer_ipc_bridge";

const SECOND_SETUP_ERROR =
  "Second harness setup in one process — one harness per test FILE " +
  "(forks pool isolation); split the file";

let activeHybridChatHarness = false;
type JotaiStore = ReturnType<typeof createStore>;
type HybridBridgeDiagnosticGlobal = typeof globalThis & {
  __DYAD_HYBRID_BRIDGE__?: RendererIpcBridge;
};

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
}

export interface MountOptions {
  /** Chat to load. Default: the harness's default chat. */
  chatId?: number;
  /** App to select. Default: the harness's default app. */
  appId?: number;
  /** Install the same main->renderer listeners AppRoot registers. Default true. */
  wireAppEvents?: boolean;
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
   * Seed the chat input the way LexicalChatInput's onChange does (happy-dom
   * can't type into its contenteditable), then wait for Send to enable. Returns
   * the button and a `send()` click helper.
   */
  typeInChat: (text: string, opts?: MountOptions) => Promise<TypeInChatResult>;

  /**
   * Resolve with the FIRST `chat:response:end` event (optionally for a chatId).
   * WARNING: for a second turn/retry in the same `it`, this resolves immediately
   * on the previous turn's stale event. Use `waitForNextStreamEnd` for any turn
   * after the first. See HYBRID_HARNESS.md §5.
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
}

/** Bridge sentEvents store `{ channel, args }`; the payload is `args[0]`. */
function eventPayload(e: { args: unknown[] }): unknown {
  return e.args[0];
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

export async function setupHybridChatHarness(
  options: HybridChatHarnessOptions,
): Promise<HybridChatHarness> {
  if (activeHybridChatHarness) {
    throw new Error(SECOND_SETUP_ERROR);
  }
  activeHybridChatHarness = true;

  // Prevent the UI's `nodejs-status` query from kicking off the real
  // `npm install pnpm` background side effect (gated in node_handlers.ts).
  process.env.DYAD_SKIP_MANAGED_PNPM_INSTALL = "true";
  setModelClientFetchForTesting(
    undiciFetch as unknown as Parameters<
      typeof setModelClientFetchForTesting
    >[0],
  );

  let node: ChatFlowHarness | undefined;

  try {
    node = await setupChatFlowHarness(options);
    const nodeHarness = node;

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

    const mount = (opts: MountOptions = {}): RenderResult => {
      const chatId = opts.chatId ?? nodeHarness.chatId;
      const appId = opts.appId ?? nodeHarness.appId;
      const store = createStore();
      activeStore = store;

      store.set(selectedAppIdAtom, appId);
      store.set(selectedChatIdAtom, chatId);

      // A private route tree: useStreamChat/ChatInput call useSearch({from:"/chat"}),
      // so a real "/chat" route is required. It imports the REAL search schema from
      // src/routes/chat.tsx (chatSearchSchema) so this replica can't drift from
      // production. It renders ChatPanel directly — mounting the real ChatPage would
      // drag in PreviewPanel (Monaco, iframe runtime).
      const rootRoute = createRootRoute({ component: Outlet });
      const chatTestRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/chat",
        validateSearch: chatSearchSchema,
        component: function HybridChatRoute() {
          const search = chatTestRoute.useSearch();
          return (
            <ChatPanel
              chatId={search.id}
              isPreviewOpen={false}
              onTogglePreview={() => {}}
            />
          );
        },
      });
      const router = createRouter({
        routeTree: rootRoute.addChildren([chatTestRoute]),
        history: createMemoryHistory({
          initialEntries: [`/chat?id=${chatId}&appId=${appId}`],
        }),
      });

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
              {opts.wireAppEvents !== false && (
                <HybridAppEventWiring store={store} queryClient={queryClient} />
              )}
              <RouterProvider router={router as never} />
              <Toaster richColors expand duration={500} />
            </ThemeProvider>
          </Provider>
        </QueryClientProvider>,
      );
      return result;
    };

    const typeInChat = async (
      text: string,
      opts: MountOptions = {},
    ): Promise<TypeInChatResult> => {
      const chatId = opts.chatId ?? nodeHarness.chatId;
      const store = getActiveStore();
      // Exactly what LexicalChatInput's onChange writes. Wrapped in act because
      // the atom write re-renders ChatInput (enabling Send).
      const current = store.get(chatInputValuesByIdAtom);
      const next = new Map(current);
      next.set(chatId, text);
      act(() => {
        store.set(chatInputValuesByIdAtom, next);
      });

      const sendButton = await screen.findByLabelText("sendMessage");
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

    const waitForStreamEnd = (
      chatId?: number,
      timeoutMs = 20_000,
    ): Promise<RendererEvent> =>
      waitForEvent("chat:response:end", streamEndPredicate(chatId), timeoutMs);

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
      let missingChannels: string[] = [];
      try {
        cleanup();
        await bridge.settleInFlight();
        missingChannels = [...bridge.missingChannels];
        for (const qc of queryClients) {
          qc.clear();
        }
        activeStore = undefined;
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
      typeInChat,
      waitForStreamEnd,
      waitForNextStreamEnd,
      eventCount,
      waitForEvent,
      waitForRenderedText,
      selectFromBaseUiSelect,
      selectChatMode,
      createChat,
      dispose,
    };
  } catch (error) {
    activeHybridChatHarness = false;
    setModelClientFetchForTesting(undefined);
    if (node) {
      await node.dispose();
    }
    throw error;
  }
}
