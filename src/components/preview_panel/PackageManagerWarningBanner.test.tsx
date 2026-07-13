import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  currentPackageManagerWarningAtom,
  setPackageManagerWarningForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { PackageManagerWarningBanner } from "./PackageManagerWarningBanner";

const {
  getNodejsStatusMock,
  installPnpmMock,
  openExternalUrlMock,
  rebuildAppAfterPnpmInstallMock,
  restartAppMock,
  stopAppMock,
  executeAppUpgradeMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  getNodejsStatusMock: vi.fn(),
  installPnpmMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  rebuildAppAfterPnpmInstallMock: vi.fn(),
  restartAppMock: vi.fn(),
  stopAppMock: vi.fn(),
  executeAppUpgradeMock: vi.fn(),
  updateSettingsMock: vi.fn(),
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
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    updateSettings: updateSettingsMock,
  }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRebuildAppAfterPnpmInstall: () => rebuildAppAfterPnpmInstallMock,
  useRunApp: () => ({
    restartApp: restartAppMock,
    stopApp: stopAppMock,
  }),
}));

describe("PackageManagerWarningBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getNodejsStatusMock.mockReset();
    installPnpmMock.mockReset();
    openExternalUrlMock.mockReset();
    rebuildAppAfterPnpmInstallMock.mockReset();
    restartAppMock.mockReset();
    stopAppMock.mockReset();
    executeAppUpgradeMock.mockReset();
    updateSettingsMock.mockReset();
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
  }: {
    kind?: "release-age" | "pnpm-migration";
    message?: string;
  } = {}) {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        kind,
        message,
      },
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
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );

    render(<PackageManagerWarningBanner />, { wrapper: Wrapper });
    return store;
  }

  it("dismisses the warning for the current session", () => {
    const store = renderBanner();

    fireEvent.click(screen.getByLabelText("Dismiss pnpm warning"));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();
  });

  it("only shows the warning for the selected app", () => {
    const store = renderBanner();

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
    const store = renderBanner();

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

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();
  });

  it("resets install state when a new warning is shown", async () => {
    const store = renderBanner();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    act(() => {
      store.set(setPackageManagerWarningForAppAtom, {
        appId: 1,
        warning: {
          kind: "release-age",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
        },
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
    expect(installPnpmMock).not.toHaveBeenCalled();

    expect(stopAppMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeAppUpgradeMock.mock.invocationCallOrder[0],
    );
    expect(executeAppUpgradeMock.mock.invocationCallOrder[0]).toBeLessThan(
      restartAppMock.mock.invocationCallOrder[0],
    );
  });
});
