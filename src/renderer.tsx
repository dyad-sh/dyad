import { StrictMode, useEffect } from "react";
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

// @ts-ignore
console.log("Running in mode:", import.meta.env.MODE);

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
      // app:initial-load, and sandbox.script.* — see shouldBypassNonProTelemetrySampling).
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
  const queryClient = useQueryClient();
  const store = useStore();

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
    return registerRendererIpcListeners({
      ipcClient: ipc,
      store,
      queryClient,
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
    });
  }, [queryClient, store]);

  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PostHogProvider client={posthogClient}>
        <App />
      </PostHogProvider>
    </QueryClientProvider>
  </StrictMode>,
);
