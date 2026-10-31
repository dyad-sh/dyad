import {
  act,
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
  getSettings: vi.fn(),
  flowState: { status: "disconnected", revision: 0 } as ConnectionFlowState,
  start: vi.fn(),
  cancel: vi.fn(),
  acknowledge: vi.fn(),
  getApp: vi.fn(),
  listProjects: vi.fn(),
  fakeConnect: vi.fn(),
  getProject: vi.fn(),
  getEmailPasswordConfig: vi.fn(),
  setActiveBranch: vi.fn(),
  openExternalUrl: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { getApp: h.getApp },
    neon: {
      listProjects: h.listProjects,
      fakeConnect: h.fakeConnect,
      getProject: h.getProject,
      getEmailPasswordConfig: h.getEmailPasswordConfig,
      setActiveBranch: h.setActiveBranch,
    },
    system: { openExternalUrl: h.openExternalUrl },
  },
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => {
    const { data, isLoading, refetch } = useQuery({
      queryKey: queryKeys.settings.user,
      queryFn: h.getSettings,
      staleTime: Infinity,
    });
    return {
      settings: data,
      settingsLoading: isLoading,
      refreshSettings: refetch,
    };
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
  h.getSettings.mockImplementation(async () => h.settings);
  h.flowState = { status: "disconnected", revision: 0 };
  h.getApp.mockResolvedValue({ id: 1, name: "Demo", frameworkType: "vite" });
  h.listProjects.mockResolvedValue({ projects: [] });
  h.start.mockResolvedValue({ started: true, invocationRef });
  h.acknowledge.mockResolvedValue(undefined);
  h.openExternalUrl.mockResolvedValue(undefined);
  h.fakeConnect.mockResolvedValue(undefined);
  h.getProject.mockResolvedValue({
    branches: [
      { branchId: "dev", branchName: "development", type: "development" },
      { branchId: "prod", branchName: "main", type: "production" },
      { branchId: "preview", branchName: "preview", type: "preview" },
    ],
  });
  h.getEmailPasswordConfig.mockResolvedValue(null);
  h.setActiveBranch.mockResolvedValue({});
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

function connectedApp(activeBranchId = "dev") {
  h.settings = { neon: { accessToken: { value: "connected" } } };
  h.getApp.mockResolvedValue({
    id: 1,
    frameworkType: "vite",
    neonProjectId: "project",
    neonDevelopmentBranchId: "dev",
    neonActiveBranchId: activeBranchId,
    deploymentProvidersInUse: {},
  });
}

it("hides production and preview branches by default", async () => {
  connectedApp();
  render(connector());
  fireEvent.click(await screen.findByTestId("neon-branch-select"));
  await screen.findByRole("option", { name: /development/ });
  expect(screen.queryByRole("option", { name: /main/ })).toBeNull();
  expect(screen.queryByRole("option", { name: /preview/ })).toBeNull();
});

it.each([true, false])(
  "waits for settings before showing the active branch picker (loading: %s)",
  async (loading) => {
    connectedApp();
    h.settings.enableNeonBranchProtection = false;
    let finish!: (settings: Partial<UserSettings>) => void;
    h.getSettings.mockImplementationOnce(() =>
      loading
        ? new Promise<Partial<UserSettings>>((resolve) => {
            finish = resolve;
          })
        : Promise.reject(new Error("Settings unavailable")),
    );
    render(connector());
    await screen.findByText(
      `integrations.neon.branchSafety.${loading ? "settingsLoading" : "settingsUnavailable"}`,
    );
    expect(screen.queryByTestId("neon-branch-select")).toBeNull();
    expect(
      screen.queryByText("integrations.neon.branchSafety.locked"),
    ).toBeNull();
    expect(h.setActiveBranch).not.toHaveBeenCalled();
    if (loading) {
      await act(async () => finish(h.settings));
    } else {
      fireEvent.click(
        screen.getByRole("button", { name: "integrations.neon.retry" }),
      );
    }
    fireEvent.click(await screen.findByTestId("neon-branch-select"));
    await screen.findByRole("option", { name: /main/ });
    expect(h.getSettings).toHaveBeenCalledTimes(loading ? 1 : 2);
  },
);

it("requires confirmation before switching to production when protection is disabled", async () => {
  connectedApp();
  h.settings.enableNeonBranchProtection = false;
  render(connector());
  const selectProduction = async () => {
    fireEvent.click(await screen.findByTestId("neon-branch-select"));
    const option = await screen.findByRole("option", { name: /main/ });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    fireEvent.keyDown(option, { key: "Enter" });
    await screen.findByRole("alertdialog");
  };
  await selectProduction();
  expect(h.setActiveBranch).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "integrations.neon.branchSafety.keepCurrent",
    }),
  );
  expect(h.setActiveBranch).not.toHaveBeenCalled();
  await selectProduction();
  fireEvent.click(
    screen.getByRole("button", {
      name: "integrations.neon.branchSafety.confirmProduction",
    }),
  );
  await waitFor(() =>
    expect(h.setActiveBranch).toHaveBeenCalledExactlyOnceWith({
      appId: 1,
      branchId: "prod",
    }),
  );
});

it.each([true, false])(
  "warns existing production users with protection %s and offers development",
  async (enabled) => {
    connectedApp("prod");
    h.settings.enableNeonBranchProtection = enabled;
    render(connector());
    await screen.findByText(
      "integrations.neon.branchSafety.developmentWarning",
    );
    fireEvent.click(screen.getByTestId("neon-branch-select"));
    await screen.findByRole("option", { name: /main/ });
    await screen.findByRole("option", { name: /development/ });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "integrations.neon.branchSafety.developmentRecommended",
      }),
    );
    await waitFor(() =>
      expect(h.setActiveBranch).toHaveBeenCalledWith({
        appId: 1,
        branchId: "dev",
      }),
    );
  },
);
