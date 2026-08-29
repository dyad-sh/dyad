import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseConnector } from "./SupabaseConnector";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { SUPABASE_PROJECT_CREATED_BUT_UNLINKED } from "@/ipc/types";

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
  supabaseOptionsState,
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
    // Mirrors the real hook, which tracks in-flight creates per app so two
    // running at once cannot be mistaken for each other.
    creatingAppIds: new Set<number>(),
  },
  // What the connector asked the data hook for. The branch query is gated by
  // the argument it passes, not by anything it renders.
  supabaseOptionsState: {
    last: null as { branchesProjectId?: string | null } | null,
  },
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
  SUPABASE_PROJECT_CREATED_BUT_UNLINKED:
    "supabase_project_created_but_unlinked",
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
  useSupabase: (options: { branchesProjectId?: string | null }) => {
    supabaseOptionsState.last = options;
    return {
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
      isCreatingProjectForApp: (id: number) =>
        createState.creatingAppIds.has(id),
      createProject: createState.createProject,
      refetchOrganizations: refetchOrganizationsMock,
      refetchProjects: refetchProjectsMock,
      setAppProject: setAppProjectMock,
      recoverAppProject: recoverAppProjectMock,
      unsetAppProject: unsetAppProjectMock,
      deleteOrganization: vi.fn(),
    };
  },
  // Mirrors the real predicate: matched on the code the handler attaches, not
  // on the error kind.
  isCreatedButUnlinkedError: (error: unknown) =>
    (error as { code?: unknown } | null)?.code ===
    SUPABASE_PROJECT_CREATED_BUT_UNLINKED,
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
  createState.creatingAppIds = new Set();
  supabaseOptionsState.last = null;
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

// The selector state: connected to Supabase, but this app has no project yet.
function showSelector() {
  appState.supabaseProjectId = null;
  appState.supabaseProjectName = null;
  appState.supabaseOrganizationSlug = null;
  organizationsState.current = [{ organizationSlug: "org-1", name: "Acme" }];
}

/** A create whose settlement this test controls. */
function deferredCreate() {
  let settle: (project: unknown) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle: (p: unknown) => settle(p), fail };
}

// Mirrors what the handler throws when the project exists but the link failed.
// The code is the marker; the kind is the catch-all it happens to share with
// every other unclassified failure.
function createdButUnlinkedError() {
  const error = new DyadError(
    "Created Supabase project abc123 but couldn't link it to this app.",
    DyadErrorKind.Internal,
  );
  (error as DyadError & { code: string }).code =
    SUPABASE_PROJECT_CREATED_BUT_UNLINKED;
  return error;
}

async function submitFailingCreate(error: Error) {
  showSelector();
  createState.createProject = vi.fn().mockRejectedValue(error);
  const rendered = renderConnector();
  fireEvent.click(await screen.findByTestId("supabase-create-project-button"));
  fireEvent.click(await screen.findByTestId("supabase-create-project-submit"));
  return rendered;
}

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

describe("SupabaseConnector — creating a project", () => {
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
    createState.creatingAppIds = new Set([999]);

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );

    const submit = await screen.findByTestId("supabase-create-project-submit");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("locks the form while this app's own create is in flight", async () => {
    showSelector();
    createState.creatingAppIds = new Set([7]);

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );

    const submit = await screen.findByTestId("supabase-create-project-submit");
    expect(submit.hasAttribute("disabled")).toBe(true);
  });
});

