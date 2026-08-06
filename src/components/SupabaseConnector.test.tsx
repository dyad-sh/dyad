import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseConnector } from "./SupabaseConnector";

const {
  detectLegacyAppKeyMock,
  switchAppToPublishableKeyMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  redeployAllFunctionsMock,
  redeployState,
  showErrorMock,
} = vi.hoisted(() => ({
  detectLegacyAppKeyMock: vi.fn(),
  switchAppToPublishableKeyMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  redeployAllFunctionsMock: vi.fn(),
  showErrorMock: vi.fn(),
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {}, refreshSettings: vi.fn() }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: {
      supabaseProjectId: "proj-1",
      supabaseProjectName: "My Project",
      supabaseOrganizationSlug: "org-1",
    },
    refreshApp: vi.fn(),
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock("@/lib/schemas", () => ({ isSupabaseConnected: () => true }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    organizations: [],
    projects: [],
    branches: [],
    isLoadingProjects: false,
    isFetchingProjects: false,
    projectsError: null,
    isLoadingBranches: false,
    branchesError: null,
    isSettingAppProject: false,
    refetchOrganizations: vi.fn(),
    setAppProject: vi.fn(),
    unsetAppProject: vi.fn(),
    deleteOrganization: vi.fn(),
  }),
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
  useUnsolicitedConnectionReturn: vi.fn(),
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
    errors: [],
  });
  redeployState.progress = null;
  redeployState.isPending = false;
});

describe("SupabaseConnector — edge function redeployment", () => {
  const REDEPLOY_BUTTON = "supabase-redeploy-functions-button";

  it("redeploys every function for the current app", async () => {
    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() =>
      expect(redeployAllFunctionsMock).toHaveBeenCalledWith(7),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "integrations.supabase.redeploySucceeded",
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

  it("surfaces partial deployment failures", async () => {
    redeployAllFunctionsMock.mockResolvedValue({
      functionCount: 2,
      errors: ["Failed to bundle send-email"],
    });

    renderConnector();
    fireEvent.click(await screen.findByTestId(REDEPLOY_BUTTON));

    await waitFor(() =>
      expect(showErrorMock).toHaveBeenCalledWith(
        "integrations.supabase.redeployFailed",
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
