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
import type {
  ConnectionFlowInvocationRef,
  ConnectionFlowState,
} from "@/connection_flow/state";
import type { UserSettings } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  NEON_PROJECT_ACCESS_DENIED_MESSAGE,
  NEON_PROJECT_NOT_FOUND_MESSAGE,
} from "@/shared/neon_auth";

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
  error: vi.fn(),
  warning: vi.fn(),
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
  toast: { success: h.success, error: h.error, warning: h.warning },
}));

import { NeonConnector } from "./NeonConnector";
import { NeonIntegration } from "./NeonIntegration";
import { NeonReconnectionBanner } from "./chat/NeonReconnectionBanner";

// Sign-in outcomes are claimed in module state shared by every test, so each
// test gets its own operation.
let operationCount = 0;
let invocationRef: ConnectionFlowInvocationRef;
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
  invocationRef = {
    kind: "connection-flow",
    entityKey: "neon",
    operationId: `neon-sign-in-${++operationCount}`,
  };
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
  h.cancel.mockResolvedValue(undefined);
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
      `https://oauth.dyad.sh/api/integrations/neon/login?state=${invocationRef.operationId}`,
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
  const app = {
    id: 1,
    frameworkType: "vite",
    neonProjectId: "project",
    neonDevelopmentBranchId: "dev",
    neonActiveBranchId: activeBranchId,
    deploymentProvidersInUse: {},
  };
  h.getApp.mockResolvedValue(app);
  h.setActiveBranch.mockImplementation(async ({ branchId }) => {
    h.getApp.mockResolvedValue({ ...app, neonActiveBranchId: branchId });
    return {};
  });
}

it("reconnects rejected credentials while retaining the linked project and branch", async () => {
  connectedApp();
  h.settings.neon!.reconnectRequired = true;
  const view = render(connector(), { wrapper: StrictMode });
  const reconnect = await screen.findByRole("button", {
    name: "integrations.neon.reconnectTitle",
  });
  expect(h.listProjects).not.toHaveBeenCalled();
  expect(h.getProject).not.toHaveBeenCalled();
  expect(h.getEmailPasswordConfig).not.toHaveBeenCalled();
  expect(h.openExternalUrl).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "integrations.neon.disconnectProject" }),
  ).toBeDefined();
  fireEvent.click(reconnect);
  await waitFor(() => expect(h.start).toHaveBeenCalledExactlyOnceWith("neon"));
  await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledOnce());
  h.settings = { neon: { accessToken: { value: "fresh-access" } } };
  h.flowState = {
    status: "connected",
    revision: 1,
    provider: "neon",
    invocationRef,
  };
  view.rerender(connector());
  await screen.findByTestId("neon-branch-select");
  expect(
    client.getQueryData(queryKeys.apps.detail({ appId: 1 })),
  ).toMatchObject({
    neonProjectId: "project",
    neonActiveBranchId: "dev",
  });
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "integrations.neon.reconnectedSuccess",
    ),
  );
  expect(h.setActiveBranch).not.toHaveBeenCalled();
});

