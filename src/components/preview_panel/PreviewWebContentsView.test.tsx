import { act, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  overlayActiveAtom: Symbol("overlayActiveAtom"),
  previewModeAtom: Symbol("previewModeAtom"),
  previewNativeViewAppIdAtom: Symbol("previewNativeViewAppIdAtom"),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  testRunStateAtom: Symbol("testRunStateAtom"),
  onScreenshotUpdated: vi.fn(),
  screenshotHandler: null as ((payload: { dataUrl: string }) => void) | null,
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: symbol) => {
    if (atom === h.overlayActiveAtom) return true;
    if (atom === h.selectedAppIdAtom) return 1;
    if (atom === h.testRunStateAtom) return { phase: "running" };
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
vi.mock("./PreviewLoadingScreen", () => ({
  PreviewLoadingScreen: () => null,
}));

import { PreviewWebContentsView } from "./PreviewWebContentsView";

beforeEach(() => {
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
});
