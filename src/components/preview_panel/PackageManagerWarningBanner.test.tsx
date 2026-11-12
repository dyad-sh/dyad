import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { PackageManagerWarningBanner } from "./PackageManagerWarningBanner";
import { PackageManagerWarningStore } from "@/package_manager_warnings/store";
import { PackageManagerWarningProvider } from "@/package_manager_warnings/PackageManagerWarningProvider";

const {
  appRunState,
  getNodejsStatusMock,
  installPnpmMock,
  openExternalUrlMock,
  rebuildAppAfterPnpmInstallMock,
  restartAppMock,
  stopAppMock,
  executeAppUpgradeMock,
  updateSettingsMock,
  useRunAppMock,
  getChatWorkspaceStatusMock,
  getAppWorkspaceOverviewMock,
} = vi.hoisted(() => ({
  appRunState: {
    loading: false,
    /** Run phase of the owner app (the app whose folder is migrated). */
    ownerPhase: "ready" as string,
  },
  getNodejsStatusMock: vi.fn(),
  installPnpmMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  rebuildAppAfterPnpmInstallMock: vi.fn(),
  restartAppMock: vi.fn(),
  stopAppMock: vi.fn(),
  executeAppUpgradeMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  useRunAppMock: vi.fn(),
  getChatWorkspaceStatusMock: vi.fn(),
  getAppWorkspaceOverviewMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getNodejsStatus: getNodejsStatusMock,
      installPnpm: installPnpmMock,
      openExternalUrl: openExternalUrlMock,
    },
    upgrade: {
      executeAppUpgrade: executeAppUpgradeMock,
    },
    workspace: {
      getChatWorkspaceStatus: getChatWorkspaceStatusMock,
      getAppWorkspaceOverview: getAppWorkspaceOverviewMock,
    },
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    updateSettings: updateSettingsMock,
  }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRebuildAppAfterPnpmInstall: () => rebuildAppAfterPnpmInstallMock,
  useRunApp: (targetRuntimeId?: number | null) => {
    useRunAppMock(targetRuntimeId);
    return {
      loading: appRunState.loading,
      restartApp: restartAppMock,
      stopApp: stopAppMock,
    };
  },
}));

vi.mock("@/hooks/useAppRun", () => ({
  useAppRunState: () => ({ phase: appRunState.ownerPhase }),
}));

const WORKSPACE_RUNTIME_ID = 1_000_000_003;

