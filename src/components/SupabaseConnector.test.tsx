import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseConnector } from "./SupabaseConnector";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const {
  detectLegacyAppKeyMock,
  switchAppToPublishableKeyMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  redeployAllFunctionsMock,
  redeployState,
  showErrorMock,
  hasSupabaseCredentialsForOrganizationMock,
  unsetAppProjectMock,
  setAppProjectMock,
  recoverAppProjectMock,
  refetchOrganizationsMock,
  refetchProjectsMock,
  refreshSettingsMock,
  refreshAppMock,
  appState,
  projectsState,
  providerLoadingState,
  providerErrorState,
  settingsLoadingState,
  appLoadingState,
  unsolicitedReturnCallback,
  refreshedSettings,
  organizationsState,
  createState,
  projectStatusState,
  projectStatusMock,
} = vi.hoisted(() => ({
  detectLegacyAppKeyMock: vi.fn(),
  switchAppToPublishableKeyMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  redeployAllFunctionsMock: vi.fn(),
  showErrorMock: vi.fn(),
  hasSupabaseCredentialsForOrganizationMock: vi.fn(
    (_settings: unknown, _organizationSlug?: string | null) => true,
  ),
  unsetAppProjectMock: vi.fn(),
  setAppProjectMock: vi.fn(),
  recoverAppProjectMock: vi.fn(),
  refetchOrganizationsMock: vi.fn(),
  refetchProjectsMock: vi.fn(),
  refreshSettingsMock: vi.fn(),
  refreshAppMock: vi.fn(),
  appState: {
    name: "My App",
    supabaseProjectId: "proj-1" as string | null,
    supabaseParentProjectId: undefined as string | undefined,
    supabaseProjectName: "My Project" as string | null,
    supabaseOrganizationSlug: "org-1" as string | null,
  },
  organizationsState: {
    current: [] as Array<{ organizationSlug: string; name?: string }>,
  },
  createState: {
    createProject: vi.fn(),
    isCreatingProject: false,
    // Mirrors the real hook's `createProjectMutation.variables?.appId ?? null`.
    // Omitting it would make the connector's app-scoping gate false no matter
    // what, so a test of that scoping would pass without exercising it.
    creatingProjectAppId: null as number | null,
  },
  // The provisioning banner is the user-facing point of the status hook, so the
  // stub has to be varyable rather than a constant.
  projectStatusState: {
    status: null as string | null,
    isProvisioning: false,
  },
  projectStatusMock: vi.fn(),
  projectsState: {
    current: [] as Array<{
      id: string;
      name: string;
      region: string;
      organizationSlug: string;
    }>,
  },
  providerLoadingState: {
    organizations: false,
    projects: false,
  },
  providerErrorState: {
    organizations: null as Error | null,
    projects: null as Error | null,
  },
  settingsLoadingState: { current: false },
  appLoadingState: { current: false },
  unsolicitedReturnCallback: {
    current: null as null | (() => void),
  },
  refreshedSettings: { refreshed: true },
  redeployState: {
    progress: null as null | { completed: number; total: number },
    isPending: false,
  },
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      detectLegacyAppKey: detectLegacyAppKeyMock,
      switchAppToPublishableKey: switchAppToPublishableKeyMock,
    },
    system: { openExternalUrl: vi.fn() },
  },
  // The create form reads these at render time; without them it crashes on its
  // region default.
  SUPABASE_REGIONS: [{ id: "us-east-1", label: "East US (North Virginia)" }],
  DEFAULT_SUPABASE_REGION: "us-east-1",
  SUPABASE_PROJECT_NAME_MAX_LENGTH: 64,
  SUPABASE_PROJECT_STATUS_PROVISIONING: "COMING_UP",
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    info: toastInfoMock,
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolation values are appended rather than dropped, so a test can tell
    // `t("...projectCreated", { name })` from a bare `t("...projectCreated")`.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {},
    refreshSettings: refreshSettingsMock,
    loading: settingsLoadingState.current,
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: {
      name: appState.name,
      supabaseProjectId: appState.supabaseProjectId,
      supabaseParentProjectId: appState.supabaseParentProjectId,
      supabaseProjectName: appState.supabaseProjectName,
      supabaseOrganizationSlug: appState.supabaseOrganizationSlug,
    },
    loading: appLoadingState.current,
    refreshApp: refreshAppMock,
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock("@/lib/schemas", () => ({
  isSupabaseConnected: () => true,
  hasSupabaseCredentialsForOrganization:
    hasSupabaseCredentialsForOrganizationMock,
}));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    organizations: organizationsState.current,
    projects: projectsState.current,
    branches: [],
    isLoadingProjects: providerLoadingState.projects,
    isFetchingProjects: providerLoadingState.projects,
    isLoadingOrganizations: providerLoadingState.organizations,
    isFetchingOrganizations: providerLoadingState.organizations,
    projectsError: providerErrorState.projects,
    organizationsError: providerErrorState.organizations,
    isLoadingBranches: false,
    branchesError: null,
    isSettingAppProject: false,
    isCreatingProject: createState.isCreatingProject,
    creatingProjectAppId: createState.creatingProjectAppId,
    createProject: createState.createProject,
    refetchOrganizations: refetchOrganizationsMock,
    refetchProjects: refetchProjectsMock,
    setAppProject: setAppProjectMock,
    recoverAppProject: recoverAppProjectMock,
    unsetAppProject: unsetAppProjectMock,
    deleteOrganization: vi.fn(),
  }),
  useSupabaseProjectStatus: projectStatusMock,
  isCreatedButUnlinkedError: (error: unknown) =>
    error instanceof DyadError && error.kind === DyadErrorKind.Internal,
  useRedeploySupabaseFunctions: () => ({
    redeployAllFunctions: redeployAllFunctionsMock,
    redeployProgress: redeployState.progress,
    isRedeployingFunctions: redeployState.isPending,
  }),
}));

