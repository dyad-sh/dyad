import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import { RouterProvider } from "@tanstack/react-router";
import { PostHogProvider } from "posthog-js/react";
import posthog from "posthog-js";
import {
  getTelemetryUserId,
  isTelemetryOptedIn,
  isDyadProUser,
} from "./hooks/useSettings";

// Initialize i18next before any rendering
import "./i18n";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  MutationCache,
  useQueryClient,
} from "@tanstack/react-query";
import { showError } from "./lib/toast";
import { ipc } from "./ipc/types";
import { useStore } from "jotai";
import { queryKeys } from "./lib/queryKeys";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
  shouldBypassNonProTelemetrySampling,
  shouldFilterPostHogExceptionEvent,
} from "./lib/posthogTelemetry";
import { registerRendererIpcListeners } from "./app_wiring/registerRendererIpcListeners";
import {
  ChatStreamProvider,
  useChatStreamManager,
} from "./chat_stream/ChatStreamProvider";
import {
  EntityDisposalProvider,
  useEntityDisposal,
  useRegisterEntityDisposer,
} from "./state_machines/react";
import { clearTestRuntimeForAppAtom } from "./atoms/testRuntimeAtoms";
import { initializeChatTabSessionStorageAtom } from "./atoms/chatAtoms";
import {
  configureChatTabWindowSession,
  pruneChatTabWindowSessions,
} from "./window_infrastructure/chat_tab_session_storage";
import type { VisibleEntity } from "./window_infrastructure/types";
import { registerEarlyRendererEvents } from "./app_wiring/early_renderer_events";

// @ts-ignore
console.log("Running in mode:", import.meta.env.MODE);
registerEarlyRendererEvents();

interface MyMeta extends Record<string, unknown> {
  showErrorToast: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: MyMeta;
    mutationMeta: MyMeta;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.showErrorToast) {
        showError(error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.showErrorToast) {
        showError(error);
      }
    },
  }),
});

const posthogClient = posthog.init(
  "phc_5Vxx0XT8Ug3eWROhP6mm4D6D2DgIIKT232q4AKxC2ab",
  {
    api_host: "https://us.i.posthog.com",
    // @ts-ignore
    debug: import.meta.env.MODE === "development",
    autocapture: false,
    capture_exceptions: true,
    capture_pageview: false,
    before_send: (event) => {
      if (!isTelemetryOptedIn()) {
        console.debug("Telemetry not opted in, skipping event");
        return null;
      }

      if (shouldFilterPostHogExceptionEvent(event)) {
        console.debug(
          "Filtering generic fetch failed exception from telemetry",
        );
        return null;
      }
      const telemetryUserId = getTelemetryUserId();
      if (telemetryUserId) {
        posthogClient.identify(telemetryUserId);
      }

      if (event?.properties["$ip"]) {
        event.properties["$ip"] = null;
      }

      // For non-Pro users, only send 10% of events (but always send errors,
      // app:initial-load, promo_click, and sandbox.script.* — see
      // shouldBypassNonProTelemetrySampling).
      if (!isDyadProUser()) {
        if (
          !shouldBypassNonProTelemetrySampling(event) &&
          Math.random() > 0.1
        ) {
          console.debug("Non-Pro user: sampling out event", event?.event);
          return null;
        }
      }

      console.debug(
        "Telemetry opted in - UUID:",
        telemetryUserId,
        "sending event",
        event,
      );
      return event;
    },
    persistence: "localStorage",
  },
);

function App() {
  return (
    <ChatStreamProvider>
      <RendererServices />
    </ChatStreamProvider>
  );
}

function RendererServices() {
  const queryClient = useQueryClient();
  const store = useStore();
  const chatStreamManager = useChatStreamManager();
  const entityDisposal = useEntityDisposal();
  const [windowReady, setWindowReady] = useState(false);
  const clearAppRuntime = useCallback(
    (appId: number) => {
      store.set(clearTestRuntimeForAppAtom, appId);
    },
    [store],
  );
  useRegisterEntityDisposer("app", clearAppRuntime);

  // Fetch user budget on app load
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.userBudget.info,
      queryFn: () => ipc.system.getUserBudget(),
    });
  }, [queryClient]);

  useEffect(() => {
    // Subscribe to navigation state changes
    const unsubscribe = router.subscribe("onResolved", (navigation) => {
      // Capture the navigation event in PostHog
      posthog.capture("navigation", {
        toPath: navigation.toLocation.pathname,
        fromPath: navigation.fromLocation?.pathname,
      });

      // Optionally capture as a standard pageview as well
      posthog.capture("$pageview", {
        path: navigation.toLocation.pathname,
      });
    });

    // Clean up subscription when component unmounts
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 100;
    const bootstrapWindow = () => {
      void ipc.windowInfrastructure
        .bootstrap({})
        .then((bootstrap) => {
          if (disposed) return;
          configureChatTabWindowSession(bootstrap.windowSessionId, {
            mayMigrateLegacySession: bootstrap.mayMigrateLegacyChatTabSession,
          });
          try {
            pruneChatTabWindowSessions(
              window.localStorage,
              bootstrap.restorableWindowSessionIds,
            );
            store.set(initializeChatTabSessionStorageAtom);
          } catch (error) {
            // Browser storage is optional presentation state. A denied or full
            // localStorage must not turn a successful main-process bootstrap
            // into a permanently blank product window.
            console.error(
              "Failed to initialize chat tab session storage",
              error,
            );
          }
          const entity: VisibleEntity | undefined = bootstrap.initialEntity;
          if (entity?.kind === "app") {
            void router.navigate({
              to: "/app-details",
              search: { appId: entity.id },
              replace: true,
            });
          }
          setWindowReady(true);
        })
        .catch((error) => {
          if (disposed) return;
          console.error("Failed to initialize window session", error);
          retryTimer = setTimeout(bootstrapWindow, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
        });
    };
    bootstrapWindow();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!windowReady) return;
    return registerRendererIpcListeners({
      ipcClient: ipc,
      store,
      queryClient,
      chatStreamManager,
      entityDisposal,
      onTelemetryEvent: ({ eventName, properties }) => {
        if (eventName === "$exception") {
          posthog.captureException(
            createExceptionFromTelemetry(properties),
            getExceptionTelemetryContext(properties),
          );
          return;
        }

        posthog.capture(eventName, properties);
      },
      getCurrentPathname: () => router.state.location.pathname,
      subscribeToNavigation: (listener) =>
        router.subscribe("onResolved", listener),
    });
  }, [chatStreamManager, entityDisposal, queryClient, store, windowReady]);

  return windowReady ? <RouterProvider router={router} /> : null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PostHogProvider client={posthogClient}>
        <EntityDisposalProvider>
          <App />
        </EntityDisposalProvider>
      </PostHogProvider>
    </QueryClientProvider>
  </StrictMode>,
);