describe("PackageManagerWarningBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appRunState.loading = false;
    appRunState.ownerPhase = "ready";
    getNodejsStatusMock.mockReset();
    installPnpmMock.mockReset();
    openExternalUrlMock.mockReset();
    rebuildAppAfterPnpmInstallMock.mockReset();
    restartAppMock.mockReset();
    stopAppMock.mockReset();
    executeAppUpgradeMock.mockReset();
    updateSettingsMock.mockReset();
    useRunAppMock.mockReset();
    getChatWorkspaceStatusMock.mockReset();
    getAppWorkspaceOverviewMock.mockReset();
    getAppWorkspaceOverviewMock.mockResolvedValue({
      appId: 1,
      isolationEnabled: false,
      writableChatIds: [],
      workspaces: [],
    });
    executeAppUpgradeMock.mockResolvedValue(undefined);
    restartAppMock.mockResolvedValue(undefined);
    stopAppMock.mockResolvedValue(undefined);
    getNodejsStatusMock.mockResolvedValue({
      nodeVersion: "v22.14.0",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://example.com/node.pkg",
      source: "system",
      nodePath: "node",
      managedNodeInstalled: false,
      managedNodeVersion: null,
      systemNodeTooOld: false,
      managedNodeSupported: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderBanner({
    kind = "release-age",
    message = "Install pnpm 10.16.0 or newer for the strongest protection",
    workspaceChat = false,
  }: {
    kind?: "release-age" | "pnpm-migration";
    message?: string;
    /** Select a chat whose isolated workspace reported the warning. */
    workspaceChat?: boolean;
  } = {}) {
    const store = createStore();
    const warningStore = new PackageManagerWarningStore();
    store.set(selectedAppIdAtom, 1);
    if (workspaceChat) {
      store.set(selectedChatIdAtom, 7);
      getChatWorkspaceStatusMock.mockResolvedValue({
        chatId: 7,
        appId: 1,
        kind: "isolated",
        branch: "dyad/chat-7",
        targetBranch: "main",
        workspaceId: 3,
        runtimeAppId: WORKSPACE_RUNTIME_ID,
        writableTurnRunning: false,
        hasUnmergedWork: false,
        packageManager: "pnpm",
        integration: null,
      });
    }
    warningStore.setWarning(workspaceChat ? WORKSPACE_RUNTIME_ID : 1, {
      kind,
      message,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const Wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <PackageManagerWarningProvider manager={warningStore}>
            {children}
          </PackageManagerWarningProvider>
        </Provider>
      </QueryClientProvider>
    );

    render(<PackageManagerWarningBanner />, { wrapper: Wrapper });
    return { store, warningStore };
  }

  it("dismisses the warning for the current session", () => {
    const { warningStore } = renderBanner();

    fireEvent.click(screen.getByLabelText("Dismiss pnpm warning"));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(warningStore.getSnapshot(1)).toBeUndefined();
  });

  it("only shows the warning for the selected app", () => {
    const { store } = renderBanner();

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(screen.queryByTestId("package-manager-warning-banner")).toBeNull();

    act(() => {
      store.set(selectedAppIdAtom, 1);
    });

    expect(
      screen.queryByTestId("package-manager-warning-banner"),
    ).not.toBeNull();
  });

  it("installs pnpm, rebuilds the app, and clears the banner after success", async () => {
    const { warningStore } = renderBanner();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
      await Promise.resolve();
    });

    expect(installPnpmMock).toHaveBeenCalledTimes(1);
    expect(rebuildAppAfterPnpmInstallMock).toHaveBeenCalledWith(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      hidePnpmMinimumReleaseAgeWarning: true,
    });
    screen.getByText("pnpm installed. Rebuilding preview...");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(warningStore.getSnapshot(1)).toBeUndefined();
  });

  it("resets install state when a new warning is shown", async () => {
    const { warningStore } = renderBanner();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    act(() => {
      warningStore.setWarning(1, {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer for the strongest protection",
      });
    });

    screen.getByText(
      "Install pnpm 10.16.0 or newer for the strongest protection",
    );
    const installButton = screen.getByRole("button", {
      name: /install/i,
    }) as HTMLButtonElement;
    expect(installButton.disabled).toBe(false);
  });

  it("keeps a docs action visible when pnpm installation fails", async () => {
    installPnpmMock.mockRejectedValueOnce(new Error("EACCES"));
    renderBanner();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
      await Promise.resolve();
    });

    screen.getByText("EACCES.");
    expect(updateSettingsMock).toHaveBeenCalledWith({
      hidePnpmMinimumReleaseAgeWarning: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /docs/i }));

    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://pnpm.io/installation",
    );
  });

  it("shows a Node.js download action when Node is too old for pnpm v11", async () => {
    vi.useRealTimers();
    getNodejsStatusMock.mockResolvedValue({
      nodeVersion: "v20.11.1",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://example.com/node.pkg",
      source: "system",
      nodePath: "node",
      managedNodeInstalled: false,
      managedNodeVersion: null,
      systemNodeTooOld: true,
      managedNodeSupported: true,
    });

    renderBanner();

    const downloadButton = await screen.findByRole("button", {
      name: /download node\.js/i,
    });
    fireEvent.click(downloadButton);

    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://example.com/node.pkg",
    );
    expect(installPnpmMock).not.toHaveBeenCalled();
  });

  it("stops the app before running the pnpm migration upgrade", async () => {
    renderBanner({
      kind: "pnpm-migration",
      message:
        "This app pins an older pnpm that can't read the lockfile Dyad writes.",
    });

    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("package-manager-warning-run-upgrade"),
      );
      await Promise.resolve();
    });

    expect(stopAppMock).toHaveBeenCalledWith(1);
    expect(executeAppUpgradeMock).toHaveBeenCalledWith({
      appId: 1,
      upgradeId: "pnpm-version-migration",
    });
    expect(restartAppMock).toHaveBeenCalledTimes(1);
    expect(restartAppMock).toHaveBeenCalledWith({ appId: 1 });
    expect(installPnpmMock).not.toHaveBeenCalled();

    expect(stopAppMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeAppUpgradeMock.mock.invocationCallOrder[0],
    );
    expect(executeAppUpgradeMock.mock.invocationCallOrder[0]).toBeLessThan(
      restartAppMock.mock.invocationCallOrder[0],
    );
  });

  it("waits for the active app lifecycle before starting migration", () => {
    appRunState.loading = true;
    renderBanner({
      kind: "pnpm-migration",
      message:
        "This app pins an older pnpm that can't read the lockfile Dyad writes.",
    });

    const migrateButton = screen.getByTestId(
      "package-manager-warning-run-upgrade",
    ) as HTMLButtonElement;
    expect(migrateButton.disabled).toBe(true);
  });

  it("shows warnings from the isolated workspace the preview shows", async () => {
    vi.useRealTimers();
    renderBanner({
      workspaceChat: true,
      message: "Install pnpm 10.16.0 or newer",
    });

    await screen.findByText("Install pnpm 10.16.0 or newer");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
      await Promise.resolve();
    });
    // The workspace's runtime reported it, so that runtime is rebuilt.
    expect(rebuildAppAfterPnpmInstallMock).toHaveBeenCalledWith(
      WORKSPACE_RUNTIME_ID,
    );
  });

  it("migrates and restarts the app itself when a workspace reported the pnpm migration", async () => {
    vi.useRealTimers();
    const { warningStore } = renderBanner({
      kind: "pnpm-migration",
      message: "Migrate to pnpm 11",
      workspaceChat: true,
    });
    const migrateButton = await screen.findByTestId(
      "package-manager-warning-run-upgrade",
    );
    // Stop and restart address the same app the upgrade migrates: the
    // upgrade only takes an app id and rewrites the app's own folder.
    expect(useRunAppMock).toHaveBeenLastCalledWith(1);

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(migrateButton);
      await Promise.resolve();
    });

    expect(stopAppMock).toHaveBeenCalledWith(1);
    expect(executeAppUpgradeMock).toHaveBeenCalledWith({
      appId: 1,
      upgradeId: "pnpm-version-migration",
    });
    // The app was running, so it is restarted, and never the workspace.
    expect(restartAppMock).toHaveBeenCalledTimes(1);
    expect(restartAppMock).toHaveBeenCalledWith({ appId: 1 });
    const successMessage =
      "pnpm migration applied to the app. This chat's workspace picks it up with its next turn.";
    screen.getByText(successMessage);

    // The explanation stays until the user closes it.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    screen.getByText(successMessage);
    expect(warningStore.getSnapshot(WORKSPACE_RUNTIME_ID)).toBeDefined();

    fireEvent.click(screen.getByLabelText("Dismiss pnpm warning"));
    expect(warningStore.getSnapshot(WORKSPACE_RUNTIME_ID)).toBeUndefined();
    // Closing the success message is not a dismissal: the workspace's later
    // warnings still show.
    act(() => {
      warningStore.setWarning(WORKSPACE_RUNTIME_ID, {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      });
    });
    screen.getByText("Install pnpm 10.16.0 or newer");
  });

  it("leaves a stopped app stopped when a workspace reported the pnpm migration", async () => {
    vi.useRealTimers();
    appRunState.ownerPhase = "idle";
    renderBanner({
      kind: "pnpm-migration",
      message: "Migrate to pnpm 11",
      workspaceChat: true,
    });
    const migrateButton = await screen.findByTestId(
      "package-manager-warning-run-upgrade",
    );

    await act(async () => {
      fireEvent.click(migrateButton);
      await Promise.resolve();
    });

    expect(executeAppUpgradeMock).toHaveBeenCalledWith({
      appId: 1,
      upgradeId: "pnpm-version-migration",
    });
    // The user is viewing the workspace's preview, not the app's, so the
    // app's runtime is not started just because its folder was migrated.
    expect(restartAppMock).not.toHaveBeenCalled();
    screen.getByText(
      "pnpm migration applied to the app. This chat's workspace picks it up with its next turn.",
    );
  });

  it("keeps release-age warnings ahead of pnpm migration warnings", () => {
    const { warningStore } = renderBanner({
      kind: "pnpm-migration",
      message: "Migrate to pnpm 11",
    });

    act(() => {
      warningStore.setWarning(1, {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      });
      warningStore.setWarning(1, {
        kind: "pnpm-migration",
        message: "Migrate to pnpm 11",
      });
    });

    screen.getByText("Install pnpm 10.16.0 or newer");
  });
});