it.each([
  ["cancelled", undefined],
  ["failed", "timeout"],
  ["failed", "network"],
] as const)(
  "keeps reconnection available after sign-in is %s (%s)",
  async (status, reason) => {
    connectedApp();
    h.settings.neon!.reconnectRequired = true;
    const view = render(connector());
    fireEvent.click(await screen.findByTestId("connect-neon-button"));
    await waitFor(() => expect(h.start).toHaveBeenCalledOnce());
    h.flowState = {
      status: "awaiting-return",
      revision: 1,
      provider: "neon",
      invocationRef,
    };
    view.rerender(connector());
    await screen.findByText("integrations.neon.waitingForSignIn");
    fireEvent.click(screen.getByTestId("cancel-neon-flow-button"));
    await waitFor(() =>
      expect(h.cancel).toHaveBeenCalledWith("neon", invocationRef),
    );
    h.flowState =
      status === "cancelled"
        ? { status, revision: 2, provider: "neon", invocationRef }
        : {
            status,
            revision: 2,
            provider: "neon",
            invocationRef,
            reason: reason!,
            message: reason === "network" ? "Could not reach Neon" : undefined,
          };
    view.rerender(connector());
    await waitFor(() =>
      expect(
        (screen.getByTestId("connect-neon-button") as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await waitFor(() =>
      expect(h.acknowledge).toHaveBeenCalledExactlyOnceWith(
        "neon",
        invocationRef,
      ),
    );
    if (reason === "network") {
      expect(h.error).toHaveBeenCalledExactlyOnceWith("Could not reach Neon");
      expect(h.warning).not.toHaveBeenCalled();
    } else if (reason === "timeout") {
      expect(h.warning).toHaveBeenCalledExactlyOnceWith(
        "integrations.neon.signInTimedOut",
      );
      expect(h.error).not.toHaveBeenCalled();
    } else {
      expect(h.warning).not.toHaveBeenCalled();
      expect(h.error).not.toHaveBeenCalled();
    }
    expect(screen.getByTestId("neon-reconnection-notice")).toBeDefined();
    expect(h.success).not.toHaveBeenCalled();
    expect(h.listProjects).not.toHaveBeenCalled();
  },
);

it.each([
  ["failed", "integrations.neon.signInTimedOut"],
  ["connected", "integrations.neon.reconnectedSuccess"],
] as const)(
  "handles a %s sign-in once after the initiating notice unmounts",
  async (status, message) => {
    connectedApp();
    h.settings.neon!.reconnectRequired = true;
    const initiator = render(
      <QueryClientProvider client={client}>
        <NeonReconnectionBanner appId={1} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId("connect-neon-button"));
    await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledOnce());
    // e.g. the user dismissed the chat banner while signing in.
    initiator.unmount();

    if (status === "connected") {
      h.settings = { neon: { accessToken: { value: "fresh-access" } } };
    }
    h.flowState =
      status === "connected"
        ? { status, revision: 2, provider: "neon", invocationRef }
        : {
            status,
            revision: 2,
            provider: "neon",
            invocationRef,
            reason: "timeout",
          };
    // Two surfaces that each render a sign-in button mount afterwards.
    render(
      <QueryClientProvider client={client}>
        <NeonConnector appId={1} />
        <NeonIntegration />
      </QueryClientProvider>,
    );

    const toast = status === "connected" ? h.success : h.warning;
    await waitFor(() => expect(toast).toHaveBeenCalledExactlyOnceWith(message));
    await waitFor(() =>
      expect(h.acknowledge).toHaveBeenCalledExactlyOnceWith(
        "neon",
        invocationRef,
      ),
    );
    if (status === "connected") {
      // The initiator's reconnect context still refreshes the linked project.
      await screen.findByTestId("neon-branch-select");
      expect(h.getProject).toHaveBeenCalledWith({ appId: 1 });
    }
  },
);

it.each([
  [
    new DyadError(NEON_PROJECT_ACCESS_DENIED_MESSAGE, DyadErrorKind.Auth),
    "integrations.neon.projectAccessRequired",
  ],
  [
    new DyadError(NEON_PROJECT_NOT_FOUND_MESSAGE, DyadErrorKind.NotFound),
    "integrations.neon.projectNotFound",
  ],
])(
  "offers another account when the signed-in account cannot use the existing project (%s)",
  async (error, description) => {
    connectedApp();
    h.getProject.mockRejectedValue(error);
    render(connector());
    await screen.findByText(description);
    expect(
      screen.getByRole("button", {
        name: "integrations.neon.disconnectProject",
      }),
    ).toBeDefined();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "integrations.neon.signInAnotherAccount",
      }),
    );
    await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledOnce());
    expect(
      client.getQueryData(queryKeys.apps.detail({ appId: 1 })),
    ).toMatchObject({
      neonProjectId: "project",
      neonActiveBranchId: "dev",
    });
    expect(h.setActiveBranch).not.toHaveBeenCalled();
  },
);

it("reports a successful sign-in when the other account cannot use the project either", async () => {
  connectedApp();
  h.getProject.mockRejectedValue(
    new DyadError(NEON_PROJECT_ACCESS_DENIED_MESSAGE, DyadErrorKind.Auth),
  );
  const view = render(connector());
  fireEvent.click(
    await screen.findByRole("button", {
      name: "integrations.neon.signInAnotherAccount",
    }),
  );
  await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledOnce());
  h.getProject.mockClear();
  h.settings = { neon: { accessToken: { value: "other-account" } } };
  h.flowState = {
    status: "connected",
    revision: 1,
    provider: "neon",
    invocationRef,
  };
  view.rerender(connector());

  await waitFor(() =>
    expect(h.acknowledge).toHaveBeenCalledExactlyOnceWith(
      "neon",
      invocationRef,
    ),
  );
  expect(h.getProject).toHaveBeenCalledWith({ appId: 1 });
  expect(h.success).toHaveBeenCalledExactlyOnceWith(
    "integrations.neon.reconnectedSuccess",
  );
  expect(h.error).not.toHaveBeenCalled();
  // The inline notice, not a toast, reports the remaining access problem.
  await screen.findByText("integrations.neon.projectAccessRequired");
});

