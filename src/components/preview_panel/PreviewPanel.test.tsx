import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PreviewPanel,
  resetPreviewAutoInstallGuardForTests,
} from "./PreviewPanel";

const mocks = vi.hoisted(() => ({
  cancelManagedNodeInstall: vi.fn(),
  installManagedNode: vi.fn(),
  nodeCheckFailed: false,
  managedNodeSupported: true,
  nodeVersion: "v22.14.0",
  openExternalUrl: vi.fn(),
  previewMode: "preview" as string,
  previewModeAtom: Symbol("previewModeAtom"),
  previewReloadToken: 0,
  recorderMountCount: 0,
  reloadRecorderPreview: null as (() => void) | null,
  previewNativeViewAppIdAtom: Symbol("previewNativeViewAppIdAtom"),
  previewNativeViewAppId: null as number | null,
  currentTestRunStateAtom: Symbol("currentTestRunStateAtom"),
  testRunPhase: "idle" as "idle" | "setup" | "running",
  setPreviewMode: vi.fn(),
  setPreviewNativeViewAppId: vi.fn(),
  refetchNodeStatus: vi.fn(),
  reloadEnvPath: vi.fn(),
  runApp: vi.fn(),
  previewIframeMounted: vi.fn(),
  previewIframeUnmounted: vi.fn(),
  selectAppForPreview: vi.fn(),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  selectedAppId: 1,
  settings: {
    disablePreviewNodeAutoInstall: false,
  } as Record<string, unknown>,
  updateSettings: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: (atom: symbol) => {
    if (atom === mocks.previewModeAtom) {
      return mocks.previewMode;
    }
    if (atom === mocks.selectedAppIdAtom) {
      return mocks.selectedAppId;
    }
    if (atom === mocks.previewNativeViewAppIdAtom) {
      return mocks.previewNativeViewAppId;
    }
    if (atom === mocks.currentTestRunStateAtom) {
      return { phase: mocks.testRunPhase };
    }
    return undefined;
  },
  useSetAtom: (atom: symbol) => {
    if (atom === mocks.previewModeAtom) {
      return mocks.setPreviewMode;
    }
    if (atom === mocks.previewNativeViewAppIdAtom) {
      return mocks.setPreviewNativeViewAppId;
    }
    return vi.fn();
  },
}));

vi.mock("../../atoms/appAtoms", () => ({
  previewModeAtom: mocks.previewModeAtom,
  selectedAppIdAtom: mocks.selectedAppIdAtom,
}));

vi.mock("@/atoms/previewAtoms", () => ({
  previewNativeViewAppIdAtom: mocks.previewNativeViewAppIdAtom,
}));

vi.mock("@/atoms/testRuntimeAtoms", () => ({
  currentTestRunStateAtom: mocks.currentTestRunStateAtom,
}));

vi.mock("@/preview_console/hooks", () => ({
  useLatestConsoleEntry: () => undefined,
}));

vi.mock("@/hooks/useAppRun", () => ({
  // Reads the hoisted value rather than returning a constant: a test that bumps
  // the token needs the iframe key to actually change, or the remount it means
  // to exercise never happens and everything it asserts afterwards passes on a
  // component that was never re-created.
  usePreviewReloadToken: () => mocks.previewReloadToken,
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

vi.mock("@/hooks/useRunApp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useRunApp")>()),
  useRunApp: () => ({
    loading: false,
    runApp: mocks.runApp,
  }),
}));

vi.mock("@/hooks/useTestRecorder", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useTestRecorder: ({ reloadPreview }: { reloadPreview: () => void }) => {
      mocks.reloadRecorderPreview = reloadPreview;
      const [instanceId] = React.useState(() => ++mocks.recorderMountCount);
      return { instanceId };
    },
  };
});

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: { id: mocks.selectedAppId },
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
  PreviewIframe: ({ recorder }: { recorder: { instanceId: number } }) => {
    useEffect(() => {
      mocks.previewIframeMounted();
      return () => mocks.previewIframeUnmounted();
    }, []);
    return (
      <div data-testid="preview-iframe" data-recorder={recorder.instanceId}>
        Preview iframe
      </div>
    );
  },
}));

vi.mock("./PreviewWebContentsView", () => ({
  PreviewWebContentsView: () => <div>Preview native view</div>,
}));

vi.mock("./PreviewToolbar", () => ({
  PreviewToolbar: () => null,
}));

// The panel only reaches the manager to put the preview back on the app root
// before a recording; standing it up needs the whole provider stack, and this
// suite is about the Node.js setup path and the iframe's remount identity.
vi.mock("@/preview_iframe/PreviewIframeProvider", () => ({
  usePreviewIframeManager: () => ({
    getSnapshot: () => ({ currentUrl: null }),
    send: () => {},
  }),
}));