vi.mock("@/hooks/useConnectionFlow", () => ({
  useConnectionFlow: () => ({
    flowState: { status: "idle" },
    isFlowActive: false,
  }),
  useUnsolicitedConnectionReturn: (_provider: string, callback: () => void) => {
    unsolicitedReturnCallback.current = callback;
  },
  acknowledgeConnectionFlow: vi.fn(),
  cancelConnectionFlow: vi.fn(),
  startConnectionFlow: vi.fn(),
}));

function renderConnector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SupabaseConnector appId={7} />, { wrapper });
}

const BUTTON = "supabase-update-api-key-button";
const SECTION = "supabase-legacy-key";

beforeEach(() => {
  vi.clearAllMocks();
  detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: true });
  switchAppToPublishableKeyMock.mockResolvedValue({ outcome: "switched" });
  redeployAllFunctionsMock.mockResolvedValue({
    functionCount: 2,
    prunedFunctionNames: [],
    errors: [],
  });
  redeployState.progress = null;
  redeployState.isPending = false;
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(true);
  appState.supabaseOrganizationSlug = "org-1";
  appState.supabaseProjectId = "proj-1";
  appState.supabaseParentProjectId = undefined;
  appState.name = "My App";
  appState.supabaseProjectName = "My Project";
  organizationsState.current = [];
  createState.createProject = vi.fn();
  createState.isCreatingProject = false;
  createState.creatingProjectAppId = null;
  projectStatusState.status = null;
  projectStatusState.isProvisioning = false;
  projectStatusMock.mockImplementation(() => projectStatusState);
  projectsState.current = [];
  providerLoadingState.organizations = false;
  providerLoadingState.projects = false;
  providerErrorState.organizations = null;
  providerErrorState.projects = null;
  settingsLoadingState.current = false;
  appLoadingState.current = false;
  unsolicitedReturnCallback.current = null;
  refreshSettingsMock.mockResolvedValue(refreshedSettings);
  refreshAppMock.mockResolvedValue(undefined);
  refetchOrganizationsMock.mockResolvedValue({ data: [] });
  refetchProjectsMock.mockResolvedValue({ data: [] });
  setAppProjectMock.mockResolvedValue(undefined);
  recoverAppProjectMock.mockResolvedValue(undefined);
});

it("migrates a legacy project link to the organization found after reconnect", async () => {
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockImplementation(
    (settings, organizationSlug) =>
      settings === refreshedSettings && organizationSlug === "org-reconnected",
  );
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "My Project",
        region: "us-east-1",
        organizationSlug: "org-reconnected",
      },
    ],
  });

  renderConnector();
  expect(unsolicitedReturnCallback.current).not.toBeNull();
  unsolicitedReturnCallback.current?.();

  await waitFor(() =>
    expect(recoverAppProjectMock).toHaveBeenCalledWith({
      appId: 7,
      projectId: "proj-1",
      parentProjectId: undefined,
      organizationSlug: "org-reconnected",
    }),
  );
});

