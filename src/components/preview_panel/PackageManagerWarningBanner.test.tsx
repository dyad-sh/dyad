import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  currentPackageManagerWarningAtom,
  setPackageManagerWarningForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { PackageManagerWarningBanner } from "./PackageManagerWarningBanner";

const {
  installPnpmMock,
  openExternalUrlMock,
  rebuildAppAfterPnpmInstallMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  installPnpmMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  rebuildAppAfterPnpmInstallMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      installPnpm: installPnpmMock,
      openExternalUrl: openExternalUrlMock,
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
}));

describe("PackageManagerWarningBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installPnpmMock.mockReset();
    openExternalUrlMock.mockReset();
    rebuildAppAfterPnpmInstallMock.mockReset();
    updateSettingsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderBanner() {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        message: "Install pnpm 10.16.0 or newer for the strongest protection",
      },
    });

    const Wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
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
});