it("shows the project picker after unlinking a project this account cannot access", async () => {
  connectedApp();
  h.getProject.mockRejectedValue(
    new DyadError(NEON_PROJECT_ACCESS_DENIED_MESSAGE, DyadErrorKind.Auth),
  );
  render(connector());
  await screen.findByText("integrations.neon.projectAccessRequired");
  // The project query is disabled once unlinked, so its access error is stale.
  h.getApp.mockResolvedValue({ id: 1, frameworkType: "vite" });
  await act(() =>
    client.refetchQueries({ queryKey: queryKeys.apps.detail({ appId: 1 }) }),
  );
  await screen.findByText("integrations.neon.noProjectsFound");
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
  expect(
    client.getQueryState(queryKeys.neon.project({ appId: 1 }))?.error,
  ).toBeInstanceOf(DyadError);
});

it("keeps a retry action for transient errors without requiring sign-in", async () => {
  h.settings = { neon: { accessToken: { value: "valid-token" } } };
  h.listProjects.mockRejectedValueOnce(
    new DyadError("Server unavailable", DyadErrorKind.External),
  );
  render(connector());
  fireEvent.click(
    await screen.findByRole("button", { name: "integrations.neon.retry" }),
  );
  await waitFor(() => expect(h.listProjects).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
  expect(h.openExternalUrl).not.toHaveBeenCalled();
});

it("allows another sign-in after the initiating component has unmounted", async () => {
  connectedApp();
  h.settings.neon!.reconnectRequired = true;
  h.flowState = {
    status: "connected",
    revision: 5,
    provider: "neon",
    invocationRef,
  };
  render(connector());
  const button = await screen.findByTestId("connect-neon-button");
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(h.start).toHaveBeenCalledOnce());
});

it("offers reconnection directly from Settings without needing an app", async () => {
  h.settings = {
    neon: { accessToken: { value: "old" }, reconnectRequired: true },
  };
  render(
    <QueryClientProvider client={client}>
      <NeonIntegration />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "integrations.neon.reconnectTitle",
    }),
  );
  await waitFor(() => expect(h.openExternalUrl).toHaveBeenCalledOnce());
  expect(h.getApp).not.toHaveBeenCalled();
  expect(h.listProjects).not.toHaveBeenCalled();
  expect(screen.queryByText("integrations.neon.connected")).toBeNull();
  expect(
    screen.getByRole("button", { name: "integrations.neon.disconnect" }),
  ).toBeDefined();
});

it("retains the explicit unlink action when a linked app has no saved credentials", async () => {
  connectedApp();
  h.settings = {};
  render(connector());
  await screen.findByRole("button", {
    name: "integrations.neon.reconnectTitle",
  });
  expect(
    screen.getByRole("button", { name: "integrations.neon.disconnectProject" }),
  ).toBeDefined();
  expect(h.getProject).not.toHaveBeenCalled();
  expect(h.setActiveBranch).not.toHaveBeenCalled();
});

it("shows a reconnect action in chat only for a linked app requiring sign-in", async () => {
  connectedApp();
  h.settings.neon!.reconnectRequired = true;
  const view = render(
    <QueryClientProvider client={client}>
      <NeonReconnectionBanner appId={1} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("neon-reconnection-notice");
  expect(h.listProjects).not.toHaveBeenCalled();
  expect(h.openExternalUrl).not.toHaveBeenCalled();
  h.getApp.mockResolvedValue({ id: 2, frameworkType: "vite" });
  view.rerender(
    <QueryClientProvider client={client}>
      <NeonReconnectionBanner appId={2} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull(),
  );
});

it("hides production and preview branches by default", async () => {
  connectedApp();
  render(connector());
  fireEvent.click(await screen.findByTestId("neon-branch-select"));
  await screen.findByRole("option", { name: /development/ });
  expect(screen.queryByRole("option", { name: /main/ })).toBeNull();
  expect(screen.queryByRole("option", { name: /preview/ })).toBeNull();
  expect(
    screen.queryByText("integrations.neon.branchSafety.locked"),
  ).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
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
  expect(h.success).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    undefined,
  );
});