describe("SupabaseConnector — a create that fails", () => {
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
    const unlinked = createdButUnlinkedError();
    await submitFailingCreate(unlinked);

    await waitFor(() =>
      expect(screen.queryByTestId("supabase-new-project-name")).toBeNull(),
    );
    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });

  // `Internal` is the kind for any unclassified bug, so a failure that carries
  // it without the code never created a project. Treating it as one would tell
  // the user to go clean up something that does not exist.
  it("does not claim a project exists for an unmarked internal failure", async () => {
    await submitFailingCreate(
      new DyadError("Renderer is not trusted", DyadErrorKind.Internal),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "not trusted",
    );
    // The form stays open, which is what an ordinary failure gets.
    expect(screen.getByTestId("supabase-new-project-name")).toBeTruthy();
  });

  // The mutation refetches the project list on this failure, so an alert placed
  // below that branch would be swapped for the refetch's skeleton just as the
  // only record of the orphan appeared.
  it("keeps reporting the orphan while the project list reloads", async () => {
    const { rerender } = await submitFailingCreate(createdButUnlinkedError());
    await screen.findByTestId("supabase-create-project-error");

    providerLoadingState.projects = true;
    rerender(<SupabaseConnector appId={7} />);

    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });

  it("keeps reporting the orphan when that reload fails", async () => {
    const { rerender } = await submitFailingCreate(createdButUnlinkedError());
    await screen.findByTestId("supabase-create-project-error");

    providerErrorState.projects = new Error("offline");
    rerender(<SupabaseConnector appId={7} />);

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
    const unlinked = createdButUnlinkedError();
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

// `@/ipc/types` is mocked wholesale here, so the marker the fixtures carry is a
// copy of the real one rather than the real one. Imported directly — the real
// module is untouched by that mock — so changing the constant fails here rather
// than leaving these tests quietly pinning a value nothing uses.
describe("the created-but-unlinked marker these tests fake", () => {
  it("still matches the real constant", async () => {
    const real = await import("@/ipc/types/supabase");
    expect(real.SUPABASE_PROJECT_CREATED_BUT_UNLINKED).toBe(
      SUPABASE_PROJECT_CREATED_BUT_UNLINKED,
    );
  });
});

describe("SupabaseConnector — clearing a create failure", () => {
  // Picking a project is how the user finishes a create that failed after
  // minting one, so the message has done its job once the app is linked.
  it("clears the failure once the app has a project", async () => {
    const user = userEvent.setup();
    projectsState.current = [
      {
        id: "proj-new",
        name: "My App",
        region: "us-east-1",
        organizationSlug: "org-1",
      },
    ];
    // Stands in for the link the handler writes and refreshApp reloads.
    setAppProjectMock.mockImplementation(async () => {
      appState.supabaseProjectId = "proj-new";
    });

    const { rerender } = await submitFailingCreate(createdButUnlinkedError());
    await screen.findByTestId("supabase-create-project-error");

    await user.click(screen.getByLabelText("Project"));
    await user.click(await screen.findByRole("option", { name: /My App/ }));
    await waitFor(() => expect(setAppProjectMock).toHaveBeenCalled());
    rerender(<SupabaseConnector appId={7} />);

    await waitFor(() =>
      expect(screen.queryByTestId("supabase-create-project-error")).toBeNull(),
    );
  });

  // The app on screen being linked says nothing about the app a create was
  // launched for. Suppressing on that basis discards the orphan message for the
  // app that actually failed — the only record of a project being paid for.
  it("keeps a failure for an app the panel has navigated away from", async () => {
    showSelector();
    const create = deferredCreate();
    createState.createProject = vi.fn().mockReturnValue(create.promise);

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    await waitFor(() => expect(createState.createProject).toHaveBeenCalled());

    // App 8 is on screen and linked when app 7's create fails.
    appState.supabaseProjectId = "proj-8";
    appState.supabaseProjectName = "Other Project";
    rerender(<SupabaseConnector appId={8} />);
    await act(async () => {
      create.fail(createdButUnlinkedError());
      await create.promise.catch(() => {});
    });

    // Back on app 7, still unlinked, the message has to be there.
    appState.supabaseProjectId = null;
    appState.supabaseProjectName = null;
    rerender(<SupabaseConnector appId={7} />);
    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });

  // The one path the clear-on-linked effect cannot cover: a failure recorded
  // while the app was already linked leaves the effect no transition to fire
  // on. Disconnecting is what brings the selector card back, so it has to drop
  // the message on the way.
  it("clears a failure recorded while linked when the app is disconnected", async () => {
    organizationsState.current = [{ organizationSlug: "org-1", name: "Acme" }];
    appState.supabaseProjectId = "proj-1";
    appState.supabaseProjectName = null;
    createState.createProject = vi
      .fn()
      .mockRejectedValue(
        new Error("This app is already connected to a Supabase project."),
      );

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    await screen.findByRole("alert");

    // Disconnect from the reconnect card, which is where a linked app with no
    // usable credentials offers it.
    hasSupabaseCredentialsForOrganizationMock.mockReturnValue(false);
    rerender(<SupabaseConnector appId={7} />);
    fireEvent.click(
      screen.getByText("integrations.supabase.disconnectProject"),
    );
    await waitFor(() => expect(unsetAppProjectMock).toHaveBeenCalled());

    // Back on the selector as an unlinked app, with nothing left over. Asserted
    // on the message rather than the outside alert: the form stays open on an
    // ordinary failure, so it is the form's own copy that would survive.
    hasSupabaseCredentialsForOrganizationMock.mockReturnValue(true);
    appState.supabaseProjectId = null;
    rerender(<SupabaseConnector appId={7} />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The connected card is gated on the project NAME, which getApp leaves null
  // when the Management API call for it fails. That renders the selector, with
  // its Create button, for an app that is linked — and the handler refuses.
  // Suppressed, that click is a silent no-op: the mutation shows no toast.
  it("shows the refusal when Create is pressed on a linked app", async () => {
    organizationsState.current = [{ organizationSlug: "org-1", name: "Acme" }];
    appState.supabaseProjectId = "proj-1";
    appState.supabaseProjectName = null;
    createState.createProject = vi
      .fn()
      .mockRejectedValue(
        new Error("This app is already connected to a Supabase project."),
      );

    renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "already connected",
    );
  });

  // A double-submit settles as one success and one "already connected"
  // failure, and the failure lands second. Clearing per success path would
  // leave it on file to reappear at the next disconnect, contradicting the
  // success toast the user just saw.
  it("drops a failure that lost the race to a create that linked the app", async () => {
    showSelector();
    const first = deferredCreate();
    const second = deferredCreate();
    createState.createProject = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = renderConnector();
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    const submit = await screen.findByTestId("supabase-create-project-submit");
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(createState.createProject).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      first.settle({
        id: "proj-new",
        name: "My App",
        region: "us-east-1",
        organizationSlug: "org-1",
      });
      await first.promise;
    });
    await act(async () => {
      second.fail(
        new Error("This app is already connected to a Supabase project."),
      );
      await second.promise.catch(() => {});
    });

    // The create linked the app, which is what settles the losing failure.
    appState.supabaseProjectId = "proj-new";
    rerender(<SupabaseConnector appId={7} />);

    await waitFor(() =>
      expect(screen.queryByTestId("supabase-create-project-error")).toBeNull(),
    );
  });

  // For a project created but not linked, this message carries the only copy of
  // its id, and "Create new project" is the natural thing to click after
  // reading it. Clearing on reopen would wipe it before the user could act.
  // Backing out of the form settles nothing about a project that was already
  // minted, and this message is the only place its id appears. Reopening to
  // re-read it and then cancelling must not be what loses it.
  it("keeps the failure when the form is cancelled", async () => {
    await submitFailingCreate(createdButUnlinkedError());
    await screen.findByTestId("supabase-create-project-error");

    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(screen.getByText("common:cancel"));
    await act(async () => {});

    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });

  // Only a stranded project earns that stickiness. An ordinary failure kept
  // past a cancel becomes a banner over the selector with nothing on screen to
  // dismiss it.
  it("clears an ordinary failure when the form is cancelled", async () => {
    await submitFailingCreate(new Error("You have reached your project limit"));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByText("common:cancel"));
    await act(async () => {});

    // The testid, not the form's own `role="alert"`: that one goes with the
    // form whether or not the record was dropped, so it would pass either way.
    expect(screen.queryByTestId("supabase-create-project-error")).toBeNull();
  });

  it("keeps the failure visible when the form is reopened", async () => {
    await submitFailingCreate(createdButUnlinkedError());
    await screen.findByTestId("supabase-create-project-error");

    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );

    // Inside the form now, rather than beside it.
    expect((await screen.findByRole("alert")).textContent).toContain(
      "couldn't link it to this app",
    );

    // And the first keystroke is what drops it.
    fireEvent.change(await screen.findByTestId("supabase-new-project-name"), {
      target: { value: "retry-name" },
    });
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The scoping tests pass even if the clear never fires, which would strand a
  // failure over inputs the user has since retyped.
  it("clears the failure once the same app edits its form", async () => {
    await submitFailingCreate(new Error("You have reached your project limit"));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByTestId("supabase-new-project-name"), {
      target: { value: "edited" },
    });

    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Two creates can be in flight at once, so one app's failure must not
  // overwrite the record belonging to another.
  it("keeps both apps' failures when two creates fail", async () => {
    const unlinked = createdButUnlinkedError();
    const { rerender } = await submitFailingCreate(unlinked);
    await screen.findByTestId("supabase-create-project-error");

    appState.name = "Other App";
    createState.createProject = vi
      .fn()
      .mockRejectedValue(new Error("network unreachable"));
    rerender(<SupabaseConnector appId={8} />);
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-button"),
    );
    fireEvent.click(
      await screen.findByTestId("supabase-create-project-submit"),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "network unreachable",
    );

    rerender(<SupabaseConnector appId={7} />);
    expect(
      (await screen.findByTestId("supabase-create-project-error")).textContent,
    ).toContain("couldn't link it to this app");
  });
});
