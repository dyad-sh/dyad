import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PreviewPanel,
  resetPreviewAutoInstallGuardForTests,
} from "./PreviewPanel";

const mocks = vi.hoisted(() => ({
  currentConsoleEntriesAtom: Symbol("currentConsoleEntriesAtom"),
  currentPreviewReloadTokenAtom: Symbol("currentPreviewReloadTokenAtom"),
  cancelManagedNodeInstall: vi.fn(),
  installManagedNode: vi.fn(),
  nodeCheckFailed: false,
  managedNodeSupported: true,
  nodeVersion: "v22.14.0",
  openExternalUrl: vi.fn(),
  previewModeAtom: Symbol("previewModeAtom"),
  refetchNodeStatus: vi.fn(),
  reloadEnvPath: vi.fn(),
  runApp: vi.fn(),
  selectAppForPreview: vi.fn(),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  settings: {
    disablePreviewNodeAutoInstall: false,
  } as Record<string, unknown>,
  updateSettings: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: (atom: symbol) => {
    if (atom === mocks.previewModeAtom) {
      return "preview";
    }
    if (atom === mocks.selectedAppIdAtom) {
      return 1;
    }
    if (atom === mocks.currentPreviewReloadTokenAtom) {
      return 0;
    }
    if (atom === mocks.currentConsoleEntriesAtom) {
      return [];
    }
    return undefined;
  },
}));

vi.mock("../../atoms/appAtoms", () => ({
  previewModeAtom: mocks.previewModeAtom,
  selectedAppIdAtom: mocks.selectedAppIdAtom,
}));

vi.mock("@/atoms/previewRuntimeAtoms", () => ({
  currentConsoleEntriesAtom: mocks.currentConsoleEntriesAtom,
  currentPreviewReloadTokenAtom: mocks.currentPreviewReloadTokenAtom,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useQuery: () => ({
    data: {
      nodeDownloadUrl: "https://nodejs.org",
      nodeVersion: mocks.nodeVersion,
      pnpmVersion: "10.15.0",
      source: "system",
      nodePath: "node",
      managedNodeInstalled: false,
      managedNodeVersion: null,
      systemNodeTooOld: false,
      managedNodeSupported: mocks.managedNodeSupported,
    },
    isError: mocks.nodeCheckFailed,
    isLoading: false,
    refetch: mocks.refetchNodeStatus,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      selectAppForPreview: mocks.selectAppForPreview,
    },
    system: {
      getNodejsStatus: vi.fn(),
      installManagedNode: mocks.installManagedNode,
      cancelManagedNodeInstall: mocks.cancelManagedNodeInstall,
      reloadEnvPath: mocks.reloadEnvPath,
      selectNodeFolder: vi.fn(),
      openExternalUrl: mocks.openExternalUrl,
    },
    events: {
      system: {
        onManagedNodeInstallProgress: vi.fn(() => vi.fn()),
      },
    },
  },
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({
    loading: false,
    runApp: mocks.runApp,
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: { id: 1 },
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-resizable-panels", () => ({
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: () => <div />,
}));

vi.mock("./PreviewIframe", () => ({
  PreviewIframe: () => <div>Preview iframe</div>,
}));

vi.mock("./PreviewToolbar", () => ({
  PreviewToolbar: () => null,
}));

vi.mock("./PackageManagerWarningBanner", () => ({
  PackageManagerWarningBanner: () => null,
}));

vi.mock("./CodeView", () => ({
  CodeView: () => <div>Code view</div>,
}));

vi.mock("./ConfigurePanel", () => ({
  ConfigurePanel: () => <div>Configure panel</div>,
}));

vi.mock("./Console", () => ({
  Console: () => null,
}));

vi.mock("./PlanPanel", () => ({
  PlanPanel: () => <div>Plan panel</div>,
}));

vi.mock("./Problems", () => ({
  Problems: () => <div>Problems panel</div>,
}));

vi.mock("./PublishPanel", () => ({
  PublishPanel: () => <div>Publish panel</div>,
}));

vi.mock("./SecurityPanel", () => ({
  SecurityPanel: () => <div>Security panel</div>,
}));

describe("PreviewPanel", () => {
  beforeEach(() => {
    resetPreviewAutoInstallGuardForTests();
    mocks.nodeCheckFailed = false;
    mocks.cancelManagedNodeInstall.mockReset();
    mocks.installManagedNode.mockReset();
    mocks.managedNodeSupported = true;
    mocks.nodeVersion = "v22.14.0";
    mocks.openExternalUrl.mockReset();
    mocks.refetchNodeStatus.mockReset();
    mocks.reloadEnvPath.mockReset();
    mocks.runApp.mockReset();
    mocks.selectAppForPreview.mockReset();
    mocks.settings = {
      disablePreviewNodeAutoInstall: false,
    };
    mocks.updateSettings.mockReset();
    mocks.installManagedNode.mockReturnValue(new Promise(() => {}));
    mocks.cancelManagedNodeInstall.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);
  });

  it("shows preview when Node is known to be installed even if the latest Node check failed", () => {
    mocks.nodeCheckFailed = true;

    render(<PreviewPanel />);

    expect(screen.getByText("Preview iframe")).toBeTruthy();
    expect(
      screen.queryByText("Install Node.js to see your preview"),
    ).toBeNull();
  });

  it("auto-starts managed Node install and skips running the app when Node.js is missing", async () => {
    mocks.nodeVersion = "";

    render(<PreviewPanel />);

    expect(await screen.findByText("Installing Node.js")).toBeTruthy();
    expect(screen.getByText("Your app · localhost")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    await waitFor(() => {
      expect(mocks.installManagedNode).toHaveBeenCalledTimes(1);
    });
    expect(mocks.runApp).not.toHaveBeenCalled();
  });

  it("does not restart the auto-install when the setup card remounts", async () => {
    mocks.nodeVersion = "";

    const { unmount } = render(<PreviewPanel />);
    await waitFor(() => {
      expect(mocks.installManagedNode).toHaveBeenCalledTimes(1);
    });
    unmount();

    render(<PreviewPanel />);

    expect(
      await screen.findByText("Install Node.js to see your preview"),
    ).toBeTruthy();
    expect(mocks.installManagedNode).toHaveBeenCalledTimes(1);
  });

  it("persists opt-out when cancelling automatic managed Node install", async () => {
    mocks.nodeVersion = "";

    render(<PreviewPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(mocks.cancelManagedNodeInstall).toHaveBeenCalledTimes(1);
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        disablePreviewNodeAutoInstall: true,
      });
    });
  });

  it("shows the manual install action when automatic install was disabled", () => {
    mocks.nodeVersion = "";
    mocks.settings = {
      disablePreviewNodeAutoInstall: true,
    };

    render(<PreviewPanel />);

    expect(
      screen.getByText("Install Node.js to see your preview"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Install Node\.js for me/ }),
    ).toBeTruthy();
    expect(mocks.installManagedNode).not.toHaveBeenCalled();
  });

  it("lets unsupported managed-runtime platforms reopen the manual download page while watching for Node.js", () => {
    mocks.nodeVersion = "";
    mocks.managedNodeSupported = false;

    render(<PreviewPanel />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Download Node.js from nodejs.org",
      }),
    );

    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://nodejs.org");
    expect(
      screen.getByRole("button", { name: "Reopen nodejs.org download" }),
    ).toBeTruthy();
  });
});