it("uses the parent project to migrate a legacy branch link", async () => {
  appState.supabaseProjectId = "branch-1";
  appState.supabaseParentProjectId = "proj-1";
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockImplementation(
    (settings, organizationSlug) =>
      settings === refreshedSettings && organizationSlug === "org-reconnected",
  );
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "Parent Project",
        region: "us-east-1",
        organizationSlug: "org-reconnected",
      },
    ],
  });

  renderConnector();
  unsolicitedReturnCallback.current?.();

  await waitFor(() =>
    expect(recoverAppProjectMock).toHaveBeenCalledWith({
      appId: 7,
      projectId: "branch-1",
      parentProjectId: "proj-1",
      organizationSlug: "org-reconnected",
    }),
  );
});

it("relinks without OAuth when the owning organization is already connected", async () => {
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockImplementation(
    (_settings, organizationSlug) => organizationSlug === "org-connected",
  );
  projectsState.current = [
    {
      id: "proj-1",
      name: "My Project",
      region: "us-east-1",
      organizationSlug: "org-connected",
    },
  ];

  renderConnector();
  fireEvent.click(await screen.findByTestId("relink-supabase-project-button"));

  await waitFor(() =>
    expect(recoverAppProjectMock).toHaveBeenCalledWith({
      appId: 7,
      projectId: "proj-1",
      parentProjectId: undefined,
      organizationSlug: "org-connected",
    }),
  );
});

it("does not offer relinking from stale cached projects", () => {
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  projectsState.current = [
    {
      id: "proj-1",
      name: "My Project",
      region: "us-east-1",
      organizationSlug: "org-disconnected",
    },
  ];

  renderConnector();

  expect(screen.queryByTestId("relink-supabase-project-button")).toBeNull();
});

it("refreshes app state when automatic legacy relinking fails", async () => {
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockImplementation(
    (settings, organizationSlug) =>
      settings === refreshedSettings && organizationSlug === "org-reconnected",
  );
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "My Project",
        region: "us-east-1",
        organizationSlug: "org-reconnected",
      },
    ],
  });
  recoverAppProjectMock.mockRejectedValue(new Error("write failed"));

  renderConnector();
  unsolicitedReturnCallback.current?.();

  await waitFor(() => expect(refreshAppMock).toHaveBeenCalled());
  expect(recoverAppProjectMock).toHaveBeenCalled();
  expect(toastErrorMock).toHaveBeenCalledWith(
    expect.stringContaining("integrations.supabase.failedConnectProject:"),
  );
});

it("migrates a link whose stored organization is stale", async () => {
  appState.supabaseOrganizationSlug = "org-old";
  hasSupabaseCredentialsForOrganizationMock.mockImplementation(
    (settings, organizationSlug) =>
      settings === refreshedSettings && organizationSlug === "org-new",
  );
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "My Project",
        region: "us-east-1",
        organizationSlug: "org-new",
      },
    ],
  });

  renderConnector();
  unsolicitedReturnCallback.current?.();

  await waitFor(() =>
    expect(recoverAppProjectMock).toHaveBeenCalledWith({
      appId: 7,
      projectId: "proj-1",
      parentProjectId: undefined,
      organizationSlug: "org-new",
    }),
  );
  expect(toastSuccessMock).toHaveBeenCalledWith(
    "integrations.supabase.projectConnected",
  );
});

it("does not recover a legacy link from stale project data after a failed refetch", async () => {
  appState.supabaseOrganizationSlug = null;
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "Stale Project",
        region: "us-east-1",
        organizationSlug: "org-stale",
      },
    ],
    isError: true,
  });

  renderConnector();
  unsolicitedReturnCallback.current?.();

  await waitFor(() => expect(refreshAppMock).toHaveBeenCalled());
  expect(recoverAppProjectMock).not.toHaveBeenCalled();
});

it("does not recover a legacy link without refreshed organization credentials", async () => {
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  refetchProjectsMock.mockResolvedValue({
    data: [
      {
        id: "proj-1",
        name: "Disconnected Project",
        region: "us-east-1",
        organizationSlug: "org-disconnected",
      },
    ],
    isError: false,
  });

  renderConnector();
  unsolicitedReturnCallback.current?.();

  await waitFor(() => expect(refreshAppMock).toHaveBeenCalled());
  expect(recoverAppProjectMock).not.toHaveBeenCalled();
});

