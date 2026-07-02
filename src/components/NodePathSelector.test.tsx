import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodePathSelector } from "./NodePathSelector";

const mocks = vi.hoisted(() => ({
  getNodejsStatus: vi.fn(),
  getSystemDebugInfo: vi.fn(),
  invalidateQueries: vi.fn(),
  installManagedNode: vi.fn(),
  onManagedNodeInstallProgress: vi.fn(),
  reloadEnvPath: vi.fn(),
  removeManagedNode: vi.fn(),
  selectNodeFolder: vi.fn(),
  settings: null as Record<string, unknown> | null,
  updateSettings: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      system: {
        onManagedNodeInstallProgress: mocks.onManagedNodeInstallProgress,
      },
    },
    system: {
      getNodejsStatus: mocks.getNodejsStatus,
      getSystemDebugInfo: mocks.getSystemDebugInfo,
      installManagedNode: mocks.installManagedNode,
      reloadEnvPath: mocks.reloadEnvPath,
      removeManagedNode: mocks.removeManagedNode,
      selectNodeFolder: mocks.selectNodeFolder,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("NodePathSelector", () => {
  beforeEach(() => {
    mocks.getNodejsStatus.mockReset();
    mocks.getSystemDebugInfo.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.installManagedNode.mockReset();
    mocks.onManagedNodeInstallProgress.mockReset();
    mocks.reloadEnvPath.mockReset();
    mocks.removeManagedNode.mockReset();
    mocks.selectNodeFolder.mockReset();
    mocks.updateSettings.mockReset();
    mocks.settings = null;

    mocks.getSystemDebugInfo.mockResolvedValue({
      nodePath: "/usr/local/bin/node",
    });
    mocks.getNodejsStatus.mockResolvedValue({
      nodeVersion: "v22.14.0",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://nodejs.org",
      source: "system",
      nodePath: "node",
      managedNodeInstalled: false,
      managedNodeVersion: null,
      systemNodeTooOld: false,
      managedNodeSupported: true,
    });
    mocks.onManagedNodeInstallProgress.mockReturnValue(vi.fn());
  });

  it("checks Node status after settings load without a custom node path", async () => {
    const { rerender } = render(<NodePathSelector />);

    expect(mocks.getNodejsStatus).not.toHaveBeenCalled();

    mocks.settings = {
      nodeRuntimePreference: "system",
    };
    rerender(<NodePathSelector />);

    await waitFor(() => {
      expect(mocks.getNodejsStatus).toHaveBeenCalledTimes(1);
    });
    const installButton = screen.getByRole("button", {
      name: "general.installManagedNode",
    }) as HTMLButtonElement;
    expect(installButton.disabled).toBe(false);
  });
});
