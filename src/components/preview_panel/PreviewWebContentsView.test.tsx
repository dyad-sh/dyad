import { act, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  overlayActiveAtom: Symbol("overlayActiveAtom"),
  previewModeAtom: Symbol("previewModeAtom"),
  previewNativeViewAppIdAtom: Symbol("previewNativeViewAppIdAtom"),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  testRunStateAtom: Symbol("testRunStateAtom"),
  testRunPhase: "running" as "idle" | "setup" | "running",
  // Whether renderer UI is currently covering the native surface. Settable so
  // the false branch — where the screenshot fallback must NOT paint — is
  // exercised rather than assumed.
  overlayActive: true,
  setTestSetupOverlayActive: vi.fn(),
  onScreenshotUpdated: vi.fn(),
  screenshotHandler: null as
    | ((payload: { dataUrl: string | null }) => void)
    | null,
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: symbol) => {
    if (atom === h.overlayActiveAtom) return h.overlayActive;
    if (atom === h.selectedAppIdAtom) return 1;
    if (atom === h.testRunStateAtom) return { phase: h.testRunPhase };
    return false;
  },
  useSetAtom: () => vi.fn(),
}));

vi.mock("@/atoms/appAtoms", () => ({
  previewModeAtom: h.previewModeAtom,
  selectedAppIdAtom: h.selectedAppIdAtom,
}));

vi.mock("@/atoms/previewAtoms", () => ({
  previewNativeOverlayActiveAtom: h.overlayActiveAtom,
  previewNativeViewAppIdAtom: h.previewNativeViewAppIdAtom,
}));

vi.mock("@/atoms/testRuntimeAtoms", () => ({
  currentTestRunStateAtom: h.testRunStateAtom,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/ui/tooltip", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({
      children,
      render: trigger,
    }: {
      children: ReactNode;
      render: ReactElement;
    }) => React.cloneElement(trigger, {}, children),
    TooltipContent: ({ children }: { children: ReactNode }) => (
      <span>{children}</span>
    ),
  };
});

vi.mock("@/hooks/useAppRun", () => ({
  useCurrentAppUrl: () => ({
    appUrl: "http://localhost:42101/",
    originalUrl: "http://localhost:42101/",
    mode: "local",
  }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  runAppLifecycleInBackground: vi.fn(),
  useRunApp: () => ({ restartApp: vi.fn() }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { zoomLevel: 0 } }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { createCloudSandboxShareLink: vi.fn() },
    system: { openExternalUrl: vi.fn() },
    previewView: {
      show: vi.fn(async () => {}),
      hide: vi.fn(async () => {}),
      setBounds: vi.fn(),
      setOverlayActive: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
    },
    events: {
      previewView: {
        onNavigationState: vi.fn(() => vi.fn()),
        onLoadFailed: vi.fn(() => vi.fn()),
        onScreenshotUpdated: h.onScreenshotUpdated,
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));
vi.mock("./usePreviewNativeOverlay", () => ({
  usePreviewNativeOverlay: () => h.setTestSetupOverlayActive,
}));
vi.mock("./PreviewLoadingScreen", () => ({
  PreviewLoadingScreen: () => null,
}));

import { PreviewWebContentsView } from "./PreviewWebContentsView";

beforeEach(() => {
  h.testRunPhase = "running";
  h.overlayActive = true;
  h.setTestSetupOverlayActive.mockReset();
  h.screenshotHandler = null;
  h.onScreenshotUpdated.mockReset().mockImplementation((handler) => {
    h.screenshotHandler = handler;
    return vi.fn();
  });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe("PreviewWebContentsView screenshot fallback", () => {
  it("renders the latest in-memory screenshot while the native view is hidden", () => {
    render(<PreviewWebContentsView loading={false} />);

    act(() => {
      h.screenshotHandler?.({
        dataUrl: "data:image/png;base64,first",
      });
    });
    expect(
      screen.getByTestId("preview-native-screenshot").getAttribute("src"),
    ).toBe("data:image/png;base64,first");

    act(() => {
      h.screenshotHandler?.({
        dataUrl: "data:image/png;base64,second",
      });
    });
    expect(
      screen.getByTestId("preview-native-screenshot").getAttribute("src"),
    ).toBe("data:image/png;base64,second");
  });

  it("shows setup feedback over the preview screenshot", () => {
    h.testRunPhase = "setup";
    render(<PreviewWebContentsView loading={false} />);

    expect(h.setTestSetupOverlayActive).toHaveBeenCalledWith(true);
    expect(
      screen.getByTestId("preview-native-test-setup-banner").textContent,
    ).toContain("Setting up tests");

    act(() => {
      h.screenshotHandler?.({
        dataUrl: "data:image/png;base64,setup",
      });
    });

    expect(
      screen
        .getByTestId("preview-native-screenshot")
        .classList.contains("opacity-50"),
    ).toBe(true);
    expect(
      screen.getByTestId("preview-native-test-setup-overlay").textContent,
    ).toContain("Tests will start automatically");
  });

  it("does not cover the preview once tests are running", () => {
    render(<PreviewWebContentsView loading={false} />);

    expect(h.setTestSetupOverlayActive).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("preview-native-test-setup-banner")).toBeNull();
    expect(
      screen.queryByTestId("preview-native-test-setup-overlay"),
    ).toBeNull();
  });

  it("paints nothing over the native view while no overlay is up", () => {
    // The native WebContentsView composites above all renderer DOM, so the
    // screenshot is a stand-in for a surface the user cannot see. Painting it
    // with no overlay up would cover the live page with a frozen frame.
    h.overlayActive = false;
    h.testRunPhase = "setup";
    render(<PreviewWebContentsView loading={false} />);

    act(() => {
      h.screenshotHandler?.({ dataUrl: "data:image/png;base64,hidden" });
    });

    expect(screen.queryByTestId("preview-native-screenshot")).toBeNull();
    expect(
      screen.queryByTestId("preview-native-test-setup-overlay"),
    ).toBeNull();
  });

  it("drops the cached frame when main clears it mid-run", () => {
    // A rotation between isolated tests destroys the page the last frame came
    // from, so main sends null rather than just stopping. Without honoring it
    // the renderer would keep painting the previous test's page.
    render(<PreviewWebContentsView loading={false} />);

    act(() => {
      h.screenshotHandler?.({ dataUrl: "data:image/png;base64,stale" });
    });
    expect(screen.getByTestId("preview-native-screenshot")).toBeTruthy();

    act(() => {
      h.screenshotHandler?.({ dataUrl: null });
    });
    expect(screen.queryByTestId("preview-native-screenshot")).toBeNull();
  });
});