it("shows a disabled relink action while provider projects are loading", async () => {
  appState.supabaseOrganizationSlug = null;
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  providerLoadingState.organizations = true;

  renderConnector();

  const button = screen.getByText("integrations.supabase.relinkProject");
  expect(button.closest("button")?.hasAttribute("disabled")).toBe(true);
});

it("shows and retries provider load failures in the recovery card", async () => {
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  providerErrorState.projects = new Error("project lookup failed");

  renderConnector();

  expect(
    screen.getByText(/integrations\.supabase\.errorLoadingProjects/),
  ).toBeTruthy();
  fireEvent.click(screen.getByText("common:retry"));
  await waitFor(() => {
    expect(refetchOrganizationsMock).toHaveBeenCalled();
    expect(refetchProjectsMock).toHaveBeenCalled();
  });
});

it("shows recovery controls when linked organization credentials are missing", async () => {
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);

  renderConnector();

  expect(await screen.findByTestId("supabase-reconnect-card")).toBeTruthy();
  expect(screen.getByText("My Project")).toBeTruthy();
  expect(
    screen.getByText("integrations.supabase.organizationCredentialsMissing"),
  ).toBeTruthy();
  expect(screen.getByTestId("reconnect-supabase-button")).toBeTruthy();
  fireEvent.click(screen.getByText("integrations.supabase.disconnectProject"));
  await waitFor(() => expect(unsetAppProjectMock).toHaveBeenCalledWith(7));
  expect(hasSupabaseCredentialsForOrganizationMock).toHaveBeenCalledWith(
    {},
    "org-1",
  );
});

it("waits for settings before showing missing-credential recovery", () => {
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  settingsLoadingState.current = true;

  renderConnector();

  expect(screen.getByTestId("supabase-settings-loading")).toBeTruthy();
  expect(screen.queryByTestId("supabase-reconnect-card")).toBeNull();
});

it("waits for the app before choosing the Supabase connection state", () => {
  hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
  appLoadingState.current = true;

  renderConnector();

  expect(screen.getByTestId("supabase-settings-loading")).toBeTruthy();
  expect(screen.queryByTestId("supabase-reconnect-card")).toBeNull();
});