// The real host reaches for the chat stream to send the assertion request; this
// suite is about the Node.js setup path and the iframe's remount identity.
vi.mock("./RecordingBannerHost", () => ({
  RecordingBannerHost: ({ recorder }: { recorder: { instanceId: number } }) => (
    <div
      data-testid="recording-banner-host"
      data-recorder={recorder.instanceId}
    >
      Recording banner host
    </div>
  ),
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
    mocks.previewReloadToken = 0;
    mocks.recorderMountCount = 0;
    mocks.reloadRecorderPreview = null;
    mocks.refetchNodeStatus.mockReset();
    mocks.reloadEnvPath.mockReset();
    mocks.runApp.mockReset();
    mocks.runApp.mockResolvedValue(undefined);
    mocks.previewIframeMounted.mockReset();
    mocks.previewIframeUnmounted.mockReset();
    mocks.previewMode = "preview";
    mocks.previewNativeViewAppId = null;
    mocks.testRunPhase = "idle";
    mocks.setPreviewMode.mockReset();
    mocks.setPreviewNativeViewAppId.mockReset();
    mocks.selectedAppId = 1;
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

  it("remounts the iframe when switching apps with the same reload token", () => {
    const { rerender } = render(<PreviewPanel />);
    expect(mocks.previewIframeMounted).toHaveBeenCalledTimes(1);

    mocks.selectedAppId = 2;
    rerender(<PreviewPanel />);

    expect(mocks.previewIframeUnmounted).toHaveBeenCalledTimes(1);
    expect(mocks.previewIframeMounted).toHaveBeenCalledTimes(2);
  });

  it("keeps the recorder coordinator mounted when the preview reloads", () => {
    const { rerender } = render(<PreviewPanel />);

    expect(screen.getByTestId("preview-iframe").dataset.recorder).toBe("1");
    expect(mocks.previewIframeMounted).toHaveBeenCalledTimes(1);

    // A token-driven reload: the iframe is re-created, and the recorder that
    // owns the live session must not go with it.
    mocks.previewReloadToken = 1;
    rerender(<PreviewPanel />);

    expect(mocks.previewIframeUnmounted).toHaveBeenCalledTimes(1);
    expect(mocks.previewIframeMounted).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("preview-iframe").dataset.recorder).toBe("1");
    expect(mocks.recorderMountCount).toBe(1);

    // And the recorder's own reload, which is the other way the iframe is
    // re-created — teardown reloads the preview to drop the test user's
    // in-memory session.
    act(() => mocks.reloadRecorderPreview?.());

    expect(mocks.previewIframeMounted).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("preview-iframe").dataset.recorder).toBe("1");
    expect(mocks.recorderMountCount).toBe(1);
  });

  it("renders the native view while a test run drives it", () => {
    mocks.previewNativeViewAppId = 1;
    mocks.testRunPhase = "running";

    render(<PreviewPanel />);

    expect(screen.getByText("Preview native view")).toBeTruthy();
    expect(screen.queryByText("Preview iframe")).toBeNull();
    expect(mocks.setPreviewNativeViewAppId).not.toHaveBeenCalled();
  });

  it("keeps the iframe when no test run has requested the native view", () => {
    render(<PreviewPanel />);

    expect(screen.getByText("Preview iframe")).toBeTruthy();
    expect(screen.queryByText("Preview native view")).toBeNull();
  });

  it("closes the native view and shows the Tests panel once the run finishes", () => {
    mocks.previewNativeViewAppId = 1;
    mocks.testRunPhase = "running";

    const { rerender } = render(<PreviewPanel />);
    expect(mocks.setPreviewNativeViewAppId).not.toHaveBeenCalled();

    mocks.testRunPhase = "idle";
    rerender(<PreviewPanel />);

    expect(mocks.setPreviewNativeViewAppId).toHaveBeenCalledWith(null);
    expect(mocks.setPreviewMode).toHaveBeenCalledWith("tests");
  });

  it("closes the native view without stealing the user's place when they left the preview", () => {
    mocks.previewNativeViewAppId = 1;
    mocks.previewMode = "code";

    render(<PreviewPanel />);

    expect(mocks.setPreviewNativeViewAppId).toHaveBeenCalledWith(null);
    expect(mocks.setPreviewMode).not.toHaveBeenCalled();
  });

  it("keeps the iframe when another app's run owns the native view", () => {
    // The window holds one native view and it belongs to the app whose run
    // opened it. Without the owner check, selecting a second app mid-run would
    // show that app the *other* app's live test page.
    mocks.previewNativeViewAppId = 2;
    mocks.selectedAppId = 1;
    mocks.testRunPhase = "running";

    render(<PreviewPanel />);

    expect(screen.getByText("Preview iframe")).toBeTruthy();
    expect(screen.queryByText("Preview native view")).toBeNull();
  });

  it("leaves another app's native view alone when this app's run state goes idle", () => {
    // `testRunPhase` is the *selected* app's. Acting on it here would tear down
    // a view a different app's run is still driving, and drag that app's
    // preview to the Tests panel.
    mocks.previewNativeViewAppId = 2;
    mocks.selectedAppId = 1;
    mocks.testRunPhase = "running";

    const { rerender } = render(<PreviewPanel />);

    mocks.testRunPhase = "idle";
    rerender(<PreviewPanel />);

    expect(mocks.setPreviewNativeViewAppId).not.toHaveBeenCalled();
    expect(mocks.setPreviewMode).not.toHaveBeenCalled();
  });

  it("leaves an ordinary preview alone when a background test run finishes", () => {
    mocks.testRunPhase = "running";

    const { rerender } = render(<PreviewPanel />);
    mocks.testRunPhase = "idle";
    rerender(<PreviewPanel />);

    expect(mocks.setPreviewNativeViewAppId).not.toHaveBeenCalled();
    expect(mocks.setPreviewMode).not.toHaveBeenCalled();
  });

  it("still gates the native view behind the Node.js requirement", () => {
    mocks.settings = {
      disablePreviewNodeAutoInstall: true,
    };
    mocks.previewNativeViewAppId = 1;
    mocks.testRunPhase = "running";
    mocks.nodeVersion = "";

    render(<PreviewPanel />);

    expect(
      screen.getByText("Install Node.js to see your preview"),
    ).toBeTruthy();
    expect(screen.queryByText("Preview native view")).toBeNull();
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
