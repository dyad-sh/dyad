import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewPanel } from "./PreviewPanel";

const mocks = vi.hoisted(() => ({
  currentConsoleEntriesAtom: Symbol("currentConsoleEntriesAtom"),
  currentPreviewReloadTokenAtom: Symbol("currentPreviewReloadTokenAtom"),
  nodeCheckFailed: false,
  nodeVersion: "v22.14.0",
  previewModeAtom: Symbol("previewModeAtom"),
  refetchNodeStatus: vi.fn(),
  reloadEnvPath: vi.fn(),
  runApp: vi.fn(),
  selectAppForPreview: vi.fn(),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  updateSettings: vi.fn(),
}));

vi.mock("jotai", () => ({
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
  useQuery: () => ({
    data: {
      nodeDownloadUrl: "https://nodejs.org",
      nodeVersion: mocks.nodeVersion,
      pnpmVersion: "10.15.0",
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
      reloadEnvPath: mocks.reloadEnvPath,
      selectNodeFolder: vi.fn(),
      openExternalUrl: vi.fn(),
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
    mocks.nodeCheckFailed = false;
    mocks.nodeVersion = "v22.14.0";
    mocks.refetchNodeStatus.mockReset();
    mocks.reloadEnvPath.mockReset();
    mocks.runApp.mockReset();
    mocks.selectAppForPreview.mockReset();
    mocks.updateSettings.mockReset();
  });

  it("shows preview when Node is known to be installed even if the latest Node check failed", () => {
    mocks.nodeCheckFailed = true;

    render(<PreviewPanel />);

    expect(screen.getByText("Preview iframe")).toBeTruthy();
    expect(
      screen.queryByText("Install Node.js to see your preview"),
    ).toBeNull();
  });

  it("shows the preview-stage setup and skips running the app when Node.js is missing", () => {
    mocks.nodeVersion = "";

    render(<PreviewPanel />);

    expect(
      screen.getByText("Install Node.js to see your preview"),
    ).toBeTruthy();
    expect(screen.getByText("Your app · localhost")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Install Node\.js/ }),
    ).toBeTruthy();
    expect(mocks.runApp).not.toHaveBeenCalled();
  });
});
