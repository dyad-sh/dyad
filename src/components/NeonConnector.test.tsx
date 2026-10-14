import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConnectionFlowState } from "@/connection_flow/state";
import type { UserSettings } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

const h = vi.hoisted(() => ({
  settings: {} as Partial<UserSettings>,
  flowState: { status: "disconnected", revision: 0 } as ConnectionFlowState,
  start: vi.fn(),
  cancel: vi.fn(),
  acknowledge: vi.fn(),
  getApp: vi.fn(),
  listProjects: vi.fn(),
  fakeConnect: vi.fn(),
  openExternalUrl: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { getApp: h.getApp },
    neon: { listProjects: h.listProjects, fakeConnect: h.fakeConnect },
    system: { openExternalUrl: h.openExternalUrl },
  },
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => {
    const { data } = useQuery({
      queryKey: queryKeys.settings.user,
      queryFn: async () => h.settings,
      staleTime: Infinity,
    });
    return { settings: data };
  },
}));
vi.mock("@/hooks/useConnectionFlow", () => ({
  useConnectionFlow: () => ({
    flowState: h.flowState,
    isFlowActive: ["starting", "awaiting-return", "exchanging-token"].includes(
      h.flowState.status,
    ),
  }),
  startConnectionFlow: h.start,
  cancelConnectionFlow: h.cancel,
  acknowledgeConnectionFlow: h.acknowledge,
}));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: h.success, error: vi.fn(), warning: vi.fn() },
}));

import { NeonConnector } from "./NeonConnector";

const invocationRef = {
  kind: "connection-flow",
  entityKey: "neon",
  operationId: "neon-sign-in",
} as const;
let client: QueryClient;

function connector() {
  return (
    <QueryClientProvider client={client}>
      <NeonConnector appId={1} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  h.settings = {};
  h.flowState = { status: "disconnected", revision: 0 };
  h.getApp.mockResolvedValue({ id: 1, name: "Demo", frameworkType: "vite" });
  h.listProjects.mockResolvedValue({ projects: [] });
  h.start.mockResolvedValue({ started: true, invocationRef });
  h.acknowledge.mockResolvedValue(undefined);
  h.openExternalUrl.mockResolvedValue(undefined);
  h.fakeConnect.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  client.clear();
});

it("uses the shared sign-in button and loads projects after authentication", async () => {
  const view = render(connector(), { wrapper: StrictMode });
  const connect = await screen.findByRole("button", {
    name: "integrations.neon.connectTo Neon",
  });
  expect(connect).toBe(screen.getByTestId("connect-neon-button"));
  fireEvent.click(connect);
  await waitFor(() =>
    expect(h.openExternalUrl).toHaveBeenCalledWith(
      "https://oauth.dyad.sh/api/integrations/neon/login?state=neon-sign-in",
    ),
  );
  expect(h.start).toHaveBeenCalledExactlyOnceWith("neon");
  expect(h.listProjects).not.toHaveBeenCalled();

  h.settings = { neon: { accessToken: { value: "connected-token" } } };
  h.flowState = {
    status: "connected",
    revision: 1,
    provider: "neon",
    invocationRef,
  };
  view.rerender(connector());

  await screen.findByText("integrations.neon.noProjectsFound");
  expect(screen.queryByTestId("connect-neon-button")).toBeNull();
  expect(h.listProjects).toHaveBeenCalledOnce();
  expect(h.getApp).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(h.acknowledge).toHaveBeenCalledExactlyOnceWith(
      "neon",
      invocationRef,
    ),
  );
  expect(h.success).toHaveBeenCalledExactlyOnceWith(
    "integrations.neon.connectedSuccess",
  );
});

it("preserves the fake connection path in test mode", async () => {
  h.settings = { isTestMode: true };
  render(connector(), { wrapper: StrictMode });
  fireEvent.click(await screen.findByTestId("connect-neon-button"));
  await waitFor(() => expect(h.fakeConnect).toHaveBeenCalledOnce());
  expect(h.start).toHaveBeenCalledExactlyOnceWith("neon");
  expect(h.openExternalUrl).not.toHaveBeenCalled();
});