describe("SupabaseConnector — edge function redeployment", () => {
  const REDEPLOY_BUTTON = "supabase-redeploy-functions-button";

  it("redeploys every function for the current app", async () => {
    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() => expect(redeployAllFunctionsMock).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining("integrations.supabase.redeploySucceeded:"),
    );
  });

  it("shows correlated live progress and prevents another deployment", async () => {
    redeployState.isPending = true;
    redeployState.progress = { completed: 3, total: 5 };

    renderConnector();

    const button = await screen.findByTestId(REDEPLOY_BUTTON);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toContain(
      "integrations.supabase.redeployProgress",
    );
  });

  it("reports when there are no local functions", async () => {
    redeployAllFunctionsMock.mockResolvedValue({
      functionCount: 0,
      prunedFunctionNames: [],
      errors: [],
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() =>
      expect(toastInfoMock).toHaveBeenCalledWith(
        "integrations.supabase.noFunctionsToRedeploy",
      ),
    );
  });

  it("reports remote-only functions removed by a prune-only sync", async () => {
    redeployAllFunctionsMock.mockResolvedValue({
      functionCount: 0,
      prunedFunctionNames: ["old-webhook"],
      errors: [],
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining("integrations.supabase.redeployPrunedOnly:"),
      ),
    );
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it("surfaces partial deployment failures", async () => {
    redeployAllFunctionsMock.mockResolvedValue({
      functionCount: 2,
      prunedFunctionNames: [],
      errors: ["Failed to bundle send-email"],
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() =>
      expect(showErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("integrations.supabase.redeployFailed:"),
      ),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

describe("SupabaseConnector — app API key", () => {
  it("offers the update when the app holds this project's legacy key", async () => {
    renderConnector();

    expect(await screen.findByTestId(SECTION)).toBeTruthy();
    expect(screen.getByTestId(BUTTON)).toBeTruthy();
  });

  // An app already on a publishable key has nothing to update.
  it("renders nothing when no legacy key is detected", async () => {
    detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: false });

    renderConnector();

    await waitFor(() => expect(detectLegacyAppKeyMock).toHaveBeenCalled());
    expect(screen.queryByTestId(SECTION)).toBeNull();
    expect(screen.queryByTestId(BUTTON)).toBeNull();
  });

  // Detection failing is non-critical — the offer just doesn't appear.
  it("renders nothing when detection fails", async () => {
    detectLegacyAppKeyMock.mockRejectedValue(new Error("supabase down"));

    renderConnector();

    await waitFor(() => expect(detectLegacyAppKeyMock).toHaveBeenCalled());
    expect(screen.queryByTestId(SECTION)).toBeNull();
  });

  it("reports a completed switch", async () => {
    renderConnector();
    fireEvent.click(await screen.findByTestId(BUTTON));

    await waitFor(() =>
      expect(switchAppToPublishableKeyMock).toHaveBeenCalledWith({ appId: 7 }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "integrations.supabase.apiKeyUpdated",
    );
  });

  // Reachable despite the gate: the file can change between the detection
  // that showed the button and the click.
  it("says so when the key was already current", async () => {
    switchAppToPublishableKeyMock.mockResolvedValue({
      outcome: "already-current",
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(BUTTON));

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "integrations.supabase.apiKeyAlreadyCurrent",
      ),
    );
  });

  // The key is still legacy and Dyad couldn't act on it — the one case where
  // claiming the key is "already up to date" would be a plain falsehood.
  it("does not claim the key is current when nothing could be switched", async () => {
    switchAppToPublishableKeyMock.mockResolvedValue({
      outcome: "not-applicable",
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(BUTTON));

    await waitFor(() =>
      expect(toastInfoMock).toHaveBeenCalledWith(
        "integrations.supabase.apiKeyNotUpdated",
      ),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed switch", async () => {
    switchAppToPublishableKeyMock.mockRejectedValue(new Error("write failed"));

    renderConnector();
    fireEvent.click(await screen.findByTestId(BUTTON));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });
});

describe("SupabaseConnector — provisioning banner", () => {
  const BANNER = "supabase-project-provisioning";

  it("warns while the new project's database is still coming up", async () => {
    projectStatusState.status = "COMING_UP";
    projectStatusState.isProvisioning = true;

    renderConnector();

    expect(await screen.findByTestId(BANNER)).toBeTruthy();
  });

  it("says nothing once the project is serving", async () => {
    projectStatusState.status = "ACTIVE_HEALTHY";

    renderConnector();

    await screen.findByTestId("supabase-branch-select");
    expect(screen.queryByTestId(BANNER)).toBeNull();
  });

  // Guards the wiring, not just the rendering: pointing the hook at the wrong
  // id (a branch ref, say) would leave the banner permanently silent.
  it("asks about the app's own project", async () => {
    renderConnector();

    await screen.findByTestId("supabase-branch-select");
    expect(projectStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        organizationSlug: "org-1",
      }),
    );
  });
});

describe("SupabaseConnector — creating a project", () => {
  // The selector state: connected to Supabase, but this app has no project yet.
  const showSelector = () => {
    appState.supabaseProjectId = null;
    appState.supabaseProjectName = null;
    appState.supabaseOrganizationSlug = null;
    organizationsState.current = [{ organizationSlug: "org-1", name: "Acme" }];
  };

  it("offers project creation when the organization has no projects", async () => {
    showSelector();

    renderConnector();

    expect(
      await screen.findByTestId("supabase-create-project-button"),
    ).toBeTruthy();
  });

  it("keeps the open form and its input while the project list refetches", async () => {
    showSelector();

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.change(await screen.findByTestId("supabase-new-project-name"), {
      target: { value: "half-typed-name" },
    });

    // A background refetch used to render the loading skeleton over the form,
    // unmounting it and discarding whatever the user had typed.
    providerLoadingState.projects = true;
    rerender(<SupabaseConnector appId={7} />);

    const stillThere = (await screen.findByTestId(
      "supabase-new-project-name",
    )) as HTMLInputElement;
    expect(stillThere.value).toBe("half-typed-name");
  });

  // Some navigations (Copy App) swap `appId` without remounting this panel.
  it("does not carry an open form across an app switch", async () => {
    showSelector();

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.change(await screen.findByTestId("supabase-new-project-name"), {
      target: { value: "half-typed-name" },
    });

    appState.name = "Other App";
    rerender(<SupabaseConnector appId={8} />);

    await waitFor(() =>
      expect(screen.queryByTestId("supabase-new-project-name")).toBeNull(),
    );

    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    const reopened = (await screen.findByTestId(
      "supabase-new-project-name",
    )) as HTMLInputElement;
    expect(reopened.value).toBe("Other App");
  });

  // A create settles seconds later, by which time the user may have switched
  // apps and opened a form for the new one. Closing that form would throw away
  // what they just typed.
  it("leaves another app's newly opened form alone when an earlier create settles", async () => {
    showSelector();
    let finishCreate: (project: {
      id: string;
      name: string;
    }) => void = () => {};
    createState.createProject = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve as typeof finishCreate;
        }),
    );

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    await waitFor(() => expect(createState.createProject).toHaveBeenCalled());

    appState.name = "Other App";
    rerender(<SupabaseConnector appId={8} />);
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.change(await screen.findByTestId("supabase-new-project-name"), {
      target: { value: "app-8-name" },
    });

    finishCreate({ id: "proj-new", name: "app-7-project" });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    const survivor = (await screen.findByTestId(
      "supabase-new-project-name",
    )) as HTMLInputElement;
    expect(survivor.value).toBe("app-8-name");
  });

  // The message names the project so it stays true wherever it lands.
  it("names the created project in the success message", async () => {
    showSelector();
    createState.createProject = vi
      .fn()
      .mockResolvedValue({ id: "proj-new", name: "app-7-project" });

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining("app-7-project"),
      ),
    );
  });

  it("does not lock this app's form for another app's in-flight create", async () => {
    showSelector();
    createState.isCreatingProject = true;
    createState.creatingProjectAppId = 999;

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );

    const submit = await screen.findByTestId("supabase-create-project-submit");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("locks the form while this app's own create is in flight", async () => {
    showSelector();
    createState.isCreatingProject = true;
    createState.creatingProjectAppId = 7;

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );

    const submit = await screen.findByTestId("supabase-create-project-submit");
    expect(submit.hasAttribute("disabled")).toBe(true);
  });
});

describe("SupabaseConnector — a create that fails", () => {
  const showSelector = () => {
    appState.supabaseProjectId = null;
    appState.supabaseProjectName = null;
    appState.supabaseOrganizationSlug = null;
    organizationsState.current = [{ organizationSlug: "org-1", name: "Acme" }];
  };

  const submitFailingCreate = async (error: Error) => {
    showSelector();
    createState.createProject = vi.fn().mockRejectedValue(error);
    const rendered = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    return rendered;
  };

  it("shows an ordinary failure inline, leaving the form open to retry", async () => {
    await submitFailingCreate(new Error("You have reached your project limit"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("reached your project limit");
    expect(screen.getByTestId("supabase-new-project-name")).toBeTruthy();
  });

  // The project exists but is unlinked, so leaving the form open invites a
  // second Create that would mint another one. The message has to move out of
  // the form to survive it closing.
  it("closes the form and keeps reporting when the project was created but not linked", async () => {
    const unlinked = new DyadError(
      "Created Supabase project abc123 but couldn't link it to this app.",
      DyadErrorKind.Internal,
    );
    await submitFailingCreate(unlinked);

    await waitFor(() =>
      expect(screen.queryByTestId("supabase-new-project-name")).toBeNull(),
    );
    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });

  it("reports a failure whose form has gone with the app switch", async () => {
    showSelector();
    let failCreate: (error: Error) => void = () => {};
    createState.createProject = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          failCreate = reject as typeof failCreate;
        }),
    );

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    await waitFor(() => expect(createState.createProject).toHaveBeenCalled());

    rerender(<SupabaseConnector appId={8} />);
    failCreate(new Error("network unreachable"));

    // App 8 is on screen and never asked for this, so nothing is shown here.
    // Flushed rather than polled: waitFor returns on its first successful check,
    // which for an absence is satisfied before the rejection even lands.
    await act(async () => {});
    expect(screen.queryByTestId("supabase-create-project-error")).toBeNull();

    // Returning to the app that asked surfaces it, in the form it left open.
    rerender(<SupabaseConnector appId={7} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "network unreachable",
    );
  });

  // For a created-but-unlinked project this message is the only record that a
  // project was minted and left orphaned, so another app's create must not
  // discard it.
  it("keeps one app's failure when another app starts its own create", async () => {
    const unlinked = new DyadError(
      "Created Supabase project abc123 but couldn't link it to this app.",
      DyadErrorKind.Internal,
    );
    const { rerender } = await submitFailingCreate(unlinked);
    await screen.findByTestId("supabase-create-project-error");

    appState.name = "Other App";
    rerender(<SupabaseConnector appId={8} />);
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.change(await screen.findByTestId("supabase-new-project-name"), {
      target: { value: "app-8-name" },
    });

    rerender(<SupabaseConnector appId={7} />);
    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });
});