it.each([undefined, true, false])(
  "warns existing production users with protection %s and offers development",
  async (enabled) => {
    connectedApp("prod");
    h.settings.enableNeonBranchProtection = enabled;
    const view = render(connector());
    await screen.findByText(
      "integrations.neon.branchSafety.developmentWarning",
    );
    expect(h.success).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(screen.getByTestId("neon-branch-select").textContent).toContain(
        "development",
      ),
    );
    expect(h.success).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      enabled === false
        ? undefined
        : {
            description:
              "integrations.neon.branchSafety.productionHiddenAfterSwitch",
            duration: 10_000,
          },
    );

    // Reopening the panel after switching must not repeat the notice.
    view.unmount();
    client.clear();
    render(connector());
    const select = await screen.findByTestId("neon-branch-select");
    expect(select.textContent).toContain("development");
    expect(
      screen.queryByText("integrations.neon.branchSafety.locked"),
    ).toBeNull();
    fireEvent.click(select);
    await screen.findByRole("option", { name: /development/ });
    expect(!!screen.queryByRole("option", { name: /main/ })).toBe(
      enabled === false,
    );
    expect(h.success).toHaveBeenCalledOnce();
  },
);

it("only explains hidden production after a successful switch from the picker", async () => {
  connectedApp("prod");
  let rejectSwitch!: (error: Error) => void;
  h.setActiveBranch.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectSwitch = reject;
      }),
  );
  render(connector());
  fireEvent.click(await screen.findByTestId("neon-branch-select"));
  const option = await screen.findByRole("option", { name: /development/ });
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() =>
    expect(h.setActiveBranch).toHaveBeenCalledExactlyOnceWith({
      appId: 1,
      branchId: "dev",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();

  await act(async () => rejectSwitch(new Error("Switch failed")));
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "integrations.neon.failedSetBranch",
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByTestId("neon-branch-select").textContent).toContain(
    "main",
  );

  fireEvent.click(screen.getByTestId("neon-branch-select"));
  const retryOption = await screen.findByRole("option", {
    name: /development/,
  });
  fireEvent.pointerDown(retryOption);
  fireEvent.pointerUp(retryOption);
  fireEvent.click(retryOption);
  fireEvent.keyDown(retryOption, { key: "Enter" });
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      description: "integrations.neon.branchSafety.productionHiddenAfterSwitch",
      duration: 10_000,
    }),
  );
});

it("renders the protection explanation when leaving production for a legacy development snapshot", async () => {
  const { Toaster, toast } =
    await vi.importActual<typeof import("sonner")>("sonner");
  connectedApp("prod");
  h.getProject.mockResolvedValue({
    branches: [
      { branchId: "dev", branchName: "old-development", type: "development" },
      { branchId: "prod", branchName: "main", type: "production" },
      {
        branchId: "legacy-dev",
        branchName: "development",
        type: "snapshot",
      },
    ],
  });
  h.success.mockImplementationOnce(toast.success);
  const view = render(
    <>
      {connector()}
      <Toaster />
    </>,
  );
  try {
    fireEvent.click(await screen.findByTestId("neon-branch-select"));
    const option = await screen.findByRole("option", {
      name: "development integrations.neon.snapshot",
    });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() =>
      expect(h.setActiveBranch).toHaveBeenCalledExactlyOnceWith({
        appId: 1,
        branchId: "legacy-dev",
      }),
    );
    const explanation = await screen.findByText(
      "integrations.neon.branchSafety.productionHiddenAfterSwitch",
    );
    expect(
      explanation.closest("[data-sonner-toast]")?.getAttribute("data-visible"),
    ).toBe("true");
    fireEvent.click(screen.getByTestId("neon-branch-select"));
    await screen.findByRole("option", {
      name: "development integrations.neon.snapshot",
    });
    expect(screen.queryByRole("option", { name: /main/ })).toBeNull();
  } finally {
    view.unmount();
    toast.dismiss();
  }
});
